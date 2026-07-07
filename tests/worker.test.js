import { describe, it, expect } from 'vitest';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

import {
  validateTx, hashPassword, verifyPassword, signJWT, verifyJWT,
  computeStreak, computeDivCAGR5y, extractPayMonths,
  normalizeFunda, normalizeProfile, isRateLimited,
} from '../worker/src/index.js';

import {
  computeDividendSafetyV2, scoreEpsPayout, scoreFcfPayout,
  scoreDebtToFCF, scoreInterestCoverage, scoreCAGR, scoreCutCount,
} from '../worker/src/dividendScore.js';

// ── Helpers ──────────────────────────────────────────────────
const b64u = buf => Buffer.from(buf).toString('base64url');

/* 4 versements trimestriels (mar/juin/sep/déc) par année, montant = total/4.
   Renvoyé du plus récent au plus ancien, comme FMP. */
function mkDivs(totalsByYear) {
  const out = [];
  for (const [year, total] of Object.entries(totalsByYear)) {
    for (const m of ['03', '06', '09', '12']) {
      out.push({ paymentDate: `${year}-${m}-15`, dividend: total / 4 });
    }
  }
  return out.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
}

const CUR_YEAR = new Date().getFullYear();

// ── validateTx ───────────────────────────────────────────────
describe('validateTx', () => {
  const valid = { type: 'buy', ticker: 'JNJ', date: '2025-01-15', shares: 10, price: 150 };

  it('accepte une transaction buy valide', () => {
    expect(validateTx(valid)).toBeNull();
  });

  it('accepte un dividende avec amount seul', () => {
    expect(validateTx({ type: 'dividend', ticker: 'O', date: '2025-02-01', amount: 12.5 })).toBeNull();
  });

  it('accepte les tickers avec ., -, ^ et = (BRK.B, ^GSPC…)', () => {
    for (const t of ['BRK.B', 'RIO-L', '^GSPC', 'GC=F']) {
      expect(validateTx({ ...valid, ticker: t })).toBeNull();
    }
  });

  it.each([
    ['type inconnu',      { ...valid, type: 'transfer' }],
    ['type absent',       { ...valid, type: undefined }],
    ['ticker absent',     { ...valid, ticker: '' }],
    ['ticker HTML (XSS)', { ...valid, ticker: '<img onerror=alert(1)>' }],
    ['ticker trop long',  { ...valid, ticker: 'A'.repeat(21) }],
    ['date non ISO',      { ...valid, date: '15/01/2025' }],
    ['shares = 0',        { ...valid, shares: 0 }],
    ['shares négatif',    { ...valid, shares: -3 }],
    ['prix négatif',      { ...valid, price: -1 }],
    ['amount négatif',    { ...valid, amount: -5 }],
    ['amount non num.',   { ...valid, amount: 'abc' }],
    ['pas un objet',      null],
  ])('rejette : %s', (_lbl, tx) => {
    expect(typeof validateTx(tx)).toBe('string');
  });

  it('tolère shares/price/amount absents (null)', () => {
    expect(validateTx({ type: 'sell', ticker: 'T', date: '2025-03-01' })).toBeNull();
  });
});

// ── hashPassword / verifyPassword ────────────────────────────
describe('hashPassword / verifyPassword', () => {
  it('round-trip : le bon mot de passe vérifie, sans re-hash', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.split(':')).toHaveLength(3);
    const r = await verifyPassword('correct horse battery', stored);
    expect(r).toEqual({ ok: true, needsRehash: false });
  });

  it('rejette un mauvais mot de passe', async () => {
    const stored = await hashPassword('secret123');
    const r = await verifyPassword('secret124', stored);
    expect(r.ok).toBe(false);
  });

  it('accepte l’ancien format legacy salt:hash (100k itérations implicites)', async () => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync('legacy-pass', salt, 100000, 32, 'sha256');
    const stored = `${b64u(salt)}:${b64u(hash)}`; // 2 parties, sans préfixe
    const r = await verifyPassword('legacy-pass', stored);
    expect(r).toEqual({ ok: true, needsRehash: false });
  });

  it('signale needsRehash pour un hash à itérations inférieures à la cible', async () => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync('old-pass', salt, 50000, 32, 'sha256');
    const stored = `50000:${b64u(salt)}:${b64u(hash)}`;
    const r = await verifyPassword('old-pass', stored);
    expect(r).toEqual({ ok: true, needsRehash: true });
  });
});

// ── signJWT / verifyJWT ──────────────────────────────────────
describe('signJWT / verifyJWT', () => {
  const SECRET = 'test-secret-0123456789';

  it('round-trip : le payload est restitué', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const tok = await signJWT({ sub: 'u1', email: 'a@b.co', exp }, SECRET);
    const p = await verifyJWT(tok, SECRET);
    expect(p.sub).toBe('u1');
    expect(p.email).toBe('a@b.co');
  });

  it('rejette un token expiré', async () => {
    const tok = await signJWT({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    await expect(verifyJWT(tok, SECRET)).rejects.toThrow('expired');
  });

  it('rejette une signature altérée', async () => {
    const tok = await signJWT({ sub: 'u1' }, SECRET);
    const [h, b, sig] = tok.split('.');
    const bad = `${h}.${b}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(verifyJWT(bad, SECRET)).rejects.toThrow();
  });

  it('rejette un token signé avec un autre secret', async () => {
    const tok = await signJWT({ sub: 'u1' }, 'autre-secret');
    await expect(verifyJWT(tok, SECRET)).rejects.toThrow();
  });

  it('rejette un token malformé', async () => {
    await expect(verifyJWT('pas.un-jwt', SECRET)).rejects.toThrow('invalid');
  });

  it('un payload altéré invalide la signature', async () => {
    const tok = await signJWT({ sub: 'u1' }, SECRET);
    const [h, , sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
    await expect(verifyJWT(`${h}.${forged}.${sig}`, SECRET)).rejects.toThrow();
  });
});

// ── computeStreak ────────────────────────────────────────────
describe('computeStreak', () => {
  it('compte les années consécutives sans baisse', () => {
    const divs = mkDivs({ 2021: 4.0, 2022: 4.2, 2023: 4.4, 2024: 4.6, 2025: 4.8 });
    expect(computeStreak(divs)).toBe(4); // 4 comparaisons année/année-1
  });

  it('une coupure récente remet le streak à zéro', () => {
    const divs = mkDivs({ 2022: 4.0, 2023: 4.2, 2024: 4.4, 2025: 2.0 });
    expect(computeStreak(divs)).toBe(0);
  });

  it('une coupure ancienne borne le streak', () => {
    const divs = mkDivs({ 2021: 4.0, 2022: 2.0, 2023: 2.1, 2024: 2.2, 2025: 2.3 });
    expect(computeStreak(divs)).toBe(3); // 2025→2024→2023→2022 ok, 2022 vs 2021 = cut
  });

  it('tolère 2% d’écart d’arrondi (pas un faux cut)', () => {
    const divs = mkDivs({ 2024: 4.00, 2025: 3.95 }); // -1.25%, dans la tolérance
    expect(computeStreak(divs)).toBe(1);
  });

  it('rend 0 sur entrée vide ou trop courte', () => {
    expect(computeStreak([])).toBe(0);
    expect(computeStreak(null)).toBe(0);
    expect(computeStreak([{ paymentDate: '2025-03-15', dividend: 1 }])).toBe(0);
  });
});

// ── computeDivCAGR5y ─────────────────────────────────────────
describe('computeDivCAGR5y', () => {
  it('calcule le CAGR entre N-1 et N-6 (fallback quand l’année courante est partielle)', () => {
    const divs = mkDivs({ [CUR_YEAR - 6]: 1.0, [CUR_YEAR - 1]: 2.0 });
    // now = total N-1 (N absent), old = total N-6 (N-5 absent) → (2/1)^0.2 - 1
    expect(computeDivCAGR5y(divs)).toBeCloseTo(Math.pow(2, 0.2) - 1, 3);
  });

  it('rend null sans assez d’historique', () => {
    expect(computeDivCAGR5y([])).toBeNull();
    expect(computeDivCAGR5y(mkDivs({ [CUR_YEAR - 1]: 2.0 }))).toBeNull();
  });
});

// ── extractPayMonths ─────────────────────────────────────────
describe('extractPayMonths', () => {
  it('extrait les mois de paiement des 2 dernières années (0-indexés, triés)', () => {
    const divs = mkDivs({ [CUR_YEAR - 1]: 4.0 }); // mars/juin/sep/déc
    expect(extractPayMonths(divs)).toEqual([2, 5, 8, 11]);
  });

  it('rend null si tous les versements sont trop anciens', () => {
    const divs = mkDivs({ [CUR_YEAR - 4]: 4.0 });
    expect(extractPayMonths(divs)).toBeNull();
  });

  it('rend null sur entrée vide', () => {
    expect(extractPayMonths([])).toBeNull();
    expect(extractPayMonths(null)).toBeNull();
  });
});

// ── normalizeFunda ───────────────────────────────────────────
describe('normalizeFunda', () => {
  it('somme les versements des 12 derniers mois (format enveloppé { historical })', () => {
    const y = CUR_YEAR, m = String(new Date().getMonth() + 1).padStart(2, '0');
    const recent = [
      { paymentDate: `${y}-${m}-01`, dividend: 1.1 },
      { paymentDate: `${y - 1}-12-15`, dividend: 1.0 },
      { paymentDate: `${y - 1}-09-15`, dividend: 1.0 },
      { paymentDate: `${y - 1}-08-15`, dividend: 1.0 },
    ];
    const r = normalizeFunda([{ companyName: 'Acme', sector: 'Tech', beta: 1.1, marketCap: 5e9 }],
                             { historical: recent });
    expect(r.annual_div).toBeCloseTo(4.1);
    expect(r.name).toBe('Acme');
    expect(r.sector).toBe('Tech');
    expect(r.market_cap).toBe(5e9);
    expect(Array.isArray(r.pay_months)).toBe(true);
    // Champs FMP payants : toujours null en sortie (remplis par fillFundaFallback)
    expect(r.pe_cur).toBeNull();
    expect(r.payout_ratio).toBeNull();
  });

  it('retombe sur profile.lastDividend (déjà annuel) sans historique', () => {
    const r = normalizeFunda([{ lastDividend: 4.56 }], null);
    expect(r.annual_div).toBeCloseTo(4.56);
  });

  it('tolère des entrées vides sans crasher', () => {
    const r = normalizeFunda(null, null);
    expect(r.annual_div).toBeNull();
    expect(r.streak).toBe(0);
    expect(r.pay_months).toBeNull();
  });
});

// ── normalizeProfile ─────────────────────────────────────────
describe('normalizeProfile', () => {
  it('mappe les champs FMP /stable/profile confirmés', () => {
    const q = normalizeProfile('jnj', {
      price: 100, change: 2, marketCap: 5e9, lastDividend: 4,
      companyName: 'Johnson & Johnson', currency: 'USD',
      range: '80-120', averageVolume: 1e6,
    });
    expect(q.symbol).toBe('JNJ');
    expect(q.regularMarketPrice).toBe(100);
    expect(q.regularMarketPreviousClose).toBeCloseTo(98);
    expect(q.regularMarketChangePercent).toBeCloseTo(2 / 98 * 100, 3);
    expect(q.fiftyTwoWeekLow).toBe(80);
    expect(q.fiftyTwoWeekHigh).toBe(120);
    expect(q.dividendYield).toBeCloseTo(0.04);
    expect(q.trailingAnnualDividendRate).toBe(4);
    expect(q.trailingPE).toBeNull(); // jamais de P/E fournisseur
  });
});

// ── isRateLimited ────────────────────────────────────────────
function mkKV() {
  const m = new Map();
  return {
    get: async k => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, v); },
  };
}

describe('isRateLimited', () => {
  it('laisse passer sous la limite puis bloque', async () => {
    const env = { PRICES_KV: mkKV() };
    for (let i = 0; i < 3; i++) expect(await isRateLimited(env, 'k', 3)).toBe(false);
    expect(await isRateLimited(env, 'k', 3)).toBe(true);
  });

  it('sans KV : fail-open par défaut, fail-closed pour l’auth', async () => {
    expect(await isRateLimited({}, 'k', 3)).toBe(false);
    expect(await isRateLimited({}, 'k', 3, true)).toBe(true);
  });

  it('KV en erreur : suit le mode failClosed demandé', async () => {
    const broken = { PRICES_KV: { get: async () => { throw new Error('kv down'); }, put: async () => {} } };
    expect(await isRateLimited(broken, 'k', 3)).toBe(false);
    expect(await isRateLimited(broken, 'k', 3, true)).toBe(true);
  });
});

// ── dividendScore.js : bandes de score ───────────────────────
describe('bandes de score (dividendScore)', () => {
  it('scoreEpsPayout suit les paliers de la spec', () => {
    expect(scoreEpsPayout(0.20)).toBe(100);
    expect(scoreEpsPayout(0.40)).toBe(90);
    expect(scoreEpsPayout(0.55)).toBe(70);
    expect(scoreEpsPayout(0.70)).toBe(45);
    expect(scoreEpsPayout(0.85)).toBe(20);
    expect(scoreEpsPayout(1.20)).toBe(0);
  });

  it('scoreFcfPayout / scoreDebtToFCF / scoreInterestCoverage : bornes', () => {
    expect(scoreFcfPayout(0.30)).toBe(100);
    expect(scoreFcfPayout(0.95)).toBe(0);
    expect(scoreDebtToFCF(1.0)).toBe(100);
    expect(scoreDebtToFCF(8)).toBe(0);
    expect(scoreInterestCoverage(12)).toBe(100);
    expect(scoreInterestCoverage(1.0)).toBe(0);
  });

  it('scoreCAGR et scoreCutCount', () => {
    expect(scoreCAGR(0.10)).toBe(100);
    expect(scoreCAGR(-0.05)).toBe(20);
    expect(scoreCutCount(0)).toBe(100);
    expect(scoreCutCount(1)).toBe(40);
    expect(scoreCutCount(3)).toBe(0);
  });
});

// ── computeDividendSafetyV2 ──────────────────────────────────
describe('computeDividendSafetyV2', () => {
  const SHAPE_KEYS = ['symbol', 'score', 'rating', 'confidence', 'breakdown', 'metrics', 'reconstructed', 'explanation'];

  it('entrée vide : ne crashe pas, score borné, confiance faible', () => {
    const r = computeDividendSafetyV2({});
    for (const k of SHAPE_KEYS) expect(r).toHaveProperty(k);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.confidence).toBeLessThan(0.4);
    expect(r.breakdown.coverage).toBeNull();
    expect(r.reconstructed.used).toBe(false);
    expect(r.explanation.length).toBeGreaterThan(0);
  });

  it('entrée garbage : ne crashe pas et reste borné', () => {
    const r = computeDividendSafetyV2({
      annualDividend: 'abc', payoutRatio: NaN, epsTTM: Infinity,
      incomeStatements: 'nope', cashFlowStatements: [{}, null, { year: 'x' }],
      priceHistory: [{ close: 'NaN' }], streakHint: -1,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['Very Safe', 'Safe', 'Borderline', 'Risky', 'Unsafe']).toContain(r.rating);
  });

  it('profil complet et sain : score élevé, 5 catégories remplies, confiance haute', () => {
    const years = [0, 1, 2, 3, 4].map(i => CUR_YEAR - 5 + i);
    const income = years.map((y, i) => ({ year: y, eps: 8 + i * 0.5, revenue: 1e9 * (1 + i * 0.05), shares: 1e8 }));
    const cash = years.map(y => ({ year: y, freeCashFlow: 1.2e9, freeCashFlowPerShare: 12 }));
    const prices = Array.from({ length: 300 }, (_, i) => ({
      date: `d${i}`, close: 100 * Math.pow(1.0005, i),
    }));
    const r = computeDividendSafetyV2({
      symbol: 'TEST', annualDividend: 4, payoutRatio: 0.45,
      epsTTM: 10, finnhubEps: 10.2, fcfPerShareTTM: 12,
      totalDebt: 1.2e9, interestCoverageDirect: 12,
      incomeStatements: income, cashFlowStatements: cash, priceHistory: prices,
    });
    expect(r.score).toBeGreaterThanOrEqual(65);
    expect(['Safe', 'Very Safe']).toContain(r.rating);
    for (const k of ['coverage', 'balance', 'stability', 'growth', 'market']) {
      expect(r.breakdown[k]).not.toBeNull();
    }
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.breakdown.penalties).toBe(0);
    expect(r.reconstructed.used).toBe(true); // historique reconstruit depuis EPS/FCF
  });

  it('payout intenable : pénalités appliquées et score dégradé', () => {
    const r = computeDividendSafetyV2({
      symbol: 'RISKY', annualDividend: 5, payoutRatio: 1.0,
      epsTTM: 5, fcfPerShareTTM: 4, // epsPayout 1.0 (+15), fcfPayout 1.25 (+25)
    });
    expect(r.breakdown.penalties).toBeGreaterThanOrEqual(40);
    expect(r.score).toBeLessThan(50);
    expect(['Risky', 'Unsafe']).toContain(r.rating);
  });

  it('streakHint : prouve 0 coupure quand l’historique reconstruit est indisponible', () => {
    const r = computeDividendSafetyV2({
      symbol: 'HINT', annualDividend: 4,
      dividendGrowth5yHint: 0.06, streakHint: 12,
    });
    // stabilité disponible via hints seuls (CAGR + cuts=0 prouvé par le streak)
    expect(r.breakdown.stability).not.toBeNull();
    expect(r.explanation.join(' ')).toMatch(/coupure/i);
  });
});
