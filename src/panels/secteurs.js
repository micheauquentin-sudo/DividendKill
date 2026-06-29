import { _emptyState, _logo, _esc } from '../ui-shared.js';
import { getMV, toE, eu } from '../calc.js';
import { meta } from '../data.js';
import { getDivBadge } from '../dividendTiers.js';

export function renderSecteurs(el) {
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

window.renderSecteurs = renderSecteurs;
