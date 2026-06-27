import { Data } from './data.js';
import { Storage } from './storage.js';
import { Calc } from './calc.js';

export const BrokerImport = (() => {

  const parseCSV = text => {
    const firstLine = text.split('\n')[0] || '';
    const delim = (firstLine.match(/;/g)||[]).length > (firstLine.match(/,/g)||[]).length ? ';' : ',';
    const rows = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cols = []; let inQ = false, cur = '';
      for (const ch of trimmed) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === delim && !inQ) { cols.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      cols.push(cur.trim());
      rows.push(cols);
    }
    return rows;
  };

  const detectBroker = (text, headers) => {
    const t = text.toLowerCase(), h = (headers||[]).join(' ').toLowerCase();
    if (t.includes('interactive brokers') || t.includes('ibkr') || h.includes('conid')) return 'IBKR';
    if (t.includes('trade republic') || (h.includes('isin') && h.includes('shares') && h.includes('average price'))) return 'TradeRepublic';
    if (h.includes('isin') && (h.includes('degiro') || h.includes('nombre') || h.includes('cours'))) return 'Degiro';
    return 'Unknown';
  };

  const mapColumns = (headers, broker) => {
    const h = headers.map(x => x.toLowerCase().trim());
    const find = candidates => {
      for (const c of candidates) for (let j=0; j<h.length; j++) if (h[j].includes(c)) return j;
      return -1;
    };
    const maps = {
      IBKR:          {type:find(['type','transaction type','activity type']),ticker:find(['symbol','ticker']),date:find(['date','trade date','settlement date']),quantity:find(['quantity','qty','shares']),price:find(['price','t. price','trprice']),fees:find(['commission','fee','frais']),currency:find(['currency','ccy']),tax:find(['withholding','tax','retenue'])},
      TradeRepublic:  {type:find(['type','transaction type']),ticker:find(['symbol','isin','ticker']),date:find(['date','booking date','value date']),quantity:find(['shares','quantity','nombre']),price:find(['average price','price','cours']),fees:find(['fee','commission','frais']),currency:find(['currency','devise']),tax:find(['tax','impot','retenue','withholding'])},
      Degiro:         {type:find(['type','order type']),ticker:find(['product','isin','symbole']),date:find(['date','datum']),quantity:find(['quantity','nombre','qty']),price:find(['price','cours','koers']),fees:find(['frais','fee','couts']),currency:find(['currency','devise','valuta']),tax:find(['tax','impot','retenue'])},
    };
    return maps[broker] || {type:find(['type','transaction type','activity']),ticker:find(['symbol','ticker','isin','product']),date:find(['date','trade date']),quantity:find(['quantity','qty','shares','nombre']),price:find(['price','cours']),fees:find(['fee','commission','frais']),currency:find(['currency','devise']),tax:find(['withholding','tax','retenue'])};
  };

  const normalizeType = raw => {
    if (!raw) return null;
    const r = raw.toLowerCase().trim();
    if (r.includes('buy') || r.includes('achat') || r === 'b') return 'buy';
    if (r.includes('sell') || r.includes('vente') || r === 's') return 'sell';
    if (r.includes('dividend') || r.includes('dividende') || r.includes('div')) return 'dividend';
    if (r.includes('withholding') || r.includes('retenue') || r.includes('tax')) return 'withholding_tax';
    if (r.includes('split') || r.includes('fractionnement')) return 'stock_split';
    return null;
  };

  const normalizeDate = raw => {
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
    const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (m) return `${m[3]}-${('0'+m[2]).slice(-2)}-${('0'+m[1]).slice(-2)}`;
    const m2 = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m2 && parseInt(m2[1]) <= 12) return `${m2[3].length===2?'20':''}${m2[3]}-${('0'+m2[1]).slice(-2)}-${('0'+m2[2]).slice(-2)}`;
    return null;
  };

  const isDuplicate = tx => {
    const all = Data.transactions.concat(Storage.load());
    return all.some(t => t.ticker === tx.ticker && t.date === tx.date && Math.abs((t.price * t.quantity) - (tx.price * tx.quantity)) < 0.001);
  };

  const normalizeTransaction = (row, map, broker, autoId) => {
    const col = idx => (idx > -1 && row[idx] !== undefined) ? row[idx].replace(/,/g, '.') : '';
    const num = idx => { const v = parseFloat(col(idx)); return isNaN(v) ? 0 : v; };
    const type = normalizeType(col(map.type));
    const ticker = col(map.ticker).toUpperCase().replace(/[^A-Z0-9\.]/g, '');
    const date = normalizeDate(col(map.date));
    const quantity = Math.abs(num(map.quantity));
    const price = Math.abs(num(map.price));
    if (!ticker || !type || !date || quantity === 0) return null;
    return { id: `imp_${autoId}`, ticker, type, quantity, price, fees: Math.abs(num(map.fees)), currency: (col(map.currency) || 'USD').toUpperCase().substring(0,3), tax_withheld: Math.abs(num(map.tax)), date, _imported: true, _broker: broker };
  };

  const process = text => {
    const rows = parseCSV(text);
    if (rows.length < 2) return { ok:[], skipped:[], broker:'Unknown', error:'Fichier vide ou format non reconnu' };
    const headers = rows[0];
    const broker = detectBroker(text, headers);
    const map = mapColumns(headers, broker);
    const ok = [], skipped = []; let dupes = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length < 3) continue;
      const tx = normalizeTransaction(rows[i], map, broker, `${Date.now()}_${i}`);
      if (!tx) { skipped.push({row: i+1, reason: 'Ligne ignorée (type/ticker/date manquant)'}); continue; }
      if (isDuplicate(tx)) { dupes++; continue; }
      ok.push(tx);
    }
    return { ok, skipped, dupes, broker, map, headers };
  };

  const applyToPortfolio = () => {
    const imported = Storage.load();
    const manual   = Storage.loadManual();
    Data.transactions = Data.transactions.filter(t => !t._imported && !t._manual);
    for (const tx of imported) Data.transactions.push(tx);
    for (const tx of manual)   Data.transactions.push(tx);
    Calc.recompute();
  };

  return { process, isDuplicate, applyToPortfolio };
})();

export const processCsv           = BrokerImport.process;
export const applyImportedToPortfolio = BrokerImport.applyToPortfolio;
