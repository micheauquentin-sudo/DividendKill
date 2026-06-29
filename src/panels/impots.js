import { _emptyState } from '../ui-shared.js';

const IMPOT_STORE_KEY = 'astra_tax_data';

export function renderImpots(el) {
  if (raw.length === 0) {
    el.innerHTML = _emptyState('⚖️', 'Aucune donnée fiscale', 'Les données fiscales s\'affichent une fois des transactions importées.');
    return;
  }
  let taxData = null;
  try { const s = localStorage.getItem(IMPOT_STORE_KEY); if (s) taxData = JSON.parse(s); } catch(e) {}
  if (!taxData) { _renderImpotUpload(el); } else { _renderImpotFilled(el, taxData); }
}

export function _renderImpotUpload(el) {
  el.innerHTML =
    '<div class="section-title">Déclaration fiscale</div>'
    + '<div id="imp-drop" onclick="document.getElementById(\'imp-file-input\').click()" '
    + 'ondragover="event.preventDefault();this.style.borderColor=\'#7c6dff\'" '
    + 'ondragleave="this.style.borderColor=\'\'" '
    + 'ondrop="event.preventDefault();this.style.borderColor=\'\';_handleImpotFile(event.dataTransfer.files[0])" '
    + 'style="border:2px dashed var(--border);border-radius:16px;padding:36px 20px;text-align:center;margin-bottom:16px;cursor:pointer;transition:border-color .2s">'
    + '<div style="font-size:44px;margin-bottom:12px">📄</div>'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:6px">Déposez votre relevé ici</div>'
    + '<div style="font-size:11px;color:var(--muted);line-height:1.7">Relevé annuel IBKR Ireland · IFU · Dividend Report Tax Year N‑1<br>Formats acceptés : CSV · PDF · TXT</div>'
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
    + '✏️  Saisie manuelle des montants</button></div>';
}

function _impotStep(n, col, titre, desc) {
  return '<div style="display:flex;gap:10px;align-items:flex-start">'
    + '<div style="flex-shrink:0;width:24px;height:24px;border-radius:7px;background:'+col+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">'+n+'</div>'
    + '<div style="font-size:11px;color:var(--muted2);line-height:1.55"><strong style="color:var(--text)">'+titre+'</strong><br>'+desc+'</div>'
    + '</div>';
}

export function _handleImpotFile(file) {
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

export function _renderImpotManual(el, errorMsg) {
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

export function _impotManualSave() {
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
  function eur(v,dec){dec=dec==null?2:dec;return v.toLocaleString('fr-FR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+' €';}
  function row(cas,titre,valeur,col,desc){
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--surface2);border-radius:10px;margin-bottom:6px">'
      +'<div style="min-width:44px;text-align:center;flex-shrink:0"><div style="font-family:DM Mono,monospace;font-size:15px;font-weight:700;color:var(--violet)">'+cas+'</div></div>'
      +'<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700;margin-bottom:2px">'+titre+'</div>'+(desc?'<div style="font-size:10px;color:var(--muted);line-height:1.5">'+desc+'</div>':'')+'</div>'
      +'<div style="flex-shrink:0;font-family:DM Mono,monospace;font-size:14px;font-weight:700;color:'+(col||'var(--text)')+';text-align:right;min-width:80px">'+valeur+'</div></div>';
  }
  var html='';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<div style="background:rgba(34,212,122,.15);border:1px solid rgba(34,212,122,.3);border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;color:#22d47a">✓ Tax Year '+TAX.annee+'</div>'
    +(TAX.compte?'<div style="font-size:10px;color:var(--muted)">IBKR Ireland · '+TAX.compte+'</div>':'')
    +'</div>'
    +'<button onclick="localStorage.removeItem(\''+IMPOT_STORE_KEY+'\');_renderImpotUpload(document.getElementById(\'panel-impots\'))" '
    +'style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">✕ Effacer</button></div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total div. bruts</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace">'+eur(total_brut,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">US + Irlande</div></div>'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px;border:1px solid rgba(34,212,122,.2)"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Crédit impôt (8VL)</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#22d47a">-'+eur(credit_8vl,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">US '+eur(rts_us_eur,0)+' + IE '+eur(credit_ie,0)+'</div></div>'
    +'<div style="background:var(--surface);border-radius:12px;padding:12px 10px"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Net à payer France</div><div style="font-size:18px;font-weight:700;font-family:DM Mono,monospace;color:#f5a623">'+eur(net_france,0)+'</div><div style="font-size:9px;color:var(--muted);margin-top:2px">PFU 30% après crédit</div></div>'
    +'</div>';
  html+='<div style="display:flex;flex-direction:column;gap:7px;margin-bottom:20px">';
  if(roc_eur>0) html+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:11px 13px"><div style="font-size:11.5px;line-height:1.55">⚠ <strong style="color:#f59e0b">Return of Capital '+eur(roc_eur,0)+'</strong> (REITs) — non imposable, réduit ton PRU.</div></div>';
  if(perte_ie>0.01) html+='<div style="background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.18);border-radius:10px;padding:11px 13px"><div style="font-size:11.5px;line-height:1.55">⚠ <strong style="color:#f43f5e">'+eur(perte_ie)+' perdus</strong> (DWT irlandaise 25% sur '+ieTickers+' — crédit plafonné 15%). Dépose le formulaire <strong>2VA</strong> auprès d\'IBKR Ireland.</div></div>';
  html+='</div>';
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid #f43f5e;padding:14px;margin-bottom:12px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
    +'<div style="display:flex;gap:8px;align-items:center"><span style="background:#f43f5e;color:#fff;font-size:9px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.5px">OBLIGATOIRE</span>'
    +'<div style="font-size:15px;font-weight:700">Formulaire 3916-bis</div></div>'
    +'<div style="text-align:right;font-size:10px;color:#f59e0b;font-weight:600;line-height:1.4">À faire 1×/an<br>Amende 1 500 €</div></div>'
    +'<div style="font-size:12px;line-height:1.7;color:var(--muted2)">Sur <strong style="color:var(--text)">impots.gouv.fr</strong> → Ma déclaration → Comptes à l\'étranger'
    +'<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">'
    +'<span>• Établissement : <strong style="color:var(--text)">'+TAX.etablissement+'</strong></span>'
    +'<span>• Pays : <strong style="color:var(--text)">'+TAX.pays_compte+'</strong></span>'
    +(TAX.compte?'<span>• N° compte : <strong style="color:var(--text);font-family:DM Mono,monospace">'+TAX.compte+'</strong></span>':'')
    +'</div></div></div>';
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid #f59e0b;padding:14px;margin-bottom:12px">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:12px">Formulaire 2047 — À remplir AVANT la 2042</div>'
    +'<div style="background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.15);border-radius:10px;padding:11px;margin-bottom:8px">'
    +'<div style="font-size:11px;font-weight:700;color:#22c55e;margin-bottom:8px">🇺🇸 Ligne 1 — Pays : États-Unis</div>'
    +row('201','Pays','États-Unis','#22c55e',null)
    +row('203','Montant net encaissé',(TAX.div_us_usd-TAX.rts_us_usd).toFixed(2)+' $ → € au taux BCE','#22c55e','Convertir au taux du jour de chaque versement')
    +row('204','Taux crédit d\'impôt','17,7 %','#22c55e','Convention France-USA art. 10')
    +row('206','Impôt payé aux USA',eur(rts_us_eur),'#22c55e',null)
    +row('207','Crédit d\'impôt retenu',eur(rts_us_eur),'#22c55e',null)
    +row('208','Revenu crédit inclus',eur(div_us_eur),'#22c55e',null)
    +'</div>'
    +(div_ie_eur>0?'<div style="background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);border-radius:10px;padding:11px">'
    +'<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:8px">🇮🇪 Ligne 2 — Pays : Irlande ('+ieTickers+')</div>'
    +row('201','Pays','Irlande','#f59e0b',null)
    +row('203','Montant net encaissé',(TAX.div_ie_usd-TAX.rts_ie_usd).toFixed(2)+' $ → € au taux BCE','#f59e0b','Convertir au taux du jour de chaque versement')
    +row('204','Taux','15 %','#f59e0b','Convention France-Irlande (≠ USA)')
    +row('206','DWT prélevée par IBKR',eur(rts_ie_eur),'#f59e0b',null)
    +row('207','Crédit récupérable',eur(credit_ie),'#f59e0b','Plafonné à 15%')
    +'</div>':'')
    +'</div>';
  var cases2042=[
    {cas:'2DC',titre:'Dividendes bruts actions US',val:eur(div_us_eur),col:'#22d47a',desc:(usTickers||'actions US du portefeuille')+' — Source : «Total Ordinary Dividends»'},
    {cas:'2CG',titre:'Revenus soumis aux prélèvements sociaux (PFU)',val:eur(div_us_eur),col:'#22d47a',desc:'Identique à 2DC. Option barème progressif → 2BH à la place'},
    ...(div_ie_eur>0?[{cas:'2TS',titre:'Dividendes source irlandaise ('+ieTickers+')',val:eur(div_ie_eur),col:'#f59e0b',desc:'Pas d\'abattement 40 %. Source : «Total non-US Ordinary Dividends»'}]:[]),
    {cas:'3VG',titre:'Plus-values de cession',val:'À vérifier',col:'#6b7280',desc:'Vérifier «Realized Gains & Losses» IBKR → reporter si gain. Perte → case 3VH'},
    {cas:'8VL',titre:'Crédit d\'impôt étranger (report depuis 2047)',val:eur(credit_8vl),col:'#22d47a',desc:'= '+eur(rts_us_eur)+' US'+(credit_ie>0?' + '+eur(credit_ie)+' IE':'')+'. ⚠ Case 8VL uniquement — 2AB réservée aux courtiers français'},
  ];
  html+='<div style="background:var(--surface);border-radius:14px;border-left:4px solid var(--violet);padding:14px;margin-bottom:12px">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:12px">Formulaire 2042 — Déclaration principale</div>'
    +'<div style="display:flex;flex-direction:column;gap:6px">';
  for(var i=0;i<cases2042.length;i++){var c=cases2042[i];html+=row(c.cas,c.titre,c.val,c.col,c.desc);}
  html+='</div></div>';
  var steps=[
    {n:1,col:'#ef4444',titre:'Déclarer le compte IBKR (3916-bis)',desc:'Sur impots.gouv.fr dès l\'ouverture de la campagne. Obligatoire même sans gain. Amende 1 500 € si oubli.'},
    {n:2,col:'#f59e0b',titre:'Déposer le Dividend Report IBKR dans cet onglet',desc:'Relevé annuel Tax Year N-1 → ibkr.com → Rapports → Relevés fiscaux. Cases calculées automatiquement.'},
    {n:3,col:'#7c6dff',titre:'Remplir le formulaire 2047 en premier',desc:'Ligne USA (taux 17,7 %) + Ligne Irlande (taux 15 %). Copier les valeurs affichées ci-dessus.'},
    {n:4,col:'#22d47a',titre:'Remplir la 2042',desc:'Copier : 2DC · 2CG · 2TS · 8VL (PAS 2AB) · 3VG si ventes. Vérifier que Return of Capital REITs n\'est PAS inclus.'},
  ];
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:18px">🔄</span><div style="font-size:14px;font-weight:700">Procédure chaque année</div></div>'
    +'<div style="background:var(--surface);border-radius:14px;overflow:hidden;margin-bottom:14px">';
  for(var j=0;j<steps.length;j++){var s=steps[j];html+='<div style="display:flex;gap:12px;padding:13px 14px;border-bottom:1px solid var(--border)"><div style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:'+s.col+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">'+s.n+'</div><div><div style="font-size:12.5px;font-weight:700;margin-bottom:3px">'+s.titre+'</div><div style="font-size:10.5px;color:var(--muted);line-height:1.6">'+s.desc+'</div></div></div>';}
  html+='</div>';
  html+='<div style="background:rgba(124,109,255,.05);border:1px solid rgba(124,109,255,.12);border-radius:10px;padding:11px 13px;font-size:10px;color:var(--muted);line-height:1.7">'
    +'<strong style="color:var(--violet)">Source</strong> : Tax Year '+TAX.annee+' · IBKR Ireland'+(TAX.compte?' · '+TAX.compte:'')
    +' · Convention France-USA art. 10 · Convention France-Irlande (BOFiP) · Notice 2047-NOT.'
    +'</div>';
  el.innerHTML=html;
}
