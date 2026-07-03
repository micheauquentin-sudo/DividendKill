import { _emptyState, buildSVG } from '../ui-shared.js';
import { getDivA, getMV, getCost, toE, eu } from '../calc.js';
import { Data } from '../data.js';

export function renderDividendes(el) {
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

  /* -- si mode simulation/historique, déléguer ------------- */
  if (el._divMode === 'simulation') {
    renderSimulation(el);
    return;
  }
  if (el._divMode === 'history') {
    renderHistory(el);
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
      +'<button id="btnModeHistory" onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'history\';renderDividendes(p);}})()" '
      +'style="padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;cursor:pointer;border:none;min-height:44px;'
      +(el._divMode==='history'?'background:var(--violet);color:#fff;':'background:transparent;color:var(--muted);')
      +'">📊 Historique</button>'
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
export function renderSimulation(el) {
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
      +'<button onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'history\';renderDividendes(p);}})()" '
      +'style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);">📊 Historique</button>'
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

/* ── Historique réel des dividendes perçus (depuis les transactions) ── */
export function renderHistory(el) {
  /* Mode switcher (réutilisé identique aux 2 autres vues) */
  function modeSwitcher() {
    return '<div style="display:flex;gap:0;background:var(--surface);border-radius:10px;padding:3px;margin-bottom:14px;width:fit-content">'
      + '<button onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'snowball\';renderDividendes(p);}})()" '
      + 'style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);">📈 Snowball</button>'
      + '<button onclick="(function(){var p=document.getElementById(\'panel-dividendes\');if(p){p._divMode=\'simulation\';renderDividendes(p);}})()" '
      + 'style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);">🧮 Simulation</button>'
      + '<button style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:var(--violet);color:#fff;">📊 Historique</button>'
      + '</div>';
  }

  /* Agrège les transactions dividend réellement perçues, par année (USD, comme tx.price) */
  function yearlyDividends() {
    var byYear = {};
    var txs = Data.transactions || [];
    for (var i = 0; i < txs.length; i++) {
      var tx = txs[i];
      if (tx.type !== 'dividend' || !tx.date) continue;
      var yr = tx.date.slice(0, 4);
      if (!byYear[yr]) byYear[yr] = { gross: 0, tax: 0, byTicker: {} };
      var amt = tx.quantity * tx.price;
      byYear[yr].gross += amt;
      byYear[yr].tax   += (tx.tax_withheld || 0);
      byYear[yr].byTicker[tx.ticker] = (byYear[yr].byTicker[tx.ticker] || 0) + amt;
    }
    var years = Object.keys(byYear).sort();
    return years.map(function(y) {
      var yd = byYear[y];
      var top = Object.keys(yd.byTicker).map(function(t){ return [t, yd.byTicker[t]]; })
        .sort(function(a,b){ return b[1]-a[1]; }).slice(0, 3);
      return { year: y, gross: yd.gross, net: yd.gross - yd.tax, tax: yd.tax, top: top };
    });
  }

  function barsSVG(rows) {
    var W = 340, H = 170, padB = 26, padT = 22;
    var vals = rows.map(function(r){ return toE(r.gross); });
    var mx = Math.max.apply(null, vals) || 1;
    var n = rows.length;
    var gap = 10;
    var barW = Math.min(50, (W - gap * (n + 1)) / n);
    var usedW = barW * n + gap * (n + 1);
    var offset = (W - usedW) / 2;
    var bars = '';
    for (var i = 0; i < n; i++) {
      var x = offset + gap + i * (barW + gap);
      var h = Math.max(3, (vals[i] / mx) * (H - padB - padT));
      var y = H - padB - h;
      var isLast = i === n - 1;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1)
        + '" rx="5" fill="' + (isLast ? '#22d47a' : '#7c6dff') + '" opacity="' + (isLast ? '1' : '0.65') + '"/>';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '" fill="#9ca3af" font-size="10" text-anchor="middle">' + rows[i].year + '</text>';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" fill="#e2e2ec" font-size="10" font-weight="700" text-anchor="middle">' + Math.round(vals[i]).toLocaleString('fr-FR') + '€</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;display:block">' + bars + '</svg>';
  }

  var rows = yearlyDividends();

  if (rows.length === 0) {
    el.innerHTML = modeSwitcher()
      + _emptyState('📊', 'Aucun historique', 'Les dividendes perçus (transactions importées ou saisies manuellement) apparaîtront ici année par année, une fois enregistrés.');
    return;
  }

  var lastYear = rows[rows.length - 1];
  var prevYear = rows.length >= 2 ? rows[rows.length - 2] : null;
  var yoy = prevYear && prevYear.gross > 0 ? (lastYear.gross - prevYear.gross) / prevYear.gross * 100 : null;
  var totalGross = rows.reduce(function(s, r){ return s + r.gross; }, 0);

  function topList(top) {
    if (!top.length) return '';
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'
      + top.map(function(t) {
        return '<span style="font-size:10px;background:var(--surface2);border-radius:20px;padding:4px 10px;color:var(--muted)">'
          + '<strong style="color:var(--text)">' + t[0] + '</strong> $' + Math.round(t[1]).toLocaleString('fr-FR') + '</span>';
      }).join('')
      + '</div>';
  }

  var html = modeSwitcher()
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<span style="font-size:22px">📊</span>'
    + '<div><div class="section-title" style="margin:0">Historique des dividendes</div>'
    + '<div class="mu" style="font-size:11px">Montants réellement perçus · ' + rows.length + ' année' + (rows.length > 1 ? 's' : '') + '</div>'
    + '</div></div>'

    + '<div class="row2" style="margin-bottom:10px">'
    + '<div class="card"><div class="mini-k-l">DERNIÈRE ANNÉE (' + lastYear.year + ')</div>'
    + '<div class="mini-k-v up" style="font-size:22px;margin:4px 0">$' + Math.round(lastYear.gross).toLocaleString('fr-FR') + '</div>'
    + '<div class="mu" style="font-size:11px">' + (yoy != null ? (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '% vs ' + prevYear.year : 'Brut perçu') + '</div></div>'
    + '<div class="card"><div class="mini-k-l">TOTAL CUMULÉ</div>'
    + '<div class="mini-k-v" style="font-size:22px;margin:4px 0;color:#86efad">$' + Math.round(totalGross).toLocaleString('fr-FR') + '</div>'
    + '<div class="mu" style="font-size:11px">Depuis ' + rows[0].year + '</div></div>'
    + '</div>'

    + '<div class="card" style="padding:14px 12px 10px;margin-bottom:10px">'
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">DIVIDENDES BRUTS PAR AN (€)</div>'
    + barsSVG(rows)
    + '</div>'

    + '<div class="twrap"><table>'
    + '<thead><tr><th>ANNÉE</th><th style="text-align:right">BRUT</th><th style="text-align:right">RETENUE</th><th style="text-align:right">NET</th></tr></thead>'
    + '<tbody>' + rows.slice().reverse().map(function(r) {
        return '<tr>'
          + '<td class="fw7 mono">' + r.year + '</td>'
          + '<td class="mono up" style="text-align:right">$' + Math.round(r.gross).toLocaleString('fr-FR') + '</td>'
          + '<td class="mono" style="text-align:right;color:var(--muted)">$' + Math.round(r.tax).toLocaleString('fr-FR') + '</td>'
          + '<td class="mono" style="text-align:right;color:#86efad">$' + Math.round(r.net).toLocaleString('fr-FR') + '</td>'
          + '</tr>'
          + '<tr><td colspan="4" style="padding-top:0">' + topList(r.top) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>';

  el.innerHTML = html;
}

window.renderDividendes = renderDividendes;
