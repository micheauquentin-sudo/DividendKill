import { Config } from './config.js';
import { MarketData } from './marketData.js';
import { FmpData } from './fmpData.js';
import { Data, assets, meta } from './data.js';
import { Calc, toE, fE, fPct, eu, getMV, getCost, getPNL, getDivA,
         getTotalDividends, getTotalTaxes, getRealizedGains, getPositions } from './calc.js';
import { DividendSafety, calculateDividendSafety, dseColor, dseLabel, DSE_WEIGHTS } from './dividendSafety.js';
import { Storage, loadImportedTx, saveImportedTx, clearImportedTx } from './storage.js';
import { D1Client } from './d1client.js';
import { BrokerImport, processCsv, applyImportedToPortfolio } from './brokerImport.js';
import { getDivBadge } from './dividendTiers.js';
import { _esc, _emptyState, buildSVG, _logo } from './ui-shared.js';

// Expose Calc.raw as a live window getter so render functions can access 'raw' as bare variable
Object.defineProperty(window, 'raw', { get: () => Calc.raw, configurable: true });

/* ════════════════════════════════════════════════════════════════
   MODULE: UI.Nav — Navigation, KPI Bar, init
   ════════════════════════════════════════════════════════════════ */
const EURUSD = Config.EURUSD;
const NAV_EUR = Config.NAV_EUR;

/* PERF rétrocompat */
const PERF = Data.PERF;

let _cur      = 0;
let _rendered = {};
const _noKPI  = {accueil:1, news:1, impots:1, import:1};

function _animKpiVal(id, newText, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== newText) {
    el.textContent = newText;
    el.classList.remove('anim-num');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('anim-num');
    setTimeout(() => el.classList.remove('anim-num'), 350);
  }
  if (color !== undefined) el.style.color = color;
}

function buildKPI() {
  const bar = document.getElementById('kpiBar');
  if (!bar) return;
  const mv = getMV(), pnl = getPNL(), cost = getCost(), diva = getDivA();
  const pp      = cost > 0 ? pnl / cost * 100 : 0;
  const yld     = mv   > 0 ? diva / mv * 100  : 0;
  const monthly = diva / 12 / Calc.eu();
  const fire    = Config.TARGET_MONTHLY > 0 ? Math.min(100, Math.round(monthly / Config.TARGET_MONTHLY * 100)) : 0;
  const fireC   = fire >= 100 ? '#22d47a' : fire >= 70 ? '#86efad' : fire >= 40 ? '#f5a623' : '#f43f5e';

  _animKpiVal('kv0', fE(mv));
  document.getElementById('ks0').textContent = fPct(pp, 1);
  _animKpiVal('kv1', Math.round(monthly).toLocaleString('fr-FR') + ' €');
  document.getElementById('ks1').textContent = 'par mois';
  _animKpiVal('kv2', yld.toFixed(2) + '%');
  document.getElementById('ks2').textContent = Math.round(diva / Calc.eu()) + ' €/an';
  _animKpiVal('kv3', fire + '%', fireC);
  document.getElementById('ks3').textContent = Math.round(monthly) + ' / ' + Config.TARGET_MONTHLY + ' €';
  const _curPid = document.querySelector('.tab.on')?.dataset?.p || '';
  bar.classList.toggle('on', !_noKPI[_curPid]);
}

function goTo(idx) {
  const tabs   = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  _cur = idx;
  window._curTab = idx;
  try { localStorage.setItem('dk_active_tab', idx); } catch(_) {}
  tabs.forEach((t, i)   => t.classList.toggle('on', i === idx));
  panels.forEach(p      => p.classList.remove('on'));
  const pid = tabs[idx]?.dataset?.p;
  const el  = pid ? document.getElementById(`panel-${pid}`) : null;
  if (el) {
    el.classList.add('on');
    if (pid === 'dividendes') { renderPanel(pid, el); }
    else if (!_rendered[pid]) { _rendered[pid] = 1; renderPanel(pid, el); }
  }
  const inner = document.getElementById('panels-inner');
  if (inner) inner.style.transform = `translateX(calc(-${idx} * 100vw))`;
  tabs[idx]?.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});
  buildKPI();
}

const _panelMods = {};
async function renderPanel(pid, el) {
  try {
    switch (pid) {
      case 'accueil':      renderAccueil(el);      return;
      case 'deal':         renderDeal(el);         return;
      case 'rendement':
        if (!_panelMods.rendement) _panelMods.rendement = await import('./panels/rendement.js');
        _panelMods.rendement.renderRendement(el); return;
      case 'impots':
        if (!_panelMods.impots) {
          _panelMods.impots = await import('./panels/impots.js');
          Object.assign(window, {
            _renderImpotUpload: _panelMods.impots._renderImpotUpload,
            _renderImpotManual: _panelMods.impots._renderImpotManual,
            _handleImpotFile:   _panelMods.impots._handleImpotFile,
            _impotManualSave:   _panelMods.impots._impotManualSave,
          });
        }
        _panelMods.impots.renderImpots(el); return;
      case 'import':
        if (!_panelMods.importPanel) {
          _panelMods.importPanel = await import('./panels/import.js');
          window.renderImportStatus  = _panelMods.importPanel.renderImportStatus;
          window.renderImportPreview = _panelMods.importPanel.renderImportPreview;
        }
        _panelMods.importPanel.renderImport(el); return;
      case 'secteurs':
        if (!_panelMods.secteurs) _panelMods.secteurs = await import('./panels/secteurs.js');
        _panelMods.secteurs.renderSecteurs(el); return;
      case 'dividendes':
        if (!_panelMods.dividendes) _panelMods.dividendes = await import('./panels/dividendes.js');
        _panelMods.dividendes.renderDividendes(el); return;
      case 'calendar':
        if (!_panelMods.calendar) _panelMods.calendar = await import('./panels/calendar.js');
        _panelMods.calendar.renderCalendar(el); return;
      case 'valorisation':
        if (!_panelMods.val) _panelMods.val = await import('./panels/valorisation.js');
        _panelMods.val.renderValorisation(el); return;
      case 'news':
        if (!_panelMods.val) _panelMods.val = await import('./panels/valorisation.js');
        _panelMods.val.renderNews(el); return;
    }
  } catch(e) {
    el.innerHTML = `<div style="padding:20px;color:#f43f5e;font-size:12px;font-family:monospace">Erreur [${pid}]: ${e.message}</div>`;
  }
}

function safetyLabel(sc) { return Calc.safetyLabel(sc); }
function getPortfolioDSE() { return DividendSafety.getPortfolioDSE(); }


/* -- ACCUEIL ---------------------------------------------- */
var _mode = '1Y';
var _hoverIdx = -1;
var _navHistory = null; // { nav: [{date, nav_usd}] } chargé depuis /api/nav
var _spyHistory = null; // [{date, close}] chargé depuis /api/benchmark


function renderAccueil(el) {
  el._drawAcc = _drawAccueil;
  _drawAccueil(el);
}

function _buildSpyOverlay(pts) {
  if (!_spyHistory || _spyHistory.length < 2 || !_navHistory || _navHistory.length < 2) return null;
  var now = new Date();
  var spyMap = {};
  for (var i = 0; i < _spyHistory.length; i++) spyMap[_spyHistory[i].date] = _spyHistory[i].close;
  var hist = _navHistory;
  var dates = [];
  if (_mode === '1D') {
    var sl = hist.slice(-2); for (var a=0;a<sl.length;a++) dates.push(sl[a].date);
  } else if (_mode === '7D') {
    var sl7 = hist.slice(-7); for (var b=0;b<sl7.length;b++) dates.push(sl7[b].date);
  } else if (_mode === 'MTD') {
    var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    for (var c=0;c<hist.length;c++) { if (hist[c].date >= firstOfMonth) dates.push(hist[c].date); }
  } else {
    var oneYearAgo = new Date(now.getTime() - 365*86400000).toISOString().slice(0,10);
    for (var d=0;d<hist.length;d++) { if (hist[d].date >= oneYearAgo) dates.push(hist[d].date); }
  }
  if (dates.length < 2 || dates.length !== pts.length) return null;
  var closes = []; var lastC = null;
  for (var n=0;n<dates.length;n++) {
    var cv = spyMap[dates[n]]; if (cv != null) lastC = cv; closes.push(lastC);
  }
  var firstVal = null;
  for (var p=0;p<closes.length;p++) { if (closes[p] != null) { firstVal = closes[p]; break; } }
  if (!firstVal) return null;
  for (var q=0;q<closes.length;q++) { if (closes[q] == null) closes[q] = firstVal; }
  var spyStart = closes[0];
  return closes.map(function(cv){ return cv / spyStart * pts[0]; });
}

function _buildNavPts(mv, dpnl, pnl, cost) {
  var hist = _navHistory && _navHistory.length >= 2 ? _navHistory : null;
  if (hist) {
    var now = new Date();
    var isoToday = now.toISOString().slice(0, 10);
    // S'assure que le dernier point reflète la valeur live actuelle
    var pts_hist = hist.map(function(d) { return d.nav_usd; });
    pts_hist[pts_hist.length - 1] = mv; // remplace par valeur live
    if (_mode === '1D') {
      // Hier vs aujourd'hui
      var prev = pts_hist.length >= 2 ? pts_hist[pts_hist.length - 2] : Math.max(mv - dpnl, 0.01);
      return [prev, mv];
    }
    if (_mode === '7D') {
      var slice7 = pts_hist.slice(-7);
      if (slice7.length < 2) slice7 = [Math.max(mv - dpnl * 5, 0.01), mv];
      return slice7;
    }
    if (_mode === 'MTD') {
      var y = now.getFullYear(), m = now.getMonth();
      var firstOfMonth = new Date(y, m, 1).toISOString().slice(0, 10);
      var mtdSlice = [];
      for (var i = 0; i < hist.length; i++) { if (hist[i].date >= firstOfMonth) mtdSlice.push(hist[i].nav_usd); }
      mtdSlice[mtdSlice.length > 0 ? mtdSlice.length - 1 : 0] = mv;
      return mtdSlice.length >= 2 ? mtdSlice : [Math.max(mv - pnl * 0.1, 0.01), mv];
    }
    // 1Y — dernier 365 jours (max 260 points de trading)
    var oneYearAgo = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10);
    var y1Slice = [];
    for (var j = 0; j < hist.length; j++) { if (hist[j].date >= oneYearAgo) y1Slice.push(hist[j].nav_usd); }
    y1Slice[y1Slice.length > 0 ? y1Slice.length - 1 : 0] = mv;
    return y1Slice.length >= 2 ? y1Slice : [Math.max(cost, 0.01), mv];
  }
  // Fallback synthétique (avant que le cron ait tourné)
  if (_mode === '1D') return [Math.max(mv - dpnl, 0.01), mv];
  if (_mode === '7D') {
    var w0 = Math.max(mv - dpnl * 5, 0.01);
    return [w0, w0+(mv-w0)/6, w0+(mv-w0)*2/6, w0+(mv-w0)*3/6, w0+(mv-w0)*4/6, w0+(mv-w0)*5/6, mv];
  }
  if (_mode === 'MTD') {
    var m0 = Math.max(mv - pnl * 0.15, 0.01);
    return Array.from({length:22}, function(_,i){ return m0 + (mv-m0)*i/21; }).map(function(v,i,a){ return i===a.length-1?mv:v; });
  }
  var y0 = Math.max(cost, 0.01);
  return Array.from({length:12}, function(_,i){ return y0 + (mv-y0)*i/11; }).map(function(v,i,a){ return i===a.length-1?mv:v; });
}

function _drawAccueil(el) {
  /* ── État vide : aucune position ── */
  if (raw.length === 0) {
    el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:24px 16px;text-align:center">'
      + '<div style="font-size:56px;margin-bottom:20px">📊</div>'
      + '<div style="font-size:22px;font-weight:700;letter-spacing:-.5px;margin-bottom:8px">Portefeuille vide</div>'
      + '<div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:28px;max-width:280px">Importe un relevé CSV IBKR ou saisis tes actions manuellement pour démarrer.</div>'
      + '<button onclick="goTo(9)" style="width:100%;max-width:300px;padding:14px;border-radius:14px;background:var(--violet);color:#fff;font-weight:700;font-size:15px;cursor:pointer;border:none;margin-bottom:12px">📂 Importer un CSV</button>'
      + '<button onclick="goTo(9);setTimeout(function(){switchImportTab(\'manual\');},100)" style="width:100%;max-width:300px;padding:14px;border-radius:14px;background:var(--surface);color:var(--text);font-weight:700;font-size:15px;cursor:pointer;border:1px solid var(--border)">✏️ Saisie manuelle</button>'
      + '</div>';
    return;
  }

  var mv = getMV(), cost = getCost(), pnl = getPNL();
  var pp  = cost > 0 ? pnl/cost*100 : 0;
  var dpnl = 0;
  for (var k = 0; k < raw.length; k++) dpnl += raw[k].dpnl || 0;
  var dpnlEur = toE(dpnl);
  var dpnlPct = (mv - dpnl) > 0 ? dpnl / (mv - dpnl) * 100 : 0;
  var dCol = dpnl >= 0 ? '#10b981' : '#f43f5e';
  // Build chart pts (USD) — vraies données si disponibles, sinon synthétique
  var pts = _buildNavPts(mv, dpnl, pnl, cost);
  var spyPts = _buildSpyOverlay(pts);
  var col = (_mode === '1D') ? (dpnl >= 0 ? '#10b981' : '#f43f5e') : (pnl >= 0 ? '#10b981' : '#f43f5e');
  var hIdx = (_hoverIdx >= 0 && _hoverIdx < pts.length) ? _hoverIdx : pts.length - 1;
  var hVal = pts[hIdx], hVal0 = pts[0];
  var hG = hVal - hVal0, hP = hVal0>0?hG/hVal0*100:0;
  var hCol = hG >= 0 ? '#10b981' : '#f43f5e';
  var spyInitPct = null, spyInitAlpha = null;
  if (spyPts && spyPts.length === pts.length) {
    var _sV = spyPts[hIdx], _sG = _sV - hVal0, _sP = hVal0 > 0 ? _sG/hVal0*100 : 0;
    spyInitPct = _sP; spyInitAlpha = hP - _sP;
  }
  var sorted;
  if (_mode === '1D') {
    // 1 jour : trier par % variation du jour (dpnl / mv)
    sorted = raw.slice().sort(function(a,b){
      var pa = a.mv > 0 ? (a.dpnl||0) / (a.mv - (a.dpnl||0)) * 100 : 0;
      var pb = b.mv > 0 ? (b.dpnl||0) / (b.mv - (b.dpnl||0)) * 100 : 0;
      return pb - pa;
    });
  } else if (_mode === '7D') {
    // 7 jours : trier par P&L% hebdo estimé (pnl * 0.07 proxy ou variation prix récente)
    // On utilise dpnl*5 comme proxy semaine vs pnl long terme
    sorted = raw.slice().sort(function(a,b){
      var va = (a.dpnl||0) * 5;
      var vb = (b.dpnl||0) * 5;
      return vb - va;
    });
  } else if (_mode === 'MTD') {
    // Mois en cours : trier par P&L absolu (meilleur proxy disponible)
    sorted = raw.slice().sort(function(a,b){ return (b.pnl||0) - (a.pnl||0); });
  } else {
    // Long terme 1Y : trier par P&L% total
    sorted = raw.slice().sort(function(a,b){
      var ppa = a.avg > 0 ? (a.price-a.avg)/a.avg*100 : 0;
      var ppb = b.avg > 0 ? (b.price-b.avg)/b.avg*100 : 0;
      return ppb - ppa;
    });
  }
  function mrow(d, cls) {
    var pct = d.avg > 0 ? (d.price-d.avg)/d.avg*100 : 0;
    // % pondéré par volume = PnL% × (MV / totalMV portefeuille)
    var totalMVRef = getMV();
    var weight = totalMVRef > 0 ? d.mv / totalMVRef * 100 : 0;
    var pnlEur = Math.round(toE(d.pnl));
    var pctStr, amtStr;
    if (_mode === '1D') {
      var val = d.dpnl || 0;
      var valE = Math.round(toE(val));
      var dayPct = d.mv > 0 ? (val / (d.mv - val)) * 100 : 0;
      pctStr = (dayPct >= 0 ? '+' : '') + dayPct.toFixed(2) + '%';
      amtStr = (valE >= 0 ? '+' : '') + valE + '\u20ac · ' + weight.toFixed(1) + '% ptf';
    } else if (_mode === '7D') {
      var val7 = (d.dpnl || 0) * 5;
      var val7E = Math.round(toE(val7));
      var w7Pct = d.mv > 0 ? (val7 / d.mv) * 100 : 0;
      pctStr = (w7Pct >= 0 ? '+' : '') + w7Pct.toFixed(2) + '%';
      amtStr = (val7E >= 0 ? '+' : '') + val7E + '\u20ac · ' + weight.toFixed(1) + '% ptf';
    } else if (_mode === 'MTD') {
      pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      amtStr = (pnlEur >= 0 ? '+' : '') + pnlEur.toLocaleString('fr-FR') + '\u20ac · ' + weight.toFixed(1) + '% ptf';
    } else {
      pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      amtStr = (pnlEur >= 0 ? '+' : '') + pnlEur.toLocaleString('fr-FR') + '\u20ac · ' + weight.toFixed(1) + '% ptf';
    }
    return '<div class="mrow"><div style="display:flex;align-items:center;gap:5px">' + _logo(d.ticker, 18) + '<span class="mrow-tk">' + d.ticker + '</span></div>'
      + '<div style="text-align:right">'
      + '<span class="mrow-v ' + cls + '">' + pctStr + '</span>'
      + (amtStr ? '<div style="font-size:9.5px;color:var(--muted);font-family:DM Mono,monospace">' + amtStr + '</div>' : '')
      + '</div></div>';
  }
  var gH = '', lH = '';
  var topN = Math.min(3, sorted.length);
  for (var a = 0; a < topN; a++) gH += mrow(sorted[a], 'up');
  // FLOP : exclure les entrées déjà en TOP et ne montrer que les vrais sous-performants
  var flopCount = 0;
  for (var b = sorted.length - 1; b >= topN && flopCount < 3; b--) {
    var _pct = sorted[b].avg > 0 ? (sorted[b].price - sorted[b].avg) / sorted[b].avg * 100 : 0;
    var _val = _mode === '1D' ? (sorted[b].dpnl || 0)
             : _mode === '7D' ? (sorted[b].dpnl || 0) * 5
             : sorted[b].pnl || 0;
    // Pour 1Y/MTD : ne montrer que si performance négative
    // Pour 1D/7D  : montrer les pires même si positifs (variations intraday)
    if (_mode === '1D' || _mode === '7D' || _pct < 0) {
      lH += mrow(sorted[b], 'dn');
      flopCount++;
    }
  }
  function ctbtn(v, lbl) {
    return '<button class="ctbtn' + (_mode === v ? ' on' : '') + '" data-m="' + v + '">' + lbl + '</button>';
  }
  var yld = mv > 0 ? getDivA()/mv*100 : 0;
  var yoc = cost > 0 ? getDivA()/cost*100 : 0;
  var sc  = DividendSafety.getPortfolioDSE();
  var scCol = sc >= 80 ? '#10b981' : sc >= 65 ? '#86efad' : sc >= 50 ? '#f5a623' : '#f43f5e';
  var monthly = getDivA() / 12 / eu();
  var fire = Config.TARGET_MONTHLY > 0 ? Math.min(100, Math.round(monthly / Config.TARGET_MONTHLY * 100)) : 0;
  var fireC = fire >= 100 ? '#22d47a' : fire >= 70 ? '#86efad' : fire >= 40 ? '#f5a623' : '#f43f5e';
  var hLabel = hIdx === pts.length-1 ? 'Actuel' : 'J-' + (pts.length-1-hIdx);
  el.innerHTML = '<div class="home-wrap">'
    + '<div class="home-label">Portefeuille \u00b7 IBKR \u00b7 ' + new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) + '</div>'
    + '<div class="home-nav" id="accNav">' + Math.round(hVal/eu()).toLocaleString('fr-FR') + ' \u20ac</div>'
    + '<div class="home-daily">'
    +   '<span class="home-daily-amt" style="color:' + dCol + '">' + (dpnlEur >= 0 ? '+' : '') + Math.round(dpnlEur).toLocaleString('fr-FR') + ' \u20ac</span>'
    +   '<span class="' + (dpnlEur >= 0 ? 'badge-up' : 'badge-dn') + '">' + (dpnlPct >= 0 ? '+' : '') + dpnlPct.toFixed(2) + '%</span>'
    +   '<span class="home-daily-lbl">aujourd\u2019hui</span>'
    + '</div>'
    + '<div class="home-sub">'
    +   '<span class="home-pnl" id="accPnl" style="color:' + hCol + '">' + (hG >= 0 ? '+' : '') + Math.round(hG/eu()).toLocaleString('fr-FR') + ' \u20ac</span>'
    +   '<span class="' + (hG >= 0 ? 'badge-up' : 'badge-dn') + '" id="accPct">' + (hG >= 0 ? '+' : '') + hP.toFixed(2) + '%</span>'
    +   '<span class="mu" style="font-size:11px" id="accLabel">' + hLabel + '</span>'
    + '</div>'
    + '<div class="home-chart" id="accChart"></div>'
    + '<div class="chart-toggle">' + ctbtn('1Y','1 an') + ctbtn('MTD','Mois') + ctbtn('7D','7 j') + ctbtn('1D','Auj.') + '</div>'
    + (spyPts ? '<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 2px 2px;margin-top:2px"><span id="accSpyPct" style="font-size:11px;color:#6b7280;font-family:DM Mono,monospace">S&amp;P 500 '+(spyInitPct!==null?(spyInitPct>=0?'+':'')+spyInitPct.toFixed(2)+'%':'--')+'</span><span id="accAlpha" class="'+(spyInitAlpha!==null&&spyInitAlpha>=0?'badge-up':'badge-dn')+'" style="font-size:10px">\u03b1 '+(spyInitAlpha!==null?(spyInitAlpha>=0?'+':'')+spyInitAlpha.toFixed(2)+'%':'--')+'</span></div>' : '')
    + '<div class="row3">'    +   '<div class="mini-k"><div class="mini-k-l">YoC</div><div class="mini-k-v up">' + yoc.toFixed(2) + '%</div><div class="mini-k-s">Sur coût</div></div>'    +   '<div class="mini-k"><div class="mini-k-l">Score</div><div class="mini-k-v" style="color:' + scCol + '">' + sc + '</div><div class="mini-k-s">/100</div></div>'    +   '<div class="mini-k"><div class="mini-k-l">Div. annuel</div><div class="mini-k-v" style="color:#86efad">' + Math.round(getDivA()/eu()) + '€</div><div class="mini-k-s">brut/an</div></div>'    + '</div>'
        + '<div class="row3">'    +   '<div class="mini-k"><div class="mini-k-l">Yield</div><div class="mini-k-v up">' + yld.toFixed(2) + '%</div><div class="mini-k-s">' + Math.round(getDivA()/eu()) + '€/an</div></div>'    +   '<div class="mini-k"><div class="mini-k-l">Rev.mois</div><div class="mini-k-v" style="color:#86efad">' + Math.round(monthly) + '€</div><div class="mini-k-s">Revenu passif</div></div>'    +   '<div class="mini-k"><div class="mini-k-l">FIRE</div><div class="mini-k-v" style="color:' + fireC + '">' + fire + '%</div><div class="mini-k-s">Progression</div></div>'    + '</div>'
    + '<div class="movers">'
    +   '<div><div class="mover-t">\u25b2 Top ' + (_mode==='1D'?'Auj.':_mode) + '</div>' + gH + '</div>'
    +   '<div><div class="mover-t">\u25bc Flop ' + (_mode==='1D'?'Auj.':_mode) + '</div>' + lH + '</div>'
    + '</div>'
    + '</div>';
  var chartEl = document.getElementById('accChart');
  if (chartEl) _buildInteractiveChart(chartEl, pts, col, hIdx, spyPts);
  var btns = el.querySelectorAll('.ctbtn');
  for (var ci = 0; ci < btns.length; ci++) {
    (function(b) {
      b.addEventListener('click', function() {
        _mode = b.dataset.m; _hoverIdx = -1; _drawAccueil(el);
      });
    })(btns[ci]);
  }
}

function _buildInteractiveChart(container, pts, col, activeIdx, spyPts) {
  var W = 360, H = Math.max(115, container.offsetHeight || 130);
  var mn = pts[0], mx = pts[0];
  for (var i=1;i<pts.length;i++){if(pts[i]<mn)mn=pts[i];if(pts[i]>mx)mx=pts[i];}
  if (spyPts && spyPts.length === pts.length) {
    for (var si=0;si<spyPts.length;si++){if(spyPts[si]<mn)mn=spyPts[si];if(spyPts[si]>mx)mx=spyPts[si];}
  }
  var rng = mx - mn || 1;
  function px(i){ return ((i/(pts.length-1))*W).toFixed(1); }
  function py(v){ return (H - ((v-mn)/rng*(H*0.82)+H*0.09)).toFixed(1); }
  var d='M'+px(0)+' '+py(pts[0]);
  for(var j=1;j<pts.length;j++) d+=' L'+px(j)+' '+py(pts[j]);
  var fill=d+' L'+W+' '+H+' L0 '+H+' Z';
  var gid='gc'+(col.replace('#',''));
  var aIdx = activeIdx >= 0 ? activeIdx : pts.length-1;
  var ax = parseFloat(px(aIdx)), ay = parseFloat(py(pts[aIdx]));
  var spyLine = '', spyDotSvg = '';
  if (spyPts && spyPts.length === pts.length) {
    var ds='M'+px(0)+' '+py(spyPts[0]);
    for(var sk=1;sk<spyPts.length;sk++) ds+=' L'+px(sk)+' '+py(spyPts[sk]);
    spyLine = '<path d="'+ds+'" fill="none" stroke="#6b7280" stroke-width="1.4" stroke-dasharray="4,3" stroke-linejoin="round" opacity="0.7"/>';
    spyDotSvg = '<circle id="chartSpyDot" cx="'+ax+'" cy="'+parseFloat(py(spyPts[aIdx]))+'" r="3.5" fill="#6b7280" stroke="#08080f" stroke-width="2"/>';
  }
  container.innerHTML = '<svg id="accSvg" viewBox="0 0 '+W+' '+H+'" style="width:100%;display:block;height:100%;min-height:'+H+'px;touch-action:pan-y;cursor:crosshair" preserveAspectRatio="none">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+col+'" stop-opacity="0.28"/>'
    +'<stop offset="100%" stop-color="'+col+'" stop-opacity="0.02"/>'
    +'</linearGradient></defs>'
    +'<path d="'+fill+'" fill="url(#'+gid+')" />'
    +spyLine
    +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.8" stroke-linejoin="round"/>'
    +'<line id="chartCursor" x1="'+ax+'" y1="0" x2="'+ax+'" y2="'+H+'" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="3,3"/>'
    +spyDotSvg
    +'<circle id="chartDot" cx="'+ax+'" cy="'+ay+'" r="5" fill="'+col+'" stroke="#08080f" stroke-width="2.5"/>'
    +'</svg>';
  var svg = document.getElementById('accSvg');
  if (!svg) return;
  function getIdx(clientX) {
    var rect = svg.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (pts.length-1));
  }
  function updateCursor(idx) {
    var cursor = document.getElementById('chartCursor');
    var dot    = document.getElementById('chartDot');
    var spyDot = document.getElementById('chartSpyDot');
    var navEl  = document.getElementById('accNav');
    var pnlEl  = document.getElementById('accPnl');
    var pctEl  = document.getElementById('accPct');
    var lblEl  = document.getElementById('accLabel');
    var spyEl  = document.getElementById('accSpyPct');
    var alphaEl= document.getElementById('accAlpha');
    if (!cursor) return;
    var x = parseFloat(px(idx)), y = parseFloat(py(pts[idx]));
    cursor.setAttribute('x1',x); cursor.setAttribute('x2',x);
    if (dot) { dot.setAttribute('cx',x); dot.setAttribute('cy',y); }
    if (spyDot && spyPts && spyPts.length === pts.length) {
      spyDot.setAttribute('cx', x);
      spyDot.setAttribute('cy', parseFloat(py(spyPts[idx])));
    }
    _hoverIdx = idx;
    var hV=pts[idx], h0=pts[0], hG=hV-h0, hP=h0>0?hG/h0*100:0;
    var hC=hG>=0?'#10b981':'#f43f5e';
    if (navEl) navEl.textContent=Math.round(hV/eu()).toLocaleString('fr-FR')+' €';
    if (pnlEl){pnlEl.textContent=(hG>=0?'+':'')+Math.round(hG/eu()).toLocaleString('fr-FR')+' €';pnlEl.style.color=hC;}
    if (pctEl){pctEl.textContent=(hG>=0?'+':'')+hP.toFixed(2)+'%';pctEl.className=(hG>=0?'badge-up':'badge-dn');}
    if (lblEl) lblEl.textContent=idx===pts.length-1?'Actuel':'J-'+(pts.length-1-idx);
    if (spyEl && spyPts && spyPts.length === pts.length) {
      var sV=spyPts[idx], sG=sV-h0, sP=h0>0?sG/h0*100:0;
      spyEl.textContent='S&P 500 '+(sP>=0?'+':'')+sP.toFixed(2)+'%';
      if (alphaEl) {
        var alpha=hP-sP;
        alphaEl.textContent='α '+(alpha>=0?'+':'')+alpha.toFixed(2)+'%';
        alphaEl.className=alpha>=0?'badge-up':'badge-dn';
        alphaEl.style.fontSize='10px';
      }
    }
  }
  svg.addEventListener('mousemove', function(e){ updateCursor(getIdx(e.clientX)); });
  svg.addEventListener('touchstart', function(e){ e.preventDefault(); updateCursor(getIdx(e.touches[0].clientX)); }, {passive:false});
  svg.addEventListener('touchmove', function(e){ e.preventDefault(); e.stopPropagation(); updateCursor(getIdx(e.touches[0].clientX)); }, {passive:false});
  svg.addEventListener('mouseleave', function(){ updateCursor(pts.length-1); });
}






/* -- TICKER DATABASE (static fundamentals: sector, beta, d, pe, streak) -- */
const TICKER_DB = {
  ACN:  {pe_cur:11.6,pe_5y:28.1,fair:346,streak:20,safe:82,sector:'Tech',     beta:1.20,d:4.64,moat:'500k consultants 120 pays, contrats pluriannuels, switching cost \u00e9lev\u00e9.',risk:'Budgets IT compressibles. IA g\u00e9n\u00e9rative sur missions standardis\u00e9es.',why:'ACN -49% depuis son pic. P/E 11.6x vs 28x historique. Yield 3.94% record absolu.'},
  ADP:  {pe_cur:25.4,pe_5y:30.2,fair:362,streak:50,safe:92,sector:'Tech',     beta:0.85,d:6.16,moat:'Leader paie USA, 1M entreprises clientes, int\u00e9grations ERP profondes.',risk:'Ralentissement emploi US. Pression Workday/Ceridian.',why:'50 ans de hausse dividende. Mod\u00e8le SaaS r\u00e9current. P/E 25x vs 30x historique.'},
  APD:  {pe_cur:20.8,pe_5y:26.4,fair:361,streak:42,safe:75,sector:'Mat.',     beta:0.85,d:8.00,moat:'Infrastructure gazi\u00e8re irr\u00e9plicable, contrats take-or-pay 15-20 ans.',risk:'H2 vert incertain. CapEx intense.',why:'Diversifi\u00e9 H2 vert. Yield 7.4% sur PRU. Contrats s\u00e9curis\u00e9s.'},
  BMY:  {pe_cur:7.2, pe_5y:11.8,fair:72, streak:16,safe:62,sector:'Sant\u00e9',    beta:0.35,d:2.40,moat:'Pipeline oncologie Opdivo. Brevets prot\u00e9g\u00e9s jusqu\'en 2030.',risk:'Expiration brevets 2026-2027. Pression g\u00e9n\u00e9riques.',why:'P/E 7.2x, yield 2.36%, d\u00e9cote vs pairs pharma.'},
  CMCSA:{pe_cur:6.8, pe_5y:10.8,fair:38, streak:14,safe:58,sector:'M\u00e9dias',   beta:1.00,d:1.24,moat:'Infrastructure c\u00e2ble irr\u00e9plicable. Bundle internet/TV/mobile.',risk:'Cord-cutting acc\u00e9l\u00e9r\u00e9. Comp\u00e9tition fibre AT&T/Verizon.',why:'P/E 6.8x historiquement bas. Yield 5.51%. Rachats agressifs.'},
  CTBI: {pe_cur:13.1,pe_5y:14.2,fair:85, streak:22,safe:70,sector:'Finance',  beta:0.60,d:1.92,moat:'Banque communautaire Kentucky, faible concurrence locale.',risk:'Exposition immobilier r\u00e9gional. Taux bas.',why:'CTBI +102% vs PRU. Dividende stable 22 ans.'},
  HRL:  {pe_cur:14.2,pe_5y:21.8,fair:36, streak:57,safe:55,sector:'Conso.',   beta:0.50,d:1.10,moat:'Spam, Hormel Natural Choice. 57 ans hausse (Dividend King).',risk:'Co\u00fbts mati\u00e8res premi\u00e8res. Marges sous pression.',why:'Dividend King 57 ans. P/E 14x vs 22x historique. D\u00e9cote -22%.'},
  HTO:  {pe_cur:10.2,pe_5y:12.8,fair:72, streak:0, safe:50,sector:'Finance',  beta:0.70,d:0.00,moat:'Pr\u00eatuer sur gages UK leader, 270 agences.',risk:'R\u00e9gulation FCA. Exposition GBP. Pas de dividende.',why:'HTO +38% vs PRU. Valorisation attractive. Mod\u00e8le contra-cyclique.'},
  JNJ:  {pe_cur:15.8,pe_5y:17.2,fair:282,streak:62,safe:97,sector:'Sant\u00e9',    beta:0.55,d:4.96,moat:'MedTech/Pharma diversifi\u00e9. 62 ans hausse. AAA credit.',risk:'Contentieux talc. G\u00e9n\u00e9riques Stelara.',why:'JNJ Dividend King 62 ans. P/E 15.8x. Mod\u00e8le d\u00e9fensif AAA.'},
  MDT:  {pe_cur:14.1,pe_5y:17.5,fair:98, streak:47,safe:80,sector:'Sant\u00e9',    beta:0.90,d:2.80,moat:'Dispositifs m\u00e9dicaux #1 mondial. 47 ans hausse.',risk:'Concurrence Abbott/Boston Scientific.',why:'MDT -3% vs PRU. P/E 14x vs 17.5x historique. D\u00e9cote injustifi\u00e9e.'},
  MMM:  {pe_cur:14.5,pe_5y:17.3,fair:198,streak:66,safe:72,sector:'Industrie',beta:0.90,d:1.76,moat:'66 ans hausse. 55k produits, 60k brevets.',risk:'Restructuration post-Solventum. March\u00e9s cycliques.',why:'3M +58% vs PRU. Restructuration prometteuse. Dividende s\u00e9curis\u00e9.'},
  NEE:  {pe_cur:17.4,pe_5y:22.6,fair:108,streak:28,safe:78,sector:'Utilities',beta:0.50,d:2.06,moat:'#1 renouvelable USA. Pipeline 15GW. PPA long terme.',risk:'Taux \u00e9lev\u00e9s (CapEx). R\u00e9gulation \u00e9tatique.',why:'NEE +24% vs PRU. M\u00e9gatrend renouvelable. Div +10%/an 2028.'},
  NFG:  {pe_cur:13.8,pe_5y:16.2,fair:94, streak:54,safe:74,sector:'Utilities',beta:0.55,d:1.88,moat:'54 ans hausse. Utility gaz NY/PA. R\u00e9gulation protectrice.',risk:'Transition gaz. R\u00e9gulation NYS.',why:'NFG +42% vs PRU. Utility d\u00e9fensive. 54 ans croissance div.'},
  NNN:  {pe_cur:15.2,pe_5y:18.4,fair:58, streak:35,safe:76,sector:'Immo.',    beta:0.90,d:2.24,moat:'Triple Net REIT 35 ans. 3500 propri\u00e9t\u00e9s.',risk:'Taux (dette). Exposition retail physique.',why:'NNN +18% vs PRU. Locataire paie tout. Yield 4.1%.'},
  NWN:  {pe_cur:18.2,pe_5y:20.1,fair:62, streak:67,safe:72,sector:'Utilities',beta:0.45,d:1.96,moat:'67 ans hausse. Utility gaz Oregon/WA. Monopole.',risk:'Transition \u00e9nerg\u00e9tique. R\u00e9gulation co\u00fbts.',why:'NWN +19% vs PRU. Monopole. 67 ans hausse (record).'},
  O:    {pe_cur:14.8,pe_5y:18.2,fair:78, streak:30,safe:85,sector:'Immo.',    beta:0.90,d:3.17,moat:'Monthly dividend. 30 ans hausse. 15k propri\u00e9t\u00e9s.',risk:'Taux. Concentration retail/restaurant.',why:'O +6% vs PRU. Mensualit\u00e9 dividende. Yield 5.3%.'},
  PPG:  {pe_cur:12.4,pe_5y:16.8,fair:156,streak:53,safe:70,sector:'Mat.',     beta:1.10,d:2.60,moat:'53 ans hausse. Leader peintures industrielles mondial.',risk:'Co\u00fbts mati\u00e8res. Ralentissement auto.',why:'PPG +10% vs PRU. P/E 12.4x vs 16.8x historique.'},
  SON:  {pe_cur:11.8,pe_5y:15.4,fair:62, streak:41,safe:66,sector:'Industrie',beta:0.75,d:1.96,moat:'41 ans hausse. Emballages industriels #3 USA.',risk:'Surcapacit\u00e9 emballage. Volumes en baisse.',why:'SON -1% vs PRU. P/E 11.8x. Yield 4%. R\u00e9silient.'},
  TGT:  {pe_cur:11.2,pe_5y:16.8,fair:195,streak:57,safe:68,sector:'Conso.',   beta:0.85,d:4.48,moat:'57 ans hausse. Own-brand. Pickup same-day.',risk:'Amazon/Walmart. Consommateur sous pression.',why:'TGT +25% vs PRU. P/E 11.2x vs 17x historique. 57 ans div.'},
  TSN:  {pe_cur:13.2,pe_5y:15.6,fair:68, streak:12,safe:61,sector:'Conso.',   beta:0.60,d:1.04,moat:'#1 prot\u00e9ines USA. Tyson/Jimmy Dean. Int\u00e9gr\u00e9 vertical.',risk:'Grippe aviaire. Marges compress\u00e9es.',why:'TSN +1% vs PRU. Prot\u00e9ines essentielles. Rebond attendu.'},
  UGI:  {pe_cur:10.8,pe_5y:13.2,fair:44, streak:36,safe:60,sector:'Utilities',beta:0.65,d:1.46,moat:'36 ans hausse. Propane #2 USA (AmeriGas).',risk:'Transition \u00e9nergie renouvelable.',why:'UGI +19% vs PRU. P/E 10.8x d\u00e9cot\u00e9. Yield 4.4%.'},
  UNM:  {pe_cur:7.8, pe_5y:9.4, fair:115,streak:15,safe:78,sector:'Finance',  beta:0.90,d:1.56,moat:'#1 assurance invalidit\u00e9 USA/UK. Pricing power.',risk:'Long\u00e9vit\u00e9. R\u00e9gulation assurance.',why:'UNM +122% vs PRU. P/E 7.8x. Rerating significatif.'}
};

const _TICKER_NAMES = {
  ACN:'Accenture', ADP:'Automatic Data Processing', APD:'Air Products',
  BMY:'Bristol-Myers Squibb', CMCSA:'Comcast', CTBI:'Community Bankshares',
  HRL:'Hormel Foods', HTO:'H&T Group', JNJ:'Johnson & Johnson',
  MDT:'Medtronic', MMM:'3M Company', NEE:'NextEra Energy',
  NFG:'National Fuel Gas', NNN:'NNN REIT', NWN:'Northwest Natural',
  O:'Realty Income', PPG:'PPG Industries', SON:'Sonoco Products',
  TGT:'Target', TSN:'Tyson Foods', UGI:'UGI Corporation', UNM:'Unum Group'
};

function seedAssetsFromDB() {
  for (const [ticker, info] of Object.entries(TICKER_DB)) {
    if (!Data.assets[ticker]) Data.assets[ticker] = {};
    const a = Data.assets[ticker];
    if (!a.sector && info.sector)           a.sector = info.sector;
    if (!a.streak)                          a.streak = info.streak;
    if (!a.pe_cur)                          a.pe_cur = info.pe_cur;
    if (!a.beta)                            a.beta   = info.beta;
    if ((!a.d || a.d === 0) && info.d > 0) a.d      = info.d;
    if (!a.safe  && info.safe)              a.safe   = info.safe;
  }
}

/* -- DEAL FINDER ------------------------------------------ */
function calculatePriorityRanking(portfolio) {
  var secAlloc  = {'Tech':3.22,'Mat.':11.26,'Sant\u00e9':18.93,'M\u00e9dias':2.80,'Finance':4.05,'Conso.':27.58,'Industrie':5.53,'Immo.':5.26,'Utilities':21.03};
  var secTarget = {'Tech':10,  'Mat.':10,   'Sant\u00e9':20,   'M\u00e9dias':8,  'Finance':10, 'Conso.':15,   'Industrie':10, 'Immo.':8,  'Utilities':16};
  var totalMV   = getMV();
  var fd = TICKER_DB;

  var results = [];
  for (var i = 0; i < portfolio.length; i++) {
    var d = portfolio[i];
    var f = fd[d.ticker];
    if (!f) continue;
    var div    = meta[d.ticker] && meta[d.ticker].d || 0;
    var yd     = d.price > 0 ? div / d.price * 100 : 0;
    var upside = f.fair > 0 ? (f.fair - d.price) / d.price * 100 : 0;
    var pe_disc = f.pe_5y > 0 ? (f.pe_5y - f.pe_cur) / f.pe_5y * 100 : 0;
    var cur_w  = totalMV > 0 ? d.mv / totalMV * 100 : 0;
    var sec_w  = secAlloc[d.sec]  || 10;
    var tgt_w  = secTarget[d.sec] || 10;
    var sec_gap = tgt_w - sec_w;
    // 30% Dividend Safety
    var s_safety = Math.min(100, f.safe);
    // 25% Valuation (upside cours vs fair value + décote P/E historique)
    var upsideScore = Math.max(0, Math.min(100, upside * 1.2));
    var s_val = Math.max(0, Math.min(100, upsideScore * 0.65 + pe_disc * 0.35));
    // 20% Yield Quality (yield + streak)
    var streakNorm = Math.min(f.streak, 60) / 60 * 100;
    var s_yq = Math.max(0, Math.min(100, yd * 8 * 0.5 + streakNorm * 0.5));
    // 15% Besoin diversification sectorielle
    var s_div = Math.max(0, Math.min(100, sec_gap * 5 + 50));
    // 10% Poids portefeuille (favorise sous-représentés, pénalise concentrés)
    var s_poids;
    if (cur_w < 3)       s_poids = 100;
    else if (cur_w < 5)  s_poids = 80;
    else if (cur_w < 8)  s_poids = 60;
    else if (cur_w < 12) s_poids = 35;
    else                 s_poids = 0;
    // Priority Score global
    var priorityScore = Math.round(
      s_safety * 0.30 +
      s_val    * 0.25 +
      s_yq     * 0.20 +
      s_div    * 0.15 +
      s_poids  * 0.10
    );
    // Opportunity type
    var oppType;
    if (upside > 30 && f.safe >= 75)     oppType = 'D\u00e9cote structurelle';
    else if (sec_gap > 3 && f.safe >= 70) oppType = 'R\u00e9\u00e9quilibrage sectoriel';
    else if (yd > 4 && streakNorm > 60)   oppType = 'Rendement long terme';
    else if (pe_disc > 25)                oppType = 'Compression de valorisation';
    else                                  oppType = 'Classement relatif';
    // Reasons
    var reasons = [];
    if (f.safe >= 80)      reasons.push('Safety dividende \u00e9lev\u00e9e (' + f.safe + '/100)');
    if (upside > 20)       reasons.push('Upside valorisation +' + upside.toFixed(0) + '%');
    if (pe_disc > 20)      reasons.push('P/E d\u00e9cot\u00e9 vs historique (' + f.pe_cur + 'x vs ' + f.pe_5y + 'x)');
    if (f.streak >= 25)    reasons.push('Streak dividende ' + f.streak + ' ans');
    if (sec_gap > 3)       reasons.push('Secteur sous-pond\u00e9r\u00e9 (' + sec_w.toFixed(1) + '% \u2192 cible ' + tgt_w + '%)');
    if (yd > 4)            reasons.push('Yield ' + yd.toFixed(2) + '%');
    // Risks
    var risks = [];
    if (cur_w > 12) risks.push('Position d\u00e9j\u00e0 concentr\u00e9e (' + cur_w.toFixed(1) + '% du portefeuille)');
    if (f.safe < 70) risks.push('Safety dividende mod\u00e9r\u00e9e (' + f.safe + '/100)');
    risks.push(f.risk);
    results.push({
      ticker: d.ticker, name: d.name, priorityScore: priorityScore,
      reasons: reasons, risks: risks, opportunityType: oppType,
      _yd: yd, _upside: upside, _safe: f.safe, _streak: f.streak,
      _s_safety: s_safety, _s_val: s_val, _s_yq: s_yq, _s_div: s_div, _s_poids: s_poids,
      _cur_w: cur_w, _sec_gap: sec_gap, _moat: f.moat, _why: f.why, _d: d, _f: f
    });
  }
  results.sort(function(a, b) { return b.priorityScore - a.priorityScore; });
  return results;
}

function renderDeal(el) {
  if (raw.length === 0) { el.innerHTML = _emptyState('💎', 'Aucune opportunité', 'Le classement Deal s\'affiche une fois ton portefeuille renseigné.'); return; }
  if (!el._dealState) el._dealState = { expanded: {} };
  var DS = el._dealState;
  var ranked = calculatePriorityRanking(raw);

  function scoreBar(label, val, color) {
    return '<div style="margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:3px"><span>' + label + '</span><span style="color:' + color + ';font-weight:700">' + Math.round(val) + '</span></div>'
      + '<div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden"><div style="width:' + Math.min(100, val) + '%;height:100%;background:' + color + ';border-radius:2px"></div></div>'
      + '</div>';
  }

  function oppBadgeColor(t) {
    if (t === 'D\u00e9cote structurelle')        return 'rgba(34,212,122,.15);color:#22d47a';
    if (t === 'R\u00e9\u00e9quilibrage sectoriel') return 'rgba(56,189,248,.15);color:#38bdf8';
    if (t === 'Rendement long terme')         return 'rgba(124,109,255,.15);color:#7c6dff';
    if (t === 'Compression de valorisation')  return 'rgba(245,166,35,.15);color:#f5a623';
    return 'rgba(255,255,255,.07);color:#8888aa';
  }

  function draw() {
    var html = '<div class="section-title">Priority Engine</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Classement intra-portefeuille \u00b7 ' + ranked.length + ' positions analys\u00e9es</div>'
      + '<div style="background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:11px;color:#f5a623">'
      + '\u26a0 Outil d\u2019analyse informative. Ce classement ne constitue pas un conseil en investissement. Safety \u2265 60/100 requis. Horizon 5\u201310 ans.'
      + '</div>'
      // Légende scoring
      + '<div style="background:var(--surface);border-radius:10px;padding:12px;margin-bottom:14px">'
      + '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Composition du score</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">'
      + '<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:#22d47a;flex-shrink:0"></div><span>30% Safety dividende</span></div>'
      + '<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:#7c6dff;flex-shrink:0"></div><span>25% Valorisation + upside</span></div>'
      + '<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:#38bdf8;flex-shrink:0"></div><span>20% Qualit\u00e9 rendement</span></div>'
      + '<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:#f5a623;flex-shrink:0"></div><span>15% Besoin diversif. sectorielle</span></div>'
      + '<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:#f43f5e;flex-shrink:0"></div><span>10% Poids portefeuille</span></div>'
      + '</div></div>';

    for (var i = 0; i < ranked.length; i++) {
      var r = ranked[i];
      if (r._safe < 60) continue;
      var ex = DS.expanded[r.ticker];
      var rank = i + 1;
      var scoreColor = r.priorityScore >= 70 ? '#22d47a' : r.priorityScore >= 50 ? '#f5a623' : '#f43f5e';
      var bc = oppBadgeColor(r.opportunityType);

      html += '<div style="background:var(--surface);border-radius:12px;border:1px solid var(--border);margin-bottom:8px;overflow:hidden">'
        + '<div data-tk="' + r.ticker + '" style="padding:14px;cursor:pointer">'
        + '<div style="display:flex;align-items:center;gap:12px">'
        // Rang + logo
        + '<div style="position:relative;width:36px;height:36px;flex-shrink:0">'
        + _logo(r.ticker, 36)
        + '<div style="position:absolute;bottom:-3px;right:-3px;min-width:16px;height:16px;border-radius:5px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--muted);padding:0 2px">' + rank + '</div>'
        + '</div>'
        // Info
        + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">'
        + '<span style="font-size:15px;font-weight:700">' + r.ticker + '</span>'
        + '<span style="font-size:9.5px;padding:2px 8px;border-radius:6px;font-weight:700;background:' + bc + '">' + r.opportunityType + '</span>'
        + '</div>'
        + '<div style="font-size:10px;color:var(--muted)">' + r.name + '</div>'
        + '<div style="font-size:10px;color:var(--muted);margin-top:2px">Yield ' + r._yd.toFixed(2) + '% \u00b7 Safety ' + r._safe + ' \u00b7 Streak ' + r._streak + ' ans</div>'
        + '</div>'
        // Score
        + '<div style="text-align:center;flex-shrink:0">'
        + '<div style="font-size:26px;font-weight:700;line-height:1;color:' + scoreColor + '">' + r.priorityScore + '</div>'
        + '<div style="font-size:9px;color:var(--muted)">priorité</div>'
        + '<div style="font-size:14px;color:var(--muted);margin-top:2px">' + (ex ? '\u25B2' : '\u25BC') + '</div>'
        + '</div>'
        + '</div></div>';

      if (ex) {
        html += '<div style="padding:0 14px 14px;border-top:1px solid var(--border)">'
          // Score breakdown
          + '<div style="margin:12px 0 10px">'
          + scoreBar('Safety dividende (30%)', r._s_safety, '#22d47a')
          + scoreBar('Valorisation + upside (25%)', r._s_val, '#7c6dff')
          + scoreBar('Qualité rendement (20%)', r._s_yq, '#38bdf8')
          + scoreBar('Besoin diversif. sectorielle (15%)', r._s_div, '#f5a623')
          + scoreBar('Poids portefeuille (10%)', r._s_poids, '#f43f5e')
          + '</div>'
          // Upside + stats
          + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">Upside</div><div class="mono fw7" style="font-size:14px;color:#22d47a">+' + r._upside.toFixed(0) + '%</div></div>'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">Poids actuel</div><div class="mono fw7" style="font-size:14px">' + r._cur_w.toFixed(1) + '%</div></div>'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px;cursor:pointer" onclick="showDSESheet(\'' + r.ticker + '\')"><div style="font-size:9.5px;color:var(--muted)">Safety DSE</div><div class="mono fw7" style="font-size:14px;color:' + dseColor(calculateDividendSafety(r._f).safetyScore) + '">' + calculateDividendSafety(r._f).safetyScore + '/100</div><div style="font-size:8px;color:var(--muted)">\u2197 d\u00e9tail</div></div>'
          + '</div>'
          // Pourquoi
          + '<div style="background:rgba(124,109,255,.06);border-radius:8px;padding:10px;margin-bottom:8px">'
          + '<div style="font-size:11px;font-weight:700;margin-bottom:4px">Priorité actuelle</div>'
          + '<div style="font-size:12px;color:var(--muted);line-height:1.5">' + r._why + '</div>'
          + '</div>'
          // Raisons / risques
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'
          + '<div style="background:rgba(34,212,122,.05);border:1px solid rgba(34,212,122,.15);border-radius:8px;padding:10px">'
          + '<div class="up fw7" style="font-size:11px;margin-bottom:6px">Opportunités relatives</div>'
          + '<ul style="list-style:none;padding:0">' + r.reasons.map(function(rr) { return '<li style="font-size:10.5px;color:var(--muted);line-height:1.5;padding:2px 0;border-bottom:1px solid rgba(34,212,122,.08)">\u2022 ' + rr + '</li>'; }).join('') + '</ul>'
          + '</div>'
          + '<div style="background:rgba(244,63,94,.05);border:1px solid rgba(244,63,94,.15);border-radius:8px;padding:10px">'
          + '<div class="dn fw7" style="font-size:11px;margin-bottom:6px">Risques</div>'
          + '<ul style="list-style:none;padding:0">' + r.risks.map(function(rk) { return '<li style="font-size:10.5px;color:var(--muted);line-height:1.5;padding:2px 0;border-bottom:1px solid rgba(244,63,94,.08)">\u2022 ' + rk + '</li>'; }).join('') + '</ul>'
          + '</div></div>'
          // Moat
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px">'
          + '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px">MOAT</div>'
          + '<div style="font-size:11px;color:var(--muted);line-height:1.5">' + r._moat + '</div>'
          + '</div>'
          + '</div>';
      }
      html += '</div>';
    }

    /* AI Analyst block */
    html += '<div id="aiAnalystBlock" style="margin-top:20px">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<span style="font-size:20px">\uD83E\uDDE0</span>'
      + '<div><div style="font-size:15px;font-weight:700">AI Analyst</div>'
      + '<div style="font-size:10.5px;color:var(--muted)">Analyse \u00b7 Comparaison \u00b7 Simulation — jamais prescriptif</div>'
      + '</div></div>'

      /* Prompt chips */
      + '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">'
      + aiChip('safe',    '\uD83D\uDEE1\uFE0F Pourquoi cette action est-elle plus s\u00fbre\u00a0?')
      + aiChip('weak',    '\u26A0\uFE0F Quel est mon point faible\u00a0?')
      + aiChip('ratio',   '\uD83C\uDFC6 Meilleur ratio rendement\u002Fs\u00e9curit\u00e9\u00a0?')
      + aiChip('reinvest','\uD83D\uDD01 Que se passe-t-il si je r\u00e9investis 10\u00a0ans\u00a0?')
      + aiChip('cut',     '\u2702\uFE0F Que se passe-t-il si 20\u00a0% des dividendes sont coup\u00e9s\u00a0?')
      + '</div>'

      /* Response area */
      + '<div id="aiResponse" style="display:none;background:rgba(124,109,255,.06);border:1px solid rgba(124,109,255,.2);border-radius:12px;padding:14px">'
      + '<div id="aiResponseTitle" style="font-size:10px;font-weight:700;color:#7c6dff;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"></div>'
      + '<div id="aiResponseBody" style="font-size:12px;color:var(--text);line-height:1.7"></div>'
      + '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(124,109,255,.15);font-size:9.5px;color:var(--muted)">'
      + '\u26A0 Analyse informative uniquement — non prescriptive. Aucun conseil en investissement.</div>'
      + '</div>'
      + '</div>';

    el.innerHTML = html;

    var items = el.querySelectorAll('[data-tk]');
    for (var j = 0; j < items.length; j++) {
      (function(h) {
        h.addEventListener('click', function() {
          var tk = h.dataset.tk;
          DS.expanded[tk] = !DS.expanded[tk];
          draw();
        });
      })(items[j]);
    }

    bindAI(ranked);
  }

  /* ── AI chip builder ── */
  function aiChip(id, label) {
    return '<button data-ai="'+id+'" style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 13px;width:100%;text-align:left;cursor:pointer;transition:border-color .15s;font-size:12px;color:var(--text);font-weight:500">'
      + label + '<span style="margin-left:auto;color:var(--muted);font-size:11px">\u25B6</span></button>';
  }

  /* ── AI analysis engine ── */
  function runAnalysis(type, ranked) {
    var totalDiv = 0, totalMV = 0;
    var lines = [];
    /* Build enriched snapshot */
    for (var ri=0; ri<ranked.length; ri++) {
      var r = ranked[ri];
      totalDiv += (r._yd/100) * r._mv;
      totalMV  += r._mv;
    }
    var avgYield = totalMV > 0 ? (totalDiv/totalMV*100) : 0;

    if (type === 'safe') {
      /* Sort by safety score */
      var sorted = ranked.slice().sort(function(a,b){return b._safe-a._safe;});
      var top3 = sorted.slice(0,3);
      var bot3 = sorted.slice(-3).reverse();
      var out = '<strong>Top 3 scores de s\u00e9curit\u00e9 dividende\u00a0:</strong><br>';
      for (var i=0;i<top3.length;i++) {
        var t=top3[i];
        out += '\u2460'.replace('0',String(i+1))+' <strong>'+t.ticker+'</strong> — Safety '+t._safe+'/100 · Payout '+(t._f&&t._f.payout_ratio?Math.round(t._f.payout_ratio*100)+'%':'N/A')+' · Streak '+t._streak+' ans · Raison\u00a0: '+t._why+'<br>';
      }
      out += '<br><strong>3 titres avec s\u00e9curit\u00e9 plus fragile\u00a0:</strong><br>';
      for (var j=0;j<bot3.length;j++) {
        var b=bot3[j];
        out += '• <strong>'+b.ticker+'</strong> — Safety '+b._safe+'/100 · '+b.risks[0]+'<br>';
      }
      out += '<br><em>Facteurs de s\u00e9curit\u00e9 analys\u00e9s\u00a0: payout ratio, FCF coverage, streak de hausse, debt/equity.</em>';
      return {title:'Analyse comparative \u2014 S\u00e9curit\u00e9 dividende', body:out};
    }

    if (type === 'weak') {
      /* Identify weakest dimensions */
      var weakPoints = [];
      /* Concentration revenu */
      var divByTk = {};
      var totDiv2 = 0;
      for (var ri2=0;ri2<ranked.length;ri2++){
        var d2=(ranked[ri2]._yd/100)*ranked[ri2]._mv;
        divByTk[ranked[ri2].ticker]=d2; totDiv2+=d2;
      }
      for (var tk2 in divByTk){
        if(!divByTk.hasOwnProperty(tk2)) continue;
        var pct2=totDiv2>0?divByTk[tk2]/totDiv2*100:0;
        if(pct2>18) weakPoints.push('Concentration revenu\u00a0: <strong>'+tk2+'</strong> g\u00e9n\u00e8re '+pct2.toFixed(1)+'% des dividendes totaux.');
      }
      /* Low safety */
      for (var ri3=0;ri3<ranked.length;ri3++){
        if(ranked[ri3]._safe<60) weakPoints.push('S\u00e9curit\u00e9 faible\u00a0: <strong>'+ranked[ri3].ticker+'</strong> ('+ranked[ri3]._safe+'/100) — '+ranked[ri3].risks[0]);
      }
      /* High payout */
      for (var ri4=0;ri4<ranked.length;ri4++){
        var f4=ranked[ri4]._f||{};
        if(f4.payout_ratio>0.75) weakPoints.push('Payout \u00e9lev\u00e9\u00a0: <strong>'+ranked[ri4].ticker+'</strong> distribue '+Math.round(f4.payout_ratio*100)+'% de ses b\u00e9n\u00e9fices.');
      }
      if(weakPoints.length===0) weakPoints.push('Aucun point de faiblesse structurel d\u00e9tect\u00e9 selon les crit\u00e8res analys\u00e9s.');
      return {title:'Analyse \u2014 Points de fragilit\u00e9 d\u00e9tect\u00e9s', body:'• '+weakPoints.join('<br>• ')};
    }

    if (type === 'ratio') {
      /* Rendement / sécurité composite */
      var scored = ranked.slice().map(function(r){
        var score = (r._yd * (r._safe/100));
        return {tk:r.ticker, yd:r._yd, safe:r._safe, score:score, streak:r._streak};
      }).sort(function(a,b){return b.score-a.score;});
      var out2='<strong>Classement rendement\u002Fs\u00e9curit\u00e9 composite (yield \u00d7 safety/100)\u00a0:</strong><br><br>';
      for(var si=0;si<Math.min(5,scored.length);si++){
        var s=scored[si];
        out2+='<strong>#'+(si+1)+' '+s.tk+'</strong> — Score '+s.score.toFixed(2)+' | Yield '+s.yd.toFixed(2)+'% | Safety '+s.safe+' | Streak '+s.streak+' ans<br>';
      }
      out2+='<br><em>Formule\u00a0: score = yield% \u00d7 (safety/100). Favorise l\u2019\u00e9quilibre entre rendement et fiabilit\u00e9.</em>';
      return {title:'Classement \u2014 Ratio rendement\u002Fs\u00e9curit\u00e9', body:out2};
    }

    if (type === 'reinvest') {
      var divAnn = getDivA()/eu();
      var mv2    = getMV()/eu();
      var yld2   = mv2>0?divAnn/mv2:0.035;
      var G      = 0.057;
      var port   = mv2;
      var div2   = divAnn;
      var table  = '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="color:var(--muted);font-size:9.5px"><th style="text-align:left;padding:3px 0">AN</th><th style="text-align:right;padding:3px">PORTFOLIO</th><th style="text-align:right;padding:3px">DIV BRUT/AN</th><th style="text-align:right;padding:3px">DIV/MOIS</th></tr></thead><tbody>';
      var today2 = new Date().getFullYear();
      for(var y=1;y<=10;y++){
        var brut2 = (div2+div2*yld2)*(1+G);
        port = port*(1+yld2);
        table += '<tr style="border-top:1px solid rgba(255,255,255,.04)"><td style="padding:3px 0;font-weight:700">'+(today2+y)+'</td>'
          +'<td style="text-align:right;padding:3px;color:#7c6dff">'+Math.round(port).toLocaleString('fr-FR')+'\u20ac</td>'
          +'<td style="text-align:right;padding:3px;color:#22d47a">'+Math.round(brut2).toLocaleString('fr-FR')+'\u20ac</td>'
          +'<td style="text-align:right;padding:3px;color:#86efad">'+Math.round(brut2/12).toLocaleString('fr-FR')+'\u20ac</td></tr>';
        div2=brut2;
      }
      table+='</tbody></table>';
      return {title:'Simulation \u2014 R\u00e9investissement des dividendes sur 10\u00a0ans', body:'Hypoth\u00e8ses\u00a0: yield actuel '+( yld2*100).toFixed(2)+'% · croissance dividende 5.7%/an · DRIP total (sans apport ext\u00e9rieur).<br><br>'+table};
    }

    if (type === 'cut') {
      var cut = 0.20;
      var divBrut = getDivA()/eu();
      var divNet  = divBrut*(1-0.314);
      var divCut  = divBrut*(1-cut);
      var divCutN = divCut*(1-0.314);
      var delta   = divNet-divCutN;
      /* Par ticker */
      var impactLines = '<strong>Impact par titre (–20% dividende)\u00a0:</strong><br>';
      for(var ri5=0;ri5<ranked.length;ri5++){
        var r5=ranked[ri5];
        var ann5=(r5._yd/100)*r5._mv;
        var loss5=ann5*cut;
        impactLines+='• <strong>'+r5.ticker+'</strong> — perte '+Math.round(loss5)+'\u20ac/an · Safety '+r5._safe+'/100'+(r5._safe<65?' ⚠️':'')+' <br>';
      }
      return {
        title:'Stress test \u2014 Coupe de 20\u00a0% des dividendes',
        body:'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
          +'<div style="background:rgba(244,63,94,.07);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">Revenu actuel net/an</div><div style="font-size:16px;font-weight:700;color:#22d47a">'+Math.round(divNet).toLocaleString('fr-FR')+'\u20ac</div></div>'
          +'<div style="background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.3);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">Apr\u00e8s coupe –20% net/an</div><div style="font-size:16px;font-weight:700;color:#f43f5e">'+Math.round(divCutN).toLocaleString('fr-FR')+'\u20ac</div></div>'
          +'</div>'
          +'<div style="background:rgba(244,63,94,.07);border-radius:8px;padding:8px;margin-bottom:12px;font-size:12px">'
          +'Perte mensuelle nette\u00a0: <strong style="color:#f43f5e">–'+Math.round(delta/12)+'\u20ac/mois</strong></div>'
          + impactLines
          +'<br><em>Note\u00a0: Les titres avec safety &lt;65 sont les plus expos\u00e9s (\u26A0\uFE0F).</em>'
      };
    }

    return {title:'Analyse', body:'Type inconnu.'};
  }

  /* ── Bind AI chips ── */
  function bindAI(ranked) {
    var chips = el.querySelectorAll('[data-ai]');
    for(var ci=0; ci<chips.length; ci++){
      (function(chip){
        chip.addEventListener('click', function(){
          var type = chip.dataset.ai;
          var result = runAnalysis(type, ranked);
          var respEl = document.getElementById('aiResponse');
          var titleEl = document.getElementById('aiResponseTitle');
          var bodyEl  = document.getElementById('aiResponseBody');
          if(!respEl||!titleEl||!bodyEl) return;
          titleEl.textContent = result.title;
          bodyEl.innerHTML    = result.body;
          respEl.style.display = 'block';
          respEl.scrollIntoView({behavior:'smooth', block:'nearest'});
          /* Highlight active chip */
          var allChips = el.querySelectorAll('[data-ai]');
          for(var i=0;i<allChips.length;i++) allChips[i].style.borderColor='var(--border)';
          chip.style.borderColor = '#7c6dff';
        });
      })(chips[ci]);
    }
  }

  draw();
}


/* ════════════════════════════════════════════════════════════════
   MODULE: UI.Import — Import CSV interface
   ════════════════════════════════════════════════════════════════ */
let _importResult = null;


function switchImportTab(tab) {
  const zones = { csv: 'imp-zone-csv', manual: 'imp-zone-manual', funds: 'imp-zone-funds' };
  const btns  = {
    csv:    { id: 'imp-tab-csv',    color: 'var(--violet)' },
    manual: { id: 'imp-tab-manual', color: 'var(--teal)'   },
    funds:  { id: 'imp-tab-funds',  color: '#f59e0b'       },
  };
  for (const [key, zoneId] of Object.entries(zones)) {
    const zone = document.getElementById(zoneId);
    const btn  = document.getElementById(btns[key].id);
    if (!zone || !btn) continue;
    const active = key === tab;
    zone.style.display    = active ? '' : 'none';
    btn.style.color       = active ? btns[key].color : 'var(--muted)';
    btn.style.borderBottom= active ? `2px solid ${btns[key].color}` : '2px solid transparent';
  }
  if (tab === 'manual') renderManualList();
  if (tab === 'funds')  renderFundamentalsTable();
}

const SECTORS = ['Tech','Santé','Conso.','Utilities','Finance','Immo.','Industrie','Mat.','Médias','Énergie','Autre'];

function renderFundamentalsTable() {
  const el = document.getElementById('funds-table');
  if (!el) return;
  const positions = Calc.getPositions();
  if (!positions.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px">Aucune position dans le portfolio.</div>';
    return;
  }
  let html = `<div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-size:10px">
        <th style="text-align:left;padding:6px 4px">Ticker</th>
        <th style="text-align:left;padding:6px 4px">Nom</th>
        <th style="text-align:center;padding:6px 4px">Div/action $</th>
        <th style="text-align:center;padding:6px 4px">Secteur</th>
        <th style="text-align:center;padding:6px 4px">PE actuel</th>
        <th style="text-align:center;padding:6px 4px">Streak ans</th>
        <th style="text-align:center;padding:6px 4px">Source</th>
      </tr></thead>
      <tbody>`;
  positions.forEach(p => {
    const tk = p.ticker;
    const a  = Data.assets[tk] || {};
    const fromApi = !!a._from_api;
    const badge = fromApi
      ? '<span style="font-size:9px;background:rgba(34,212,122,.15);color:#22d47a;padding:2px 6px;border-radius:5px;font-weight:700">API ✓</span>'
      : '<span style="font-size:9px;background:rgba(255,255,255,.06);color:var(--muted);padding:2px 6px;border-radius:5px">Manuel</span>';
    const sectorOpts = SECTORS.map(s => `<option value="${s}"${a.sector===s?' selected':''}>${s}</option>`).join('');
    html += `<tr style="border-top:1px solid var(--border)">
      <td style="padding:7px 4px;font-family:DM Mono,monospace;font-weight:700;color:var(--violet)">${tk}</td>
      <td style="padding:7px 4px"><input data-tk="${tk}" data-field="name" type="text" value="${a.name||''}" placeholder="Nom société" style="width:110px;padding:4px 7px;border-radius:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:11px;font-family:inherit"></td>
      <td style="padding:7px 4px;text-align:center"><input data-tk="${tk}" data-field="d" type="number" value="${a.d!=null?a.d:''}" placeholder="0.00" min="0" step="any" style="width:70px;padding:4px 7px;border-radius:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:11px;font-family:DM Mono,monospace;text-align:center"></td>
      <td style="padding:7px 4px;text-align:center"><select data-tk="${tk}" data-field="sector" style="padding:4px 7px;border-radius:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:11px;font-family:inherit"><option value="">—</option>${sectorOpts}</select></td>
      <td style="padding:7px 4px;text-align:center"><input data-tk="${tk}" data-field="pe_cur" type="number" value="${a.pe_cur!=null?a.pe_cur:''}" placeholder="—" min="0" step="any" style="width:60px;padding:4px 7px;border-radius:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:11px;font-family:DM Mono,monospace;text-align:center"></td>
      <td style="padding:7px 4px;text-align:center"><input data-tk="${tk}" data-field="streak" type="number" value="${a.streak!=null?a.streak:''}" placeholder="—" min="0" step="1" style="width:55px;padding:4px 7px;border-radius:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:11px;font-family:DM Mono,monospace;text-align:center"></td>
      <td style="padding:7px 4px;text-align:center">${badge}</td>
    </tr>`;
  });
  html += `</tbody></table></div>
    <div id="funds-save-msg" style="display:none;text-align:center;font-size:11px;margin-top:12px;padding:8px;border-radius:8px"></div>`;
  el.innerHTML = html;
}

async function saveFundamentalsForm() {
  const inputs = document.querySelectorAll('#funds-table [data-tk]');
  inputs.forEach(input => {
    const tk    = input.dataset.tk;
    const field = input.dataset.field;
    if (!Data.assets[tk]) Data.assets[tk] = {};
    const raw = input.value.trim();
    if (field === 'name' || field === 'sector') {
      Data.assets[tk][field] = raw || null;
    } else {
      const n = parseFloat(raw);
      Data.assets[tk][field] = isNaN(n) ? null : n;
    }
  });
  await Storage.saveFundamentals(Data.assets);
  Calc.recompute();
  _rendered = {};
  buildKPI();
  const msg = document.getElementById('funds-save-msg');
  if (msg) {
    msg.style.display = '';
    msg.style.background = 'rgba(34,212,122,.1)';
    msg.style.color = '#22d47a';
    msg.textContent = '✓ Fondamentaux sauvegardés';
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
  }
}

/* ── Auto-fetch fondamentaux pour une liste de tickers ── */
async function autoFetchFundamentals(tickers, { onDone, onProgress } = {}) {
  if (!tickers || !tickers.length) return;
  // Dédupliquer
  const uniq = [...new Set(tickers.filter(Boolean))];
  let fetched = 0;
  for (const tk of uniq) {
    try {
      const quote = await MarketData.getQuote(tk);
      if (!quote) continue;
      if (!Data.assets[tk]) Data.assets[tk] = {};
      const a = Data.assets[tk];
      if (quote.annual_div != null) { a.d = quote.annual_div; }
      else if (quote.div_yield > 0 && quote.price > 0) { a.d = +(quote.div_yield * quote.price).toFixed(4); }
      if (quote.name        != null) a.name        = quote.name;
      if (quote.pe_cur      != null) a.pe_cur      = quote.pe_cur;
      if (quote.pe_fwd      != null) a.pe_fwd      = quote.pe_fwd;
      if (quote.beta        != null) a.beta        = quote.beta;
      if (quote.market_cap  != null) a.market_cap  = quote.market_cap;
      if (quote.fifty2_high != null) a.fifty2_high = quote.fifty2_high;
      if (quote.fifty2_low  != null) a.fifty2_low  = quote.fifty2_low;
      a._from_api = true;
      fetched++;
      if (onProgress) onProgress(tk, fetched, uniq.length);
    } catch(e) {
      console.warn('[autoFetchFundamentals]', tk, e.message);
    }
  }
  if (fetched > 0) {
    await Storage.saveFundamentals(Data.assets);
    Calc.recompute();
    _rendered = {};
    buildKPI();
    // Rafraîchir le panel fondamentaux s'il est visible
    renderFundamentalsTable();
  }
  if (onDone) onDone(fetched, uniq.length);
}

function addManualTransaction() {
  const type     = document.getElementById('mt-type')?.value;
  const ticker   = (document.getElementById('mt-ticker')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g,'');
  const qty      = parseFloat(document.getElementById('mt-qty')?.value);
  const price    = parseFloat(document.getElementById('mt-price')?.value);
  const fees     = parseFloat(document.getElementById('mt-fees')?.value) || 0;
  const tax      = parseFloat(document.getElementById('mt-tax')?.value)  || 0;
  const currency = document.getElementById('mt-currency')?.value || 'USD';
  const date     = document.getElementById('mt-date')?.value;
  const errEl    = document.getElementById('mt-error');
  const okEl     = document.getElementById('mt-success');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  /* Validation */
  if (!ticker)         { errEl.textContent = 'Ticker manquant'; errEl.style.display=''; return; }
  if (!date)           { errEl.textContent = 'Date manquante';  errEl.style.display=''; return; }
  if (isNaN(qty) || qty <= 0)   { errEl.textContent = 'Quantité invalide'; errEl.style.display=''; return; }
  if (isNaN(price) || price < 0){ errEl.textContent = 'Prix invalide';     errEl.style.display=''; return; }

  const tx = {
    id: `manual_${Date.now()}`,
    ticker, type, quantity: qty, price, fees, currency, tax_withheld: tax, date,
    _manual: true
  };

  const existing = Storage.loadManual();
  existing.push(tx);
  Storage.saveManual(existing);
  // Persist to D1 in background — matches the pattern used by submitFABTx
  D1Client.addTx({ type, ticker, shares: qty, price, date, currency }).then(r => {
    if (r?.id) {
      const upd = Storage.loadManual().map(t => t.id === tx.id ? { ...t, d1_id: r.id } : t);
      Storage.saveManual(upd);
    }
  }).catch(() => {});
  BrokerImport.applyToPortfolio();
  _rendered = {};

  /* Reset form */
  document.getElementById('mt-ticker').value = '';
  document.getElementById('mt-qty').value    = '';
  document.getElementById('mt-price').value  = '';
  document.getElementById('mt-fees').value   = '';
  document.getElementById('mt-tax').value    = '';

  okEl.textContent   = `✓ ${ticker} ${type} ajouté — récupération fondamentaux…`;
  okEl.style.display = '';

  renderManualList();
  buildKPI();

  // Récupérer les fondamentaux en arrière-plan pour ce ticker
  autoFetchFundamentals([ticker], {
    onDone: (ok) => {
      if (okEl.isConnected) {
        okEl.textContent = ok
          ? `✓ ${ticker} ajouté · fondamentaux chargés (div, PE, nom…)`
          : `✓ ${ticker} ajouté · fondamentaux indisponibles (API hors-ligne)`;
      }
    }
  });
}

function renderManualList() {
  const el = document.getElementById('manual-list');
  if (!el) return;
  const manual = Storage.loadManual();
  if (!manual.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:16px 0">Aucune transaction manuelle enregistrée.</div>'; return; }

  const typeColor = {buy:'#22d47a', sell:'#f43f5e', dividend:'#7c6dff', withholding_tax:'#f5a623'};
  const typeIcon  = {buy:'▲', sell:'▼', dividend:'$', withholding_tax:'%'};

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:12px;font-weight:700;color:var(--teal)">${manual.length} transaction(s) manuelle(s)</div>
    <button onclick="clearManualTransactions()" style="font-size:10px;color:#f43f5e;font-weight:600;padding:4px 9px;border:1px solid rgba(244,63,94,.3);border-radius:7px;background:rgba(244,63,94,.07);cursor:pointer">Effacer tout</button>
  </div>`;

  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  for (let i = manual.length - 1; i >= 0; i--) {
    const t  = manual[i];
    const tc = typeColor[t.type] || '#8888aa';
    const ti = typeIcon[t.type]  || '?';
    html += `<div style="background:var(--surface);border-radius:10px;padding:11px 12px;display:flex;justify-content:space-between;align-items:center;border-left:3px solid ${tc}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="font-size:12px;font-weight:700">${t.ticker}</span>
          <span style="font-size:10px;font-weight:700;color:${tc}">${ti} ${t.type}</span>
        </div>
        <div style="font-size:10px;color:var(--muted);font-family:DM Mono,monospace">${t.quantity} × ${t.price.toFixed(2)} ${t.currency} &nbsp;·&nbsp; ${t.date}</div>
        ${t.fees ? `<div style="font-size:9px;color:var(--muted)">Frais: ${t.fees.toFixed(2)} · Tax: ${(t.tax_withheld||0).toFixed(2)}</div>` : ''}
      </div>
      <button onclick="deleteManualTx('${t.id}')" style="flex-shrink:0;margin-left:10px;color:#f43f5e;font-size:16px;line-height:1;background:none;border:none;cursor:pointer;padding:4px">×</button>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function deleteManualTx(id) {
  const all = Storage.loadManual();
  const tx = all.find(t => t.id === id);
  const existing = all.filter(t => t.id !== id);
  Storage.saveManual(existing);
  if (tx && tx.d1_id) D1Client.deleteTx(tx.d1_id);
  BrokerImport.applyToPortfolio();
  _rendered = {};
  renderManualList();
  buildKPI();
}

function deleteByTicker(ticker) {
  if (!confirm('Retirer ' + ticker + ' du portefeuille ?\nToutes ses transactions seront supprimées.')) return;
  const all = Storage.loadManual();
  const toDelete = all.filter(t => t.ticker === ticker);
  const remaining = all.filter(t => t.ticker !== ticker);
  Storage.saveManual(remaining);
  toDelete.forEach(function(t) { if (t.d1_id) D1Client.deleteTx(t.d1_id); });
  BrokerImport.applyToPortfolio();
  _rendered = {};
  buildKPI();
  const rEl = document.getElementById('panel-rendement');
  if (rEl) renderPanel('rendement', rEl);
}

function clearManualTransactions() {
  if (!confirm('Supprimer toutes les transactions manuelles ?')) return;
  Storage.clearManual();
  BrokerImport.applyToPortfolio();
  _rendered = {};
  renderManualList();
  buildKPI();
}

function handleDrop(e) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }

function handleFile(file) {
  if (!file) return;
  const st = document.getElementById('imp-status');
  st.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0">↻ Lecture de ${_esc(file.name)}…</div>`;
  document.getElementById('imp-preview').innerHTML = '';
  const reader = new FileReader();
  reader.onload = e => { _importResult = BrokerImport.process(e.target.result); window.renderImportStatus?.(_importResult); window.renderImportPreview?.(_importResult); };
  reader.onerror = () => { st.innerHTML = '<div style="color:#f43f5e;font-size:12px;padding:8px 0">Erreur de lecture fichier.</div>'; };
  reader.readAsText(file, 'UTF-8');
}



function validateImport() {
  if (!_importResult?.ok?.length) return;
  const newTickers = [...new Set(_importResult.ok.map(t => t.ticker).filter(Boolean))];
  const merged = Storage.load().concat(_importResult.ok);
  Storage.save(merged);
  BrokerImport.applyToPortfolio();
  _rendered = {}; _importResult = null;
  const el = document.getElementById('panel-import');
  if (el) {
    _rendered['import'] = 1; _panelMods.importPanel?.renderImport(el);
    const st = document.getElementById('imp-status');
    if (st) st.innerHTML = '<div style="background:rgba(34,212,122,.1);border:1px solid rgba(34,212,122,.3);border-radius:10px;padding:14px;margin-bottom:14px;text-align:center"><div style="font-size:18px;margin-bottom:4px">&#10003;</div><div style="font-weight:700;color:#22d47a;font-size:14px">Import réussi !</div><div style="font-size:11px;color:var(--muted);margin-top:4px">Récupération fondamentaux en cours…</div></div>';
  }
  // Récupérer fondamentaux : FmpData (payout, streak, fcf…) en parallèle + prix en série
  FmpData.prefetch(newTickers).then(results => {
    results.forEach(({ ticker }) => FmpData.mergeIntoAssets(ticker, Data.assets));
    Calc.recompute();
    Storage.saveFundamentals(Data.assets);
    buildKPI();
  }).catch(() => {});
  autoFetchFundamentals(newTickers, {
    onProgress: (tk, done, total) => {
      const st = document.getElementById('imp-status');
      if (st) {
        const msg = st.querySelector('div > div:last-child');
        if (msg) msg.textContent = `Fondamentaux : ${done}/${total} tickers chargés…`;
      }
    },
    onDone: (ok, total) => {
      const st = document.getElementById('imp-status');
      if (st) {
        const msg = st.querySelector('div > div:last-child');
        if (msg) msg.textContent = `${ok}/${total} tickers enrichis (div, PE, nom, beta…)`;
      }
    }
  });
}

function cancelImport() {
  _importResult = null;
  const el = document.getElementById('panel-import');
  if (el) { _rendered['import'] = 1; _panelMods.importPanel?.renderImport(el); }
}

async function clearAll() {
  if (!confirm('Supprimer toutes les transactions importées et manuelles ?')) return;
  await Storage.clear();
  await Storage.clearManual();
  Data.transactions = Data.transactions.filter(t => !t._imported && !t._manual);
  // Vide aussi les métadonnées actifs pour éviter des dividendes fantômes
  for (const k in Data.assets) delete Data.assets[k];
  Calc.recompute();
  _rendered = {};
  buildKPI();
  const el = document.getElementById('panel-import');
  if (el) { _rendered['import'] = 1; _panelMods.importPanel?.renderImport(el); }
}

/* ════════════════════════════════════════════════════════════════
   MODULE: Init — Bootstrap application
   ════════════════════════════════════════════════════════════════ */
const App = (() => {

  const initSwipe = () => {
    let sx = 0, sy = 0, startTarget = null, swiping = false;
    const getInner = () => document.getElementById('panels-inner');

    // ── Pull-to-refresh ball ──────────────────────────────────
    const ptr = document.createElement('div');
    ptr.id = 'ptr-ball';
    ptr.style.cssText = 'position:fixed;top:62px;left:50%;transform:translateX(-50%) translateY(-70px);z-index:5000;width:38px;height:38px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 14px rgba(0,0,0,.6);transition:transform .22s,opacity .22s;opacity:0;pointer-events:none';
    ptr.innerHTML = '<svg id="ptr-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    document.body.appendChild(ptr);

    const _ptrHide = () => {
      ptr.style.transform = 'translateX(-50%) translateY(-70px)';
      ptr.style.opacity = '0';
      const ic = document.getElementById('ptr-icon');
      if (ic) { ic.style.transform = ''; ic.style.animation = ''; }
    };

    document.addEventListener('touchstart', e => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      startTarget = e.target;
      swiping = false;
      const inn = getInner();
      if (inn) inn.style.transition = 'none';
    }, {passive:true});

    document.addEventListener('touchmove', e => {
      if (startTarget && startTarget.closest('.tabs')) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      const inn = getInner();

      // Detect horizontal swipe intent
      if (!swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) swiping = true;

      if (swiping && inn) {
        // Live drag: panels follow finger with rubber-band at edges
        const nP = document.querySelectorAll('.panel').length;
        let raw = -(_cur * window.innerWidth) + dx;
        if (raw > 0)                           raw = raw * 0.25;
        if (raw < -((nP - 1) * window.innerWidth)) raw = -((nP - 1) * window.innerWidth) + (raw + ((nP - 1) * window.innerWidth)) * 0.25;
        inn.style.transform = `translateX(${raw}px)`;
        return;
      }

      // Pull-to-refresh: vertical pull from top
      if (!swiping && dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        const ap = document.querySelector('.panel.on');
        if (!ap || ap.scrollTop <= 2) {
          const progress = Math.min(1, dy / 90);
          ptr.style.transform = `translateX(-50%) translateY(${Math.min(dy * 0.45, 38) - 70}px)`;
          ptr.style.opacity = progress.toFixed(2);
          const ic = document.getElementById('ptr-icon');
          if (ic) ic.style.transform = `rotate(${progress * 180}deg)`;
        }
      }
    }, {passive:true});

    document.addEventListener('touchend', e => {
      const inn = getInner();
      if (inn) inn.style.transition = 'transform .28s cubic-bezier(.25,.46,.45,.94)';

      if (startTarget && startTarget.closest('.tabs')) { _ptrHide(); return; }
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;

      // Commit or bounce horizontal swipe
      if (swiping) {
        const tabs = document.querySelectorAll('.tab');
        if (Math.abs(dx) > 55) {
          if (dx < 0 && _cur < tabs.length - 1) { goTo(_cur + 1); return; }
          if (dx > 0 && _cur > 0)               { goTo(_cur - 1); return; }
        }
        // Bounce back
        if (inn) inn.style.transform = `translateX(${-_cur * window.innerWidth}px)`;
        return;
      }

      // Pull-to-refresh trigger
      const ap = document.querySelector('.panel.on');
      if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 1.5 && (!ap || ap.scrollTop <= 2)) {
        ptr.style.transform = 'translateX(-50%) translateY(0px)';
        const ic = document.getElementById('ptr-icon');
        if (ic) { ic.style.transform = ''; ic.style.animation = 'ptr-spin .8s linear infinite'; }
        syncIBKR();
        setTimeout(_ptrHide, 2200);
        return;
      }

      _ptrHide();
    }, {passive:true});
  };

  const initDSESheet = () => {
    const overlay = document.createElement('div');
    overlay.id = 'dse-sheet';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:9000;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)';
    overlay.innerHTML = `
      <div id="dse-sheet-box" style="background:#111120;border-radius:20px 20px 0 0;padding:20px 16px 40px;max-height:85vh;overflow-y:auto;transform:translateY(100%);transition:transform .28s cubic-bezier(.32,1.2,.56,1)">
        <div style="width:36px;height:4px;background:#2a2a40;border-radius:2px;margin:0 auto 16px;cursor:pointer" onclick="closeDSESheet()"></div>
        <div id="dse-sheet-inner"></div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDSESheet(); });
    document.body.appendChild(overlay);
    const st = document.createElement('style');
    st.textContent = '.dse-open #dse-sheet-box{transform:translateY(0)!important}';
    document.head.appendChild(st);
  };

  const boot = async () => {
    /* Vérification auth Google OAuth */
    const user = await D1Client.me();
    const overlay = document.getElementById('loginOverlay');
    const userBtn = document.getElementById('navUserBtn');
    const userInitial = document.getElementById('navUserInitial');
    if (!user) {
      if (overlay) overlay.style.display = 'flex';
      return; // ne pas booter l'app sans auth
    }
    if (overlay) overlay.style.display = 'none';
    if (userBtn) userBtn.style.display = 'flex';
    if (userInitial) userInitial.textContent = (user.name || user.email || '?')[0].toUpperCase();
    window._currentUser = user;

    /* Init IndexedDB + migration localStorage + hydrate cache */
    await Storage.init();

    /* Apply imported transactions */
    BrokerImport.applyToPortfolio();

    /* Charger les fondamentaux persistés (div, secteur, PE…) */
    const savedFunds = await Storage.loadFundamentals();
    for (const [tk, info] of Object.entries(savedFunds)) {
      if (!Data.assets[tk]) Data.assets[tk] = {};
      Object.assign(Data.assets[tk], info);
    }
    if (Object.keys(savedFunds).length) Calc.recompute();

    /* Seed static fundamentals (sector, beta, streak, div/share) for known tickers */
    seedAssetsFromDB();
    Calc.recompute();
    buildKPI();

    /* Register service worker for offline caching */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    /* Init tabs */
    const allTabs = document.querySelectorAll('.tab');
    allTabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => goTo(idx));
      const pid = tab.dataset?.p;
      if (pid) {
        tab.addEventListener('mouseenter', () => {
          switch (pid) {
            case 'rendement':    if (!_panelMods.rendement)    import('./panels/rendement.js').then(m    => { _panelMods.rendement    = m; }); break;
            case 'impots':       if (!_panelMods.impots)       import('./panels/impots.js').then(m       => { _panelMods.impots       = m; }); break;
            case 'import':       if (!_panelMods.importPanel)  import('./panels/import.js').then(m       => { _panelMods.importPanel  = m; }); break;
            case 'secteurs':     if (!_panelMods.secteurs)     import('./panels/secteurs.js').then(m     => { _panelMods.secteurs     = m; }); break;
            case 'dividendes':   if (!_panelMods.dividendes)   import('./panels/dividendes.js').then(m   => { _panelMods.dividendes   = m; }); break;
            case 'calendar':     if (!_panelMods.calendar)     import('./panels/calendar.js').then(m     => { _panelMods.calendar     = m; }); break;
            case 'valorisation': case 'news': if (!_panelMods.val) import('./panels/valorisation.js').then(m => { _panelMods.val = m; }); break;
          }
        }, { passive: true });
      }
    });

    /* Wrap panels in slide container */
    const _allPanelEls = [...document.querySelectorAll('.panel')];
    const _panelsWrap = document.createElement('div');
    _panelsWrap.id = 'panels-wrap';
    const _panelsInner = document.createElement('div');
    _panelsInner.id = 'panels-inner';
    _allPanelEls[0].parentNode.insertBefore(_panelsWrap, _allPanelEls[0]);
    _panelsWrap.appendChild(_panelsInner);
    _allPanelEls.forEach(p => _panelsInner.appendChild(p));

    /* Init DSE bottom sheet */
    initDSESheet();

    /* Init swipe */
    initSwipe();

    /* Render accueil (toujours pré-rendu) */
    renderPanel('accueil', document.getElementById('panel-accueil'));

    /* Restaure l'onglet actif depuis la dernière session (sans animation) */
    const _savedTab = parseInt(localStorage.getItem('dk_active_tab') || '0', 10);
    _panelsInner.style.transition = 'none';
    goTo(Number.isFinite(_savedTab) && _savedTab >= 0 && _savedTab < allTabs.length ? _savedTab : 0);
    requestAnimationFrame(() => { _panelsInner.style.transition = ''; });

    /* Charge l'historique NAV (non bloquant) */
    fetch('/api/nav').then(r => r.json()).then(data => {
      if (data && Array.isArray(data.nav) && data.nav.length >= 2) {
        _navHistory = data.nav;
        const accEl = document.getElementById('panel-accueil');
        if (accEl && accEl.classList.contains('on')) renderPanel('accueil', accEl);
      }
    }).catch(() => {});

    /* Charge le benchmark S&P 500 (non bloquant) */
    fetch('/api/benchmark').then(r => r.json()).then(data => {
      if (data && Array.isArray(data.entries) && data.entries.length >= 2) {
        _spyHistory = data.entries;
        const accEl2 = document.getElementById('panel-accueil');
        if (accEl2 && accEl2.classList.contains('on')) renderPanel('accueil', accEl2);
      }
    }).catch(() => {});

    /* Lance refresh marché + fondamentaux en arrière-plan (non bloquant) */
    const tickers = Calc.getPositions().map(p => p.ticker).filter((t,i,a) => a.indexOf(t) === i);

    const bootPricePromise = MarketData.refreshAll(tickers, (ticker, quote) => {
      if (!Data.assets[ticker]) Data.assets[ticker] = {};
      const a = Data.assets[ticker];
      if (quote.annual_div != null) { a.d = quote.annual_div; }
      else if (quote.div_yield > 0 && quote.price > 0) { a.d = +(quote.div_yield * quote.price).toFixed(4); }
      if (quote.name        != null) a.name        = quote.name;
      if (quote.pe_cur      != null) a.pe_cur      = quote.pe_cur;
      if (quote.pe_fwd      != null) a.pe_fwd      = quote.pe_fwd;
      if (quote.beta        != null) a.beta        = quote.beta;
      if (quote.market_cap  != null) a.market_cap  = quote.market_cap;
      if (quote.fifty2_high != null) a.fifty2_high = quote.fifty2_high;
      if (quote.fifty2_low  != null) a.fifty2_low  = quote.fifty2_low;
      a._from_api = true;
      Calc.recompute();
      buildKPI();
      const panels = ['accueil','rendement','secteurs','dividendes','calendar','deal','valorisation','news','impots','import'];
      const activeEl = document.getElementById('panel-' + panels[window._curTab || 0]);
      if (activeEl) { try { renderPanel(panels[window._curTab || 0], activeEl); } catch(e) {} }
    });

    // FMP en parallèle — enrichit payout, fcf_payout, debt_ebitda, interest_cov, streak, cagr…
    const bootFmpPromise = FmpData.prefetch(tickers).then(results => {
      results.forEach(({ ticker }) => FmpData.mergeIntoAssets(ticker, Data.assets));
      Calc.recompute();
      buildKPI();
    }).catch(e => console.warn('[App] FmpData boot:', e.message));

    Promise.all([bootPricePromise, bootFmpPromise]).then(() => {
      Storage.saveFundamentals(Data.assets);
      _rendered = {};
      buildKPI();
    }).catch(e => console.warn('[App] boot refresh:', e.message));
  };

  return { boot };
})();

/* ════════════════════════════════════════════════════════════════
   DSE Sheet functions (appelées depuis onclick inline HTML)
   ════════════════════════════════════════════════════════════════ */
function showDSESheet(ticker) {
  const stock = Data.assets[ticker] || {};
  const r = DividendSafety.calculate(stock);
  const displayScore = stock.payout_ratio != null ? r.score : (stock.safe || r.score);
  const col = dseColor(displayScore);
  const CRIT_MAP = [
    {k:'payout_ratio',lbl:'Payout',w:'25%'},{k:'fcf_payout',lbl:'FCF Payout',w:'20%'},
    {k:'debt_ebitda',lbl:'Dette/EBITDA',w:'15%'},{k:'interest_cov',lbl:'Int. Coverage',w:'10%'},
    {k:'div_streak',lbl:'Streak',w:'10%'},{k:'div_cagr_5y',lbl:'CAGR 5Y',w:'10%'},
    {k:'earn_stability',lbl:'Stabilité',w:'5%'},{k:'recession_res',lbl:'Récession',w:'5%'}
  ];
  let breakHtml = '<div style="display:flex;flex-direction:column;gap:6px;margin:14px 0">';
  for (const cm of CRIT_MAP) {
    const sc = r.breakdown[cm.k]||0, cc = dseColor(sc);
    breakHtml += `<div style="display:flex;align-items:center;gap:8px"><div style="font-size:10px;color:#52527a;width:80px;flex-shrink:0">${cm.lbl}</div><div style="flex:1;height:4px;background:#1a1a2e;border-radius:2px;overflow:hidden"><div style="height:100%;width:${sc}%;background:${cc};border-radius:2px"></div></div><div style="font-size:10px;font-family:DM Mono,monospace;font-weight:700;color:${cc};width:24px;text-align:right">${sc}</div><div style="font-size:9px;color:#52527a;width:22px;text-align:right">${cm.w}</div></div>`;
  }
  breakHtml += '</div>';
  let wpHtml='', stHtml='';
  if (r.weakPoints.length) { wpHtml='<div style="margin-bottom:12px"><div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f43f5e;margin-bottom:6px">⚠ Points faibles</div>'+r.weakPoints.map(w=>`<div style="font-size:11px;color:#e2e2ec;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">· ${w.label} <span style="color:#52527a">(${w.weight})</span></div>`).join('')+'</div>'; }
  if (r.strengths.length)  { stHtml='<div><div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#22d47a;margin-bottom:6px">✓ Points forts</div>'+r.strengths.map(s=>`<div style="font-size:11px;color:#e2e2ec;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">· ${s.label} <span style="color:#52527a">(${s.weight})</span></div>`).join('')+'</div>'; }
  document.getElementById('dse-sheet-inner').innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px"><div><div style="font-size:20px;font-weight:700">${ticker}</div>${r.sectorNote?`<div style="font-size:9.5px;color:#f5a623;margin-top:3px">${r.sectorNote}</div>`:''}</div><div style="text-align:right"><div style="font-size:32px;font-weight:700;font-family:DM Mono,monospace;color:${col}">${displayScore}</div><div style="font-size:11px;font-weight:700;color:${col}">${dseLabel(displayScore>=80?'SAFE':displayScore>=65?'MODERATE':displayScore>=50?'CAUTION':displayScore>=35?'RISKY':'DANGER')}</div></div></div><div style="height:5px;background:#1a1a2e;border-radius:3px;overflow:hidden"><div style="height:100%;width:${displayScore}%;background:${col};border-radius:3px;transition:width .6s ease"></div></div>${breakHtml}${wpHtml}${stHtml}`;
  const sheet = document.getElementById('dse-sheet');
  sheet.style.display = 'flex';
  requestAnimationFrame(() => sheet.classList.add('dse-open'));
}

function closeDSESheet() {
  const sheet = document.getElementById('dse-sheet');
  sheet.classList.remove('dse-open');
  setTimeout(() => { sheet.style.display = 'none'; }, 280);
}

function _showToast(msg, duration = 3000) {
  let el = document.getElementById('dk-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dk-toast';
    el.style.cssText = 'position:fixed;bottom:76px;left:50%;transform:translateX(-50%) translateY(16px);z-index:9999;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:9px 18px;font-size:12px;font-weight:600;color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.55);opacity:0;transition:opacity .22s,transform .22s;pointer-events:none;white-space:nowrap;max-width:90vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(16px)';
  }, duration);
}

function syncIBKR() {
  const tickers = Calc.getPositions().map(p => p.ticker).filter((t,i,a) => a.indexOf(t) === i);
  const btn = document.querySelector('.sync-btn');
  if (btn) { btn.textContent = '⟳ Sync...'; btn.disabled = true; }

  // Invalide les TTL (force re-fetch) sans effacer les données (anciens prix conservés si FMP échoue)
  MarketData.invalidateCache();

  let successCount = 0;

  // Lance prix (Twelve Data) ET fondamentaux (FMP) en parallèle
  const pricePromise = MarketData.refreshAll(tickers, (ticker, quote) => {
    successCount++;
    if (btn) btn.textContent = '⟳ ' + successCount + '/' + tickers.length;
    if (!Data.assets[ticker]) Data.assets[ticker] = {};
    const a = Data.assets[ticker];
    if (quote.annual_div != null) { a.d = quote.annual_div; }
    else if (quote.div_yield > 0 && quote.price > 0) { a.d = +(quote.div_yield * quote.price).toFixed(4); }
    if (quote.name        != null) a.name        = quote.name;
    if (quote.pe_cur      != null) a.pe_cur      = quote.pe_cur;
    if (quote.pe_fwd      != null) a.pe_fwd      = quote.pe_fwd;
    if (quote.beta        != null) a.beta        = quote.beta;
    if (quote.market_cap  != null) a.market_cap  = quote.market_cap;
    if (quote.fifty2_high != null) a.fifty2_high = quote.fifty2_high;
    if (quote.fifty2_low  != null) a.fifty2_low  = quote.fifty2_low;
    a._from_api = true;
    Calc.recompute();
    buildKPI();
    const panels = ['accueil','rendement','secteurs','dividendes','calendar','deal','valorisation','news','impots','import'];
    const activeEl = document.getElementById('panel-' + panels[window._curTab || 0]);
    if (activeEl) { try { renderPanel(panels[window._curTab || 0], activeEl); } catch(e) {} }
  });

  const fmpPromise = FmpData.prefetch(tickers).then(results => {
    results.forEach(({ ticker }) => FmpData.mergeIntoAssets(ticker, Data.assets));
    Calc.recompute();
    buildKPI();
  }).catch(e => console.warn('[syncIBKR] FMP:', e.message));

  Promise.all([pricePromise, fmpPromise])
    .then(([{ success, errors }]) => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = errors === 0 ? '✓ Sync OK' : '⚠ ' + success + '/' + tickers.length;
        setTimeout(() => { btn.textContent = '⟳ Sync'; }, 3000);
      }
      Storage.saveFundamentals(Data.assets);
      Calc.recompute();
      _rendered = {};
      buildKPI();
      const _panels = ['accueil','rendement','secteurs','dividendes','calendar','deal','valorisation','news','impots','import'];
      const _curP = _panels[window._curTab || 0];
      const _curEl = document.getElementById('panel-' + _curP);
      if (_curEl) { try { renderPanel(_curP, _curEl); } catch(_) {} }
      _showToast(`✓ ${success}/${tickers.length} tickers synchronisés · FMP enrichi`);
      console.log('[syncIBKR] prix OK:', success + '/' + tickers.length, '— FMP fondamentaux chargés');
    })
    .catch(e => {
      console.warn('[syncIBKR]', e);
      if (btn) { btn.disabled = false; btn.textContent = '✗ Erreur'; }
      setTimeout(() => { if (btn) btn.textContent = '⟳ Sync'; }, 3000);
    });
}

/* ── Démarrage ── */
App.boot().catch(e => console.error('[App] boot error', e));

/* ── Ticker search autocomplete ─────────────────────────────── */
const _EXCH_FLAG = {
  NMS:'🇺🇸',NGM:'🇺🇸',NYQ:'🇺🇸',ASE:'🇺🇸',BTS:'🇺🇸',PCX:'🇺🇸',
  LSE:'🇬🇧',IOB:'🇬🇧',
  PAR:'🇫🇷',EPA:'🇫🇷',
  TOR:'🇨🇦',CNQ:'🇨🇦',TSX:'🇨🇦',
  ASX:'🇦🇺',
  FRA:'🇩🇪',GER:'🇩🇪',STU:'🇩🇪',
  MCE:'🇪🇸',MAD:'🇪🇸',
  MIL:'🇮🇹',
  AMS:'🇳🇱',
  SWX:'🇨🇭',
  HKG:'🇭🇰',
  TYO:'🇯🇵',OSA:'🇯🇵',
  KRX:'🇰🇷',
  SHG:'🇨🇳',SHZ:'🇨🇳',
  BSE:'🇮🇳',NSI:'🇮🇳',
  SAO:'🇧🇷',
  MEX:'🇲🇽',
};
const _EXCH_TO_FIGI = {
  NMS:'US',NGM:'US',NYQ:'US',ASE:'US',BTS:'US',
  LSE:'LN',PAR:'FP',TOR:'CN',TSX:'CN',
  FRA:'GY',GER:'GY',
  AMS:'NA',SWX:'SW',MIL:'IM',MCE:'SM',
  ASX:'AU',HKG:'HK',TYO:'JP',KRX:'KS',
};

var _fabSearchTimer = null;
var _fabSelectedISIN = '';
var _fabSelectedName = '';

function fabTickerInput(val) {
  _fabSelectedISIN = '';
  _fabSelectedName = '';
  var isinTag = document.getElementById('fab-isin-tag');
  if (isinTag) { isinTag.style.display = 'none'; isinTag.textContent = ''; }
  var q = val.trim();
  if (q.length < 2) {
    var sug = document.getElementById('fab-suggestions');
    if (sug) sug.innerHTML = '';
    return;
  }
  clearTimeout(_fabSearchTimer);
  _fabSearchTimer = setTimeout(function() { _fabDoSearch(q); }, 270);
}

async function _fabDoSearch(q) {
  var el = document.getElementById('fab-suggestions');
  if (!el) return;
  el.innerHTML = '<div class="fab-sug-loading">\u{1F50D} Recherche…</div>';
  try {
    var res = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    var results = data.results || [];
    if (!results.length) { _fabOfflineSearch(q, el); return; }
    var _EXCH_TO_FLAG = {NASDAQ:'\U0001F1FA\U0001F1F8',NYSE:'\U0001F1FA\U0001F1F8',AMEX:'\U0001F1FA\U0001F1F8',TSX:'\U0001F1E8\U0001F1E6',LSE:'\U0001F1EC\U0001F1E7',EURONEXT:'\U0001F1EA\U0001F1FA',XETRA:'\U0001F1E9\U0001F1EA'};
    el.innerHTML = results.map(function(r) {
      var flag = _EXCH_TO_FLAG[r.exchangeShortName] || '\U0001F3F3️';
      var nameSafe = (r.name || r.symbol).replace(/'/g, '&#39;');
      var exchSafe = (r.exchangeShortName || '').replace(/'/g, '');
      return '<div class="fab-sug-item" onclick="fabSelectTicker(\''
        + r.symbol + '\',\'' + nameSafe + '\',\'' + exchSafe + '\')">'
        + _logo(r.symbol, 24)
        + '<div style="flex:1;min-width:0;margin-left:8px">'
        + '<span class="fab-sug-tk">' + r.symbol + '</span>'
        + '<span class="fab-sug-name">' + (r.name || '') + '</span>'
        + '</div>'
        + '<div class="fab-sug-right"><span class="fab-sug-flag">' + flag + '</span></div>'
        + '</div>';
    }).join('');
  } catch(e) {
    _fabOfflineSearch(q, el);
  }
}

function _fabOfflineSearch(q, el) {
  var ql = q.toLowerCase();
  var dbMatches = Object.keys(TICKER_DB).filter(function(t) {
    var name = (_TICKER_NAMES[t] || '').toLowerCase();
    return t.toLowerCase().includes(ql) || name.includes(ql);
  });
  var portMatches = raw.map(function(r){ return r.ticker; }).filter(function(t) {
    var name = (Data.assets[t] && Data.assets[t].name || '').toLowerCase();
    return !TICKER_DB[t] && (t.toLowerCase().includes(ql) || name.includes(ql));
  });
  var matches = dbMatches.concat(portMatches).slice(0, 7);
  if (!matches.length) {
    el.innerHTML = '<div class="fab-sug-loading" style="color:#f5a623">Hors ligne · Saisis le ticker (ex : TSLA)</div>';
    return;
  }
  el.innerHTML = matches.map(function(t) {
    var name = _TICKER_NAMES[t] || (Data.assets[t] && Data.assets[t].name) || '';
    var nameSafe = name.replace(/'/g, '&#39;');
    return '<div class="fab-sug-item" onclick="fabSelectTicker(\'' + t + '\',\'' + nameSafe + '\',\'NMS\')">'
      + _logo(t, 24)
      + '<div style="flex:1;min-width:0;margin-left:8px">'
      + '<span class="fab-sug-tk">' + t + '</span>'
      + '<span class="fab-sug-name">' + name + '</span>'
      + '</div>'
      + '<div class="fab-sug-right"><span class="fab-sug-flag">\U0001F1FA\U0001F1F8</span></div>'
      + '</div>';
  }).join('');
}

async function _fabEnrichISINs(quotes) {
  try {
    var body = quotes.map(function(r) {
      var exchCode = _EXCH_TO_FIGI[r.exchange] || 'US';
      return {idType:'TICKER', idValue:r.symbol, exchCode:exchCode};
    });
    var res = await fetch('https://api.openfigi.com/v3/mapping', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    var data = await res.json();
    data.forEach(function(entry, i) {
      var sym = quotes[i] && quotes[i].symbol;
      var isin = entry.data && entry.data[0] && entry.data[0].isin;
      var el = document.getElementById('isin-' + sym);
      if (el) el.textContent = isin || '';
    });
  } catch(e) { /* OpenFIGI optionnel — pas bloquant */ }
}

function fabSelectTicker(symbol, name, exchange) {
  if (navigator.vibrate) navigator.vibrate(6);
  var ticker = document.getElementById('fab-ticker');
  if (ticker) ticker.value = symbol;
  _fabSelectedName = name;
  /* Récupère l'ISIN depuis l'élément DOM s'il est déjà chargé */
  var isinEl = document.getElementById('isin-' + symbol);
  var isin = isinEl ? isinEl.textContent : '';
  /* Vide la liste */
  var sug = document.getElementById('fab-suggestions');
  if (sug) sug.innerHTML = '';
  /* Affiche le badge ISIN */
  var isinTag = document.getElementById('fab-isin-tag');
  if (isinTag) {
    if (isin && isin !== 'ISIN…') {
      isinTag.textContent = isin + ' · ' + (name.length > 30 ? name.slice(0,30)+'…' : name);
      isinTag.style.display = '';
      _fabSelectedISIN = isin;
    } else {
      /* ISIN pas encore chargé → attendre OpenFIGI */
      isinTag.textContent = '⏳ ' + name.slice(0,35);
      isinTag.style.display = '';
      _fabFetchISINForSelected(symbol, name, exchange, isinTag);
    }
  }
}

async function _fabFetchISINForSelected(symbol, name, exchange, tagEl) {
  try {
    var exchCode = _EXCH_TO_FIGI[exchange] || 'US';
    var res = await fetch('https://api.openfigi.com/v3/mapping', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify([{idType:'TICKER', idValue:symbol, exchCode:exchCode}])
    });
    var data = await res.json();
    var isin = data[0] && data[0].data && data[0].data[0] && data[0].data[0].isin;
    if (tagEl) {
      if (isin) {
        tagEl.textContent = isin + ' · ' + (name.length > 30 ? name.slice(0,30)+'…' : name);
        _fabSelectedISIN = isin;
      } else {
        tagEl.textContent = symbol + ' · ' + (name.length > 35 ? name.slice(0,35)+'…' : name);
      }
    }
  } catch(e) {
    if (tagEl) tagEl.textContent = symbol + ' · ' + name.slice(0,35);
  }
}

/* ── FAB & bottom sheet ─────────────────────────────────────── */
function openFABSheet() {
  if (navigator.vibrate) navigator.vibrate(8);
  var dateEl = document.getElementById('fab-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0,10);
  document.getElementById('fab-error').style.display = 'none';
  document.getElementById('bs-overlay').style.display = '';
  document.getElementById('bs-sheet').style.display = '';
}

function closeFABSheet() {
  document.getElementById('bs-overlay').style.display = 'none';
  document.getElementById('bs-sheet').style.display = 'none';
}

function submitFABTx() {
  var type   = document.getElementById('fab-type').value;
  var ticker = (document.getElementById('fab-ticker').value||'').trim().toUpperCase().replace(/[^A-Z0-9.]/g,'');
  var qty    = parseFloat(document.getElementById('fab-qty').value);
  var price  = parseFloat(document.getElementById('fab-price').value);
  var date   = document.getElementById('fab-date').value;
  var errEl  = document.getElementById('fab-error');
  errEl.style.display = 'none';
  if (!ticker)              { errEl.textContent='Ticker manquant'; errEl.style.display=''; return; }
  if (!date)                { errEl.textContent='Date manquante';  errEl.style.display=''; return; }
  if (isNaN(qty)||qty<=0)   { errEl.textContent='Quantité invalide'; errEl.style.display=''; return; }
  if (isNaN(price)||price<0){ errEl.textContent='Prix invalide';   errEl.style.display=''; return; }
  var tx = { id:'fab_'+Date.now(), ticker, type, quantity:qty, price, fees:0, currency:'USD', tax_withheld:0, date, _manual:true };
  var existing = Storage.loadManual(); existing.push(tx);
  Storage.saveManual(existing);
  /* Push to D1 in background — ne bloque pas l'UI */
  D1Client.addTx({ type:type, ticker:ticker, shares:qty, price:price, date:date, currency:'USD',
    amount: type==='dividend' ? qty : null }).then(function(r){
    if (r && r.id) {
      var upd = Storage.loadManual().map(function(t){ return t.id===tx.id ? Object.assign({},t,{d1_id:r.id,id:'d1_'+r.id}) : t; });
      Storage.saveManual(upd);
    }
  }).catch(function(){});
  BrokerImport.applyToPortfolio();
  /* Prix de repli = PRU tant que le marché n'a pas chargé → évite -100% */
  if ((type === 'buy' || type === 'sell') && price > 0 && !MarketData.getCachedPrice(ticker)) {
    Data.setFallbackPrice(ticker, price);
  }
  _rendered = {};
  buildKPI();
  closeFABSheet();
  if (navigator.vibrate) navigator.vibrate([10,40,10]);
  /* Refresh prix du ticker si achat/vente (peut être nouveau dans le portfolio) */
  if (type === 'buy' || type === 'sell') {
    MarketData.refreshAll([ticker], function(tk, quote) {
      if (!Data.assets[tk]) Data.assets[tk] = {};
      var a = Data.assets[tk];
      if (quote.annual_div != null) a.d = quote.annual_div;
      else if (quote.div_yield > 0 && quote.price > 0) a.d = +(quote.div_yield * quote.price).toFixed(4);
      if (quote.name        != null) a.name       = quote.name;
      if (quote.pe_cur      != null) a.pe_cur     = quote.pe_cur;
      if (quote.beta        != null) a.beta       = quote.beta;
      if (quote.market_cap  != null) a.market_cap = quote.market_cap;
      a._from_api = true;
      Calc.recompute();
      _rendered = {};
      buildKPI();
      const cur = document.querySelector('.panel.on');
      if (cur) renderPanel(cur.id.replace('panel-', ''), cur);
    }).catch(function(){});
  }
  /* Success flash on FAB */
  var fab = document.getElementById('mainFAB');
  if (fab) {
    fab.textContent = '✓';
    fab.style.background = 'linear-gradient(135deg,#10b981,#22d47a)';
    fab.classList.add('anim-success');
    setTimeout(function(){
      fab.textContent = '＋';
      fab.style.background = '';
      fab.classList.remove('anim-success');
    }, 1800);
  }
}

/* ── Auth ────────────────────────────────────────────────────── */
function authLogin()  { D1Client.login(); }
function authLogout() { D1Client.logout(); }

/* ── Espace client (profil) ────────────────────────────────── */
function openProfileModal() {
  var u = window._currentUser || {};
  var pseudo = localStorage.getItem('dk_pseudo') || '';
  var displayName = localStorage.getItem('dk_display_name') || u.name || '';
  var el = document.getElementById('profile-modal');
  if (!el) return;
  var emailEl = document.getElementById('pm-email');
  var pseudoEl = document.getElementById('pm-pseudo');
  var nameEl = document.getElementById('pm-name');
  if (emailEl) emailEl.textContent = u.email || '';
  if (pseudoEl) pseudoEl.value = pseudo;
  if (nameEl) nameEl.value = displayName;
  el.style.display = 'flex';
  document.getElementById('pm-overlay').style.display = 'block';
}
function closeProfileModal() {
  var el = document.getElementById('profile-modal');
  if (el) el.style.display = 'none';
  var ov = document.getElementById('pm-overlay');
  if (ov) ov.style.display = 'none';
}
async function deleteAccount() {
  if (!confirm('Supprimer définitivement ton compte et toutes tes données ?\n\nCette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : toutes tes transactions et données seront effacées.')) return;
  try {
    await fetch('/api/account', { method: 'DELETE', credentials: 'include' });
  } catch(e) {}
  localStorage.clear();
  D1Client.logout();
}

async function saveProfile() {
  var pseudo = (document.getElementById('pm-pseudo').value || '').trim();
  var displayName = (document.getElementById('pm-name').value || '').trim();
  localStorage.setItem('dk_pseudo', pseudo);
  localStorage.setItem('dk_display_name', displayName);
  try { await D1Client.putSettings({ pseudo, display_name: displayName }); } catch(e) {}
  var navInitial = document.getElementById('navUserInitial');
  var u = window._currentUser || {};
  var label = pseudo || displayName || u.name || u.email || '?';
  if (navInitial) navInitial.textContent = label[0].toUpperCase();
  closeProfileModal();
}

function loginTabSwitch(tab) {
  document.getElementById('ltab-google').classList.toggle('on', tab === 'google');
  document.getElementById('ltab-email').classList.toggle('on', tab === 'email');
  document.getElementById('login-panel-google').style.display = tab === 'google' ? '' : 'none';
  document.getElementById('login-panel-email').style.display  = tab === 'email'  ? '' : 'none';
}

var _loginMode = 'login';
function loginToggleMode() {
  _loginMode = _loginMode === 'login' ? 'register' : 'login';
  var isReg = _loginMode === 'register';
  document.getElementById('loginSubmitBtn').textContent  = isReg ? 'Créer un compte' : 'Connexion';
  var tog = document.getElementById('loginModeToggle');
  if (tog) tog.innerHTML = isReg ? 'Déjà un compte ? <span>Connexion</span>' : 'Pas encore de compte ? <span>Créer un compte</span>';
  var nameField = document.getElementById('loginName');
  if (nameField) nameField.style.display = isReg ? '' : 'none';
  var pwField = document.getElementById('loginPassword');
  if (pwField) pwField.placeholder = isReg ? 'Mot de passe (8 car. min.)' : 'Mot de passe';
  var pwAutoComplete = document.getElementById('loginPassword');
  if (pwAutoComplete) pwAutoComplete.autocomplete = isReg ? 'new-password' : 'current-password';
  document.getElementById('loginError').style.display = 'none';
}

async function authLoginEmail() {
  var email = (document.getElementById('loginEmail').value || '').trim();
  var password = document.getElementById('loginPassword').value || '';
  var errEl = document.getElementById('loginError');
  var btn   = document.getElementById('loginSubmitBtn');

  if (!email || !password) {
    errEl.textContent = 'Email et mot de passe requis'; errEl.style.display = '';
    return;
  }
  btn.disabled = true;
  btn.textContent = '...';
  errEl.style.display = 'none';

  var endpoint = _loginMode === 'register' ? '/auth/register' : '/auth/login/email';
  var body = { email, password };
  if (_loginMode === 'register') {
    var n = (document.getElementById('loginName').value || '').trim();
    if (n) body.name = n;
  }

  try {
    var res = await fetch(endpoint, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erreur';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = _loginMode === 'register' ? 'Créer un compte' : 'Connexion';
      return;
    }
    window.location.reload();
  } catch(e) {
    errEl.textContent = 'Erreur réseau';
    errEl.style.display = '';
    btn.disabled = false;
    btn.textContent = _loginMode === 'register' ? 'Créer un compte' : 'Connexion';
  }
}

/* ── Expandable portfolio cards ─────────────────────────────── */
var _rndChartCache = {};

function toggleRndCard(ticker) {
  if (navigator.vibrate) navigator.vibrate(6);
  var body  = document.getElementById('rb-'+ticker);
  var arrow = document.getElementById('ra-'+ticker);
  if (!body) return;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (arrow) arrow.style.transform = !isOpen ? 'rotate(180deg)' : '';
  if (!isOpen) _loadRndChart(ticker);
}

async function _loadRndChart(ticker) {
  var el = document.getElementById('rnd-chart-' + ticker);
  if (!el) return;
  if (_rndChartCache[ticker]) { _buildRndChart(el, ticker, _rndChartCache[ticker]); return; }
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px">Chargement...</div>';
  try {
    var res = await fetch('/api/prices/history?tickers=' + encodeURIComponent(ticker) + '&days=365');
    var data = await res.json();
    var pts = (data.prices && data.prices[ticker]) || [];
    if (pts.length < 2) {
      el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px">'
        + '<span style="font-size:18px">📊</span>'
        + '<span style="font-size:11px;color:var(--muted)">Historique disponible demain</span>'
        + '<span style="font-size:9px;color:var(--muted);opacity:.6">Le cron enregistre les prix chaque soir</span>'
        + '</div>';
      return;
    }
    _rndChartCache[ticker] = pts;
    _buildRndChart(el, ticker, pts);
  } catch(e) {
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px">Erreur chargement</div>';
  }
}

function _buildRndChart(container, ticker, pts) {
  var buys = (Data.transactions || [])
    .filter(function(t) { return t.ticker === ticker && t.type === 'buy'; });
  var W = 340, H = 90;
  var prices = pts.map(function(p) { return p.price; });
  var dates  = pts.map(function(p) { return p.date; });
  var n = prices.length;
  var mn = prices[0], mx = prices[0];
  for (var i=1;i<n;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}
  var rng = mx - mn || 1;
  function px(i){ return ((i/(n-1))*W).toFixed(1); }
  function py(v){ return (H - ((v-mn)/rng*(H*0.82)+H*0.09)).toFixed(1); }
  var path='M'+px(0)+' '+py(prices[0]);
  for(var j=1;j<n;j++) path+=' L'+px(j)+' '+py(prices[j]);
  var fill = path+' L'+W+' '+H+' L0 '+H+' Z';
  var gid  = 'rndg'+ticker;
  var col  = prices[n-1] >= prices[0] ? '#22d47a' : '#f43f5e';
  var perf = prices[0]>0 ? ((prices[n-1]-prices[0])/prices[0]*100).toFixed(1) : '0.0';
  var perfStr = (parseFloat(perf)>=0?'+':'')+perf+'%';
  var buyMarkers = '';
  buys.forEach(function(b) {
    var idx = -1;
    for(var k=0;k<dates.length;k++){ if(dates[k]>=b.date){idx=k;break;} }
    if(idx<0) idx = n-1;
    if(idx>=n) return;
    var cx=parseFloat(px(idx)), cy=parseFloat(py(prices[idx]));
    buyMarkers += '<line x1="'+cx+'" y1="0" x2="'+cx+'" y2="'+H+'" stroke="rgba(245,166,35,.35)" stroke-width="1" stroke-dasharray="3,2"/>';
    buyMarkers += '<circle cx="'+cx+'" cy="'+cy+'" r="4.5" fill="#f5a623" stroke="#08080f" stroke-width="1.5"/>';
  });
  var d0 = dates[0] ? dates[0].slice(0,10) : '';
  var d1 = dates[n-1] ? dates[n-1].slice(0,10) : '';
  container.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px 3px">'
    + '<span style="font-size:9px;color:var(--muted)">'+d0+'</span>'
    + '<span style="font-size:10px;font-weight:700;color:'+col+'">'+perfStr+' 1 an</span>'
    + '<span style="font-size:9px;color:var(--muted)">'+d1+'</span>'
    + '</div>'
    + '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;display:block;height:'+H+'px" preserveAspectRatio="none">'
    + '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="'+col+'" stop-opacity="0.28"/>'
    + '<stop offset="100%" stop-color="'+col+'" stop-opacity="0.02"/>'
    + '</linearGradient></defs>'
    + '<path d="'+fill+'" fill="url(#'+gid+')"/>'
    + buyMarkers
    + '<path d="'+path+'" fill="none" stroke="'+col+'" stroke-width="1.8" stroke-linejoin="round"/>'
    + (buys.length ? '<text x="'+(W-4)+'" y="10" text-anchor="end" font-size="8" fill="#f5a623" opacity=".8">● achats</text>' : '')
    + '</svg>';
}


// ── Expose global functions for inline HTML event handlers ──
Object.assign(window, {
  syncIBKR,
  authLogin, authLogout, authLoginEmail, loginTabSwitch, loginToggleMode,
  openProfileModal, closeProfileModal, saveProfile, deleteAccount,
  openFABSheet, closeFABSheet, submitFABTx, fabTickerInput, fabSelectTicker,
  showDSESheet, closeDSESheet,
  toggleRndCard,
  goTo,
  handleFile, handleDrop, cancelImport, validateImport, switchImportTab,
  addManualTransaction, deleteManualTx, deleteByTicker, clearManualTransactions, clearAll,
  saveFundamentalsForm,
  _retryPanel: (pid) => renderPanel(pid, document.getElementById('panel-' + pid)),
});
