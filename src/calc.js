import { Config } from './config.js';
import { Data } from './data.js';

export const Calc = (() => {

  const eu    = () => Config.EURUSD;
  const toE   = v => v / Config.EURUSD;
  const fE    = v => `${Math.round(toE(v)).toLocaleString('fr-FR')} €`;
  const fEsign = v => `${v >= 0 ? '+' : ''}${fE(v)}`;
  const fPct  = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

  const computePositions = () => {
    const pos = {};
    for (const tx of Data.transactions) {
      if (!pos[tx.ticker]) pos[tx.ticker] = { ticker: tx.ticker, shares: 0, totalCost: 0, realizedGain: 0, totalDividends: 0, totalTaxPaid: 0 };
      const p = pos[tx.ticker];
      if (tx.type === 'buy') {
        p.totalCost += tx.quantity * tx.price + tx.fees;
        p.shares    += tx.quantity;
      } else if (tx.type === 'sell') {
        const avgP = p.shares > 0 ? p.totalCost / p.shares : 0;
        p.realizedGain += tx.quantity * (tx.price - avgP) - tx.fees;
        p.totalCost    -= avgP * tx.quantity;
        p.shares       -= tx.quantity;
      } else if (tx.type === 'dividend') {
        p.totalDividends += tx.quantity * tx.price;
        // tax_withheld absent des transactions rechargées depuis D1 → NaN sans fallback
        p.totalTaxPaid   += tx.tax_withheld || 0;
      }
    }
    const result = [];
    for (const ticker in pos) {
      if (!Object.prototype.hasOwnProperty.call(pos, ticker)) continue;
      const p2 = pos[ticker];
      if (p2.shares <= 0) continue;
      const a   = Data.assets[ticker] || {};
      const avg   = p2.shares > 0 ? p2.totalCost / p2.shares : 0;
      // Fallback au PRU si le prix de marché n'est pas encore chargé → évite -100%
      const price = Data.currentPrices[ticker] || avg;
      const mv    = p2.shares * price;
      result.push({
        ticker, name: a.name || ticker, sec: a.sector || '?',
        qty: p2.shares, price, avg, mv,
        pnl: mv - p2.totalCost,
        dpnl: (Data.dailyChange[ticker] || 0) * p2.shares,
        totalCost: p2.totalCost, realizedGain: p2.realizedGain,
        totalDividends: p2.totalDividends, totalTaxPaid: p2.totalTaxPaid,
        unrealizedGain: mv - p2.totalCost,
      });
    }
    result.sort((a, b) => b.mv - a.mv);
    return result;
  };

  let raw = computePositions();

  const getMV    = () => raw.reduce((s, d) => s + d.mv, 0);
  const getCost  = () => raw.reduce((s, d) => s + d.avg * d.qty, 0);
  const getPNL   = () => raw.reduce((s, d) => s + d.pnl, 0);
  const getDivA  = () => raw.reduce((s, d) => s + (Data.assets[d.ticker]?.d || 0) * d.qty, 0);

  const recompute = () => { raw = computePositions(); };

  const getTotalDividends = () => raw.reduce((s, d) => s + (d.totalDividends || 0), 0);
  const getTotalTaxes     = () => raw.reduce((s, d) => s + (d.totalTaxPaid   || 0), 0);
  const getRealizedGains  = () => raw.reduce((s, d) => s + (d.realizedGain   || 0), 0);
  const getPositions      = () => raw; // alias lisible pour positions[]

  const safetyLabel = sc => {
    if (sc >= 90) return {txt:'Excellent', col:'#22d47a', bg:'rgba(34,212,122,.12)'};
    if (sc >= 75) return {txt:'Sûr',       col:'#86efad', bg:'rgba(134,239,173,.1)'};
    if (sc >= 60) return {txt:'OK',         col:'#f5a623', bg:'rgba(245,166,35,.1)'};
    if (sc >= 45) return {txt:'Risqué',    col:'#fb923c', bg:'rgba(251,146,60,.1)'};
    return              {txt:'Danger',    col:'#f43f5e', bg:'rgba(244,63,94,.1)'};
  };

  return { eu, toE, fE, fEsign, fPct, getMV, getCost, getPNL, getDivA,
           getTotalDividends, getTotalTaxes, getRealizedGains, getPositions,
           get raw() { return raw; }, recompute, safetyLabel, computePositions };
})();

export const toE   = Calc.toE;
export const fE    = Calc.fE;
export const fPct  = Calc.fPct;
export const eu    = Calc.eu;
export const getMV    = Calc.getMV;
export const getCost  = Calc.getCost;
export const getPNL   = Calc.getPNL;
export const getDivA  = Calc.getDivA;
export const getTotalDividends = Calc.getTotalDividends;
export const getTotalTaxes     = Calc.getTotalTaxes;
export const getRealizedGains  = Calc.getRealizedGains;
export const getPositions      = Calc.getPositions;
