import { _emptyState, _logo } from '../ui-shared.js';
import { getMV, getDivA, eu } from '../calc.js';
import { Data, meta } from '../data.js';
import { calculateDividendSafety, dseColor } from '../dividendSafety.js';

/* -- DEAL FINDER ------------------------------------------ */
export function calculatePriorityRanking(portfolio) {
  var secAlloc  = {'Tech':3.22,'Mat.':11.26,'Santé':18.93,'Médias':2.80,'Finance':4.05,'Conso.':27.58,'Industrie':5.53,'Immo.':5.26,'Utilities':21.03};
  var secTarget = {'Tech':10,  'Mat.':10,   'Santé':20,   'Médias':8,  'Finance':10, 'Conso.':15,   'Industrie':10, 'Immo.':8,  'Utilities':16};
  var SECTOR_FAIR_PE = {'Tech':28,'Santé':22,'Finance':14,'Utilities':18,'Conso.':20,'Industrie':18,'Mat.':16,'Immo.':18,'Énergie':12,'Médias':14};
  var totalMV   = getMV();

  var results = [];
  for (var i = 0; i < portfolio.length; i++) {
    var d = portfolio[i];
    var a = Data.assets[d.ticker] || {};
    var dseResult = calculateDividendSafety(a);
    var safetyScore = dseResult.safetyScore;
    var streak  = a.streak || 0;
    var pe_cur  = a.pe_cur || 0;
    var div     = meta[d.ticker] && meta[d.ticker].d || 0;
    var yd      = d.price > 0 ? div / d.price * 100 : 0;
    var fair_pe = SECTOR_FAIR_PE[d.sec] || 20;
    var pe_disc = pe_cur > 0 ? Math.max(0, (fair_pe - pe_cur) / fair_pe * 100) : 0;
    var cur_w   = totalMV > 0 ? d.mv / totalMV * 100 : 0;
    var sec_w   = secAlloc[d.sec]  || 10;
    var tgt_w   = secTarget[d.sec] || 10;
    var sec_gap = tgt_w - sec_w;
    // 30% Dividend Safety (DSE score)
    var s_safety = Math.min(100, safetyScore);
    // 25% Valuation — P/E discount vs sector fair P/E
    var s_val = Math.max(0, Math.min(100, pe_disc * 1.8));
    // 20% Yield Quality (yield + streak)
    var streakNorm = Math.min(streak, 60) / 60 * 100;
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
    if (pe_disc > 25 && safetyScore >= 75)    oppType = 'Décote structurelle';
    else if (sec_gap > 3 && safetyScore >= 70) oppType = 'Rééquilibrage sectoriel';
    else if (yd > 4 && streakNorm > 60)        oppType = 'Rendement long terme';
    else if (pe_disc > 15)                     oppType = 'Compression de valorisation';
    else                                       oppType = 'Classement relatif';
    // Reasons
    var reasons = [];
    if (safetyScore >= 80)  reasons.push('Safety dividende élevée (' + safetyScore + '/100)');
    if (pe_disc > 20)       reasons.push('P/E décoté vs secteur (' + pe_cur.toFixed(1) + 'x vs ' + fair_pe + 'x cible)');
    if (streak >= 25)       reasons.push('Streak dividende ' + streak + ' ans');
    if (sec_gap > 3)        reasons.push('Secteur sous-pondéré (' + sec_w.toFixed(1) + '% → cible ' + tgt_w + '%)');
    if (yd > 4)             reasons.push('Yield ' + yd.toFixed(2) + '%');
    // Risks
    var risks = [];
    if (cur_w > 12)       risks.push('Position déjà concentrée (' + cur_w.toFixed(1) + '% du portefeuille)');
    if (safetyScore < 70) risks.push('Safety dividende modérée (' + safetyScore + '/100)');
    if (pe_cur > 30)      risks.push('Valorisation élevée (P/E ' + pe_cur.toFixed(1) + 'x > 30x)');
    if (!a.payout_ratio)  risks.push('Données fondamentales incomplètes');
    if (!risks.length)    risks.push('Aucun risque structurel identifié');
    results.push({
      ticker: d.ticker, name: d.name, priorityScore: priorityScore,
      reasons: reasons, risks: risks, opportunityType: oppType,
      _yd: yd, _pe_cur: pe_cur, _pe_disc: pe_disc, _safe: safetyScore, _streak: streak,
      _s_safety: s_safety, _s_val: s_val, _s_yq: s_yq, _s_div: s_div, _s_poids: s_poids,
      _cur_w: cur_w, _sec_gap: sec_gap, _d: d
    });
  }
  results.sort(function(a, b) { return b.priorityScore - a.priorityScore; });
  return results;
}

export function renderDeal(el) {
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
          // P/E + stats
          + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">P/E actuel</div><div class="mono fw7" style="font-size:14px;color:' + (r._pe_disc > 15 ? '#22d47a' : r._pe_disc > 0 ? '#f5a623' : '#f43f5e') + '">' + (r._pe_cur > 0 ? r._pe_cur.toFixed(1) + 'x' : '—') + '</div></div>'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:9.5px;color:var(--muted)">Poids actuel</div><div class="mono fw7" style="font-size:14px">' + r._cur_w.toFixed(1) + '%</div></div>'
          + '<div style="background:var(--surface2);border-radius:8px;padding:10px;cursor:pointer" onclick="showDSESheet(\'' + r.ticker + '\')"><div style="font-size:9.5px;color:var(--muted)">Safety DSE</div><div class="mono fw7" style="font-size:14px;color:' + dseColor(calculateDividendSafety(Data.assets[r.ticker] || {}).safetyScore) + '">' + calculateDividendSafety(Data.assets[r.ticker] || {}).safetyScore + '/100</div><div style="font-size:8px;color:var(--muted)">\u2197 d\u00e9tail</div></div>'
          + '</div>'
          // Pourquoi
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
        out += '\u2460'.replace('0',String(i+1))+' <strong>'+t.ticker+'</strong> — Safety '+t._safe+'/100 · Payout '+(Data.assets[t.ticker]&&Data.assets[t.ticker].payout_ratio?Math.round(Data.assets[t.ticker].payout_ratio*100)+'%':'N/A')+' · Streak '+t._streak+' ans<br>';
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
        var f4=Data.assets[ranked[ri4].ticker]||{};
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

