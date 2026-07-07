import { MarketData } from './marketData.js';

export const Data = (() => {

  /* ── Fallback prices (statiques — utilisés si pas de données marché en cache) ── */
  const _fallbackPrices = {}; // Prices viennent de Twelvedata via MarketData

  const _fallbackChange = {}; // Variations viennent de Twelvedata

  /* ── Proxy dynamique : lit MarketData si dispo, sinon fallback statique ── */
  const currentPrices = new Proxy(_fallbackPrices, {
    get(target, ticker) {
      if (typeof ticker !== 'string') return target[ticker];
      const live = MarketData.getCachedPrice(ticker);
      return live !== null ? live : (target[ticker] || 0);
    }
  });

  const dailyChange = new Proxy(_fallbackChange, {
    get(target, ticker) {
      if (typeof ticker !== 'string') return target[ticker];
      const live = MarketData.getCachedChange(ticker);
      return live !== null ? live : (target[ticker] || 0);
    }
  });

  /* ── Fondamentaux (auto-enrichis depuis Twelvedata + import CSV) ── */
  const assets = {};

  /* ── Transactions source de vérité ──────────────────────────────
     BUY/SELL : importer via CSV IBKR (onglet Import) ou saisie manuelle.
  ─────────────────────────────────────────────────────────────── */
  let transactions = [];

  /* Fixe un prix de repli (PRU) pour un ticker tant que le marché n'a pas chargé */
  const setFallbackPrice = (ticker, price) => {
    if (ticker && price > 0) _fallbackPrices[ticker] = price;
  };

  return { currentPrices, dailyChange, assets, setFallbackPrice, get transactions() { return transactions; }, set transactions(v) { transactions = v; } };
})();

export const assets = Data.assets;
export const meta   = Data.assets;
