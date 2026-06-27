/**
 * Script de migration localStorage → D1
 * Colle ce script dans la console du navigateur sur l'ancienne version de l'app,
 * puis colle la sortie JSON dans /api/restore via:
 *
 *   curl -X POST https://divkiller.michooo-45.workers.dev/api/restore \
 *     -H "Authorization: Bearer TON_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d @export.json
 */
(function exportToD1() {
  const raw = localStorage.getItem('divkill_manual') || '[]';
  let txs;
  try { txs = JSON.parse(raw); } catch { txs = []; }

  // Normalise les transactions au format D1
  const transactions = txs.map((tx, i) => ({
    id:         i + 1,
    type:       tx.type     || 'buy',
    ticker:     (tx.ticker  || tx.symbol || '').toUpperCase(),
    shares:     tx.shares   ?? tx.qty    ?? null,
    price:      tx.price    ?? null,
    amount:     tx.amount   ?? null,
    date:       tx.date     || new Date().toISOString().slice(0, 10),
    currency:   tx.currency || 'USD',
    created_at: Math.floor(Date.now() / 1000),
  })).filter(tx => tx.ticker);

  const target = parseFloat(localStorage.getItem('divkill_target') || '1500');
  const settings = { target_monthly: String(target), base_currency: 'EUR' };

  const payload = JSON.stringify({ transactions, settings }, null, 2);
  console.log('=== EXPORT D1 ===');
  console.log(payload);
  console.log(`\n✅ ${transactions.length} transactions trouvées`);
  console.log('Sauvegarde le JSON ci-dessus dans export.json, puis lance la commande curl.');
  return payload;
})();
