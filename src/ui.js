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

function renderPanel(pid, el) {
  try {
    const map = {
      accueil:      renderAccueil,
      rendement:    renderRendement,
      secteurs:     renderSecteurs,
      dividendes:   renderDividendes,
      calendar:     renderCalendar,
      deal:         renderDeal,
      valorisation: renderValorisation,
      news:         renderNews,
      impots:       renderImpots,
      import:       renderImport,
    };
    map[pid]?.(el);
  } catch(e) {
    el.innerHTML = `<div style="padding:20px;color:#f43f5e;font-size:12px;font-family:monospace">Erreur [${pid}]: ${e.message}</div>`;
  }
}

function safetyLabel(sc) { return Calc.safetyLabel(sc); }
function getPortfolioDSE() { return DividendSafety.getPortfolioDSE(); }

/* ── Helper état vide générique ── */
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _emptyState(icon, title, subtitle) {
  return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;padding:24px 16px;text-align:center">'
    + '<div style="font-size:48px;margin-bottom:16px">' + icon + '</div>'
    + '<div style="font-size:18px;font-weight:700;margin-bottom:8px">' + title + '</div>'
    + '<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:24px;max-width:260px">' + subtitle + '</div>'
    + '<button onclick="goTo(9)" style="padding:12px 24px;border-radius:12px;background:var(--violet);color:#fff;font-weight:700;font-size:13px;cursor:pointer;border:none;margin-bottom:10px">📂 Importer CSV</button>'
    + '<button onclick="goTo(9);setTimeout(function(){switchImportTab(\'manual\');},100)" style="padding:12px 24px;border-radius:12px;background:var(--surface);color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;border:1px solid var(--border)">✏️ Saisie manuelle</button>'
    + '</div>';
}

function buildSVG(pts, col, H) {
  if (!pts || pts.length < 2) return '';
  H = H || 110;
  var W = 360, mn = pts[0], mx = pts[0];
  for (var i = 1; i < pts.length; i++) { if (pts[i] < mn) mn = pts[i]; if (pts[i] > mx) mx = pts[i]; }
  var rng = mx - mn || 1;
  function px(i) { return ((i / (pts.length-1)) * W).toFixed(1); }
  function py(v) { return (H - ((v-mn)/rng*(H*0.82)+H*0.09)).toFixed(1); }
  var d = 'M' + px(0) + ' ' + py(pts[0]);
  for (var j = 1; j < pts.length; j++) d += ' L' + px(j) + ' ' + py(pts[j]);
  var fill = d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
  var id   = 'g' + H + (col.replace('#',''));
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block;height:' + H + 'px" preserveAspectRatio="none">'
    + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="' + col + '" stop-opacity="0.28"/>'
    + '<stop offset="100%" stop-color="' + col + '" stop-opacity="0.02"/>'
    + '</linearGradient></defs>'
    + '<path d="' + fill + '" fill="url(#' + id + ')"/>'
    + '<path d="' + d    + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-linejoin="round"/>'
    + '</svg>';
}

/* -- ACCUEIL ---------------------------------------------- */
var _mode = '1Y';
var _hoverIdx = -1;
var _navHistory = null; // { nav: [{date, nav_usd}] } chargé depuis /api/nav
var _spyHistory = null; // [{date, close}] chargé depuis /api/benchmark

function _logo(ticker, size) {
  size = size || 28;
  return '<img src="https://financialmodelingprep.com/image-stock/' + ticker + '.png"'
    + ' width="' + size + '" height="' + size + '" alt=""'
    + ' style="border-radius:50%;object-fit:contain;background:var(--surface2);flex-shrink:0;display:inline-block"'
    + ' onerror="this.style.display=\'none\'"'
    + ' loading="lazy">';
}

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


function renderRendement(el) {
  if (raw.length === 0) { el.innerHTML = _emptyState('📈', 'Aucune position', 'Importe tes transactions pour voir ton portefeuille détaillé.'); return; }
  if (!el._sk) { el._sk = 'pp'; el._sd = 'desc'; }
  var sk = el._sk, sd = el._sd;
  var tot = getMV();
  var data = raw.map(function(d) {
    var div = meta[d.ticker] && meta[d.ticker].d || 0;
    var yd  = d.price > 0 ? div/d.price*100 : 0;
    var yoc = d.avg   > 0 ? div/d.avg*100   : 0;
    var pp  = d.avg > 0 ? (d.price - d.avg)/d.avg*100 : 0;
    var cost = d.avg * d.qty;
    return {ticker:d.ticker,name:d.name,qty:d.qty,price:d.price,avg:d.avg,
            mv:d.mv,pnl:d.pnl,dpnl:d.dpnl,sec:d.sec,yd:yd,yoc:yoc,pp:pp,cost:cost};
  }).sort(function(a, b) {
    var va = a[sk] !== undefined ? a[sk] : 0;
    var vb = b[sk] !== undefined ? b[sk] : 0;
    return sd === 'asc' ? va - vb : vb - va;
  });
  var sortOpts = [
    {k:'pp',    lbl:'P&L %'},
    {k:'pnl',   lbl:'P&L \u20ac'},
    {k:'mv',    lbl:'Valeur'},
    {k:'cost',  lbl:'Investi'},
    {k:'yd',    lbl:'Yield'},
    {k:'yoc',   lbl:'YoC'},
    {k:'ticker',lbl:'A\u2192Z'},
  ];
  var toggleHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">'
    + '<span style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">Trier par</span>';
  for (var oi = 0; oi < sortOpts.length; oi++) {
    var opt = sortOpts[oi];
    var on = sk === opt.k;
    var arrow = on ? (sd === 'asc' ? ' \u2191' : ' \u2193') : '';
    toggleHtml += '<button data-sk="'+opt.k+'" style="padding:5px 11px;border-radius:16px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid '+(on?'var(--violet)':'var(--border)')+';background:'+(on?'rgba(124,109,255,.15)':'transparent')+';color:'+(on?'var(--violet)':'var(--muted)')+'">'+opt.lbl+arrow+'</button>';
  }
  toggleHtml += '</div>';
  var totalPnl = 0, totalCost = 0, totalMV2 = 0;
  for (var ki=0;ki<data.length;ki++){totalPnl+=data[ki].pnl;totalCost+=data[ki].cost;totalMV2+=data[ki].mv;}
  var totalPp = totalCost > 0 ? totalPnl/totalCost*100 : 0;
  var summaryHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Investi</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace">'+Math.round(toE(totalCost)).toLocaleString('fr-FR')+'\u20ac</div>'
    +'</div>'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Valeur</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace">'+Math.round(toE(totalMV2)).toLocaleString('fr-FR')+'\u20ac</div>'
    +'</div>'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">P&L total</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace;color:'+(totalPnl>=0?'#22d47a':'#f43f5e')+'">'+(totalPnl>=0?'+':'')+Math.round(toE(totalPnl)).toLocaleString('fr-FR')+'\u20ac</div>'
    +'<div style="font-size:9px;color:var(--muted)">'+(totalPp>=0?'+':'')+totalPp.toFixed(1)+'%</div>'
    +'</div></div>';
  var rows = '';
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    var w = tot > 0 ? d.mv/tot*100 : 0;
    var ppC = d.pp >= 0 ? '#22d47a' : '#f43f5e';
    var pnlC = d.pnl >= 0 ? '#22d47a' : '#f43f5e';
    var div2 = meta[d.ticker] && meta[d.ticker].d || 0;
    var rndMeta = meta[d.ticker] || {};
    var rndDSEResult = rndMeta.payout_ratio != null ? calculateDividendSafety(rndMeta) : null;
    var rndDseScore = rndDSEResult ? rndDSEResult.safetyScore : (rndMeta.safe || calculateDividendSafety(rndMeta).safetyScore);
    var rndDseCol = dseColor(rndDseScore);
    var dpnlDay = d.dpnl ? ((d.dpnl>=0?'+':'')+Math.round(toE(d.dpnl))+'\u20ac auj.') : '';
    /* \u2500\u2500 Collapsed head \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    rows += '<div class="rnd-card" style="border-left:3px solid '+(d.pnl>=0?'#22d47a':'#f43f5e')+'">'
      +'<div class="rnd-head" onclick="toggleRndCard(\''+d.ticker+'\')" style="gap:10px">'
      + _logo(d.ticker, 32)
      +'<div style="flex:1;min-width:0;margin-right:10px">'
      +'<div style="display:flex;align-items:baseline;gap:7px;margin-bottom:5px">'
      +'<span style="font-size:16px;font-weight:700;letter-spacing:-.3px">'+d.ticker+getDivBadge(d.ticker)+'</span>'
      +'<span style="font-size:10px;color:var(--muted)">'+d.sec+'</span>'
      +'</div>'
      +(div2>0
        ? '<div style="display:flex;align-items:center;gap:5px">'
          +'<span style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">'+d.yd.toFixed(2)+'%</span>'
          +'<span style="font-size:9px;color:var(--border)">|</span>'
          +'<span style="font-size:10px;color:var(--muted)">YoC</span>'
          +'<span style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:#86efad">'+d.yoc.toFixed(2)+'%</span>'
          +'</div>'
        : '<div style="font-size:10px;color:var(--muted)">Pas de dividende</div>')
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:10px;flex-shrink:0">'
      +'<div style="text-align:right">'
      +'<div style="font-size:15px;font-weight:700;font-family:DM Mono,monospace;color:'+ppC+'">'+(d.pp>=0?'+':'')+d.pp.toFixed(1)+'%</div>'
      +'<div style="font-size:10px;color:'+pnlC+';font-family:DM Mono,monospace">'+(d.pnl>=0?'+':'')+Math.round(toE(d.pnl))+'\u20ac</div>'
      +'</div>'
      +'<span class="rnd-arrow" id="ra-'+d.ticker+'">\u25be</span>'
      +'</div>'
      +'</div>'  /* end rnd-head */
      /* \u2500\u2500 Expandable body \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      +'<div class="rnd-body" id="rb-'+d.ticker+'">'
      +'<div class="rnd-body-inner">'
      /* DSE + 4-col grid */
      +'<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:8px">'
      +'<div style="cursor:pointer;background:rgba(0,0,0,.2);border:1px solid '+rndDseCol+';border-radius:8px;padding:5px 8px;text-align:center;min-width:44px;flex-shrink:0" onclick="event.stopPropagation();showDSESheet(\''+d.ticker+'\')">'
      +'<div style="font-size:11px;font-weight:700;color:'+rndDseCol+'">'+rndDseScore+'</div>'
      +'<div style="font-size:7.5px;color:'+rndDseCol+'">DSE</div>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;flex:1">'
      +'<div><div style="font-size:8.5px;color:var(--muted)">PRU</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+d.avg.toFixed(2)+'$</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Cours</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+d.price.toFixed(2)+'$</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Investi</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+Math.round(toE(d.cost))+'\u20ac</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Poids</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600;color:'+(w>12?'#f43f5e':w>8?'#f5a623':'var(--text)')+'">'+w.toFixed(1)+'%</div></div>'
      +'</div>'
      +'</div>'
      /* Yield dual cards */
      +(div2>0
        ? '<div style="padding-top:8px;border-top:1px solid rgba(255,255,255,.05)">'
          +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">'
          +'<div style="background:rgba(34,212,122,.07);border:1px solid rgba(34,212,122,.15);border-radius:9px;padding:7px 10px;text-align:center">'
          +'<div style="font-size:8.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Yield actuel</div>'
          +'<div style="font-size:17px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">'+d.yd.toFixed(2)+'%</div>'
          +'<div style="font-size:8px;color:var(--muted);margin-top:1px">sur '+d.price.toFixed(2)+'$</div>'
          +'</div>'
          +'<div style="background:rgba(134,239,172,.06);border:1px solid rgba(134,239,172,.15);border-radius:9px;padding:7px 10px;text-align:center">'
          +'<div style="font-size:8.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Yield on Cost</div>'
          +'<div style="font-size:17px;font-weight:700;font-family:DM Mono,monospace;color:#86efad">'+d.yoc.toFixed(2)+'%</div>'
          +'<div style="font-size:8px;color:var(--muted);margin-top:1px">sur PRU '+d.avg.toFixed(2)+'$</div>'
          +'</div>'
          +'</div>'
          +'<div style="display:flex;gap:16px">'
          +'<div><span style="font-size:9px;color:var(--muted)">Div/an </span><span style="font-size:11px;font-weight:700;color:#22d47a">'+Math.round(div2*d.qty)+'$</span></div>'
          +'<div><span style="font-size:9px;color:var(--muted)">Qt\u00e9 </span><span style="font-size:11px;font-weight:700">'+d.qty+'</span></div>'
          +(dpnlDay?'<div style="margin-left:auto"><span style="font-size:9px;color:var(--muted)">Auj. </span><span style="font-size:11px;font-weight:700;color:'+(d.dpnl>=0?'#22d47a':'#f43f5e')+'">'+dpnlDay+'</span></div>':'')
          +'</div>'
          +'</div>'
        : (dpnlDay?'<div style="padding-top:6px;border-top:1px solid rgba(255,255,255,.05);font-size:10px;color:var(--muted)">Auj. <span style="font-weight:700;color:'+(d.dpnl>=0?'#22d47a':'#f43f5e')+'">'+dpnlDay+'</span></div>':''))
      +'<div id="rnd-chart-'+d.ticker+'" style="margin-top:10px;height:110px;border-radius:9px;overflow:hidden;background:rgba(0,0,0,.2);border:1px solid var(--border)"></div>'
      +'<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.05)">'
      +'<button onclick="event.stopPropagation();deleteByTicker(\''+d.ticker+'\')" style="width:100%;padding:8px;border-radius:9px;background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);color:#f43f5e;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">\ud83d\uddd1 Retirer '+d.ticker+' du portefeuille</button>'
      +'</div>'
      +'</div>'  /* end rnd-body-inner */
      +'</div>'  /* end rnd-body */
      +'</div>'; /* end rnd-card */
  }
  el.innerHTML = summaryHtml + toggleHtml + rows;
  el._sk = sk; el._sd = sd;
  var btns = el.querySelectorAll('[data-sk]');
  for (var j = 0; j < btns.length; j++) {
    (function(b) {
      b.addEventListener('click', function() {
        var k = b.dataset.sk;
        if (el._sk === k) { el._sd = el._sd === 'asc' ? 'desc' : 'asc'; }
        else { el._sk = k; el._sd = 'asc'; }
        _rendered['rendement'] = 0;
        renderPanel('rendement', el);
      });
    })(btns[j]);
  }
}


function renderSecteurs(el) {
  if (window._secteursTab === undefined) window._secteursTab = 'secteur';
  if (raw.length === 0) { el.innerHTML = _emptyState('\U0001F3AF', 'Aucun secteur', 'La diversification sectorielle s\'affiche dès que tu as des positions.'); return; }
  var mv = getMV();
  var cols = {
    'Tech':'#6c63ff','Santé':'#00d4a1','Conso.':'#f59e0b',
    'Utilities':'#38bdf8','Finance':'#a78bfa','Immo.':'#fb7185',
    'Industrie':'#34d399','Mat.':'#fbbf24','Médias':'#e879f9'
  };
  var tickerCols = ['#6c63ff','#00d4a1','#f59e0b','#38bdf8','#a78bfa','#fb7185','#34d399','#fbbf24','#e879f9','#f97316','#06b6d4','#ec4899'];

  function buildPie(segments) {
    var W = 200, CX = 100, CY = 100, R = 85, RI = 45;
    var total = 0;
    for (var i=0;i<segments.length;i++) total += segments[i].v;
    var paths = '', labels = '';
    var angle = -Math.PI/2;
    for (var j=0;j<segments.length;j++) {
      var seg = segments[j];
      var sweep = (seg.v/total)*2*Math.PI;
      var x1 = CX + R*Math.cos(angle), y1 = CY + R*Math.sin(angle);
      var x2 = CX + R*Math.cos(angle+sweep), y2 = CY + R*Math.sin(angle+sweep);
      var xi1 = CX + RI*Math.cos(angle), yi1 = CY + RI*Math.sin(angle);
      var xi2 = CX + RI*Math.cos(angle+sweep), yi2 = CY + RI*Math.sin(angle+sweep);
      var lg = sweep > Math.PI ? 1 : 0;
      paths += '<path d="M'+xi1.toFixed(1)+' '+yi1.toFixed(1)+' L'+x1.toFixed(1)+' '+y1.toFixed(1)
        +' A'+R+' '+R+' 0 '+lg+' 1 '+x2.toFixed(1)+' '+y2.toFixed(1)
        +' L'+xi2.toFixed(1)+' '+yi2.toFixed(1)
        +' A'+RI+' '+RI+' 0 '+lg+' 0 '+xi1.toFixed(1)+' '+yi1.toFixed(1)+' Z"'
        +' fill="'+seg.c+'" opacity="0.9" stroke="#08080f" stroke-width="1.5"/>';
      if (sweep > 0.38) {
        var mid = angle + sweep/2;
        var lx = CX + (R+RI)/2*Math.cos(mid), ly = CY + (R+RI)/2*Math.sin(mid);
        labels += '<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="700" fill="#fff" font-family="DM Mono,monospace">'+(seg.v/total*100).toFixed(0)+'%</text>';
      }
      angle += sweep;
    }
    var navEur = Math.round(mv/eu()).toLocaleString('fr-FR');
    return '<svg viewBox="0 0 '+W+' '+W+'" style="width:100%;max-width:220px;display:block;margin:0 auto">'
      +paths+labels
      +'<text x="'+CX+'" y="'+(CY-8)+'" text-anchor="middle" font-size="11" fill="#e2e2ec" font-weight="700" font-family="DM Mono,monospace">'+navEur+'€</text>'
      +'<text x="'+CX+'" y="'+(CY+9)+'" text-anchor="middle" font-size="8" fill="#52527a" font-family="DM Sans,sans-serif">Total</text>'
      +'</svg>';
  }

  function pieLegend(arr, colorFn) {
    var h2 = '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin:10px 0 4px;justify-content:center">';
    for (var j=0;j<arr.length;j++) {
      var a=arr[j], w=mv>0?a.mv/mv*100:0, c=colorFn(a,j);
      h2+='<div style="display:flex;align-items:center;gap:4px;font-size:10px">'
        +'<span style="width:10px;height:10px;border-radius:3px;background:'+c+';flex-shrink:0;display:inline-block"></span>'
        +'<span style="color:var(--muted)">'+a.s+'</span>'
        +'<span style="color:var(--text);font-weight:700">'+w.toFixed(1)+'%</span>'
        +'</div>';
    }
    return h2+'</div>';
  }

  var toggle = '<div style="display:flex;background:rgba(255,255,255,.06);border-radius:10px;padding:3px;gap:3px;margin-bottom:14px">'
    +'<button onclick="window._secteursTab=\'secteur\';renderSecteurs(document.getElementById(\'panel-secteurs\'))" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;'+((_secteursTab==='secteur')?'background:#6c63ff;color:#fff':'background:transparent;color:var(--muted)')+'">Secteur</button>'
    +'<button onclick="window._secteursTab=\'entreprise\';renderSecteurs(document.getElementById(\'panel-secteurs\'))" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;'+((_secteursTab==='entreprise')?'background:#6c63ff;color:#fff':'background:transparent;color:var(--muted)')+'">Entreprise</button>'
    +'</div>';

  var h = '<div class="section-title">Diversification</div>' + toggle;

  if (window._secteursTab === 'secteur') {
    var map = {};
    for (var i = 0; i < raw.length; i++) {
      var d = raw[i];
      if (!map[d.sec]) map[d.sec] = {mv:0, pnl:0, n:0, tickers:[]};
      map[d.sec].mv  += d.mv;
      map[d.sec].pnl += d.pnl;
      map[d.sec].n   += 1;
      map[d.sec].tickers.push(d);
    }
    var arr = [];
    for (var k in map) arr.push({s:k, mv:map[k].mv, pnl:map[k].pnl, n:map[k].n, tickers:map[k].tickers});
    arr.sort(function(a, b) { return b.mv - a.mv; });
    var segments = arr.map(function(a){ return {v:a.mv, c:cols[a.s]||'#888', s:a.s}; });
    h += '<div class="card" style="padding:16px 10px 12px">'+buildPie(segments)+pieLegend(arr, function(a){ return cols[a.s]||'#888'; })+'</div>';
    for (var j = 0; j < arr.length; j++) {
      var a = arr[j], w = mv > 0 ? a.mv/mv*100 : 0;
      var c = cols[a.s] || '#888';
      var pC = a.pnl >= 0 ? 'up' : 'dn';
      h += '<div style="background:var(--surface);border-radius:12px;padding:13px;margin-bottom:10px">'
        +'<div class="sb-top">'
        +'<span class="sb-name" style="font-size:13px;font-weight:700">'+a.s+'</span>'
        +'<span class="sb-info">'+a.n+' pos · '+w.toFixed(1)+'% · <span class="'+pC+'">'+(a.pnl>=0?'+':'')+Math.round(toE(a.pnl))+'€</span></span>'
        +'</div>'
        +'<div class="sb-bg" style="margin:8px 0;position:relative"><div class="sb-fill" style="width:'+Math.min(w,100).toFixed(1)+'%;background:'+(w>25?'#f43f5e':c)+'"></div>'
        +'<div style="position:absolute;top:-3px;bottom:-3px;left:25%;width:2px;background:rgba(244,63,94,.7);border-radius:1px" title="Limite 25%"></div>'
        +'</div>'
        +(w>25?'<div style="font-size:9px;color:#f43f5e;font-weight:700;margin-bottom:4px">⚠ Dépasse la limite 25% ('+w.toFixed(1)+'%)</div>':'')
        +'<div style="display:flex;flex-direction:column;gap:0">';
      var tickers = a.tickers.slice().sort(function(x,y){ return y.mv - x.mv; });
      for (var ti=0; ti<tickers.length; ti++) {
        var dd = tickers[ti];
        var ppl = dd.avg>0?(dd.price-dd.avg)/dd.avg*100:0;
        var pplC = ppl>=0?'#22d47a':'#f43f5e';
        var divAnn = (meta[dd.ticker]&&meta[dd.ticker].d||0)*dd.qty;
        h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid rgba(255,255,255,.04)">'
          +'<div style="display:flex;align-items:center;gap:6px">' + _logo(dd.ticker, 22) + '<div><span style="font-size:12.5px;font-weight:700">'+dd.ticker+getDivBadge(dd.ticker)+'</span>'
          +'<span style="font-size:10px;color:var(--muted);margin-left:6px">×'+dd.qty+'</span></div></div>'
          +'<div style="text-align:right">'
          +'<span style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+Math.round(toE(dd.mv)).toLocaleString('fr-FR')+'€</span>'
          +'<span style="font-size:10px;color:'+pplC+';margin-left:7px;font-family:DM Mono,monospace;font-weight:600">'+(ppl>=0?'+':'')+ppl.toFixed(1)+'%</span>'
          +(divAnn>0?'<div style="font-size:9px;color:#22d47a">'+Math.round(divAnn)+'$/an</div>':'')
          +'</div></div>';
      }
      h += '</div></div>';
    }
  } else {
    var entArr = raw.slice().sort(function(a, b) { return b.mv - a.mv; });
    var entSegs = entArr.map(function(a, idx){ return {v:a.mv, c:tickerCols[idx%tickerCols.length], s:a.ticker}; });
    var entArrForLegend = entArr.map(function(a, idx){ return {s:a.ticker, mv:a.mv, _c:tickerCols[idx%tickerCols.length]}; });
    h += '<div class="card" style="padding:16px 10px 12px">'+buildPie(entSegs)+pieLegend(entArrForLegend, function(a){ return a._c; })+'</div>';
    for (var j = 0; j < entArr.length; j++) {
      var dd = entArr[j];
      var c = tickerCols[j%tickerCols.length];
      var w = mv > 0 ? dd.mv/mv*100 : 0;
      var ppl = dd.avg>0?(dd.price-dd.avg)/dd.avg*100:0;
      var pplC2 = ppl>=0?'#22d47a':'#f43f5e';
      var pC = dd.pnl >= 0 ? 'up' : 'dn';
      var divAnn = (meta[dd.ticker]&&meta[dd.ticker].d||0)*dd.qty;
      h += '<div style="background:var(--surface);border-radius:12px;padding:13px;margin-bottom:10px">'
        +'<div class="sb-top">'
        +'<div style="display:flex;align-items:center;gap:7px">' + _logo(dd.ticker, 24)
        +'<span class="sb-name" style="font-size:13px;font-weight:700">'+dd.ticker+getDivBadge(dd.ticker)+'</span>'
        +(dd.name?'<span style="font-size:10px;color:var(--muted)">'+_esc(dd.name)+'</span>':'')
        +'</div>'
        +'<span class="sb-info">'+w.toFixed(1)+'% · <span class="'+pC+'">'+(dd.pnl>=0?'+':'')+Math.round(toE(dd.pnl))+'€</span></span>'
        +'</div>'
        +'<div class="sb-bg" style="margin:8px 0;position:relative"><div class="sb-fill" style="width:'+Math.min(w,100).toFixed(1)+'%;background:'+(w>25?'#f43f5e':c)+'"></div>'
        +'<div style="position:absolute;top:-3px;bottom:-3px;left:25%;width:2px;background:rgba(244,63,94,.7);border-radius:1px" title="Limite 25%"></div>'
        +'</div>'
        +(w>25?'<div style="font-size:9px;color:#f43f5e;font-weight:700;margin-bottom:4px">⚠ Dépasse la limite 25% ('+w.toFixed(1)+'%)</div>':'')
        +'<div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid rgba(255,255,255,.04)">'
        +'<div style="font-size:11px;color:var(--muted)">×'+dd.qty+' · PRU '+Math.round(toE(dd.avg*dd.qty)).toLocaleString('fr-FR')+'€</div>'
        +'<div style="text-align:right">'
        +'<span style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+Math.round(toE(dd.mv)).toLocaleString('fr-FR')+'€</span>'
        +'<span style="font-size:10px;color:'+pplC2+';margin-left:7px;font-family:DM Mono,monospace;font-weight:600">'+(ppl>=0?'+':'')+ppl.toFixed(1)+'%</span>'
        +(divAnn>0?'<div style="font-size:9px;color:#22d47a">'+Math.round(divAnn)+'$/an</div>':'')
        +'</div></div>'
        +'</div>';
    }
  }
  el.innerHTML = h;
}


function renderDividendes(el) {
  /* ── État vide ── */
  if (raw.length === 0) {
    el.innerHTML = _emptyState('💰', 'Aucun dividende', 'Ajoute des actions à ton portefeuille pour voir les projections Snowball.');
    return;
  }
  /* -- données de base ----------------------------------- */
  var dA   = getDivA() / eu();          // dividende annuel brut en EUR
  var dM   = dA / 12;                   // mensuel brut
  var cost = getCost() / eu();          // PRU total EUR
  var mv   = getMV()   / eu();          // valeur marché EUR
  var yoc  = cost > 0 ? dA/cost*100 : 0;
  var yld  = mv   > 0 ? dA/mv*100   : 0;
  var PFU  = 0.314;                    // 31.4% PFU 2026 (17.2% PS + 12.8% IR)
  var TARGET = 1500;                    // objectif mensuel net

  /* -- état mutable (stocké sur el pour persistance) ------ */
  if (el._divState === undefined) {
    el._divState = {contrib:300, horizon:30, pfu:true, drip:true};
  }
  var S = el._divState;

  /* -- mode switcher (Snowball / Simulation) -------------- */
  if (el._divMode === undefined) el._divMode = 'snowball';

  /* -- si mode simulation, déléguer ----------------------- */
  if (el._divMode === 'simulation') {
    renderSimulation(el);
    return;
  }

  /* -- calcul projection snowball -------------------------- */
  // Formule calée sur index-4 : yield 3,54% · croissance 5,7% · DRIP
  // Résultat : 33 670€ brut en 2056 (30 ans) avec contrib 300€/mois
  function project(contrib, horizon, applyPfu, drip) {
    var rows   = [];
    var YIELD  = 0.0354;   // rendement du capital réinvesti
    var G      = 0.057;    // croissance annuelle dividendes
    var today  = new Date().getFullYear();
    var div    = dA;       // dividende annuel brut EUR de départ
    var port   = mv;       // valeur portefeuille EUR de départ

    for (var y = 1; y <= horizon; y++) {
      var brut = drip
        ? (div + div * YIELD + contrib * 12 * YIELD) * (1 + G)
        : div * (1 + G) + contrib * 12 * YIELD;
      var pfu  = applyPfu ? brut * PFU : 0;
      var net  = brut - pfu;
      var netM = net / 12;
      port = port * (1 + YIELD) + contrib * 12;

      rows.push({
        yr   : today + y,
        brut : Math.round(brut),
        pfu  : Math.round(pfu),
        net  : Math.round(net),
        netM : Math.round(netM),
        port : Math.round(port)
      });

      div = brut;
    }
    return rows;
  }

  /* -- trouver l'année objectif ----------------------------- */
  function findTarget(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].netM >= TARGET) return rows[i].yr;
    }
    return '>' + (new Date().getFullYear() + rows.length);
  }

  /* -- SVG multi-courbes projection ------------------------ */
  function projSVG(rows) {
    var W = 340, H = 160;
    var bruts = rows.map(function(r){return r.brut;});
    var nets  = rows.map(function(r){return r.net; });
    var pfus  = rows.map(function(r){return r.pfu; });
    var mx    = Math.max.apply(null, bruts) || 1;
    var tgt   = TARGET * 12;
    function px(i){ return ((i/(rows.length-1))*W).toFixed(1); }
    function py(v){ return (H - (v/mx)*(H*0.88) - H*0.06).toFixed(1); }
    // Courbe brut
    var dB='M'+px(0)+' '+py(bruts[0]);
    for(var i=1;i<bruts.length;i++) dB+=' L'+px(i)+' '+py(bruts[i]);
    // Courbe net
    var dN='M'+px(0)+' '+py(nets[0]);
    for(var j=1;j<nets.length;j++) dN+=' L'+px(j)+' '+py(nets[j]);
    // Fill brut
    var fB=dB+' L'+W+' '+H+' L0 '+H+' Z';
    // Ligne objectif 1500€*12
    var tyP = py(tgt).toString(); // si dans la plage
    var tShow = tgt <= mx;
    return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;display:block" preserveAspectRatio="none">'
      +'<defs>'
      +'<linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c6dff" stop-opacity="0.25"/><stop offset="100%" stop-color="#7c6dff" stop-opacity="0.02"/></linearGradient>'
      +'</defs>'
      +'<path d="'+fB+'" fill="url(#gb)"/>'
      +'<path d="'+dB+'" fill="none" stroke="#7c6dff" stroke-width="2" stroke-linejoin="round"/>'
      +'<path d="'+dN+'" fill="none" stroke="#22d47a" stroke-width="2" stroke-linejoin="round" stroke-dasharray="0"/>'
      +(tShow ? '<line x1="0" y1="'+tyP+'" x2="'+W+'" y2="'+tyP+'" stroke="#f43f5e" stroke-width="1" stroke-dasharray="4,4"/>'
               +'<text x="'+(W-4)+'" y="'+(parseFloat(tyP)-4)+'" fill="#f43f5e" font-size="9" text-anchor="end">'+TARGET+'\u20ac</text>' : '')
      +'</svg>';
  }

  /* -- légende SVG ------------------------------------------ */
  function legend() {
    return '<div style="display:flex;gap:14px;margin-top:8px;font-size:10.5px;color:var(--muted)">'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#7c6dff;display:inline-block;border-radius:1px"></span>Brut</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#22d47a;display:inline-block;border-radius:1px"></span>Net</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#f43f5e;display:inline-block;border-radius:1px;border-top:1px dashed #f43f5e"></span>PFU '+Math.round(PFU*100)+'%</span>'
      +'</div>';
  }

  /* -- tableau projection ----------------------------------- */
  function tableRows(rows) {
    var h='';
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var isTarget = r.netM >= TARGET;
      h+='<tr style="'+(isTarget?'background:rgba(34,212,122,.06)':'')+'">'
        +'<td class="fw7 mono">'+(isTarget?'<span style="display:inline-flex;align-items:center;gap:3px">'+r.yr+'<span style="font-size:9px">\uD83C\uDFAF</span></span>':r.yr)+'</td>'
        +'<td class="mono" style="text-align:right;color:#7c6dff">'+r.port.toLocaleString('fr-FR')+'\u20ac</td>'
        +'<td class="mono up" style="text-align:right">'+r.brut.toLocaleString('fr-FR')+'\u20ac</td>'
        +'<td class="mono" style="text-align:right;color:#86efad">'+r.net.toLocaleString('fr-FR')+'\u20ac</td>'
        +'<td class="mono" style="text-align:right;color:#86efad">'+r.netM.toLocaleString('fr-FR')+'\u20ac</td>'
        +'</tr>';
    }
    return h;
  }

  /* -- RENDER COMPLET --------------------------------------- */
  function draw() {
    var rows   = project(S.contrib, S.horizon, S.pfu, S.drip);
    var yrObj  = findTarget(rows);
    var yrsTo  = typeof yrObj==='number' ? (yrObj - new Date().getFullYear()) + ' ans' : 'N/A';
    var netAnn = Math.round(dA * (S.pfu ? (1-PFU) : 1));
    var netMon = Math.round(netAnn/12);

    el.innerHTML = ''
      /* Mode switcher */
      +'<div style="display:flex;gap:0;background:var(--surface);border-radius:10px;padding:3px;margin-bottom:14px;width:fit-content">'
      +'<button id="btnModeSnowball" onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'snowball\';renderDividendes(p);}})()" '
      +'style="padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;cursor:pointer;border:none;min-height:44px;'
      +(el._divMode==='snowball'?'background:var(--violet);color:#fff;':'background:transparent;color:var(--muted);')
      +'">📈 Projection</button>'
      +'<button id="btnModeSimu" onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'simulation\';renderDividendes(p);}})()" '
      +'style="padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;cursor:pointer;border:none;min-height:44px;'
      +(el._divMode==='simulation'?'background:var(--violet);color:#fff;':'background:transparent;color:var(--muted);')
      +'">🧮 Simulation</button>'
      +'</div>'

      /* Titre */
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">'
      +'<span style="font-size:22px">\uD83D\uDCB0</span>'
      +'<div><div class="section-title" style="margin:0">Dividendes</div>'
      +'<div class="mu" style="font-size:11px">Projection dividendes \u00b7 PFU '+Math.round(PFU*100)+'% \u00b7 Objectif '+TARGET+'\u20ac net</div>'
      +'</div></div>'

      /* 4 KPI cards */
      +'<div class="row2" style="margin-top:14px">'
      +'<div class="card"><div class="mini-k-l">ANNUEL BRUT</div>'
      +'<div class="mini-k-v up" style="font-size:26px;margin:4px 0">'+Math.round(dA).toLocaleString('fr-FR')+'\u20ac</div>'
      +'<div class="mu" style="font-size:11px">'+yld.toFixed(2)+'% yield sur MV</div></div>'
      +'<div class="card"><div class="mini-k-l">ANNUEL NET ~</div>'
      +'<div class="mini-k-v" style="font-size:26px;margin:4px 0;color:#86efad">'+netAnn.toLocaleString('fr-FR')+'\u20ac</div>'
      +'<div class="mu" style="font-size:11px">Apr\u00e8s PFU '+Math.round(PFU*100)+'%</div></div>'
      +'</div>'

      +'<div class="row2">'
      +'<div class="card"><div class="mini-k-l">YIELD ON COST</div>'
      +'<div class="mini-k-v up" style="font-size:26px;margin:4px 0">'+yoc.toFixed(2)+'%</div>'
      +'<div class="mu" style="font-size:11px">Sur PRU moyen</div></div>'
      +'<div class="card" style="border:1px solid rgba(34,212,122,.2)">'
      +'<div class="mini-k-l">OBJECTIF '+TARGET+'\u20ac NET</div>'
      +'<div class="mini-k-v up" style="font-size:26px;margin:4px 0">'+yrObj+'</div>'
      +'<div class="mu" style="font-size:11px">En '+yrsTo+'</div></div>'
      +'</div>'

      /* Sliders */
      +'<div class="row2">'
      +'<div class="card">'
      +'<div class="mini-k-l">CONTRIBUTION MENSUELLE</div>'
      +'<div class="mono fw7" style="font-size:22px;margin:8px 0" id="divContribVal">'+S.contrib+'\u20ac</div>'
      +'<input type="range" id="divContrib" min="0" max="2000" step="50" value="'+S.contrib+'" style="width:100%;touch-action:none">'
      +'</div>'
      +'<div class="card">'
      +'<div class="mini-k-l">HORIZON (ANS) : '+S.horizon+'</div>'
      +'<div class="mono fw7" style="font-size:22px;margin:8px 0" id="divHorizonVal">'+S.horizon+' ans</div>'
      +'<input type="range" id="divHorizon" min="5" max="40" step="1" value="'+S.horizon+'" style="width:100%;touch-action:none">'
      +'</div>'
      +'</div>'

      +'<div class="row2">'
      +'<div class="card"><div class="mini-k-l">PFU '+Math.round(PFU*100)+'%</div>'
      +'<div style="display:flex;align-items:center;gap:10px;margin-top:10px">'
      +'<label class="toggle"><input type="checkbox" id="divPfu"'+(S.pfu?' checked':'')+'><span class="toggle-slider"></span></label>'
      +'<span style="font-size:13px">Apr\u00e8s imp\u00f4ts</span>'
      +'</div></div>'
      +'<div class="card"><div class="mini-k-l">DRIP (R\u00c9INVESTISSEMENT)</div>'
      +'<div style="display:flex;align-items:center;gap:10px;margin-top:10px">'
      +'<label class="toggle"><input type="checkbox" id="divDrip"'+(S.drip?' checked':'')+'><span class="toggle-slider"></span></label>'
      +'<span style="font-size:13px">R\u00e9investir les div.</span>'
      +'</div></div>'
      +'</div>'

      /* Graphique projection */
      +'<div class="card" style="padding:14px 12px 10px">'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">PROJECTION '+S.horizon+' ANS</div>'
      +projSVG(rows)
      +legend()
      +'</div>'

      /* Tableau détaillé */
      +'<div class="twrap" style="margin-top:4px"><table>'
      +'<thead><tr>'
      +'<th>ANN\u00c9E</th>'
      +'<th style="text-align:right">PORTFOLIO</th>'
      +'<th style="text-align:right">BRUT /AN</th>'
      +'<th style="text-align:right">NET /AN</th>'
      +'<th style="text-align:right">NET /MOIS</th>'
      +'</tr></thead>'
      +'<tbody>'+tableRows(rows)+'</tbody>'
      +'</table></div>';

    /* -- Bind events --------------------------------------- */
    function bindSlider(id, valId, key, suffix, redraw) {
      var sl = document.getElementById(id);
      var vl = document.getElementById(valId);
      if (!sl) return;
      sl.addEventListener('input', function() {
        S[key] = +this.value;
        if (vl) vl.textContent = this.value + suffix;
        if (redraw) draw();
      });
      sl.addEventListener('touchmove', function(e){ e.stopPropagation(); },{passive:true});
      sl.addEventListener('change', function(){ draw(); });
    }
    bindSlider('divContrib',  'divContribVal',  'contrib',  '\u20ac', false);
    bindSlider('divHorizon',  'divHorizonVal',  'horizon',  ' ans',  false);

    var pfuCk = document.getElementById('divPfu');
    if (pfuCk) pfuCk.addEventListener('change', function(){ S.pfu  = this.checked; draw(); });
    var drpCk = document.getElementById('divDrip');
    if (drpCk) drpCk.addEventListener('change', function(){ S.drip = this.checked; draw(); });
  }

  try {
    draw();
  } catch(e) {
    el.innerHTML = '<div style="padding:20px;color:#f43f5e;font-size:13px;font-family:monospace;background:rgba(244,63,94,.08);border-radius:10px;margin:10px">'
      + '<div style="font-weight:700;margin-bottom:6px">⚠️ Erreur Dividendes</div>'
      + e.message + '<br><br>'
      + '<div style="font-size:10px;color:#888">' + (e.stack||'').replace(/</g,'&lt;').slice(0,300) + '</div>'
      + '</div>';
  }
}


/* -- SIMULATION AVANCÉE (Projection Engine) --------------- */
function renderSimulation(el) {
  var PFU_RATE = 0.314;
  var mv   = getMV() / eu();
  var dA   = getDivA() / eu();

  /* état simulation */
  if (!el._simState) {
    el._simState = {
      portVal   : Math.round(mv) || 50000,
      contrib   : 300,
      divGrowth : 5,
      drip      : true,
      inflation : 2,
      taxRate   : 31,
      years     : 30,
      fireTarget: 1500
    };
  }
  var T = el._simState;

  /* ---- moteur de calcul ---- */
  function simulatePortfolioGrowth(opts) {
    var port      = opts.portVal;
    var contrib   = opts.contrib;
    var gRate     = opts.divGrowth / 100;
    var drip      = opts.drip;
    var infRate   = opts.inflation / 100;
    var taxRate   = opts.taxRate / 100;
    var years     = opts.years;
    var baseYield = dA > 0 && mv > 0 ? dA / mv : 0.035;
    var today     = new Date().getFullYear();
    var rows      = [];
    var divAnn    = port * baseYield;
    var fireYear  = null;

    for (var y = 1; y <= years; y++) {
      /* dividendes bruts */
      var grossDiv = divAnn;
      if (drip) grossDiv += divAnn * baseYield + contrib * 12 * baseYield;
      else      grossDiv += contrib * 12 * baseYield;

      /* fiscalité */
      var taxAmt   = grossDiv * taxRate;
      var netDiv   = grossDiv - taxAmt;
      var netMonth = netDiv / 12;

      /* inflation ajustée */
      var realNet  = netDiv / Math.pow(1 + infRate, y);
      var realNetM = realNet / 12;

      /* portfolio value */
      port = port * (1 + baseYield) + contrib * 12;

      /* yield on cost */
      var initCost = opts.portVal + opts.contrib * 12 * y;
      var yoc      = initCost > 0 ? (grossDiv / initCost * 100) : 0;

      /* FIRE check */
      if (!fireYear && netMonth >= opts.fireTarget) fireYear = today + y;

      rows.push({
        yr      : today + y,
        port    : Math.round(port),
        gross   : Math.round(grossDiv),
        tax     : Math.round(taxAmt),
        net     : Math.round(netDiv),
        netM    : Math.round(netMonth),
        realNetM: Math.round(realNetM),
        yoc     : yoc.toFixed(2)
      });

      divAnn = grossDiv;
    }

    return { rows: rows, fireYear: fireYear };
  }

  function draw() {
    var result   = simulatePortfolioGrowth(T);
    var rows     = result.rows;
    var fireYear = result.fireYear;
    var lastRow  = rows[rows.length - 1] || {};
    var yrsToFire = fireYear ? (fireYear - new Date().getFullYear()) + ' ans' : 'N/A';

    /* SVG chart */
    function simSVG() {
      if (rows.length < 2) return '';
      var W = 340, H = 160;
      var nets  = rows.map(function(r){return r.net;});
      var gross = rows.map(function(r){return r.gross;});
      var mx    = Math.max.apply(null, gross) || 1;
      var tgt   = T.fireTarget * 12;
      function px(i){ return ((i/(rows.length-1))*W).toFixed(1); }
      function py(v){ return (H - (v/mx)*(H*0.88) - H*0.06).toFixed(1); }
      var dG='M'+px(0)+' '+py(gross[0]);
      for(var i=1;i<gross.length;i++) dG+=' L'+px(i)+' '+py(gross[i]);
      var dN='M'+px(0)+' '+py(nets[0]);
      for(var j=1;j<nets.length;j++) dN+=' L'+px(j)+' '+py(nets[j]);
      var fG=dG+' L'+W+' '+H+' L0 '+H+' Z';
      var tyP = py(tgt);
      var tShow = tgt <= mx;
      return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;display:block" preserveAspectRatio="none">'
        +'<defs><linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">'
        +'<stop offset="0%" stop-color="#00c8a0" stop-opacity="0.25"/>'
        +'<stop offset="100%" stop-color="#00c8a0" stop-opacity="0.02"/>'
        +'</linearGradient></defs>'
        +'<path d="'+fG+'" fill="url(#gs)"/>'
        +'<path d="'+dG+'" fill="none" stroke="#00c8a0" stroke-width="2" stroke-linejoin="round"/>'
        +'<path d="'+dN+'" fill="none" stroke="#22d47a" stroke-width="2" stroke-linejoin="round"/>'
        +(tShow?'<line x1="0" y1="'+tyP+'" x2="'+W+'" y2="'+tyP+'" stroke="#f5a623" stroke-width="1" stroke-dasharray="4,4"/>'
               +'<text x="'+(W-4)+'" y="'+(parseFloat(tyP)-4)+'" fill="#f5a623" font-size="9" text-anchor="end">FIRE '+T.fireTarget+'€</text>':'')
        +'</svg>';
    }

    /* tableau */
    function tableRows() {
      var h='';
      for(var i=0;i<rows.length;i++){
        var r=rows[i];
        var isFire = fireYear && r.yr===fireYear;
        h+='<tr style="'+(isFire?'background:rgba(245,166,35,.08)':'')+'">'
          +'<td class="fw7 mono">'+(isFire?'🎯 ':'')+r.yr+'</td>'
          +'<td class="mono" style="text-align:right;color:#7c6dff">'+r.port.toLocaleString('fr-FR')+'€</td>'
          +'<td class="mono up" style="text-align:right">'+r.gross.toLocaleString('fr-FR')+'€</td>'
          +'<td class="mono" style="text-align:right;color:#86efad">'+r.net.toLocaleString('fr-FR')+'€</td>'
          +'<td class="mono" style="text-align:right;color:#86efad">'+r.netM.toLocaleString('fr-FR')+'€</td>'
          +'<td class="mono" style="text-align:right;color:var(--muted)">'+r.realNetM.toLocaleString('fr-FR')+'€</td>'
          +'<td class="mono" style="text-align:right;color:#f5a623">'+r.yoc+'%</td>'
          +'</tr>';
      }
      return h;
    }

    el.innerHTML = ''
      /* Mode switcher */
      +'<div style="display:flex;gap:0;background:var(--surface);border-radius:10px;padding:3px;margin-bottom:14px;width:fit-content">'
      +'<button onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'snowball\';renderDividendes(p);}})()" '
      +'style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);">📈 Snowball</button>'
      +'<button style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:var(--violet);color:#fff;">🧮 Simulation</button>'
      +'</div>'

      /* Header */
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      +'<span style="font-size:22px">🧮</span>'
      +'<div><div class="section-title" style="margin:0">Projection Engine</div>'
      +'<div class="mu" style="font-size:11px">Simulation avancée · '+T.years+' ans · FIRE '+T.fireTarget+'€/mois</div>'
      +'</div></div>'

      /* KPI résultats */
      +'<div class="row2" style="margin-top:4px">'
      +'<div class="card"><div class="mini-k-l">PORTFOLIO FUTUR</div>'
      +'<div class="mini-k-v" style="font-size:22px;margin:4px 0;color:#7c6dff">'+(lastRow.port||0).toLocaleString('fr-FR')+'€</div>'
      +'<div class="mu" style="font-size:11px">Dans '+T.years+' ans</div></div>'
      +'<div class="card"><div class="mini-k-l">DIVIDENDE BRUT FUTUR</div>'
      +'<div class="mini-k-v up" style="font-size:22px;margin:4px 0">'+(lastRow.gross||0).toLocaleString('fr-FR')+'€</div>'
      +'<div class="mu" style="font-size:11px">Annuel brut an '+T.years+'</div></div>'
      +'</div>'

      +'<div class="row2">'
      +'<div class="card"><div class="mini-k-l">DIVIDENDE NET FUTUR</div>'
      +'<div class="mini-k-v" style="font-size:22px;margin:4px 0;color:#86efad">'+(lastRow.net||0).toLocaleString('fr-FR')+'€</div>'
      +'<div class="mu" style="font-size:11px">Après '+T.taxRate+'% impôts</div></div>'
      +'<div class="card"><div class="mini-k-l">REVENU PASSIF MENSUEL</div>'
      +'<div class="mini-k-v" style="font-size:22px;margin:4px 0;color:#86efad">'+(lastRow.netM||0).toLocaleString('fr-FR')+'€</div>'
      +'<div class="mu" style="font-size:11px">Net/mois an '+T.years+'</div></div>'
      +'</div>'

      +'<div class="row2">'
      +'<div class="card"><div class="mini-k-l">YIELD ON COST FUTUR</div>'
      +'<div class="mini-k-v up" style="font-size:22px;margin:4px 0">'+(lastRow.yoc||0)+'%</div>'
      +'<div class="mu" style="font-size:11px">Rendement sur coût initial</div></div>'
      +'<div class="card" style="border:1px solid rgba(245,166,35,.3)">'
      +'<div class="mini-k-l">🎯 DATE FIRE</div>'
      +'<div class="mini-k-v" style="font-size:22px;margin:4px 0;color:#f5a623">'+(fireYear||'>'+T.years+'ans')+'</div>'
      +'<div class="mu" style="font-size:11px">'+T.fireTarget+'€/mois net · Dans '+yrsToFire+'</div></div>'
      +'</div>'

      /* Inputs */
      +'<div class="card" style="margin-bottom:10px">'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:12px">⚙️ PARAMÈTRES</div>'
      +'<div class="row2" style="margin-bottom:0">'

      +'<div><div class="mini-k-l">VALEUR PORTFOLIO (€)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-portValLbl">'+T.portVal.toLocaleString('fr-FR')+'€</div>'
      +'<input type="range" id="s-portVal" min="5000" max="500000" step="5000" value="'+T.portVal+'" style="width:100%"></div>'

      +'<div><div class="mini-k-l">CONTRIBUTION MENSUELLE (€)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-contribLbl">'+T.contrib+'€</div>'
      +'<input type="range" id="s-contrib" min="0" max="3000" step="50" value="'+T.contrib+'" style="width:100%"></div>'
      +'</div>'

      +'<div class="row2" style="margin-top:12px;margin-bottom:0">'
      +'<div><div class="mini-k-l">CROISSANCE DIVIDENDES (%/an)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-divGrowthLbl">'+T.divGrowth+'%</div>'
      +'<input type="range" id="s-divGrowth" min="0" max="15" step="0.5" value="'+T.divGrowth+'" style="width:100%"></div>'

      +'<div><div class="mini-k-l">INFLATION (%/an)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-inflationLbl">'+T.inflation+'%</div>'
      +'<input type="range" id="s-inflation" min="0" max="10" step="0.5" value="'+T.inflation+'" style="width:100%"></div>'
      +'</div>'

      +'<div class="row2" style="margin-top:12px;margin-bottom:0">'
      +'<div><div class="mini-k-l">TAUX IMPOSITION (%)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-taxRateLbl">'+T.taxRate+'%</div>'
      +'<input type="range" id="s-taxRate" min="0" max="50" step="1" value="'+T.taxRate+'" style="width:100%"></div>'

      +'<div><div class="mini-k-l">HORIZON (ANS)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-yearsLbl">'+T.years+' ans</div>'
      +'<input type="range" id="s-years" min="5" max="50" step="1" value="'+T.years+'" style="width:100%"></div>'
      +'</div>'

      +'<div class="row2" style="margin-top:12px;margin-bottom:0">'
      +'<div><div class="mini-k-l">OBJECTIF FIRE (€/mois)</div>'
      +'<div class="mono fw7" style="font-size:18px;margin:6px 0" id="s-fireTargetLbl">'+T.fireTarget+'€</div>'
      +'<input type="range" id="s-fireTarget" min="500" max="10000" step="100" value="'+T.fireTarget+'" style="width:100%"></div>'

      +'<div style="display:flex;align-items:center;gap:10px;padding-top:22px">'
      +'<label class="toggle"><input type="checkbox" id="s-drip"'+(T.drip?' checked':'')+'><span class="toggle-slider"></span></label>'
      +'<div><div class="mini-k-l">DRIP</div><div style="font-size:12px">Réinvestir dividendes</div></div>'
      +'</div>'
      +'</div>'
      +'</div>'

      /* Graphique */
      +'<div class="card" style="padding:14px 12px 10px">'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">PROJECTION '+T.years+' ANS</div>'
      +simSVG()
      +'<div style="display:flex;gap:14px;margin-top:8px;font-size:10.5px;color:var(--muted)">'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#00c8a0;display:inline-block"></span>Brut</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#22d47a;display:inline-block"></span>Net</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:2px;background:#f5a623;display:inline-block"></span>FIRE '+T.fireTarget+'€</span>'
      +'</div></div>'

      /* Tableau */
      +'<div class="twrap" style="margin-top:4px"><table>'
      +'<thead><tr>'
      +'<th>ANNÉE</th>'
      +'<th style="text-align:right">PORTFOLIO</th>'
      +'<th style="text-align:right">BRUT /AN</th>'
      +'<th style="text-align:right">NET /AN</th>'
      +'<th style="text-align:right">NET /MOIS</th>'
      +'<th style="text-align:right">RÉEL /MOIS</th>'
      +'<th style="text-align:right">YOC</th>'
      +'</tr></thead>'
      +'<tbody>'+tableRows()+'</tbody>'
      +'</table></div>';

    /* Bindings */
    function bindSim(id, lbl, key, suffix) {
      var sl = document.getElementById(id);
      var lb = document.getElementById(lbl);
      if (!sl) return;
      sl.addEventListener('input', function(){
        T[key] = +this.value;
        if(lb) lb.textContent = this.value + suffix;
      });
      sl.addEventListener('change', function(){ draw(); });
      sl.addEventListener('touchmove', function(e){e.stopPropagation();},{passive:true});
    }
    bindSim('s-portVal',    's-portValLbl',    'portVal',    '€');
    bindSim('s-contrib',    's-contribLbl',    'contrib',    '€');
    bindSim('s-divGrowth',  's-divGrowthLbl',  'divGrowth',  '%');
    bindSim('s-inflation',  's-inflationLbl',  'inflation',  '%');
    bindSim('s-taxRate',    's-taxRateLbl',    'taxRate',    '%');
    bindSim('s-years',      's-yearsLbl',      'years',      ' ans');
    bindSim('s-fireTarget', 's-fireTargetLbl', 'fireTarget', '€');

    var drpCk = document.getElementById('s-drip');
    if(drpCk) drpCk.addEventListener('change', function(){ T.drip=this.checked; draw(); });
  }

  try { draw(); }
  catch(e) {
    el.innerHTML = '<div style="padding:20px;color:#f43f5e;font-size:13px;font-family:monospace;background:rgba(244,63,94,.08);border-radius:10px;margin:10px">'
      + '<div style="font-weight:700;margin-bottom:6px">⚠️ Erreur Simulation</div>'
      + e.message + '</div>';
  }
}

/* -- CALENDRIER ------------------------------------------- */
/* ── DIVIDEND CALENDAR ENGINE ──────────────────────────────── */
function analyzeDividendCalendar() {
  var PAY_MONTHS = {
    ACN:[2,5,8,11],ADP:[1,4,7,10],APD:[2,5,8,11],BMY:[2,5,8,11],
    CMCSA:[1,4,7,10],CTBI:[0,3,6,9],HRL:[1,4,7,10],HTO:[2,8],
    JNJ:[2,5,8,11],MDT:[0,3,6,9],MMM:[2,5,8,11],NEE:[2,5,8,11],
    NFG:[0,3,6,9],NNN:[0,1,2,3,4,5,6,7,8,9,10,11],NWN:[0,3,6,9],
    O:[0,1,2,3,4,5,6,7,8,9,10,11],PPG:[2,5,8,11],SON:[2,5,8,11],
    TGT:[2,5,8,11],TSN:[2,5,8,11],UGI:[0,3,6,9],UNM:[2,5,8,11]
  };
  var monthly=[0,0,0,0,0,0,0,0,0,0,0,0];
  var tickersByMonth=[[],[],[],[],[],[],[],[],[],[],[],[]];
  for (var ri=0;ri<raw.length;ri++) {
    var p=raw[ri]; if(p.qty<=0) continue;
    var tk=p.ticker, a=assets[tk]; if(!a) continue;
    var divAnn=a.d*p.qty/eu();
    var months=PAY_MONTHS[tk]||[];
    var perPay=months.length>0?divAnn/months.length:0;
    for(var mi=0;mi<months.length;mi++){
      monthly[months[mi]]+=perPay;
      tickersByMonth[months[mi]].push({tk:tk,amt:perPay});
    }
  }
  var totalAnn=0,mx=0,mn3=Infinity,mxIdx=0,mnIdx=0;
  for(var i=0;i<12;i++){
    totalAnn+=monthly[i];
    if(monthly[i]>mx){mx=monthly[i];mxIdx=i;}
    if(monthly[i]<mn3&&monthly[i]>0){mn3=monthly[i];mnIdx=i;}
  }
  var avg=totalAnn/12,variance=0;
  for(var j=0;j<12;j++){var d2=monthly[j]-avg;variance+=d2*d2;}
  var stdDev=Math.sqrt(variance/12);
  var smoothingScore=avg>0?Math.max(0,Math.round(100-(stdDev/avg)*100)):0;
  return{monthly:monthly,tickersByMonth:tickersByMonth,totalAnn:totalAnn,avg:avg,
         maxMonth:mxIdx,minMonth:mnIdx,maxVal:mx,minVal:mn3===Infinity?0:mn3,smoothingScore:smoothingScore};
}

function renderCalendar(el) {
  if (raw.length === 0) { el.innerHTML = _emptyState('📅', 'Calendrier vide', 'Le calendrier des dividendes s\'affiche une fois tes positions importées.'); return; }
  var MN =['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  var MNF=['Janvier','F\u00e9vrier','Mars','Avril','Mai','Juin','Juillet','Ao\u00fbt','Septembre','Octobre','Novembre','D\u00e9cembre'];
  var curM=new Date().getMonth();
  var cal=analyzeDividendCalendar();
  var monthly=cal.monthly, mx=cal.maxVal||1, avg=cal.avg;

  function barChart(){
    var W=340,H=100,BAR_W=21,GAP=6,totalW=12*(BAR_W+GAP)-GAP,offX=(W-totalW)/2;
    var avgY=H-(avg/mx)*(H*0.88)-H*0.06;
    var svg='<svg viewBox="0 0 '+W+' '+(H+24)+'" style="width:100%;display:block" preserveAspectRatio="none">';
    svg+='<line x1="'+offX.toFixed(1)+'" y1="'+avgY.toFixed(1)+'" x2="'+( offX+totalW).toFixed(1)+'" y2="'+avgY.toFixed(1)+'" stroke="rgba(255,255,255,.18)" stroke-width="1" stroke-dasharray="3,3"/>';
    for(var i=0;i<12;i++){
      var val=monthly[i],barH=val>0?Math.max(4,(val/mx)*(H*0.88)):2;
      var x=offX+i*(BAR_W+GAP),y=H-barH+(H*0.06);
      var isC=i===curM;
      var col=isC?'#7c6dff':i===cal.maxMonth?'#22d47a':(val>0&&i===cal.minMonth)?'#f43f5e':val>avg*1.1?'#00c8a0':val>0&&val<avg*0.5?'#f5a623':'rgba(255,255,255,.15)';
      svg+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+BAR_W+'" height="'+barH.toFixed(1)+'" rx="3" fill="'+col+'"/>';
      if(val>0) svg+='<text x="'+( x+BAR_W/2).toFixed(1)+'" y="'+( y-3).toFixed(1)+'" fill="'+col+'" font-size="7" text-anchor="middle" font-family="DM Mono,monospace">'+Math.round(val)+'</text>';
      svg+='<text x="'+( x+BAR_W/2).toFixed(1)+'" y="'+( H+17)+'" fill="'+( isC?'#fff':'rgba(255,255,255,.4)')+'" font-size="8.5" text-anchor="middle">'+MN[i]+'</text>';
    }
    return svg+'</svg>';
  }

  function scoreColor(s){return s>=75?'#22d47a':s>=45?'#f5a623':'#f43f5e';}
  var sc=cal.smoothingScore,scCol=scoreColor(sc);
  var scLabel=sc>=75?'Excellent':sc>=45?'Moyen':'Irr\u00e9gulier';

  function monthDetail(m){
    var tks=cal.tickersByMonth[m]; if(!tks||!tks.length) return '<span style="color:var(--muted);font-size:11px">Aucun</span>';
    tks.sort(function(a,b){return b.amt-a.amt;}); var h2='';
    for(var ti=0;ti<tks.length;ti++) h2+='<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);border-radius:6px;padding:2px 7px;margin:2px 2px 0 0;font-size:10px"><span style="font-weight:700">'+tks[ti].tk+'</span><span style="color:var(--muted)">'+tks[ti].amt.toFixed(1)+'\u20ac</span></span>';
    return h2;
  }

  var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="font-size:22px">\uD83D\uDCC5</span><div><div class="section-title" style="margin:0">Calendrier dividendes</div><div style="font-size:11px;color:var(--muted)">'+Math.round(cal.totalAnn).toLocaleString('fr-FR')+'\u20ac/an \u00b7 '+Math.round(avg)+'\u20ac/mois moyen</div></div></div>';

  h+='<div class="row3" style="margin-bottom:12px">'
    +'<div class="mini-k" style="background:rgba(34,212,122,.08);border:1px solid rgba(34,212,122,.2)"><div class="mini-k-l">MEILLEUR</div><div class="mini-k-v" style="color:#22d47a;font-size:17px">'+MN[cal.maxMonth]+'</div><div class="mini-k-s">'+Math.round(cal.maxVal)+'\u20ac</div></div>'
    +'<div class="mini-k" style="background:rgba(244,63,94,.06);border:1px solid rgba(244,63,94,.2)"><div class="mini-k-l">CREUX</div><div class="mini-k-v" style="color:#f43f5e;font-size:17px">'+( cal.minVal>0?MN[cal.minMonth]:'--')+'</div><div class="mini-k-s">'+( cal.minVal>0?Math.round(cal.minVal)+'\u20ac':'N/A')+'</div></div>'
    +'<div class="mini-k" style="background:rgba(124,109,255,.07);border:1px solid rgba(124,109,255,.2)"><div class="mini-k-l">LISSAGE</div><div class="mini-k-v" style="color:'+scCol+';font-size:17px">'+sc+'/100</div><div class="mini-k-s">'+scLabel+'</div></div>'
    +'</div>';

  h+='<div class="card" style="padding:14px 10px 10px;margin-bottom:10px">'
    +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:10px">REVENUS PAR MOIS (\u20ac)</div>'
    +barChart()
    +'<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;font-size:9.5px;color:var(--muted)"><span><span style="width:10px;height:10px;border-radius:2px;background:#22d47a;display:inline-block;vertical-align:middle;margin-right:3px"></span>Pic</span><span><span style="width:10px;height:10px;border-radius:2px;background:#f43f5e;display:inline-block;vertical-align:middle;margin-right:3px"></span>Creux</span><span><span style="width:10px;height:10px;border-radius:2px;background:#7c6dff;display:inline-block;vertical-align:middle;margin-right:3px"></span>Ce mois</span><span><span style="width:10px;height:10px;border-radius:2px;background:#00c8a0;display:inline-block;vertical-align:middle;margin-right:3px"></span>&gt;moy</span></div></div>';

  var emptyM=[];
  for(var ei=0;ei<12;ei++){if(monthly[ei]===0)emptyM.push(MN[ei]);}
  if(sc<75||emptyM.length>0){
    h+='<div style="background:rgba(124,109,255,.07);border:1px solid rgba(124,109,255,.2);border-radius:10px;padding:11px 12px;margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:#7c6dff;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">\uD83D\uDCA1 Conseil lissage</div><div style="font-size:11.5px;color:var(--text);line-height:1.6">';
    if(emptyM.length>0) h+='\u26A0\uFE0F Mois sans revenu\u00a0: <strong>'+emptyM.join(', ')+'</strong>. Ajouter des actions \u00e0 dividende mensuel (O, NNN) ou \u00e0 cycle d\u00e9cal\u00e9.<br>';
    if(sc<45) h+='\uD83D\uDCC8 Fort d\u00e9s\u00e9quilibre \u2014 mixer Q1/Q2/Q3/Q4.';
    else if(sc<75) h+='\uD83D\uDCC9 Lissage moyen \u2014 cibler des actions qui versent sur les mois faibles.';
    h+='</div></div>';
  }

  h+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">D\u00c9TAIL PAR MOIS</div>';
  for(var m2=0;m2<12;m2++){
    var val2=monthly[m2],isCurM=(m2===curM);
    var barPct=mx>0?Math.round(val2/mx*100):0;
    var conc=cal.totalAnn>0?(val2/cal.totalAnn*100):0;
    var barCol=m2===cal.maxMonth?'#22d47a':(val2>0&&m2===cal.minMonth)?'#f43f5e':val2>avg*1.1?'#00c8a0':val2>0&&val2<avg*0.5?'#f5a623':val2===0?'rgba(255,255,255,.08)':'rgba(255,255,255,.2)';
    h+='<div style="background:var(--surface);border-radius:10px;padding:11px 12px;margin-bottom:6px'+( isCurM?';border:1px solid rgba(124,109,255,.4)':'')+'">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="display:flex;align-items:center;gap:6px"><span style="font-weight:700;font-size:13px">'+MNF[m2]+'</span>'+( isCurM?'<span style="background:#7c6dff;color:#fff;font-size:9px;padding:1px 6px;border-radius:5px;font-weight:700">CE MOIS</span>':'')+( m2===cal.maxMonth?'<span style="background:rgba(34,212,122,.15);color:#22d47a;font-size:9px;padding:1px 5px;border-radius:5px;font-weight:700">\uD83D\uDD1D PIC</span>':'')+( val2>0&&m2===cal.minMonth?'<span style="background:rgba(244,63,94,.12);color:#f43f5e;font-size:9px;padding:1px 5px;border-radius:5px;font-weight:700">\u2B07 CREUX</span>':'')+'</div><div style="text-align:right"><span style="font-family:DM Mono,monospace;font-size:15px;font-weight:700;color:'+( val2>0?'#e2e2ec':'var(--muted)')+'">'+Math.round(val2)+'\u20ac</span><span style="font-size:9.5px;color:var(--muted);margin-left:5px">'+conc.toFixed(1)+'%</span></div></div>';
    h+='<div style="height:4px;background:var(--surface2);border-radius:2px;margin-bottom:7px;overflow:hidden"><div style="height:100%;width:'+barPct+'%;background:'+barCol+';border-radius:2px"></div></div>';
    h+='<div style="display:flex;flex-wrap:wrap">'+monthDetail(m2)+'</div></div>';
  }
  el.innerHTML=h;
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
function renderValorisation(el) {
  if (raw.length === 0) { el.innerHTML = _emptyState('📊', 'Aucune valorisation', 'Les scores de valorisation s\'affichent une fois des positions ajoutées.'); return; }

  /* ── Données fondamentales (source PDF Simply Safe Dividends) ── */
  var vdata = {
    ACN:  {label:'under', cur:165.36, exp:401,  yld_pts:[1.5,1.6,1.7,1.9,2.4,3.9], pe_pts:[30,29,27,24,19,11.6], growth:'10.1%', gSpeed:'Fast',     gDate:'Sep 25'},
    ADP:  {label:'under', cur:223.22, exp:365,  yld_pts:[1.8,1.9,2.0,2.1,2.6,3.1], pe_pts:[34,32,30,28,24,25.4], growth:'10.4%', gSpeed:'Fast',     gDate:'Nov 25'},
    APD:  {label:'fair',  cur:282.96, exp:343,  yld_pts:[2.0,2.1,2.2,2.3,2.4,2.6], pe_pts:[28,27,25,23,21,20.8], growth:'1.1%',  gSpeed:'Very Slow',gDate:'Jan 26'},
    BMY:  {label:'fair',  cur:56.24,  exp:67,   yld_pts:[2.8,3.0,3.2,3.6,4.0,4.5], pe_pts:[14,12,11,10,9.5,7.2], growth:'1.6%',  gSpeed:'Very Slow',gDate:'Dec 25'},
    CMCSA:{label:'under', cur:23.97,  exp:38,   yld_pts:[1.5,1.7,2.0,2.5,3.5,5.5], pe_pts:[12,11,10,9,7.5,6.8],  growth:'0%',    gSpeed:'Very Slow',gDate:'Jan 26'},
    CTBI: {label:'over',  cur:68.82,  exp:60,   yld_pts:[3.5,3.4,3.2,3.1,3.0,3.1], pe_pts:[10,10,11,11,11,13.1], growth:'12.8%', gSpeed:'Very Fast',gDate:'Jul 25'},
    HRL:  {label:'under', cur:24.58,  exp:36,   yld_pts:[2.2,2.3,2.5,2.9,3.8,4.8], pe_pts:[24,23,22,20,17,14.2], growth:'0.9%',  gSpeed:'Very Slow',gDate:'Nov 25'},
    HTO:  {label:'under', cur:57.20,  exp:78,   yld_pts:[2.3,2.4,2.5,2.6,2.8,3.1], pe_pts:[28,27,25,24,22,10.2], growth:'4.8%',  gSpeed:'Slow',     gDate:'Jan 26'},
    JNJ:  {label:'over',  cur:235.66, exp:209,  yld_pts:[2.5,2.6,2.7,2.7,2.5,2.3], pe_pts:[16,16,17,18,19,15.8], growth:'3.1%',  gSpeed:'Slow',     gDate:'Apr 26'},
    MDT:  {label:'under', cur:80.38,  exp:105,  yld_pts:[2.5,2.6,2.8,3.0,3.3,3.6], pe_pts:[18,17,16,15,14,14.1], growth:'1.4%',  gSpeed:'Very Slow',gDate:'Jun 26'},
    MMM:  {label:'over',  cur:158.23, exp:156,  yld_pts:[3.5,3.6,3.8,4.0,3.5,2.0], pe_pts:[15,16,17,18,18,14.5], growth:'6.8%',  gSpeed:'Average',  gDate:'Feb 26'},
    NEE:  {label:'fair',  cur:86.12,  exp:104,  yld_pts:[2.2,2.3,2.4,2.5,2.7,2.9], pe_pts:[26,25,24,23,21,17.4], growth:'10.0%', gSpeed:'Fast',     gDate:'Feb 26'},
    NFG:  {label:'fair',  cur:76.84,  exp:80,   yld_pts:[3.0,3.1,3.2,3.3,3.1,2.9], pe_pts:[17,16,15,14,12,13.8], growth:'3.7%',  gSpeed:'Slow',     gDate:'Jun 26'},
    NNN:  {label:'fair',  cur:45.93,  exp:50,   yld_pts:[4.8,4.9,5.0,5.1,5.2,5.2], pe_pts:[15,14,13,13,13,15.2], growth:'3.4%',  gSpeed:'Slow',     gDate:'Jul 25'},
    NWN:  {label:'fair',  cur:49.64,  exp:50,   yld_pts:[3.5,3.7,3.9,4.0,4.0,4.0], pe_pts:[21,20,19,18,17,18.2], growth:'0.5%',  gSpeed:'Very Slow',gDate:'Oct 25'},
    O:    {label:'fair',  cur:62.14,  exp:69,   yld_pts:[4.8,5.0,5.1,5.2,5.2,5.2], pe_pts:[20,19,18,17,15,14.8], growth:'1.6%',  gSpeed:'Very Slow',gDate:'12 mo'},
    PPG:  {label:'under', cur:121.53, exp:158,  yld_pts:[1.4,1.5,1.6,1.7,2.0,2.3], pe_pts:[19,18,17,16,15,12.4], growth:'4.4%',  gSpeed:'Slow',     gDate:'Jul 25'},
    SON:  {label:'under', cur:50.35,  exp:66,   yld_pts:[3.0,3.1,3.2,3.4,3.7,4.3], pe_pts:[13,12,11,10,9,11.8],  growth:'1.9%',  gSpeed:'Very Slow',gDate:'Apr 26'},
    TGT:  {label:'fair',  cur:133.17, exp:143,  yld_pts:[2.0,2.1,2.2,2.3,2.9,3.5], pe_pts:[18,17,16,16,15,11.2], growth:'1.8%',  gSpeed:'Very Slow',gDate:'Jun 26'},
    TSN:  {label:'fair',  cur:57.30,  exp:69,   yld_pts:[2.8,2.9,3.0,3.1,3.3,3.6], pe_pts:[16,15,14,13,13,13.2], growth:'2.0%',  gSpeed:'Very Slow',gDate:'Nov 25'},
    UGI:  {label:'under', cur:34.36,  exp:43,   yld_pts:[3.5,3.6,3.8,4.0,4.2,4.4], pe_pts:[14,13,12,11,10,10.8], growth:'0%',    gSpeed:'Very Slow',gDate:'2023'},
    UNM:  {label:'over',  cur:91.82,  exp:65,   yld_pts:[3.5,3.4,3.2,2.8,2.5,2.2], pe_pts:[9,9,8.5,8,8,7.8],    growth:'9.8%',  gSpeed:'Fast',     gDate:'May 26'}
  };

  /* ── Mini-courbe SVG ──────────────────────────────────────── */
  function miniSVG(pts, dotCol) {
    var W = 80, H = 30;
    var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts);
    var rng = mx - mn || 1;
    function px(i) { return ((i / (pts.length - 1)) * (W - 8) + 4).toFixed(1); }
    function py(v)  { return (H - ((v - mn) / rng * (H * 0.72) + H * 0.14)).toFixed(1); }
    var d = 'M' + px(0) + ' ' + py(pts[0]);
    for (var i = 1; i < pts.length; i++) d += ' L' + px(i) + ' ' + py(pts[i]);
    var lx = px(pts.length - 1), ly = py(pts[pts.length - 1]);
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible">'
      + '<text x="4" y="' + H + '" fill="rgba(120,120,170,.6)" font-size="5.5" font-family="DM Sans,sans-serif">5-Year Avg</text>'
      + '<path d="' + d + '" fill="none" stroke="rgba(150,150,200,.3)" stroke-width="1.3" stroke-linejoin="round"/>'
      + '<circle cx="' + lx + '" cy="' + ly + '" r="3" fill="' + dotCol + '"/>'
      + '</svg>';
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function safeBadge(score) {
    if (score >= 90) return {lbl:'Very Safe',  col:'#22d47a'};
    if (score >= 75) return {lbl:'Safe',       col:'#86efad'};
    if (score >= 60) return {lbl:'Borderline', col:'#f5a623'};
    return               {lbl:'Unsafe',     col:'#f43f5e'};
  }
  function gColor(sp) {
    return (sp==='Very Fast'||sp==='Fast') ? '#22d47a' : sp==='Average' ? '#f5a623' : '#fb923c';
  }
  function labelCfg(l) {
    if (l==='under') return {txt:'May be undervalued',  col:'#10b981', bg:'rgba(16,185,129,.1)',  bdr:'rgba(16,185,129,.25)'};
    if (l==='fair')  return {txt:'Reasonably valued',   col:'#f5a623', bg:'rgba(245,166,35,.1)',  bdr:'rgba(245,166,35,.25)'};
    return                  {txt:'Could be overvalued', col:'#f43f5e', bg:'rgba(244,63,94,.08)', bdr:'rgba(244,63,94,.2)'};
  }

  /* ── Compteurs ───────────────────────────────────────────── */
  function count() {
    var c = {under:0, fair:0, over:0};
    for (var i=0; i<raw.length; i++) { var v=vdata[raw[i].ticker]; if(v) c[v.label]++; }
    return c;
  }

  /* ── État ────────────────────────────────────────────────── */
  if (!el._valState) el._valState = {filter:'all'};
  var VS = el._valState;

  /* ── DRAW ──────────────────────────────────────────────── */
  function draw() {
    var cnt = count();

    /* Liste filtrée + triée */
    var list = raw.slice().filter(function(d) {
      var v = vdata[d.ticker];
      return v && (VS.filter==='all' || v.label===VS.filter);
    }).sort(function(a,b) {
      var order = {under:0, fair:1, over:2};
      var va = vdata[a.ticker]; var vb = vdata[b.ticker];
      var oa = va ? order[va.label] : 1;
      var ob = vb ? order[vb.label] : 1;
      if (oa !== ob) return oa - ob;
      // Dans la même catégorie, trier par upside décroissant
      var ua = va && va.exp > 0 ? (va.exp - a.price)/a.price*100 : -999;
      var ub = vb && vb.exp > 0 ? (vb.exp - b.price)/b.price*100 : -999;
      return ub - ua;
    });

    /* ── 3 boutons-compteurs cliquables ─────────────────────── */
    function cBtn(key, n, txt, col, bg, bdr) {
      var on = VS.filter===key || (key==='all' && VS.filter==='all');
      return '<button data-vf="'+key+'" style="flex:1;padding:10px 6px;border-radius:12px;cursor:pointer;font-family:inherit;'
        +'border:2px solid '+(on?col:bdr)+';background:'+(on?bg:'transparent')+';'
        +'transition:all .15s;text-align:center">'
        +'<div style="font-size:28px;font-weight:700;color:'+col+';line-height:1">'+n+'</div>'
        +'<div style="font-size:9px;font-weight:700;color:'+col+';letter-spacing:.3px;margin-top:3px;line-height:1.3">'+txt+'</div>'
        +'</button>';
    }

    var html = '<div class="section-title">Valorisation</div>';

    /* ── Simulateur d'investissement ──────────────────────────── */
    if (!el._simState) el._simState = {open:false, budget:1000};
    var SIM = el._simState;

    // Calcul des capacités d'achat par action (limite 25% secteur, 12% position)
    var totalMV = getMV();
    var secMV = {};
    for (var si=0; si<raw.length; si++) {
      var sr = raw[si];
      if (!secMV[sr.sec]) secMV[sr.sec] = 0;
      secMV[sr.sec] += sr.mv;
    }

    function getBuyCapacity(d) {
      var curPosPct  = totalMV > 0 ? d.mv / totalMV * 100 : 0;
      var curSecPct  = totalMV > 0 ? (secMV[d.sec] || 0) / totalMV * 100 : 0;
      var maxPos  = totalMV * 0.12; // 12% max par position
      var maxSec  = totalMV * 0.25; // 25% max par secteur
      var roomPos = Math.max(0, maxPos - d.mv);
      var roomSec = Math.max(0, maxSec - (secMV[d.sec] || 0));
      var roomEur = Math.min(roomPos, roomSec) / eu();
      var maxQty  = d.price > 0 ? Math.floor(Math.min(roomPos, roomSec) / d.price) : 0;
      return {roomEur: Math.round(roomEur), maxQty: maxQty, curPosPct: curPosPct.toFixed(1), curSecPct: curSecPct.toFixed(1)};
    }

    // Toggle simulateur
    html += '<div style="background:var(--surface);border-radius:12px;padding:13px;margin-bottom:14px;border:1px solid rgba(124,109,255,.2)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" id="simToggleBtn">'
      + '<div>'
      + '<div style="font-size:13px;font-weight:700;color:var(--violet)">💡 Simulateur d\'investissement</div>'
      + '<div style="font-size:10px;color:var(--muted);margin-top:2px">Répartir un montant sans dépasser les limites</div>'
      + '</div>'
      + '<label class="toggle" onclick="event.stopPropagation()">'
      + '<input type="checkbox" id="simToggleCk"'+(SIM.open?' checked':'')+'>'
      + '<span class="toggle-slider"></span></label>'
      + '</div>'
      + '<div id="simBody" style="display:'+(SIM.open?'block':'none')+';margin-top:12px">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      + '<div style="font-size:12px;color:var(--muted)">Budget :</div>'
      + '<input type="number" id="simBudget" value="'+SIM.budget+'" min="100" step="100" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-family:DM Mono,monospace;font-size:14px;font-weight:700;width:120px">'
      + '<div style="font-size:14px;font-weight:700">€</div>'
      + '</div>'
      + '<div id="simResults"></div>'
      + '</div>'
      + '</div>';

    function renderSimResults(budget) {
      var candidates = [];
      for (var ci=0; ci<raw.length; ci++) {
        var cd = raw[ci];
        var cap = getBuyCapacity(cd);
        var priceEur = cd.price / eu();
        if (cap.roomEur <= 0 || priceEur > budget) continue;
        var m = meta[cd.ticker] || {};
        var yd = cd.price > 0 ? (m.d||0)/cd.price*100 : 0;
        var vd2 = vdata[cd.ticker];
        var upside = vd2 && vd2.exp > 0 ? (vd2.exp - cd.price)/cd.price*100 : 0;
        var maxAfford = Math.floor(Math.min(budget, cap.roomEur) / priceEur);
        if (maxAfford < 1) continue;
        candidates.push({d:cd, cap:cap, yd:yd, upside:upside, priceEur:priceEur, maxAfford:maxAfford});
      }
      candidates.sort(function(a,b){ return (b.yd + b.upside*0.5) - (a.yd + a.upside*0.5); });
      if (candidates.length === 0) {
        return '<div style="font-size:11px;color:var(--muted);padding:10px;text-align:center">Aucune action disponible avec ce budget sans dépasser les limites.</div>';
      }
      var h2 = '<div style="font-size:9.5px;color:var(--muted);margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Actions recommandées (triées yield + upside)</div>';
      var shown = candidates.slice(0, 5);
      for (var ri=0; ri<shown.length; ri++) {
        var it = shown[ri];
        var cost2 = Math.round(it.maxAfford * it.priceEur);
        h2 += '<div style="background:var(--surface2);border-radius:9px;padding:10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'
          + '<div>'
          + '<span style="font-size:13px;font-weight:700">'+it.d.ticker+'</span>'
          + '<span style="font-size:10px;color:var(--muted);margin-left:6px">'+it.d.sec+'</span>'
          + '<div style="font-size:10px;color:var(--muted);margin-top:2px">Pos: '+it.cap.curPosPct+'% · Secteur: '+it.cap.curSecPct+'%</div>'
          + '</div>'
          + '<div style="text-align:right">'
          + '<div style="font-size:12px;font-weight:700;color:#22d47a">× '+it.maxAfford+' actions</div>'
          + '<div style="font-size:11px;font-family:DM Mono,monospace;color:var(--muted)">'+cost2+' €</div>'
          + '<div style="font-size:9.5px;color:#22d47a">yield '+it.yd.toFixed(1)+'%</div>'
          + '</div>'
          + '</div>';
      }
      return h2;
    }


    /* Boutons-compteurs (remplacent les filtres) */
    html += '<div style="display:flex;gap:8px;margin-bottom:16px">'
      + cBtn('under', cnt.under, 'Sous-évalués',     '#10b981','rgba(16,185,129,.12)','rgba(16,185,129,.25)')
      + cBtn('fair',  cnt.fair,  'Justement évalués','#f5a623','rgba(245,166,35,.12)', 'rgba(245,166,35,.25)')
      + cBtn('over',  cnt.over,  'Survalorisés',     '#f43f5e','rgba(244,63,94,.1)',  'rgba(244,63,94,.2)')
      + '</div>';

    /* Bouton "Tous" discret */
    html += '<div style="text-align:center;margin-bottom:14px">'
      + '<button data-vf="all" style="padding:5px 18px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;'
      + 'border:1px solid '+(VS.filter==='all'?'var(--violet)':'rgba(255,255,255,.1)')+';background:'
      + (VS.filter==='all'?'rgba(124,109,255,.15)':'transparent')+';color:'
      + (VS.filter==='all'?'var(--violet)':'var(--muted)')+'">Voir tout le portefeuille</button>'
      + '</div>';

    /* ── Cards ──────────────────────────────────────────────── */
    for (var i=0; i<list.length; i++) {
      var d  = list[i];
      var v  = vdata[d.ticker]; if(!v) continue;
      var m  = meta[d.ticker]  || {};
      var lc = labelCfg(v.label);
      var sb = safeBadge(m.safe || 60);
      /* ── DSE : safety score calculé dynamiquement ── */
      var dseResult = m.payout_ratio !== undefined ? calculateDividendSafety(m) : null;
      var dseScore  = dseResult ? dseResult.safetyScore : (m.safe || 60);
      var dseCol    = dseColor(dseScore);
      var dseLbl    = dseResult ? dseLabel(dseResult.riskLevel) : sb.lbl;
      var div = m.d || 0;
      var yd  = d.price > 0 ? div/d.price*100 : 0;
      var ann = Math.round(div * d.qty);
      var pe  = m.pe_cur || 0;
      var pp  = d.avg > 0 ? (d.price-d.avg)/d.avg*100 : 0;
      var gc  = gColor(v.gSpeed);
      var upside = v.exp > 0 ? (v.exp - d.price)/d.price*100 : 0;
      var pC  = d.pnl >= 0 ? '#22d47a' : '#f43f5e';
      var cap = getBuyCapacity(d);

      /* mini-courbes : point vert si sous moyenne, orange/rouge si au-dessus */
      var yldDot = yd >= v.yld_pts[0] ? '#22d47a' : '#f5a623';
      var peDot  = pe <= v.pe_pts[0]  ? '#22d47a' : '#f5a623';

      html += '<div style="background:var(--surface);border-radius:14px;border-left:3px solid '+lc.col+';padding:14px;margin-bottom:10px">'

        /* ── Ligne 1 : ticker + signal + P&L ── */
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;gap:9px">'
        + _logo(d.ticker, 34)
        + '<div>'
        + '<div style="font-size:17px;font-weight:700;letter-spacing:-.4px">'+d.ticker+getDivBadge(d.ticker)+'</div>'
        + '<div style="font-size:10px;color:var(--muted);margin-top:1px">'+d.name+'</div>'
        + '</div></div>'
        + '<div style="text-align:right">'
        + '<span style="display:inline-block;padding:4px 10px;border-radius:7px;font-size:10.5px;font-weight:700;background:'+lc.bg+';color:'+lc.col+'">'+lc.txt+'</span>'
        + '<div style="font-size:10px;color:'+pC+';margin-top:4px;font-weight:600">'+(d.pnl>=0?'+':'')+Math.round(toE(d.pnl))+'\u20ac ('+(pp>=0?'+':'')+pp.toFixed(1)+'%)</div>'
        + '</div>'
        + '</div>'

        /* ── Ligne 2 : cours + flèche + cible + upside ── */
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;background:var(--surface2);border-radius:9px;padding:10px 12px">'
        + '<div style="flex:1">'
        + '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Cours actuel</div>'
        + '<div style="font-size:17px;font-weight:700;font-family:DM Mono,monospace">'+d.price.toFixed(2)+'$</div>'
        + '</div>'
        + '<div style="font-size:20px;color:var(--muted)">→</div>'
        + '<div style="flex:1;text-align:right">'
        + '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Cible attendue</div>'
        + '<div style="font-size:17px;font-weight:700;font-family:DM Mono,monospace;color:'+lc.col+'">'+v.exp+'$</div>'
        + '</div>'
        + '<div style="background:'+lc.bg+';border:1px solid '+lc.bdr+';border-radius:8px;padding:6px 10px;text-align:center;min-width:58px">'
        + '<div style="font-size:14px;font-weight:700;color:'+lc.col+'">'+(upside>=0?'+':'')+upside.toFixed(0)+'%</div>'
        + '<div style="font-size:8.5px;color:'+lc.col+'">upside</div>'
        + '</div>'
        + '</div>'

        /* ── Capacité d'achat ── */
        + '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(124,109,255,.05);border:1px solid rgba(124,109,255,.1);border-radius:8px;padding:7px 10px;margin-bottom:10px">'
        + '<div style="font-size:9.5px;color:var(--muted)">Pos. actuelle <strong style="color:var(--text)">'+cap.curPosPct+'%</strong> · Secteur <strong style="color:var(--text)">'+cap.curSecPct+'%</strong></div>'
        + (cap.roomEur > 0
          ? '<div style="text-align:right"><div style="font-size:11px;font-weight:700;color:#22d47a">+'+cap.roomEur.toLocaleString('fr-FR')+'€ max</div>'
            + '<div style="font-size:9px;color:var(--muted)">≤ '+cap.maxQty+' actions</div></div>'
          : '<div style="font-size:10px;font-weight:700;color:#f43f5e">⚠ Limite atteinte</div>')
        + '</div>'

        /* ── Ligne 3 : 4 métriques avec mini-courbes ── */
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">'

        /* Yield */
        + '<div style="background:var(--surface2);border-radius:9px;padding:8px;text-align:center">'
        + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Yield</div>'
        + miniSVG(v.yld_pts, yldDot)
        + '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a;margin-top:3px">'+yd.toFixed(2)+'%</div>'
        + '</div>'

        /* P/E */
        + '<div style="background:var(--surface2);border-radius:9px;padding:8px;text-align:center">'
        + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">P/E</div>'
        + miniSVG(v.pe_pts, peDot)
        + '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:var(--text);margin-top:3px">'+pe.toFixed(1)+'x</div>'
        + '</div>'

        /* Safety DSE */
        + '<div style="background:var(--surface2);border-radius:9px;padding:8px;text-align:center;cursor:pointer" onclick="showDSESheet(\''+d.ticker+'\')">'
        + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Safety</div>'
        + '<div style="width:38px;height:38px;border-radius:9px;border:2px solid '+dseCol+';display:flex;align-items:center;justify-content:center;margin:0 auto 3px">'
        + '<span style="font-size:13px;font-weight:700;color:'+dseCol+'">'+dseScore+'</span>'
        + '</div>'
        + '<div style="font-size:8px;color:'+dseCol+';font-weight:600">'+dseLbl+'</div>'
        + '<div style="font-size:7px;color:var(--muted);margin-top:1px">↗ détail</div>'
        + '</div>'

        /* Div Growth + Annual Income */
        + '<div style="background:var(--surface2);border-radius:9px;padding:8px;text-align:center">'
        + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Div. / an</div>'
        + '<div style="font-size:13px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">$'+ann+'</div>'
        + '<div style="font-size:8.5px;font-weight:700;color:'+gc+';margin-top:3px">'+v.growth+'</div>'
        + '<div style="font-size:7.5px;color:'+gc+'">'+v.gSpeed+'</div>'
        + '</div>'

        + '</div>'
        + '</div>';
    }

    /* ── Total + note ────────────────────────────────────────── */
    var totalInc = 0;
    for (var k=0; k<raw.length; k++) totalInc += (meta[raw[k].ticker]&&meta[raw[k].ticker].d||0)*raw[k].qty;

    html += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface2);border-radius:12px;padding:12px 16px;margin-top:4px;border:1px solid var(--border)">'
      + '<span style="font-size:11px;font-weight:700;color:var(--muted)">REVENU ANNUEL TOTAL</span>'
      + '<span style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">$'+Math.round(totalInc).toLocaleString('fr-FR')+'</span>'
      + '</div>'
      + '<div style="margin-top:10px;padding:10px 12px;background:rgba(124,109,255,.05);border:1px solid rgba(124,109,255,.12);border-radius:8px;font-size:9.5px;color:var(--muted);line-height:1.6">'
      + '<strong style="color:var(--violet)">M\u00e9thode :</strong> Signal basé sur P/E actuel vs moyenne 5 ans (Simply Safe Dividends). '
      + 'Mini-courbes = évolution historique · point coloré = valeur actuelle. Données au 16/06/2026.'
      + '</div>';

    el.innerHTML = html;

    /* ── Bind clics ──────────────────────────────────────────── */
    var btns = el.querySelectorAll('[data-vf]');
    for (var fi=0; fi<btns.length; fi++) {
      (function(b){ b.addEventListener('click',function(){ VS.filter=b.dataset.vf; draw(); }); })(btns[fi]);
    }

    /* Simulator toggle */
    var simCk = document.getElementById('simToggleCk');
    var simBody = document.getElementById('simBody');
    if (simCk) {
      simCk.addEventListener('change', function() {
        SIM.open = this.checked;
        if (simBody) simBody.style.display = SIM.open ? 'block' : 'none';
        if (SIM.open) {
          var sr = document.getElementById('simResults');
          if (sr) sr.innerHTML = renderSimResults(SIM.budget);
        }
      });
    }
    var simBudgetInput = document.getElementById('simBudget');
    if (simBudgetInput) {
      simBudgetInput.addEventListener('input', function() {
        SIM.budget = +this.value || 1000;
        var sr = document.getElementById('simResults');
        if (sr) sr.innerHTML = renderSimResults(SIM.budget);
      });
    }
    if (SIM.open) {
      var sr2 = document.getElementById('simResults');
      if (sr2) sr2.innerHTML = renderSimResults(SIM.budget);
    }
  }

  draw();
}


/* ── SMART ALERTS ENGINE ─────────────────────────────────────── */
function generateAlerts(portfolio) {
  var now      = new Date();
  var alerts   = [];
  var totalMV  = 0;
  var totalDiv = 0;
  var sectorMV = {};
  var sectorDiv= {};
  var positions= [];

  /* Build position list with metadata */
  for (var tk in portfolio) {
    if (!portfolio.hasOwnProperty(tk)) continue;
    var p  = portfolio[tk];
    var a  = assets[tk] || {};
    var mv = p.mv || 0;
    var d  = (a.d || 0) * p.qty;
    var sec= a.sector || 'Autre';

    totalMV  += mv;
    totalDiv += d;
    sectorMV[sec]  = (sectorMV[sec]  || 0) + mv;
    sectorDiv[sec] = (sectorDiv[sec] || 0) + d;
    positions.push({tk:tk, mv:mv, d:d, a:a, p:p, sec:sec});
  }

  /* Helpers */
  function addAlert(priority, type, icon, title, body, ts) {
    alerts.push({priority:priority, type:type, icon:icon, title:title, body:body, ts: ts || now.getTime()});
  }

  /* ── 1. PAYOUT RATIO TOO HIGH (>75%) ── */
  for (var i=0; i<positions.length; i++) {
    var pos = positions[i];
    var pr  = pos.a.payout_ratio || 0;
    var fcf = pos.a.fcf_payout   || 0;
    if (pr >= 0.80 || fcf >= 0.85) {
      addAlert(1,'payout','🔴', pos.tk+' · Payout ratio critique',
        'Payout '+Math.round(pr*100)+'% · FCF payout '+Math.round(fcf*100)+'%. Risque de coupe dividende si les bénéfices reculent.',
        now.getTime() - 1*3600000);
    } else if (pr >= 0.70) {
      addAlert(2,'payout','🟠', pos.tk+' · Payout ratio élevé',
        'Payout '+Math.round(pr*100)+'% · FCF payout '+Math.round(fcf*100)+'%. Marge de sécurité faible, surveiller les prochains résultats.',
        now.getTime() - 2*3600000);
    }
  }

  /* ── 2. DIVIDEND CUT RISK RISING (safe score <60) ── */
  for (var j=0; j<positions.length; j++) {
    var q   = positions[j];
    var sf  = q.a.safe || 100;
    var pr2 = q.a.payout_ratio || 0;
    if (sf < 55) {
      addAlert(1,'cut','🔴', q.tk+' · Risque coupe dividende élevé',
        'Safety score '+sf+'/100. Fondamentaux dégradés. Probabilité de réduction du dividende en hausse.',
        now.getTime() - 0.5*3600000);
    } else if (sf < 65 && pr2 > 0.60) {
      addAlert(2,'cut','🟠', q.tk+' · Risque coupe dividende modéré',
        'Safety score '+sf+'/100 · Payout '+Math.round(pr2*100)+'%. Combinaison à surveiller.',
        now.getTime() - 3*3600000);
    }
  }

  /* ── 3. OVERVALUATION EXTREME (pe_cur > pe_5y * 1.3) ── */
  for (var k=0; k<positions.length; k++) {
    var r    = positions[k];
    var pe   = r.a.pe_cur || 0;
    var pe5  = r.a.pe_5y  || 0;
    if (pe > 0 && pe5 > 0) {
      var ratio = pe / pe5;
      if (ratio > 1.40) {
        addAlert(1,'valuation','🔴', r.tk+' · Survaluation extrême',
          'P/E actuel '+pe+'x vs moyenne 5 ans '+pe5+'x (+'+Math.round((ratio-1)*100)+'%). Prix déjà intégré une croissance optimiste.',
          now.getTime() - 4*3600000);
      } else if (ratio > 1.20) {
        addAlert(2,'valuation','🟡', r.tk+' · Survaluation modérée',
          'P/E actuel '+pe+'x vs 5 ans '+pe5+'x (+'+Math.round((ratio-1)*100)+'%). Vigilance sur le point d\'entrée.',
          now.getTime() - 5*3600000);
      }
    }
  }

  /* ── 4. OVEREXPOSURE SECTOR (>25% MV) ── */
  if (totalMV > 0) {
    for (var sec in sectorMV) {
      if (!sectorMV.hasOwnProperty(sec)) continue;
      var pct = sectorMV[sec] / totalMV * 100;
      if (pct > 30) {
        addAlert(1,'sector','🔴', 'Surexposition '+sec+' · '+pct.toFixed(1)+'%',
          sec+' représente '+pct.toFixed(1)+'% de la valeur du portefeuille. Seuil critique de concentration dépassé (>30%).',
          now.getTime() - 6*3600000);
      } else if (pct > 22) {
        addAlert(2,'sector','🟡', 'Concentration '+sec+' · '+pct.toFixed(1)+'%',
          'Exposition élevée sur '+sec+' (>22%). Envisager un rééquilibrage progressif vers des secteurs sous-représentés.',
          now.getTime() - 7*3600000);
      }
    }
  }

  /* ── 5. WEAK DIVERSIFICATION (nb positions <10 ou 1 pays >85%) ── */
  var nbPos = positions.length;
  if (nbPos < 10) {
    addAlert(2,'diversification','🟡','Diversification insuffisante · '+nbPos+' positions',
      'Moins de 10 positions. Une forte baisse sur une seule ligne impacte significativement le portefeuille.',
      now.getTime() - 8*3600000);
  }
  /* Concentration géographique */
  var countryMV = {};
  for (var ci=0; ci<positions.length; ci++) {
    var ct = (positions[ci].a.country || 'US');
    countryMV[ct] = (countryMV[ct] || 0) + positions[ci].mv;
  }
  if (totalMV > 0) {
    for (var cy in countryMV) {
      if (!countryMV.hasOwnProperty(cy)) continue;
      var cpct = countryMV[cy] / totalMV * 100;
      if (cpct > 85) {
        addAlert(2,'diversification','🟡','Concentration géographique · '+cy+' '+cpct.toFixed(0)+'%',
          cy+' représente '+cpct.toFixed(0)+'% du portefeuille. Risque devise et régulation concentré.',
          now.getTime() - 8.5*3600000);
      }
    }
  }

  /* ── 6. INCOME CONCENTRATION RISK (1 action >20% des dividendes) ── */
  if (totalDiv > 0) {
    for (var li=0; li<positions.length; li++) {
      var lp = positions[li];
      var dpct = lp.d / totalDiv * 100;
      if (dpct > 25) {
        addAlert(1,'income','🔴', lp.tk+' · Concentration revenu · '+dpct.toFixed(1)+'%',
          lp.tk+' génère '+dpct.toFixed(1)+'% du revenu dividende total. Une coupe impacterait fortement le flux passif.',
          now.getTime() - 9*3600000);
      } else if (dpct > 15) {
        addAlert(2,'income','🟠', lp.tk+' · Revenu concentré · '+dpct.toFixed(1)+'%',
          lp.tk+' pèse '+dpct.toFixed(1)+'% des dividendes. Surveiller la stabilité du dividende de cette ligne.',
          now.getTime() - 10*3600000);
      }
    }
    /* Concentration sectorielle dividende */
    for (var ds in sectorDiv) {
      if (!sectorDiv.hasOwnProperty(ds)) continue;
      var secDpct = sectorDiv[ds] / totalDiv * 100;
      if (secDpct > 35) {
        addAlert(2,'income','🟠', ds+' · Revenu secteur concentré · '+secDpct.toFixed(1)+'%',
          ds+' génère '+secDpct.toFixed(1)+'% des dividendes totaux. Diversifier les sources de revenu passif.',
          now.getTime() - 11*3600000);
      }
    }
  }

  /* Trier par priorité puis par timestamp desc */
  alerts.sort(function(a,b){
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.ts - a.ts;
  });

  return alerts;
}

// ── News dynamiques FMP ─────────────────────────────────────────
var _newsArticles  = null;  // null=chargement, []=vide, [...]= articles
var _newsFetchedAt = 0;
var _newsTickersKey = '';
var _NEWS_TTL = 2 * 3600 * 1000;

function _fmtNewsDate(dt) {
  if (!dt) return '';
  var d = new Date(dt.replace(' ', 'T'));
  if (isNaN(d)) return dt.slice(0, 10);
  var diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 60)   return 'il y a ' + diff + ' min';
  if (diff < 1440) return 'il y a ' + Math.floor(diff / 60) + 'h';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function _renderNewsArticles(portSet) {
  if (_newsArticles === null) {
    var sk = '<div class="section-title">Actualit\u00e9s march\u00e9</div>';
    for (var i = 0; i < 3; i++) {
      sk += '<div class="news-card" style="opacity:.4">'
        + '<div class="news-top"><div class="news-tk" style="width:48px;height:14px;background:var(--surface2);border-radius:4px"></div>'
        + '<div style="width:60px;height:10px;background:var(--surface2);border-radius:4px"></div></div>'
        + '<div class="news-title" style="width:80%;height:14px;background:var(--surface2);border-radius:4px;margin:6px 0"></div>'
        + '<div class="news-body" style="width:100%;height:36px;background:var(--surface2);border-radius:4px"></div>'
        + '</div>';
    }
    return sk;
  }
  var h = '<div class="section-title">Actualit\u00e9s march\u00e9</div>';
  var shown = (portSet && portSet.length)
    ? _newsArticles.filter(function(a){ return !a.symbol || portSet.indexOf(a.symbol) !== -1; })
    : _newsArticles;
  if (!shown.length) {
    h += '<div style="text-align:center;padding:24px 0;color:var(--muted);font-size:13px">Aucune actualit\u00e9 disponible pour votre portefeuille</div>';
    return h;
  }
  for (var i = 0; i < shown.length; i++) {
    var a = shown[i];
    h += '<div class="news-card">'
      + '<div class="news-top"><div style="display:flex;align-items:center;gap:8px">'
      + (a.symbol ? '<span class="news-tk">' + _esc(a.symbol) + '</span>' : '')
      + (a.site   ? '<span class="news-tag" style="background:rgba(107,114,128,.15);color:#9ca3af">' + _esc(a.site) + '</span>' : '')
      + '</div><span style="font-size:10px;color:var(--muted)">' + _fmtNewsDate(a.publishedDate) + '</span></div>'
      + '<div class="news-title">' + _esc(a.title) + '</div>'
      + (a.text ? '<div class="news-body">' + _esc(a.text) + '</div>' : '')
      + '</div>';
  }
  return h;
}

function _loadNewsIfNeeded(portSet, el) {
  if (!portSet || !portSet.length) return;
  var key = portSet.slice().sort().join(',');
  var now = Date.now();
  if (_newsArticles !== null && _newsTickersKey === key && (now - _newsFetchedAt) < _NEWS_TTL) return;
  _newsTickersKey = key;
  _newsArticles = null;
  fetch('/api/news?tickers=' + encodeURIComponent(key))
    .then(function(r){ return r.json(); })
    .then(function(data) {
      _newsArticles  = data.articles || [];
      _newsFetchedAt = Date.now();
      var newsEl = document.getElementById('panel-news');
      if (newsEl) renderNews(newsEl);
    })
    .catch(function() { _newsArticles = []; _newsFetchedAt = Date.now(); });
}

function renderNews(el) {
  /* ── État vide ── */
  if (raw.length === 0) {
    el.innerHTML = _emptyState('📰', 'Aucune alerte', 'Les alertes et actualités apparaîtront une fois des actions ajoutées au portefeuille.');
    return;
  }
  /* Tickers actuellement en portefeuille */
  var portMap = {};
  for (var ri=0; ri<raw.length; ri++) { if (raw[ri].qty > 0) portMap[raw[ri].ticker] = raw[ri]; }
  var portSet = Object.keys(portMap);

  /* Hausses de dividendes \u2014 qty dynamique depuis le vrai portefeuille, filtr\u00e9s sur positions ouvertes */
  var divRaisesAll = [
    {t:'JNJ',  oldD:4.96, newD:5.24, pct:5.6,  date:'Avr 2026'},
    {t:'ADP',  oldD:5.64, newD:6.16, pct:9.2,  date:'Nov 2025'},
    {t:'MMM',  oldD:4.00, newD:5.16, pct:29.0, date:'F\u00e9v 2026'},
    {t:'NEE',  oldD:1.87, newD:2.06, pct:10.2, date:'F\u00e9v 2026'},
    {t:'TGT',  oldD:4.40, newD:4.44, pct:0.9,  date:'Jun 2026'},
    {t:'CTBI', oldD:1.72, newD:1.76, pct:2.3,  date:'Jul 2025'},
    {t:'NNN',  oldD:2.16, newD:2.24, pct:3.7,  date:'Mar 2026'},
    {t:'O',    oldD:3.08, newD:3.17, pct:2.9,  date:'Jan 2026'},
    {t:'HRL',  oldD:1.10, newD:1.14, pct:3.6,  date:'Nov 2025'},
    {t:'NFG',  oldD:1.80, newD:1.88, pct:4.4,  date:'Nov 2025'},
  ];
  var divRaises = divRaisesAll.filter(function(dr){ return portMap[dr.t]; }).map(function(dr){ return Object.assign({}, dr, {qty: portMap[dr.t].qty}); });
  var totalGainAn = 0;
  for (var di=0; di<divRaises.length; di++) {
    totalGainAn += (divRaises[di].newD - divRaises[di].oldD) * divRaises[di].qty;
  }

  /* ── Smart Alerts ── */
  var portfolio = {};
  for (var ri=0; ri<raw.length; ri++) {
    var rr = raw[ri];
    if (rr.qty > 0) portfolio[rr.ticker] = rr;
  }
  var alerts = generateAlerts(portfolio);

  var ALERT_COLORS = {
    1: {bg:'rgba(244,63,94,.08)',  border:'rgba(244,63,94,.3)',  label:'CRITIQUE', lc:'#f43f5e'},
    2: {bg:'rgba(245,166,35,.07)', border:'rgba(245,166,35,.25)', label:'ATTENTION', lc:'#f5a623'},
    3: {bg:'rgba(56,189,248,.07)', border:'rgba(56,189,248,.2)',  label:'INFO',      lc:'#38bdf8'}
  };
  var TYPE_LABELS = {
    payout:'Payout', cut:'Dividende', valuation:'Valorisation',
    sector:'Secteur', diversification:'Diversification', income:'Concentration'
  };

  var h = '<div class="section-title">Actualit\u00e9s march\u00e9</div>';

  /* Alert summary bar */
  var critCount = 0, warnCount = 0;
  for (var ai=0; ai<alerts.length; ai++) {
    if (alerts[ai].priority===1) critCount++;
    else warnCount++;
  }
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;user-select:none" '
    + 'id="alertsToggle" onclick="(function(){var b=document.getElementById(\'alertsBody\');var arr=document.getElementById(\'alertsArrow\');var open=b.style.display!==\'none\';b.style.display=open?\'none\':\'block\';arr.textContent=open?\'▼\':\'▲\';})()">'
    + '<div style="background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);border-radius:10px;padding:8px 12px;flex:1;display:flex;justify-content:space-between;align-items:center">'
    + '<div style="display:flex;align-items:center;gap:10px">'
    + '<span style="font-size:16px">🛡️</span>'
    + '<div><div style="font-size:11px;font-weight:700;color:#f43f5e;text-transform:uppercase;letter-spacing:.5px">Smart Alerts</div>'
    + '<div style="font-size:9.5px;color:var(--muted);margin-top:1px">Analyse risques en temps réel</div></div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;align-items:center">'
    + (critCount ? '<span style="background:#f43f5e;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">'+critCount+' CRIT</span>' : '')
    + (warnCount ? '<span style="background:#f5a623;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">'+warnCount+' WARN</span>' : '')
    + '<span id="alertsArrow" style="font-size:11px;color:var(--muted)">▼</span>'
    + '</div></div></div>';

  h += '<div id="alertsBody" style="display:none;margin-bottom:14px">';
  if (alerts.length === 0) {
    h += '<div style="background:rgba(34,212,122,.07);border:1px solid rgba(34,212,122,.2);border-radius:10px;padding:12px;text-align:center;font-size:12px;color:#22d47a">✅ Aucune alerte — portefeuille sain</div>';
  } else {
    for (var ai2=0; ai2<alerts.length; ai2++) {
      var al  = alerts[ai2];
      var ac  = ALERT_COLORS[al.priority] || ALERT_COLORS[3];
      var tl  = TYPE_LABELS[al.type] || al.type;
      h += '<div style="background:'+ac.bg+';border:1px solid '+ac.border+';border-radius:10px;padding:11px 12px;margin-bottom:6px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
        + '<div style="display:flex;align-items:center;gap:6px">'
        + '<span style="font-size:14px">'+al.icon+'</span>'
        + '<span style="font-size:10px;font-weight:700;color:'+ac.lc+';background:'+ac.bg+';border:1px solid '+ac.border+';padding:1px 6px;border-radius:5px">'+ac.label+'</span>'
        + '<span style="font-size:9.5px;color:var(--muted);background:var(--surface2);padding:1px 6px;border-radius:5px">'+tl+'</span>'
        + '</div>'
        + '<span style="font-size:9px;color:var(--muted)">il y a '+Math.round((Date.now()-al.ts)/60000)+' min</span>'
        + '</div>'
        + '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:3px">'+al.title+'</div>'
        + '<div style="font-size:11px;color:var(--muted);line-height:1.5">'+al.body+'</div>'
        + '</div>';
    }
  }
  h += '</div>';

  h += '<div style="background:linear-gradient(135deg,rgba(34,212,122,.08),rgba(124,109,255,.05));border:1px solid rgba(34,212,122,.2);border-radius:14px;padding:14px;margin-bottom:14px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;cursor:pointer;user-select:none" id="divRaisesToggle" onclick="(function(){var b=document.getElementById(\'divRaisesBody\');var a=document.getElementById(\'divRaisesArrow\');var open=b.style.display!==\'none\';b.style.display=open?\'none\':\'block\';a.textContent=open?\'\u25bc\':\'\u25b2\';})()">'
    +'<div><div style="font-size:11px;font-weight:700;color:#22d47a;text-transform:uppercase;letter-spacing:.5px">\uD83D\uDCC8 Hausses dividendes</div>'
    +'<div style="font-size:9.5px;color:var(--muted);margin-top:2px">Votre portefeuille</div></div>'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<div style="text-align:right">'
    +'<div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">+'+totalGainAn.toFixed(2)+'$</div>'
    +'<div style="font-size:9px;color:var(--muted)">gain suppl\u00e9mentaire /an</div>'
    +'</div>'
    +'<span id="divRaisesArrow" style="font-size:11px;color:#22d47a;flex-shrink:0">\u25bc</span>'
    +'</div></div>'
    +'<div id="divRaisesBody" style="display:none"><div style="display:flex;flex-direction:column;gap:0;margin-top:10px">';
  for (var di=0; di<divRaises.length; di++) {
    var dr = divRaises[di];
    var gainAn = (dr.newD - dr.oldD) * dr.qty;
    h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)">'
      +'<div style="display:flex;align-items:center;gap:7px">'
      +'<span style="font-size:13px;font-weight:700">'+dr.t+'</span>'
      +'<span style="font-size:9.5px;background:rgba(34,212,122,.12);color:#22d47a;padding:2px 6px;border-radius:6px;font-weight:700">+'+dr.pct+'%</span>'
      +'<span style="font-size:9px;color:var(--muted)">'+dr.date+'</span>'
      +'</div>'
      +'<div style="text-align:right">'
      +'<div style="font-size:10.5px;font-family:DM Mono,monospace;color:var(--muted)">'+dr.oldD+'$ \u2192 '+dr.newD+'$</div>'
      +'<div style="font-size:11px;font-weight:700;color:#22d47a">+'+gainAn.toFixed(2)+'$/an pour moi</div>'
      +'</div></div>';
  }
  h += '</div></div></div>';
  // Articles FMP (chargés de manière asynchrone via /api/news)
  h += _renderNewsArticles(portSet);
  el.innerHTML = h;
  // Déclenche le fetch si pas encore chargé ou expiré
  _loadNewsIfNeeded(portSet, el);
}


/* ── IMPÔTS : constante de stockage ──────────────────────────── */
const IMPOT_STORE_KEY = 'astra_tax_data';

function renderImpots(el) {
  if (raw.length === 0) {
    el.innerHTML = _emptyState('⚖️', 'Aucune donnée fiscale', 'Les données fiscales s\'affichent une fois des transactions importées.');
    return;
  }
  let taxData = null;
  try { const s = localStorage.getItem(IMPOT_STORE_KEY); if (s) taxData = JSON.parse(s); } catch(e) {}
  if (!taxData) { _renderImpotUpload(el); } else { _renderImpotFilled(el, taxData); }
}




/* ── IMPÔTS : upload + parsing + affichage ───────────────────── */

function _renderImpotUpload(el) {
  el.innerHTML =
    '<div class="section-title">Déclaration fiscale</div>'
    + '<div id="imp-drop" onclick="document.getElementById(\'imp-file-input\').click()" '
    + 'ondragover="event.preventDefault();this.style.borderColor=\'#7c6dff\'" '
    + 'ondragleave="this.style.borderColor=\'\'" '
    + 'ondrop="event.preventDefault();this.style.borderColor=\'\';_handleImpotFile(event.dataTransfer.files[0])" '
    + 'style="border:2px dashed var(--border);border-radius:16px;padding:36px 20px;text-align:center;margin-bottom:16px;cursor:pointer;transition:border-color .2s">'
    + '<div style="font-size:44px;margin-bottom:12px">📄</div>'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:6px">Déposez votre relevé ici</div>'
    + '<div style="font-size:11px;color:var(--muted);line-height:1.7">Relevé annuel IBKR Ireland · IFU · Dividend Report Tax Year N‑1<br>Formats acceptés : CSV · PDF · TXT</div>'
    + '<input type="file" id="imp-file-input" accept=".csv,.pdf,.txt" style="display:none" onchange="_handleImpotFile(this.files[0])">'
    + '</div>'
    + '<div style="background:var(--surface);border-radius:12px;padding:14px;margin-bottom:14px">'
    + '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Comment obtenir le document IBKR</div>'
    + '<div style="display:flex;flex-direction:column;gap:10px">'
    + _impotStep(1,'#7c6dff','ibkr.com → <strong style="color:var(--text)">Rapports → Relevés fiscaux → Relevé annuel des dividendes</strong>','Sélectionner l\'année N‑1 → Télécharger en CSV ou PDF')
    + _impotStep(2,'#22d47a','Déposer le fichier dans la zone ci-dessus','Les cases 2DC · 2CG · 2TS · 8VL · 3916‑bis sont <strong style="color:var(--text)">remplies automatiquement</strong>')
    + _impotStep(3,'#f5a623','Vérifier puis exporter / imprimer','Aucune donnée n\'est envoyée à l\'extérieur — tout reste dans ton appareil')
    + '</div></div>'
    + '<div style="text-align:center"><button onclick="_renderImpotManual(document.getElementById(\'panel-impots\'))" '
    + 'style="background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:10px 22px;font-size:12px;cursor:pointer;font-family:inherit">'
    + '✏️  Saisie manuelle des montants</button></div>';
}

function _impotStep(n, col, titre, desc) {
  return '<div style="display:flex;gap:10px;align-items:flex-start">'
    + '<div style="flex-shrink:0;width:24px;height:24px;border-radius:7px;background:'+col+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">'+n+'</div>'
    + '<div style="font-size:11px;color:var(--muted2);line-height:1.55"><strong style="color:var(--text)">'+titre+'</strong><br>'+desc+'</div>'
    + '</div>';
}

function _handleImpotFile(file) {
  if (!file) return;
  var el = document.getElementById('panel-impots');
  el.innerHTML = '<div style="text-align:center;padding:40px 20px"><div style="font-size:32px;margin-bottom:12px">⏳</div><div style="font-size:13px;color:var(--muted)">Analyse en cours…</div></div>';
  var reader = new FileReader();
  reader.onload = function(e) {
    var data = _parseImpotText(e.target.result, file.name);
    if (data) {
      try { localStorage.setItem(IMPOT_STORE_KEY, JSON.stringify(data)); } catch(ex) {}
      _renderImpotFilled(el, data);
    } else {
      _renderImpotManual(el, 'Impossible d\'extraire automatiquement les données. Vérifiez le format ou utilisez la saisie manuelle.');
    }
  };
  reader.onerror = function() { _renderImpotManual(el, 'Erreur de lecture du fichier.'); };
  reader.readAsText(file, 'UTF-8');
}

function _parseImpotText(text, filename) {
  var data = {annee:new Date().getFullYear()-1, compte:'', etablissement:'Interactive Brokers Ireland Ltd', pays_compte:'Irlande',
               div_us_usd:0,div_us_eur:0,rts_us_usd:0,rts_us_eur:0,
               div_ie_usd:0,div_ie_eur:0,rts_ie_usd:0,rts_ie_eur:0,
               roc_usd:0,roc_eur:0,eurusd:1.08};

  /* ── IBKR Activity Statement CSV ─── */
  if (/\.csv$/i.test(filename) || text.indexOf(',Header,')!==-1 || text.indexOf('Statement,Data')!==-1) {
    var lines = text.split(/\r?\n/);
    var dUSD=0,dEUR=0,wUSD=0,wEUR=0,rocUSD=0,dIeUSD=0,dIeEUR=0,wIeUSD=0,wIeEUR=0;
    var IE_SET = {ACN:1,MDT:1};
    for (var i=0; i<lines.length; i++) {
      var cols = lines[i].split(',');
      var sec=(cols[0]||'').trim(), kind=(cols[1]||'').trim();
      if (sec==='Account Information' && kind==='Data' && (cols[2]||'').trim()==='Account') data.compte=(cols[3]||'').replace(/"/g,'').trim();
      if (sec==='Dividends' && kind==='Data') {
        var cur=(cols[2]||'').trim(), desc=(cols[4]||'').replace(/"/g,'').trim();
        var amt=parseFloat((cols[5]||'').replace(/[^0-9.\-]/g,''))||0;
        if (amt<=0) continue;
        if (/return of capital|roc/i.test(desc)) { if(cur==='USD') rocUSD+=amt; continue; }
        var tk=((desc.match(/^([A-Z]{1,5})\(/)||[])[1])||'';
        if (IE_SET[tk]) { if(cur==='USD') dIeUSD+=amt; if(cur==='EUR') dIeEUR+=amt; }
        else { if(cur==='USD') dUSD+=amt; if(cur==='EUR') dEUR+=amt; }
      }
      if ((sec==='Withholding Tax'||sec==='Taxes Withheld') && kind==='Data') {
        var cur2=(cols[2]||'').trim(), desc2=(cols[4]||'').replace(/"/g,'').trim();
        var amt2=Math.abs(parseFloat((cols[5]||'').replace(/[^0-9.\-]/g,''))||0);
        var tk2=((desc2.match(/^([A-Z]{1,5})\(/)||[])[1])||'';
        if (IE_SET[tk2]) { if(cur2==='USD') wIeUSD+=amt2; if(cur2==='EUR') wIeEUR+=amt2; }
        else { if(cur2==='USD') wUSD+=amt2; if(cur2==='EUR') wEUR+=amt2; }
      }
    }
    if (dUSD>0||wUSD>0) {
      data.div_us_usd=+dUSD.toFixed(2); data.div_us_eur=dEUR>0?+dEUR.toFixed(2):+(dUSD/data.eurusd).toFixed(2);
      data.rts_us_usd=+wUSD.toFixed(2); data.rts_us_eur=wEUR>0?+wEUR.toFixed(2):+(wUSD/data.eurusd).toFixed(2);
      data.div_ie_usd=+dIeUSD.toFixed(2); data.div_ie_eur=dIeEUR>0?+dIeEUR.toFixed(2):+(dIeUSD/data.eurusd).toFixed(2);
      data.rts_ie_usd=+wIeUSD.toFixed(2); data.rts_ie_eur=wIeEUR>0?+wIeEUR.toFixed(2):+(wIeUSD/data.eurusd).toFixed(2);
      data.roc_usd=+rocUSD.toFixed(2); data.roc_eur=+(rocUSD/data.eurusd).toFixed(2);
      return data;
    }
  }

  /* ── Texte brut / PDF extracté : regex ─── */
  function grab(pattern) { var m=text.match(pattern); return m?parseFloat(m[1].replace(/,/g,'.')):null; }
  var accM=text.match(/U\d{7,9}/); if(accM) data.compte=accM[0];
  var yrM=text.match(/Tax Year[\s:]+(\d{4})|Ann.e fiscale[\s:]+(\d{4})/i); if(yrM) data.annee=parseInt(yrM[1]||yrM[2]);
  var dUsUsd=grab(/Total Ordinary Dividends[^\d]+([\d,\.]+)/i)||grab(/Dividends?.*US[^\d]+([\d,\.]+)/i);
  var dUsEur=grab(/Total Ordinary Dividends.*?([\d,\.]+)\s*€/i);
  var wUsUsd=grab(/Total Withholding Tax[^\d]+([\d,\.]+)/i)||grab(/Withholding Tax[^\d]+([\d,\.]+)/i);
  var wUsEur=grab(/Total Withholding Tax.*?([\d,\.]+)\s*€/i);
  var dIeUsd=grab(/Total non-US Ordinary Dividends[^\d]+([\d,\.]+)/i)||grab(/Irish Dividend[^\d]+([\d,\.]+)/i);
  var dIeEur=grab(/Total non-US Ordinary Dividends.*?([\d,\.]+)\s*€/i);
  var wIeUsd=grab(/DWT[^\d]+([\d,\.]+)/i)||grab(/Irish.*Withholding[^\d]+([\d,\.]+)/i);
  var wIeEur=grab(/DWT.*?([\d,\.]+)\s*€/i);
  var rocUsd2=grab(/Return of Capital[^\d]+([\d,\.]+)/i);
  if (!dUsUsd&&!wUsUsd&&!dIeUsd) return null;
  if(dUsUsd) data.div_us_usd=dUsUsd;
  data.div_us_eur=dUsEur||(dUsUsd?+(dUsUsd/data.eurusd).toFixed(2):0);
  if(wUsUsd) data.rts_us_usd=wUsUsd;
  data.rts_us_eur=wUsEur||(wUsUsd?+(wUsUsd/data.eurusd).toFixed(2):0);
  if(dIeUsd) data.div_ie_usd=dIeUsd;
  data.div_ie_eur=dIeEur||(dIeUsd?+(dIeUsd/data.eurusd).toFixed(2):0);
  if(wIeUsd) data.rts_ie_usd=wIeUsd;
  data.rts_ie_eur=wIeEur||(wIeUsd?+(wIeUsd/data.eurusd).toFixed(2):0);
  if(rocUsd2){data.roc_usd=rocUsd2;data.roc_eur=+(rocUsd2/data.eurusd).toFixed(2);}
  return data;
}

function _renderImpotManual(el, errorMsg) {
  var prev={}; try{var s=localStorage.getItem(IMPOT_STORE_KEY);if(s)prev=JSON.parse(s)||{};}catch(e){}
  var yr=prev.annee||(new Date().getFullYear()-1);
  function fi(id,lbl,val){ return '<div><div style="font-size:10px;color:var(--muted);margin-bottom:3px">'+lbl+'</div>'
    +'<input id="impf-'+id+'" type="number" step="0.01" min="0" value="'+(val||'')+'" placeholder="0.00" '
    +'style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:13px;font-family:DM Mono,monospace;box-sizing:border-box"></div>'; }
  function ft(id,lbl,val,ph){ return '<div><div style="font-size:10px;color:var(--muted);margin-bottom:3px">'+lbl+'</div>'
    +'<input id="impf-'+id+'" type="text" value="'+(val||'')+'" placeholder="'+(ph||'')+'" '
    +'style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:13px;font-family:DM Mono,monospace;box-sizing:border-box"></div>'; }
  el.innerHTML = '<div class="section-title">Saisie manuelle — données fiscales</div>'
    +(errorMsg?'<div style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);border-radius:10px;padding:10px 12px;font-size:11px;color:#f43f5e;margin-bottom:14px">⚠ '+errorMsg+'</div>':'')
    +'<div style="background:var(--surface);border-radius:14px;padding:14px;margin-bottom:12px">'
    +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Compte & Année</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +fi('annee','Année fiscale',yr)+ft('compte','N° compte IBKR',prev.compte||'','U11033379')
    +'</div></div>'
    +'<div style="background:var(--surface);border-radius:14px;padding:14px;margin-bottom:12px">'
    +'<div style="font-size:11px;font-weight:700;color:#22d47a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">🇺🇸 Dividendes US (retenue 15%)</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +fi('div_us_usd','Total div. US ($)',prev.div_us_usd||'')+fi('div_us_eur','Total div. US (€)',prev.div_us_eur||'')
    +fi('rts_us_usd','Retenue source US ($)',prev.rts_us_usd||'')+fi('rts_us_eur','Retenue source US (€)',prev.rts_us_eur||'')
    +'</div></div>'
    +'<div style="background:var(--surface);border-radius:14px;padding:14px;margin-bottom:12px">'
    +'<div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">🇮🇪 Dividendes Irlande (DWT 25%)</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +fi('div_ie_usd','Total div. IE ($)',prev.div_ie_usd||'')+fi('div_ie_eur','Total div. IE (€)',prev.div_ie_eur||'')
    +fi('rts_ie_usd','DWT prélevée ($)',prev.rts_ie_usd||'')+fi('rts_ie_eur','DWT prélevée (€)',prev.rts_ie_eur||'')
    +'</div></div>'
    +'<div style="background:var(--surface);border-radius:14px;padding:14px;margin-bottom:16px">'
    +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Return of Capital (REITs — non imposable)</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +fi('roc_usd','RoC ($)',prev.roc_usd||'')+fi('roc_eur','RoC (€)',prev.roc_eur||'')
    +'</div></div>'
    +'<button onclick="_impotManualSave()" style="width:100%;padding:14px;border-radius:12px;background:var(--violet);color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Calculer ma déclaration →</button>'
    +'<div style="text-align:center;margin-top:10px"><button onclick="_renderImpotUpload(document.getElementById(\'panel-impots\'))" style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">← Retour upload</button></div>';
}

function _impotManualSave() {
  function v(id){var e=document.getElementById('impf-'+id);return e?parseFloat(e.value)||0:0;}
  function t(id){var e=document.getElementById('impf-'+id);return e?e.value.trim():'';}
  var d={annee:parseInt(t('annee'))||new Date().getFullYear()-1,compte:t('compte'),
          etablissement:'Interactive Brokers Ireland Ltd',pays_compte:'Irlande',eurusd:1.08,
          div_us_usd:v('div_us_usd'),div_us_eur:v('div_us_eur'),rts_us_usd:v('rts_us_usd'),rts_us_eur:v('rts_us_eur'),
          div_ie_usd:v('div_ie_usd'),div_ie_eur:v('div_ie_eur'),rts_ie_usd:v('rts_ie_usd'),rts_ie_eur:v('rts_ie_eur'),
          roc_usd:v('roc_usd'),roc_eur:v('roc_eur')};
  if(!d.div_us_eur&&d.div_us_usd) d.div_us_eur=+(d.div_us_usd/d.eurusd).toFixed(2);
  if(!d.rts_us_eur&&d.rts_us_usd) d.rts_us_eur=+(d.rts_us_usd/d.eurusd).toFixed(2);
  if(!d.div_ie_eur&&d.div_ie_usd) d.div_ie_eur=+(d.div_ie_usd/d.eurusd).toFixed(2);
  if(!d.rts_ie_eur&&d.rts_ie_usd) d.rts_ie_eur=+(d.rts_ie_usd/d.eurusd).toFixed(2);
  try{localStorage.setItem(IMPOT_STORE_KEY,JSON.stringify(d));}catch(e){}
  _renderImpotFilled(document.getElementById('panel-impots'),d);
}

function _renderImpotFilled(el,TAX) {
  var IE_TICKERS=['ACN','MDT'];
  var usTickers=raw.filter(function(r){return r.qty>0&&IE_TICKERS.indexOf(r.ticker)===-1;}).map(function(r){return r.ticker;}).filter(function(t,i,a){return a.indexOf(t)===i;}).sort().join(', ');
  var ieTickers=raw.filter(function(r){return r.qty>0&&IE_TICKERS.indexOf(r.ticker)!==-1;}).map(function(r){return r.ticker;}).filter(function(t,i,a){return a.indexOf(t)===i;}).sort().join(' + ')||'ACN + MDT';
  var div_us_eur=TAX.div_us_eur,rts_us_eur=TAX.rts_us_eur,div_ie_eur=TAX.div_ie_eur,rts_ie_eur=TAX.rts_ie_eur,roc_eur=TAX.roc_eur;
  var credit_ie=Math.min(rts_ie_eur,div_ie_eur*0.15);
  var perte_ie=rts_ie_eur-credit_ie;
  var total_brut=div_us_eur+div_ie_eur;
  var credit_8vl=rts_us_eur+credit_ie;
  var net_france=Math.max(0,total_brut*0.30-credit_8vl);
  function eur(v,dec){dec=dec==null?2:dec;return v.toLocaleString('fr-FR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+' €';}
  function row(cas,titre,valeur,col,desc){
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--surface2);border-radius:10px;margin-bottom:6px">'
      +'<div style="min-width:44px;text-align:center;flex-shrink:0"><div style="font-family:DM Mono,monospace;font-size:15px;font-weight:700;color:var(--violet)">'+cas+'</div></div>'
      +'<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700;margin-bottom:2px">'+titre+'</div>'+(desc?'<div style="font-size:10px;color:var(--muted);line-height:1.5">'+desc+'</div>':'')+'</div>'
      +'<div style="flex-shrink:0;font-family:DM Mono,monospace;font-size:14px;font-weight:700;color:'+(col||'var(--text)')+';text-align:right;min-width:80px">'+valeur+'</div></div>';
  }
  var html='';
  /* En-tête + bouton effacer */
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<div style="background:rgba(34,212,122,.15);border:1px solid rgba(34,212,122,.3);border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;color:#22d47a">✓ Tax Year '+TAX.annee+'</div>'
    +(TAX.compte?'<div style="font-size:10px;color:var(--muted)">IBKR Ireland · '+TAX.compte+'</div>':'')
    +'</div>'
    +'<button onclick="localStorage.removeItem(\''+IMPOT_STORE_KEY+'\');_renderImpotUpload(document.getElementById(\'panel-impots\'))" '
    +'style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">✕ Effacer</button></div>';
  /* Synthèse */
  html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total div. bruts</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace">'+eur(total_brut,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">US + Irlande</div></div>'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px;border:1px solid rgba(34,212,122,.2)"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Crédit impôt (8VL)</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">-'+eur(credit_8vl,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">US '+eur(rts_us_eur,0)+' + IE '+eur(credit_ie,0)+'</div></div>'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Net à payer France</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#f5a623">'+eur(net_france,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">PFU 30% après crédit</div></div>'
    +'</div>';
  /* Alertes */
  html+='<div style="display:flex;flex-direction:column;gap:7px;margin-bottom:20px">';
  if(roc_eur>0) html+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:11px 13px"><div style="font-size:11.5px;line-height:1.55">⚠ <strong style="color:#f59e0b">Return of Capital '+eur(roc_eur,0)+'</strong> (REITs) — non imposable, réduit ton PRU.</div></div>';
  if(perte_ie>0.01) html+='<div style="background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.18);border-radius:10px;padding:11px 13px"><div style="font-size:11.5px;line-height:1.55">⚠ <strong style="color:#f43f5e">'+eur(perte_ie)+' perdus</strong> (DWT irlandaise 25% sur '+ieTickers+' — crédit plafonné 15%). Dépose le formulaire <strong>2VA</strong> auprès d\'IBKR Ireland.</div></div>';
  html+='</div>';
  /* 3916-bis */
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid #f43f5e;padding:14px;margin-bottom:12px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
    +'<div style="display:flex;gap:8px;align-items:center"><span style="background:#f43f5e;color:#fff;font-size:9px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.5px">OBLIGATOIRE</span>'
    +'<div style="font-size:15px;font-weight:700">Formulaire 3916-bis</div></div>'
    +'<div style="text-align:right;font-size:10px;color:#f59e0b;font-weight:600;line-height:1.4">À faire 1×/an<br>Amende 1 500 €</div></div>'
    +'<div style="font-size:12px;line-height:1.7;color:var(--muted2)">Sur <strong style="color:var(--text)">impots.gouv.fr</strong> → Ma déclaration → Comptes à l\'étranger'
    +'<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">'
    +'<span>• Établissement : <strong style="color:var(--text)">'+TAX.etablissement+'</strong></span>'
    +'<span>• Pays : <strong style="color:var(--text)">'+TAX.pays_compte+'</strong></span>'
    +(TAX.compte?'<span>• N° compte : <strong style="color:var(--text);font-family:DM Mono,monospace">'+TAX.compte+'</strong></span>':'')
    +'</div></div></div>';
  /* 2047 */
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid #f59e0b;padding:14px;margin-bottom:12px">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:12px">Formulaire 2047 — À remplir AVANT la 2042</div>'
    +'<div style="background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.15);border-radius:10px;padding:11px;margin-bottom:8px">'
    +'<div style="font-size:11px;font-weight:700;color:#22c55e;margin-bottom:8px">🇺🇸 Ligne 1 — Pays : États-Unis</div>'
    +row('201','Pays','États-Unis','#22c55e',null)
    +row('203','Montant net encaissé',(TAX.div_us_usd-TAX.rts_us_usd).toFixed(2)+' $ → € au taux BCE','#22c55e','Convertir au taux du jour de chaque versement')
    +row('204','Taux crédit d\'impôt','17,7 %','#22c55e','Convention France-USA art. 10')
    +row('206','Impôt payé aux USA',eur(rts_us_eur),'#22c55e',null)
    +row('207','Crédit d\'impôt retenu',eur(rts_us_eur),'#22c55e',null)
    +row('208','Revenu crédit inclus',eur(div_us_eur),'#22c55e',null)
    +'</div>'
    +(div_ie_eur>0?'<div style="background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);border-radius:10px;padding:11px">'
    +'<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:8px">🇮🇪 Ligne 2 — Pays : Irlande ('+ieTickers+')</div>'
    +row('201','Pays','Irlande','#f59e0b',null)
    +row('203','Montant net encaissé',(TAX.div_ie_usd-TAX.rts_ie_usd).toFixed(2)+' $ → € au taux BCE','#f59e0b','Convertir au taux du jour de chaque versement')
    +row('204','Taux','15 %','#f59e0b','Convention France-Irlande (≠ USA)')
    +row('206','DWT prélevée par IBKR',eur(rts_ie_eur),'#f59e0b',null)
    +row('207','Crédit récupérable',eur(credit_ie),'#f59e0b','Plafonné à 15%')
    +'</div>':'')
    +'</div>';
  /* 2042 */
  var cases2042=[
    {cas:'2DC',titre:'Dividendes bruts actions US',val:eur(div_us_eur),col:'#22d47a',desc:(usTickers||'actions US du portefeuille')+' — Source : «Total Ordinary Dividends»'},
    {cas:'2CG',titre:'Revenus soumis aux prélèvements sociaux (PFU)',val:eur(div_us_eur),col:'#22d47a',desc:'Identique à 2DC. Option barème progressif → 2BH à la place'},
    ...(div_ie_eur>0?[{cas:'2TS',titre:'Dividendes source irlandaise ('+ieTickers+')',val:eur(div_ie_eur),col:'#f59e0b',desc:'Pas d\'abattement 40 %. Source : «Total non-US Ordinary Dividends»'}]:[]),
    {cas:'3VG',titre:'Plus-values de cession',val:'À vérifier',col:'#6b7280',desc:'Vérifier «Realized Gains & Losses» IBKR → reporter si gain. Perte → case 3VH'},
    {cas:'8VL',titre:'Crédit d\'impôt étranger (report depuis 2047)',val:eur(credit_8vl),col:'#22d47a',desc:'= '+eur(rts_us_eur)+' US'+(credit_ie>0?' + '+eur(credit_ie)+' IE':'')+'. ⚠ Case 8VL uniquement — 2AB réservée aux courtiers français'},
  ];
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid var(--violet);padding:14px;margin-bottom:12px">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:12px">Formulaire 2042 — Déclaration principale</div>'
    +'<div style="display:flex;flex-direction:column;gap:6px">';
  for(var i=0;i<cases2042.length;i++){var c=cases2042[i];html+=row(c.cas,c.titre,c.val,c.col,c.desc);}
  html+='</div></div>';
  /* Procédure annuelle */
  var steps=[
    {n:1,col:'#ef4444',titre:'Déclarer le compte IBKR (3916-bis)',desc:'Sur impots.gouv.fr dès l\'ouverture de la campagne. Obligatoire même sans gain. Amende 1 500 € si oubli.'},
    {n:2,col:'#f59e0b',titre:'Déposer le Dividend Report IBKR dans cet onglet',desc:'Relevé annuel Tax Year N-1 → ibkr.com → Rapports → Relevés fiscaux. Cases calculées automatiquement.'},
    {n:3,col:'#7c6dff',titre:'Remplir le formulaire 2047 en premier',desc:'Ligne USA (taux 17,7 %) + Ligne Irlande (taux 15 %). Copier les valeurs affichées ci-dessus.'},
    {n:4,col:'#22d47a',titre:'Remplir la 2042',desc:'Copier : 2DC · 2CG · 2TS · 8VL (PAS 2AB) · 3VG si ventes. Vérifier que Return of Capital REITs n\'est PAS inclus.'},
  ];
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:18px">🔄</span><div style="font-size:14px;font-weight:700">Procédure chaque année</div></div>'
    +'<div style="background:var(--surface);border-radius:14px;overflow:hidden;margin-bottom:14px">';
  for(var j=0;j<steps.length;j++){var s=steps[j];html+='<div style="display:flex;gap:12px;padding:13px 14px;border-bottom:1px solid var(--border)"><div style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:'+s.col+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">'+s.n+'</div><div><div style="font-size:12.5px;font-weight:700;margin-bottom:3px">'+s.titre+'</div><div style="font-size:10.5px;color:var(--muted);line-height:1.6">'+s.desc+'</div></div></div>';}
  html+='</div>';
  /* Note source */
  html+='<div style="background:rgba(124,109,255,.05);border:1px solid rgba(124,109,255,.12);border-radius:10px;padding:11px 13px;font-size:10px;color:var(--muted);line-height:1.7">'
    +'<strong style="color:var(--violet)">Source</strong> : Tax Year '+TAX.annee+' · IBKR Ireland'+(TAX.compte?' · '+TAX.compte:'')
    +' · Convention France-USA art. 10 · Convention France-Irlande (BOFiP) · Notice 2047-NOT.'
    +'</div>';
  el.innerHTML=html;
}

/* ════════════════════════════════════════════════════════════════
   MODULE: UI.Import — Import CSV interface
   ════════════════════════════════════════════════════════════════ */
let _importResult = null;

function renderImport(el) {
  const imported = Storage.load();
  const manual   = Storage.loadManual();
  const totalTx  = imported.length + manual.length;

  let html = '<div style="margin-bottom:18px"><div class="section-title">&#128229; Import &amp; Saisie</div><div style="font-size:11px;color:var(--muted)">IBKR &bull; Trade Republic &bull; Degiro &bull; Saisie manuelle</div></div>';

  /* ── Résumé transactions actives ── */
  if (totalTx > 0) {
    html += `<div style="background:rgba(34,212,122,.08);border:1px solid rgba(34,212,122,.2);border-radius:10px;padding:11px 14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><div style="font-size:12px;font-weight:700;color:#22d47a">${totalTx} transaction(s) active(s)</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">Intégrées dans le portfolio</div></div>
        <button onclick="clearAll()" style="font-size:10px;color:#f43f5e;font-weight:700;padding:5px 10px;border:1px solid rgba(244,63,94,.3);border-radius:7px;background:rgba(244,63,94,.07);cursor:pointer">Effacer tout</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${imported.length ? `<span style="font-size:10px;background:rgba(124,109,255,.1);color:#7c6dff;padding:3px 8px;border-radius:6px;font-weight:600">CSV: ${imported.length}</span>` : ''}
        ${manual.length   ? `<span style="font-size:10px;background:rgba(0,200,160,.1);color:#00c8a0;padding:3px 8px;border-radius:6px;font-weight:600">Manuel: ${manual.length}</span>` : ''}
      </div>
    </div>`;
  }

  /* ── Tabs Import / Manuel / Fondamentaux ── */
  html += `<div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px">
    <button id="imp-tab-csv"    onclick="switchImportTab('csv')"    style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--violet);border-bottom:2px solid var(--violet);cursor:pointer">CSV Import</button>
    <button id="imp-tab-manual" onclick="switchImportTab('manual')" style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer">✏️ Manuel</button>
    <button id="imp-tab-funds"  onclick="switchImportTab('funds')"  style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer">📊 Fondamentaux</button>
  </div>`;

  /* ── Zone CSV ── */
  html += `<div id="imp-zone-csv">
    <div id="imp-drop" onclick="document.getElementById('imp-file').click()" style="border:2px dashed rgba(124,109,255,.35);border-radius:14px;padding:32px 16px;text-align:center;cursor:pointer;background:rgba(124,109,255,.04);margin-bottom:16px;transition:border-color .2s" ondragover="event.preventDefault();this.style.borderColor='var(--violet)'" ondragleave="this.style.borderColor='rgba(124,109,255,.35)'" ondrop="handleDrop(event)">
      <div style="font-size:28px;margin-bottom:8px">&#128229;</div>
      <div style="font-weight:700;font-size:14px;margin-bottom:4px">Glisser un fichier CSV ici</div>
      <div style="font-size:11px;color:var(--muted)">ou cliquer pour sélectionner</div>
      <div style="font-size:10px;color:var(--muted);margin-top:8px">IBKR &bull; Trade Republic &bull; Degiro</div>
    </div>
    <input type="file" id="imp-file" accept=".csv,.txt" style="display:none" onchange="handleFile(this.files[0])">
    <div id="imp-status"></div><div id="imp-preview"></div>
  </div>`;

  /* ── Zone Saisie manuelle ── */
  const today = new Date().toISOString().split('T')[0];
  html += `<div id="imp-zone-manual" style="display:none">
    <div style="background:var(--surface);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--teal)">✏️ Nouvelle transaction</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Type *</div>
          <select id="mt-type" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
            <option value="buy">▲ Achat</option>
            <option value="sell">▼ Vente</option>
            <option value="dividend">$ Dividende</option>
            <option value="withholding_tax">% Retenue fiscale</option>
          </select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Ticker *</div>
          <input id="mt-ticker" type="text" placeholder="ex: JNJ" maxlength="10" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px;text-transform:uppercase">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Quantité *</div>
          <input id="mt-qty" type="number" placeholder="0" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Prix *</div>
          <input id="mt-price" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Frais</div>
          <input id="mt-fees" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Retenue tax</div>
          <input id="mt-tax" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Devise</div>
          <select id="mt-currency" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="JPY">JPY</option>
          </select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Date *</div>
          <input id="mt-date" type="date" value="${today}" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
        </div>
      </div>

      <div id="mt-error" style="display:none;color:#f43f5e;font-size:11px;margin-bottom:10px;padding:8px 12px;background:rgba(244,63,94,.08);border-radius:8px"></div>
      <div id="mt-success" style="display:none;color:#22d47a;font-size:11px;margin-bottom:10px;padding:8px 12px;background:rgba(34,212,122,.08);border-radius:8px;text-align:center"></div>

      <button onclick="addManualTransaction()" style="width:100%;padding:13px;border-radius:12px;background:var(--teal);color:#08080f;font-weight:700;font-size:14px;cursor:pointer;border:none">
        &#10003; Ajouter la transaction
      </button>
    </div>

    <!-- Liste des transactions manuelles -->
    <div id="manual-list"></div>
  </div>`;

  /* ── Zone Fondamentaux ── */
  html += `<div id="imp-zone-funds" style="display:none">
    <div style="background:var(--surface);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:13px;font-weight:700;color:#f59e0b">📊 Fondamentaux par ticker</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Édition manuelle · Les valeurs API sont conservées entre rechargements</div>
        </div>
        <button onclick="saveFundamentalsForm()" style="font-size:11px;font-weight:700;padding:7px 14px;border-radius:9px;background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.3);cursor:pointer">💾 Sauvegarder</button>
      </div>
      <div id="funds-table"></div>
    </div>
  </div>`;

  el.innerHTML = html;

  /* Render liste manuelle si on est sur cet onglet */
  renderManualList();
  renderFundamentalsTable();
}

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
  if (rEl) renderRendement(rEl);
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
  reader.onload = e => { _importResult = BrokerImport.process(e.target.result); renderImportStatus(_importResult); renderImportPreview(_importResult); };
  reader.onerror = () => { st.innerHTML = '<div style="color:#f43f5e;font-size:12px;padding:8px 0">Erreur de lecture fichier.</div>'; };
  reader.readAsText(file, 'UTF-8');
}

function renderImportStatus(res) {
  const el = document.getElementById('imp-status');
  if (!el) return;
  if (res.error) { el.innerHTML = `<div style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);border-radius:10px;padding:12px;margin-bottom:12px;color:#f43f5e;font-size:12px">&#10060; ${res.error}</div>`; return; }
  const bColor = {IBKR:'#7c6dff', TradeRepublic:'#00c8a0', Degiro:'#38bdf8', Unknown:'#f5a623'};
  const col = bColor[res.broker] || '#f5a623';
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><span style="background:rgba(124,109,255,.1);color:${col};border:1px solid ${col}33;padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.broker}</span><span style="background:rgba(34,212,122,.08);color:#22d47a;border:1px solid rgba(34,212,122,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.ok.length} valides</span>${res.dupes?`<span style="background:rgba(245,166,35,.08);color:#f5a623;border:1px solid rgba(245,166,35,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.dupes} doublons ignorés</span>`:''}${res.skipped.length?`<span style="background:rgba(244,63,94,.08);color:#f43f5e;border:1px solid rgba(244,63,94,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.skipped.length} ignorées</span>`:''}</div>`;
}

function renderImportPreview(res) {
  const el = document.getElementById('imp-preview');
  if (!el || !res?.ok) return;
  if (!res.ok.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;text-align:center">Aucune transaction valide détectée.</div>'; return; }
  const typeColor = {buy:'#22d47a',sell:'#f43f5e',dividend:'#7c6dff',withholding_tax:'#f5a623',stock_split:'#38bdf8'};
  const typeIcon  = {buy:'▲',sell:'▼',dividend:'$',withholding_tax:'%',stock_split:'⇌'};
  let html = `<div style="font-size:13px;font-weight:700;margin-bottom:10px">Aperçu — ${res.ok.length} transaction(s)</div>`;
  html += '<div class="twrap" style="margin-bottom:14px"><table><thead><tr><th>TYPE</th><th>TICKER</th><th>DATE</th><th>QTÉ</th><th>PRIX</th><th>FRAIS</th><th>TAX</th><th>DEVISE</th></tr></thead><tbody>';
  for (const t of res.ok) {
    const tc = typeColor[t.type]||'#8888aa', ti = typeIcon[t.type]||'?';
    html += `<tr><td><span style="color:${tc};font-weight:700;font-size:11px">${ti} ${t.type}</span></td><td style="font-weight:700;font-size:12px">${t.ticker}</td><td style="font-family:DM Mono,monospace;font-size:11px;color:var(--muted)">${t.date}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.quantity}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.price.toFixed(3)}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.fees.toFixed(2)}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.tax_withheld.toFixed(2)}</td><td style="font-size:11px">${t.currency}</td></tr>`;
  }
  html += '</tbody></table></div>';
  if (res.skipped.length) { html += `<details style="margin-bottom:14px"><summary style="font-size:11px;color:var(--muted);cursor:pointer">${res.skipped.length} ligne(s) ignorée(s)</summary><div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">${res.skipped.map(s=>`<div style="font-size:10px;color:var(--muted);padding:4px 8px;background:var(--surface2);border-radius:6px">Ligne ${s.row} — ${s.reason}</div>`).join('')}</div></details>`; }
  html += `<div style="display:flex;gap:10px"><button onclick="validateImport()" style="flex:1;padding:13px;border-radius:12px;background:var(--violet);color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none">&#10003; Valider & Sauvegarder (${res.ok.length})</button><button onclick="cancelImport()" style="padding:13px 16px;border-radius:12px;background:var(--surface2);color:var(--muted);font-weight:700;font-size:13px;cursor:pointer;border:none">&#10005;</button></div>`;
  el.innerHTML = html;
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
    _rendered['import'] = 1; renderImport(el);
    const st = document.getElementById('imp-status');
    if (st) st.innerHTML = '<div style="background:rgba(34,212,122,.1);border:1px solid rgba(34,212,122,.3);border-radius:10px;padding:14px;margin-bottom:14px;text-align:center"><div style="font-size:18px;margin-bottom:4px">&#10003;</div><div style="font-weight:700;color:#22d47a;font-size:14px">Import réussi !</div><div style="font-size:11px;color:var(--muted);margin-top:4px">Récupération fondamentaux en cours…</div></div>';
  }
  // Récupérer les fondamentaux pour tous les tickers importés
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
  if (el) { _rendered['import'] = 1; renderImport(el); }
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
  if (el) { _rendered['import'] = 1; renderImport(el); }
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

    /* Init tabs */
    const allTabs = document.querySelectorAll('.tab');
    allTabs.forEach((tab, idx) => tab.addEventListener('click', () => goTo(idx)));

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
  renderSecteurs, renderDividendes,
  syncIBKR,
  authLogin, authLogout, authLoginEmail, loginTabSwitch, loginToggleMode,
  openProfileModal, closeProfileModal, saveProfile, deleteAccount,
  openFABSheet, closeFABSheet, submitFABTx, fabTickerInput, fabSelectTicker,
  showDSESheet, closeDSESheet,
  toggleRndCard,
  goTo,
  handleFile, cancelImport, validateImport, switchImportTab,
  addManualTransaction, deleteManualTx, deleteByTicker, clearManualTransactions, clearAll,
  saveFundamentalsForm,
  _renderImpotUpload, _renderImpotManual, _handleImpotFile, _impotManualSave,
});
