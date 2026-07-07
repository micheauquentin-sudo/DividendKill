// Dernier taux EUR/USD connu (persisté par le fetch /api/fx au boot, voir ui.js).
// 1.1611 n'est que le filet de sécurité si l'app n'a encore jamais pu joindre l'API.
const _savedFx = (() => {
  try {
    const v = parseFloat(localStorage.getItem('dk_fx_eurusd'));
    return v > 0.5 && v < 2 ? v : null;
  } catch (_) { return null; }
})();

export const Config = {
  EURUSD:    _savedFx || 1.1611, // mis à jour au boot via /api/fx (Config.EURUSD est lu dynamiquement)
  TARGET_MONTHLY: 1500,
  MARKET_CACHE_TTL: 60 * 60 * 1000,
};
