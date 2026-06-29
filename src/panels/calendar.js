import { _emptyState } from '../ui-shared.js';
import { eu } from '../calc.js';
import { assets } from '../data.js';
import { getDivBadge } from '../dividendTiers.js';

/* -- CALENDRIER ------------------------------------------- */
/* ── DIVIDEND CALENDAR ENGINE ──────────────────────────────── */
export function analyzeDividendCalendar() {
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
    var months=a.pay_months||PAY_MONTHS[tk]||[];
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

export function renderCalendar(el) {
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
