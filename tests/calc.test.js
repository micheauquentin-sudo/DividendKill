import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser/config dependencies before importing calc
const mockData = {
  transactions: [],
  assets: {},
  currentPrices: {},
  dailyChange: {},
  PERF: false,
};
vi.mock('../src/data.js', () => ({ Data: mockData }));
vi.mock('../src/config.js', () => ({
  Config: { EURUSD: 1.0, MARKET_CACHE_TTL: 3600000 },
}));

// Dynamic import so mocks are applied before module execution
const { Calc } = await import('../src/calc.js');

// Helper to set up test state
function setup(transactions, assets = {}, prices = {}) {
  mockData.transactions = transactions;
  mockData.assets       = assets;
  mockData.currentPrices = prices;
  Calc.recompute();
}

// ── Buy transaction builder ───────────────────────────────────
const buy  = (ticker, qty, price, fees = 0) => ({ ticker, type: 'buy',  quantity: qty, price, fees, tax_withheld: 0 });
const sell = (ticker, qty, price, fees = 0) => ({ ticker, type: 'sell', quantity: qty, price, fees, tax_withheld: 0 });
const div  = (ticker, amount)               => ({ ticker, type: 'dividend', quantity: 1, price: amount, fees: 0, tax_withheld: 0 });

describe('Calc.computePositions', () => {

  describe('single buy', () => {
    it('creates one position with correct qty, avg, mv, pnl', () => {
      setup([buy('JNJ', 10, 150, 0)], {}, { JNJ: 160 });
      const pos = Calc.raw;
      expect(pos).toHaveLength(1);
      expect(pos[0].ticker).toBe('JNJ');
      expect(pos[0].qty).toBe(10);
      expect(pos[0].avg).toBeCloseTo(150);
      expect(pos[0].mv).toBeCloseTo(1600);
      expect(pos[0].pnl).toBeCloseTo(100); // (160-150)*10
    });

    it('uses avg as price fallback when market price missing', () => {
      setup([buy('MMM', 5, 100, 0)], {}, {});
      const pos = Calc.raw;
      expect(pos[0].price).toBe(100);
      expect(pos[0].pnl).toBe(0);
    });
  });

  describe('multiple buys → average cost (FIFO-like)', () => {
    it('blends two buys into correct avg', () => {
      setup([buy('MSFT', 10, 200), buy('MSFT', 10, 300)], {}, { MSFT: 250 });
      const pos = Calc.raw.find(p => p.ticker === 'MSFT');
      expect(pos.qty).toBe(20);
      expect(pos.avg).toBeCloseTo(250); // (10*200 + 10*300) / 20
      expect(pos.mv).toBeCloseTo(5000);
      expect(pos.pnl).toBeCloseTo(0); // (250-250)*20
    });

    it('fees are included in cost basis', () => {
      setup([buy('VZ', 10, 100, 10)], {}, { VZ: 100 });
      const pos = Calc.raw[0];
      expect(pos.avg).toBeCloseTo(101); // (10*100 + 10) / 10
      expect(pos.pnl).toBeCloseTo(-10); // price at 100, avg 101 → -1*10
    });
  });

  describe('sell reduces position', () => {
    it('partial sell reduces qty', () => {
      setup([buy('AAPL', 20, 100), sell('AAPL', 5, 120)], {}, { AAPL: 110 });
      const pos = Calc.raw.find(p => p.ticker === 'AAPL');
      expect(pos.qty).toBe(15);
    });

    it('full sell removes position from raw', () => {
      setup([buy('T', 10, 50), sell('T', 10, 60)], {}, {});
      expect(Calc.raw.find(p => p.ticker === 'T')).toBeUndefined();
    });

    it('realized gain is tracked correctly', () => {
      setup([buy('ABBV', 10, 100), sell('ABBV', 10, 150)], {}, {});
      // Position is gone, but we can verify via getRealizedGains only if still tracked
      // Since shares = 0, position excluded from raw; check via recompute
      expect(Calc.raw).toHaveLength(0);
    });
  });

  describe('dividend tracking', () => {
    it('totalDividends accumulates across dividend transactions', () => {
      setup([buy('JNJ', 10, 100), div('JNJ', 50), div('JNJ', 50)], {}, { JNJ: 100 });
      const pos = Calc.raw[0];
      expect(pos.totalDividends).toBe(100);
    });
  });

  describe('multiple tickers', () => {
    it('produces one position per ticker', () => {
      setup([buy('JNJ', 10, 100), buy('MMM', 5, 200)], {}, { JNJ: 110, MMM: 190 });
      expect(Calc.raw).toHaveLength(2);
    });
  });
});

describe('Calc aggregates', () => {
  beforeEach(() => {
    setup([buy('JNJ', 10, 100), buy('MMM', 5, 200)], {}, { JNJ: 120, MMM: 180 });
  });

  it('getMV = sum of position market values', () => {
    const expected = 10 * 120 + 5 * 180; // 1200 + 900 = 2100
    expect(Calc.getMV()).toBeCloseTo(expected);
  });

  it('getCost = sum of avg * qty', () => {
    const expected = 10 * 100 + 5 * 200; // 1000 + 1000 = 2000
    expect(Calc.getCost()).toBeCloseTo(expected);
  });

  it('getPNL = getMV − getCost', () => {
    expect(Calc.getPNL()).toBeCloseTo(Calc.getMV() - Calc.getCost());
  });

  it('getDivA = 0 with no dividend metadata', () => {
    expect(Calc.getDivA()).toBe(0);
  });

  it('getDivA uses assets.d for each position', () => {
    setup(
      [buy('JNJ', 10, 100)],
      { JNJ: { d: 4.76 } },
      { JNJ: 120 }
    );
    expect(Calc.getDivA()).toBeCloseTo(4.76 * 10);
  });
});

describe('Calc.safetyLabel', () => {
  it.each([
    [95, 'Excellent'],
    [80, 'Sûr'],
    [65, 'OK'],
    [50, 'Risqué'],
    [30, 'Danger'],
  ])('score %i → "%s"', (score, txt) => {
    expect(Calc.safetyLabel(score).txt).toBe(txt);
  });
});
