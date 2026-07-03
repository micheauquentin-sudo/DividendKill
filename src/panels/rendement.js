import { meta } from '../data.js';
import { toE, getMV } from '../calc.js';
import { getDisplayDSE } from '../dividendSafety.js';
import { _emptyState, _logo } from '../ui-shared.js';
import { getDivBadge } from '../dividendTiers.js';

export function renderRendement(el) {
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
    {k:'pnl',   lbl:'P&L €'},
    {k:'mv',    lbl:'Valeur'},
    {k:'cost',  lbl:'Investi'},
    {k:'yd',    lbl:'Yield'},
    {k:'yoc',   lbl:'YoC'},
    {k:'ticker',lbl:'A→Z'},
  ];
  var toggleHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">'
    + '<span style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">Trier par</span>';
  for (var oi = 0; oi < sortOpts.length; oi++) {
    var opt = sortOpts[oi];
    var on = sk === opt.k;
    var arrow = on ? (sd === 'asc' ? ' ↑' : ' ↓') : '';
    toggleHtml += '<button data-sk="'+opt.k+'" style="padding:5px 11px;border-radius:16px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid '+(on?'var(--violet)':'var(--border)')+';background:'+(on?'rgba(124,109,255,.15)':'transparent')+';color:'+(on?'var(--violet)':'var(--muted)')+'">'+opt.lbl+arrow+'</button>';
  }
  toggleHtml += '</div>';
  var totalPnl = 0, totalCost = 0, totalMV2 = 0;
  for (var ki=0;ki<data.length;ki++){totalPnl+=data[ki].pnl;totalCost+=data[ki].cost;totalMV2+=data[ki].mv;}
  var totalPp = totalCost > 0 ? totalPnl/totalCost*100 : 0;
  var summaryHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Investi</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace">'+Math.round(toE(totalCost)).toLocaleString('fr-FR')+'€</div>'
    +'</div>'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Valeur</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace">'+Math.round(toE(totalMV2)).toLocaleString('fr-FR')+'€</div>'
    +'</div>'
    +'<div style="background:var(--surface);border-radius:10px;padding:10px 8px;text-align:center">'
    +'<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">P&L total</div>'
    +'<div style="font-size:14px;font-weight:700;font-family:DM Mono,monospace;color:'+(totalPnl>=0?'#22d47a':'#f43f5e')+'">'+(totalPnl>=0?'+':'')+Math.round(toE(totalPnl)).toLocaleString('fr-FR')+'€</div>'
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
    var rndDseDisp = getDisplayDSE(rndMeta);
    var rndDseScore = rndDseDisp.score;
    var rndDseCol = rndDseDisp.color;
    var dpnlDay = d.dpnl ? ((d.dpnl>=0?'+':'')+Math.round(toE(d.dpnl))+'€ auj.') : '';
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
      +'<div style="font-size:10px;color:'+pnlC+';font-family:DM Mono,monospace">'+(d.pnl>=0?'+':'')+Math.round(toE(d.pnl))+'€</div>'
      +'</div>'
      +'<span class="rnd-arrow" id="ra-'+d.ticker+'">▾</span>'
      +'</div>'
      +'</div>'
      +'<div class="rnd-body" id="rb-'+d.ticker+'">'
      +'<div class="rnd-body-inner">'
      +'<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:8px">'
      +'<div style="cursor:pointer;background:rgba(0,0,0,.2);border:1px solid '+rndDseCol+';border-radius:8px;padding:5px 8px;text-align:center;min-width:44px;flex-shrink:0" onclick="event.stopPropagation();showDSESheet(\''+d.ticker+'\')">'
      +'<div style="font-size:11px;font-weight:700;color:'+rndDseCol+'">'+rndDseScore+'</div>'
      +'<div style="font-size:7.5px;color:'+rndDseCol+'">DSE</div>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;flex:1">'
      +'<div><div style="font-size:8.5px;color:var(--muted)">PRU</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+d.avg.toFixed(2)+'$</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Cours</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+d.price.toFixed(2)+'$</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Investi</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600">'+Math.round(toE(d.cost))+'€</div></div>'
      +'<div><div style="font-size:8.5px;color:var(--muted)">Poids</div><div style="font-size:12px;font-family:DM Mono,monospace;font-weight:600;color:'+(w>12?'#f43f5e':w>8?'#f5a623':'var(--text)')+'">'+w.toFixed(1)+'%</div></div>'
      +'</div>'
      +'</div>'
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
          +'<div><span style="font-size:9px;color:var(--muted)">Qté </span><span style="font-size:11px;font-weight:700">'+d.qty+'</span></div>'
          +(dpnlDay?'<div style="margin-left:auto"><span style="font-size:9px;color:var(--muted)">Auj. </span><span style="font-size:11px;font-weight:700;color:'+(d.dpnl>=0?'#22d47a':'#f43f5e')+'">'+dpnlDay+'</span></div>':'')
          +'</div>'
          +'</div>'
        : (dpnlDay?'<div style="padding-top:6px;border-top:1px solid rgba(255,255,255,.05);font-size:10px;color:var(--muted)">Auj. <span style="font-weight:700;color:'+(d.dpnl>=0?'#22d47a':'#f43f5e')+'">'+dpnlDay+'</span></div>':''))
      +'<div id="rnd-chart-'+d.ticker+'" style="margin-top:10px;height:110px;border-radius:9px;overflow:hidden;background:rgba(0,0,0,.2);border:1px solid var(--border)"></div>'
      +'<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.05)">'
      +'<button onclick="event.stopPropagation();deleteByTicker(\''+d.ticker+'\')" style="width:100%;padding:8px;border-radius:9px;background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);color:#f43f5e;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🗑 Retirer '+d.ticker+' du portefeuille</button>'
      +'</div>'
      +'</div>'
      +'</div>'
      +'</div>';
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
        renderRendement(el);
      });
    })(btns[j]);
  }
}
