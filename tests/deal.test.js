import { describe, it, expect, vi } from 'vitest';

// Mocks des dépendances navigateur/état global avant l'import du panel
vi.mock('../src/ui-shared.js', () => ({ _emptyState: () => '', _logo: () => '', _esc: s => String(s) }));
vi.mock('../src/calc.js', () => ({ getMV: () => 10000, getDivA: () => 0, eu: () => 1 }));
vi.mock('../src/data.js', () => ({ Data: { assets: {} }, meta: {} }));
vi.mock('../src/dividendSafety.js', () => ({ getDisplayDSE: () => ({ score: 70 }) }));

const { calculatePriorityRanking } = await import('../src/panels/deal.js');

// Portefeuille de test : 80% Tech / 20% Santé (total 10 000 = mock getMV)
const PORTFOLIO = [
  { ticker: 'AAA', name: 'Alpha', sec: 'Tech',  mv: 8000, price: 100, avg: 90 },
  { ticker: 'BBB', name: 'Beta',  sec: 'Santé', mv: 2000, price: 50,  avg: 40 },
];

describe('calculatePriorityRanking — allocation sectorielle réelle', () => {
  const ranked = calculatePriorityRanking(PORTFOLIO);
  const bySym = Object.fromEntries(ranked.map(r => [r.ticker, r]));

  it('calcule sec_gap depuis les positions courantes, pas un snapshot codé en dur', () => {
    // Tech : cible 10% − réel 80% = −70 ; Santé : cible 20% − réel 20% = 0
    expect(bySym.AAA._sec_gap).toBeCloseTo(-70);
    expect(bySym.BBB._sec_gap).toBeCloseTo(0);
  });

  it('le sous-score diversification reflète la sur/sous-pondération réelle', () => {
    expect(bySym.AAA._s_div).toBe(0);  // clamp(−70×5 + 50) = 0 — secteur sur-pondéré
    expect(bySym.BBB._s_div).toBe(50); // gap 0 → neutre
  });

  it('signale la concentration d’une position à 80% du portefeuille', () => {
    expect(bySym.AAA._cur_w).toBeCloseTo(80);
    expect(bySym.AAA._s_poids).toBe(0);
    expect(bySym.AAA.risks.join(' ')).toMatch(/concentrée/);
  });

  it('un secteur absent des positions ne fausse pas les autres', () => {
    const solo = calculatePriorityRanking([PORTFOLIO[0]]);
    // Portefeuille mono-secteur : ce secteur pèse mv/getMV — les cibles restent le modèle fixe
    expect(solo[0]._sec_gap).toBeCloseTo(10 - 80);
  });
});
