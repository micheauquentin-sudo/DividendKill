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
     Dividendes sample conservés pour démonstration — à remplacer par import réel.
  ─────────────────────────────────────────────────────────────── */
  let transactions = [];

  const PERF = {
    '1Y' : {g:1940,p:8.41,nav:[23260,23287,22855,22918,22951,22858,23347,23404,23494,23456,23392,23419,23428,23556,23286,23449,23154,23355,23583,23428,23244,23566,23496,23359,23289,23334,23451,23453,23159,22676,22960,22973,22860,22951,23060,23050,23053,23299,23217,23208,23250,23494,23392,23449,23513,23430,23303,23444,22882,23011,22960,22878,22803,22844,22814,22591,22637,22531,22723,22532,22289,21997,22146,22186,22182,21966,21967,22207,22161,22322,22321,22463,22490,22430,22502,22529,22655,22710,22628,22249,22394,22515,22470,22262,22503,22665,22913,22849,22783,22706,22810,22573,22014,22100,22217,22059,22130,22247,22062,22243,22320,22570,22581,22531,22408,22343,22360,22268,22213,22651,22662,22906,23000,23000,23107,23099,22980,23145,23131,23176,22853,22796,23034,23190,23327,23413,23315,23456,23411,23255,23190,23008,23191,23190,23254,23219,23261,23141,23143,23237,23319,23568,23551,23832,23942,24052,24261,24698,24878,24767,24667,24218,24468,24445,24268,24195,23921,23867,23895,24316,24598,24544,24998,25001,25166,24777,24910,24918,24838,25072,25109,25072,25280,25264,25323,25194,25321,25139,25125,25303,25467,25706,25720,25451,25447,25355,25208,25135,25116,25466,25383,25175,25013,24672,24367,24503,24620,24912,25096,25152,25477,25411,25308,25474,25523,25400,25158,25340,25329,25069,24832,24804,24832,25034,25287,25224,25147,24973,25366,24972,24938,24985,24884,25007,24906,24852,25004,24858,24648,24506,24268,24431,24409,24573,24385,24618,24823,24791,25056,25139,25064,24945,25027,24998,24842,24671,24698,24531,24700,25013,24761,25128,25152,25152,25491,25218,25191,24969,24849,24826,24924,25000]},
    '7D' : {g:-193,p:-0.77,nav:[25218,25191,24969,24849,24826,24924,25000]},
    'MTD': {g:445,p:1.81,nav:[24671,24698,24531,24700,25013,24761,25128,25152,25152,25491,25218,25191,24969,24849,24826,24924,25000]},
    '1D' : {g:120,p:0.48,nav:[24880,25000]}
  };

  return { currentPrices, dailyChange, assets, get transactions() { return transactions; }, set transactions(v) { transactions = v; }, PERF };
})();

export const assets = Data.assets;
export const meta   = Data.assets;
