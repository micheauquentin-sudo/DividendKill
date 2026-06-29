import { _emptyState, _logo, _esc } from '../ui-shared.js';
import { getMV, toE, eu } from '../calc.js';
import { assets, meta } from '../data.js';
import { calculateDividendSafety, dseColor } from '../dividendSafety.js';

export function renderValorisation(el) {
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

export function renderNews(el) {
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

