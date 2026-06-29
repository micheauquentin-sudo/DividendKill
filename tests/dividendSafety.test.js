import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock browser-specific modules before importing dividendSafety
vi.mock('../src/data.js', () => ({
  Data: { assets: {}, transactions: [], currentPrices: {}, dailyChange: {}, PERF: false },
}));
vi.mock('../src/calc.js', () => ({
  Calc: { raw: [], recompute: vi.fn() },
}));
vi.mock('../src/fmpData.js', () => ({ FmpData: {} }));
vi.mock('../src/config.js', () => ({ Config: { EURUSD: 1.1, MARKET_CACHE_TTL: 3600000 } }));

const { calculateDividendSafety, dseColor, DividendSafety } = await import('../src/dividendSafety.js');

// ── Helpers ──────────────────────────────────────────────────
const fullStock = (overrides = {}) => ({
  sector: 'Santé',
  payout_ratio: 0.45,
  fcf_payout: 0.50,
  debt_ebitda: 1.5,
  interest_cov: 12,
  streak: 30,
  div_cagr_5y: 0.09,
  beta: 0.65,
  pe_cur: 18,
  ...overrides,
});

describe('calculateDividendSafety', () => {

  describe('score structure', () => {
    it('returns safetyScore, riskLevel, weakPoints, strengths, breakdown', () => {
      const r = calculateDividendSafety(fullStock());
      expect(r).toHaveProperty('safetyScore');
      expect(r).toHaveProperty('riskLevel');
      expect(r).toHaveProperty('weakPoints');
      expect(r).toHaveProperty('strengths');
      expect(r).toHaveProperty('breakdown');
      expect(r.safetyScore).toBe(r.score);
    });

    it('score is clamped between 0 and 100', () => {
      const s1 = calculateDividendSafety(fullStock()).safetyScore;
      const s2 = calculateDividendSafety({ payout_ratio: 2, fcf_payout: 3, debt_ebitda: 20, interest_cov: 0.5, streak: 0, div_cagr_5y: -0.5 }).safetyScore;
      expect(s1).toBeGreaterThanOrEqual(0);
      expect(s1).toBeLessThanOrEqual(100);
      expect(s2).toBeGreaterThanOrEqual(0);
    });
  });

  describe('riskLevel tiers', () => {
    it('SAFE when score ≥ 80', () => {
      const r = calculateDividendSafety(fullStock({ streak: 50, payout_ratio: 0.30, fcf_payout: 0.40, interest_cov: 20, debt_ebitda: 0.8, div_cagr_5y: 0.15, beta: 0.40 }));
      expect(r.riskLevel).toBe('SAFE');
      expect(r.safetyScore).toBeGreaterThanOrEqual(80);
    });

    it('DANGER when score < 35', () => {
      const r = calculateDividendSafety({ payout_ratio: 1.5, fcf_payout: 2.0, debt_ebitda: 15, interest_cov: 0.5, streak: 0, div_cagr_5y: -0.2, beta: 2.5, sector: 'Tech' });
      expect(r.riskLevel).toBe('DANGER');
      expect(r.safetyScore).toBeLessThan(35);
    });
  });

  describe('payout scoring', () => {
    it('payout ≤ 40% → max score for that component', () => {
      const r = calculateDividendSafety(fullStock({ payout_ratio: 0.35 }));
      expect(r.breakdown.payout_ratio).toBe(100);
    });

    it('payout > 75% (default sector) → risky score', () => {
      const r = calculateDividendSafety(fullStock({ payout_ratio: 0.80, sector: 'Finance' }));
      expect(r.breakdown.payout_ratio).toBeLessThan(35);
    });

    it('REIT sector: payout 85% is acceptable (threshold shifted)', () => {
      const reit = calculateDividendSafety(fullStock({ sector: 'Immo.', payout_ratio: 0.82 }));
      const def  = calculateDividendSafety(fullStock({ sector: 'Finance', payout_ratio: 0.82 }));
      expect(reit.breakdown.payout_ratio).toBeGreaterThan(def.breakdown.payout_ratio);
    });
  });

  describe('streak scoring', () => {
    it('streak 0 → 0', () => {
      const r = calculateDividendSafety(fullStock({ streak: 0 }));
      expect(r.breakdown.div_streak).toBe(0);
    });

    it('streak ≥ 50 (King) → 100', () => {
      const r = calculateDividendSafety(fullStock({ streak: 52 }));
      expect(r.breakdown.div_streak).toBe(100);
    });

    it('streak 25 (Aristocrat) → 85', () => {
      const r = calculateDividendSafety(fullStock({ streak: 25 }));
      expect(r.breakdown.div_streak).toBe(85);
    });
  });

  describe('interest coverage', () => {
    it('coverage ≥ 15 → 100', () => {
      const r = calculateDividendSafety(fullStock({ interest_cov: 20 }));
      expect(r.breakdown.interest_cov).toBe(100);
    });

    it('coverage < 1 → 0', () => {
      const r = calculateDividendSafety(fullStock({ interest_cov: 0.8 }));
      expect(r.breakdown.interest_cov).toBe(0);
    });
  });

  describe('missing data → neutral 50', () => {
    it('null payout → 50', () => {
      const r = calculateDividendSafety({ streak: 0 });
      expect(r.breakdown.payout_ratio).toBe(50);
      expect(r.breakdown.fcf_payout).toBe(50);
      expect(r.breakdown.debt_ebitda).toBe(50);
      expect(r.breakdown.interest_cov).toBe(50);
      expect(r.breakdown.div_cagr_5y).toBe(50);
    });
  });

  describe('correlation penalty', () => {
    it('high payout AND high FCF payout → −5 penalty applied', () => {
      const penalized = calculateDividendSafety(fullStock({ payout_ratio: 0.85, fcf_payout: 0.95 }));
      // Score with penalty should be lower than if one of the values was safe
      const clean     = calculateDividendSafety(fullStock({ payout_ratio: 0.50, fcf_payout: 0.55 }));
      expect(clean.safetyScore).toBeGreaterThan(penalized.safetyScore);
    });
  });

  describe('weakness / strength detection', () => {
    it('score < 50 for a component → appears in weakPoints', () => {
      const r = calculateDividendSafety(fullStock({ streak: 0 }));
      expect(r.weakPoints.some(w => w.key === 'div_streak')).toBe(true);
    });

    it('score ≥ 75 for a component → appears in strengths', () => {
      const r = calculateDividendSafety(fullStock({ interest_cov: 20 }));
      expect(r.strengths.some(s => s.key === 'interest_cov')).toBe(true);
    });
  });
});

describe('dseColor', () => {
  it('≥ 80 → green', () => expect(dseColor(80)).toBe('#22d47a'));
  it('65–79 → light green', () => expect(dseColor(70)).toBe('#86efad'));
  it('50–64 → orange', () => expect(dseColor(55)).toBe('#f5a623'));
  it('35–49 → light red', () => expect(dseColor(40)).toBe('#fb923c'));
  it('< 35 → red', () => expect(dseColor(20)).toBe('#f43f5e'));
});
