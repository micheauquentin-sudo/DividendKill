import { Calc } from './calc.js';
import { Data } from './data.js';
import { FmpData } from './fmpData.js';

export const DividendSafety = (() => {

  const WEIGHTS = {payout_ratio:.25,fcf_payout:.20,debt_ebitda:.15,interest_cov:.10,div_streak:.10,div_cagr_5y:.10,earn_stability:.05,recession_res:.05};

  const SECTOR_PROFILES = {
    'Immo.':    {payout_ratio_ok:.85,payout_ratio_warn:.95,fcf_payout_ok:.90,fcf_payout_warn:1.00,debt_ebitda_ok:6.0,debt_ebitda_warn:8.0,interest_cov_ok:2.0,note:'REIT : payout élevé normal (FFO), dette structurelle tolérée'},
    'Utilities':{payout_ratio_ok:.75,payout_ratio_warn:.85,fcf_payout_ok:.80,fcf_payout_warn:.90,debt_ebitda_ok:5.0,debt_ebitda_warn:7.0,interest_cov_ok:2.5,note:'Utilities : capex régulier justifie dette élevée'},
    _default:   {payout_ratio_ok:.60,payout_ratio_warn:.75,fcf_payout_ok:.65,fcf_payout_warn:.80,debt_ebitda_ok:3.0,debt_ebitda_warn:4.5,interest_cov_ok:3.0,note:null}
  };

  const getSectorProfile = s => SECTOR_PROFILES[s] || SECTOR_PROFILES._default;
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
  const lerp  = (v, lo, hi, sLo, sHi) => clamp(sLo + (v - lo) / (hi - lo) * (sHi - sLo));

  /* Payout ratio — 4 paliers, seuils sectoriels */
  const scorePayout = (v, p) => {
    if (v <= 0.40)                       return 100;
    if (v <= p.payout_ratio_ok)          return lerp(v, 0.40, p.payout_ratio_ok, 100, 78);
    if (v <= p.payout_ratio_warn)        return lerp(v, p.payout_ratio_ok, p.payout_ratio_warn, 78, 35);
    if (v <= p.payout_ratio_warn + 0.15) return lerp(v, p.payout_ratio_warn, p.payout_ratio_warn + 0.15, 35, 5);
    return 0;
  };

  /* FCF payout — dividende non couvert par le FCF = score 0 */
  const scoreFCF = (v, p) => {
    if (v <= 0.50)               return 100;
    if (v <= p.fcf_payout_ok)    return lerp(v, 0.50, p.fcf_payout_ok, 100, 78);
    if (v <= p.fcf_payout_warn)  return lerp(v, p.fcf_payout_ok, p.fcf_payout_warn, 78, 30);
    if (v <= 1.00)               return lerp(v, p.fcf_payout_warn, 1.00, 30, 5);
    return 0;
  };

  /* Dette/EBITDA — faible dette valorisée, seuils sectoriels */
  const scoreDebt = (v, p) => {
    if (v <= 1.0)                        return 100;
    if (v <= p.debt_ebitda_ok)           return lerp(v, 1.0, p.debt_ebitda_ok, 100, 78);
    if (v <= p.debt_ebitda_warn)         return lerp(v, p.debt_ebitda_ok, p.debt_ebitda_warn, 78, 35);
    if (v <= p.debt_ebitda_warn + 2.0)   return lerp(v, p.debt_ebitda_warn, p.debt_ebitda_warn + 2.0, 35, 5);
    return 0;
  };

  /* Couverture intérêts — 6 paliers, ≥15× = excellent, <1× = insolvabilité */
  const scoreIntCov = (v, p) => {
    const ok = p.interest_cov_ok;
    if (v >= 15)         return 100;
    if (v >= 10)         return lerp(v, 10, 15, 85, 100);
    if (v >= ok * 2)     return lerp(v, ok * 2, 10, 68, 85);
    if (v >= ok)         return lerp(v, ok, ok * 2, 48, 68);
    if (v >= ok * 0.7)   return lerp(v, ok * 0.7, ok, 22, 48);
    if (v >= 1.0)        return lerp(v, 1.0, ok * 0.7, 5, 22);
    return 0;
  };

  /* Streak — tiers Aristocrat (≥25 ans) et King (≥50 ans) */
  const scoreStreak = y => {
    if (y >= 50) return 100;
    if (y >= 25) return lerp(y, 25, 50, 85, 100);
    if (y >= 10) return lerp(y, 10, 25, 58, 85);
    if (y >= 5)  return lerp(y, 5, 10, 35, 58);
    if (y >= 3)  return lerp(y, 3, 5, 18, 35);
    if (y >= 1)  return lerp(y, 1, 3, 5, 18);
    return 0;
  };

  /* CAGR dividende 5 ans — CAGR négatif (coupure) = 0 */
  const scoreDivCAGR = c => {
    if (c >= 0.12) return 100;
    if (c >= 0.08) return lerp(c, 0.08, 0.12, 80, 100);
    if (c >= 0.05) return lerp(c, 0.05, 0.08, 58, 80);
    if (c >= 0.03) return lerp(c, 0.03, 0.05, 38, 58);
    if (c >= 0.01) return lerp(c, 0.01, 0.03, 18, 38);
    if (c >= 0)    return lerp(c, 0, 0.01, 5, 18);
    return 0;
  };

  /* Stabilité résultats — bêta comme proxy principal, PE en fallback */
  const scoreEarnStab = (beta, peCur) => {
    if (beta != null && beta > 0) {
      if (beta <= 0.40) return 100;
      if (beta <= 0.70) return lerp(beta, 0.40, 0.70, 100, 85);
      if (beta <= 0.90) return lerp(beta, 0.70, 0.90, 85, 68);
      if (beta <= 1.10) return lerp(beta, 0.90, 1.10, 68, 50);
      if (beta <= 1.40) return lerp(beta, 1.10, 1.40, 50, 28);
      if (beta <= 2.00) return lerp(beta, 1.40, 2.00, 28, 8);
      return 5;
    }
    if (peCur != null && peCur > 0) {
      if (peCur <= 15) return 78;
      if (peCur <= 25) return 62;
      if (peCur <= 40) return 45;
      return 28;
    }
    return 50;
  };

  /* Résilience récession — secteur + streak + payout + bêta */
  const scoreRecession = (sec, streak, payout, beta) => {
    const BASE = {
      'Santé':90,'Utilities':82,'Conso.':75,'Immo.':62,
      'Finance':52,'Industrie':45,'Énergie':40,'Tech':38,
      'Mat.':32,'Médias':30
    };
    const base = BASE[sec] || 50;
    const sb = streak >= 25 ? 10 : streak >= 10 ? 6 : streak >= 5 ? 3 : 0;
    const pm = payout > 0.85 ? -15 : payout > 0.70 ? -7 : 0;
    const bm = (beta != null && beta > 1.2) ? clamp((beta - 1.2) * 10) * -1 : 0;
    return clamp(base + sb + pm + bm);
  };

  const STRENGTH_LABELS = {
    payout_ratio:  'Payout ratio conservateur',
    fcf_payout:    'FCF couvre largement le dividende',
    debt_ebitda:   'Bilan sain — faible endettement',
    interest_cov:  'Couverture intérêts confortable',
    div_streak:    'Long historique de croissance du dividende',
    div_cagr_5y:   'Croissance soutenue du dividende',
    earn_stability:'Résultats réguliers et prévisibles',
    recession_res: 'Secteur défensif — résilient en récession'
  };
  const WEAKNESS_LABELS = {
    payout_ratio:  'Payout ratio trop élevé',
    fcf_payout:    'Dividende mal couvert par le FCF',
    debt_ebitda:   'Endettement excessif',
    interest_cov:  'Couverture intérêts insuffisante',
    div_streak:    'Historique dividendes court',
    div_cagr_5y:   'Croissance dividende faible ou négative',
    earn_stability:'Résultats volatils ou instables',
    recession_res: 'Secteur cyclique — vulnérable en récession'
  };

  const calculate = stock => {
    const p   = getSectorProfile(stock.sector);
    const sec = stock.sector || '';

    // Données absentes → score neutre 50 (pas de faux bonus/malus)
    const payout = stock.payout_ratio != null ? stock.payout_ratio : null;
    const fcfP   = stock.fcf_payout   != null ? stock.fcf_payout   : null;
    const debtE  = stock.debt_ebitda  != null ? stock.debt_ebitda
                 : stock.debt_equity  != null ? stock.debt_equity * 2.0 : null;
    const intC   = stock.interest_cov      != null ? stock.interest_cov
                 : stock.interest_coverage != null ? stock.interest_coverage : null;
    const streak = stock.streak      || 0;
    const cagr   = stock.div_cagr_5y != null ? stock.div_cagr_5y : null;
    const beta   = stock.beta        != null ? stock.beta        : null;
    const peCur  = stock.pe_cur      != null ? stock.pe_cur      : null;

    const scores = {
      payout_ratio:   payout != null ? scorePayout(payout, p)             : 50,
      fcf_payout:     fcfP   != null ? scoreFCF(fcfP, p)                  : 50,
      debt_ebitda:    debtE  != null ? scoreDebt(debtE, p)                : 50,
      interest_cov:   intC   != null ? scoreIntCov(intC, p)               : 50,
      div_streak:     scoreStreak(streak),
      div_cagr_5y:    cagr   != null ? scoreDivCAGR(cagr)                 : 50,
      earn_stability: scoreEarnStab(beta, peCur),
      recession_res:  scoreRecession(sec, streak, payout || 0, beta)
    };

    // Disponibilité réelle des données par facteur — fcf_payout/debt_ebitda/interest_cov
    // ne viennent QUE des états financiers FMP payants (402 en gratuit) : sur le plan
    // gratuit ils sont désormais TOUJOURS indisponibles pour toutes les actions, pas
    // seulement occasionnellement. Les compter en neutre 50 plafonnait artificiellement
    // le score max à ~78/100 pour absolument tout le monde (45% du poids bloqué à 50).
    // On renormalise donc sur les seuls facteurs réellement disponibles pour cette action,
    // pour que le score reflète ce qu'on sait vraiment, pas un manque de données structurel.
    const AVAILABLE = {
      payout_ratio:   payout != null,
      fcf_payout:     fcfP   != null,
      debt_ebitda:    debtE  != null,
      interest_cov:   intC   != null,
      div_streak:     true,
      div_cagr_5y:    cagr   != null,
      earn_stability: true,
      recession_res:  true,
    };

    let total = 0, weightSum = 0;
    for (const k in WEIGHTS) {
      if (!AVAILABLE[k]) continue;
      total     += (scores[k] || 0) * WEIGHTS[k];
      weightSum += WEIGHTS[k];
    }
    total = weightSum > 0 ? total / weightSum : 50;

    // Pénalité corrélation : payout élevé ET FCF payout élevé simultanément
    if (payout != null && fcfP != null && payout > 0.80 && fcfP > 0.90) total -= 5;

    total = clamp(total);

    const risk = total >= 80 ? 'SAFE' : total >= 65 ? 'MODERATE' : total >= 50 ? 'CAUTION' : total >= 35 ? 'RISKY' : 'DANGER';

    const weak = [], str = [];
    for (const c in scores) {
      const s = scores[c];
      if (s < 50)   weak.push({key:c, label:WEAKNESS_LABELS[c], score:s, weight:Math.round(WEIGHTS[c]*100)+'%'});
      else if (s >= 75) str.push({key:c, label:STRENGTH_LABELS[c], score:s, weight:Math.round(WEIGHTS[c]*100)+'%'});
    }
    weak.sort((a, b) => a.score - b.score);
    str.sort((a, b)  => b.score - a.score);

    // safetyScore conservé pour compatibilité avec code existant
    return {score:total, safetyScore:total, riskLevel:risk, weakPoints:weak, strengths:str, breakdown:scores, sectorNote:p.note||null};
  };

  const color = sc => sc>=80?'#22d47a':sc>=65?'#86efad':sc>=50?'#f5a623':sc>=35?'#fb923c':'#f43f5e';
  const label = rl => ({SAFE:'Sûr',MODERATE:'Modéré',CAUTION:'Prudence',RISKY:'Risqué',DANGER:'Danger'}[rl]||rl);

  const RATING_COLORS = {
    'Very Safe':'#22d47a', 'Safe':'#86efad', 'Borderline':'#f5a623',
    'Risky':'#fb923c', 'Unsafe':'#f43f5e',
  };
  const RATING_LABELS_FR = {
    'Very Safe':'Très sûr', 'Safe':'Sûr', 'Borderline':'Prudence',
    'Risky':'Risqué', 'Unsafe':'Danger',
  };

  /* Score affiché : privilégie le moteur serveur V2 (worker/src/dividendScore.js —
     états financiers FMP + Finnhub + volatilité prix, reconstruction + confiance) quand
     dispo, sinon retombe sur l'ancien calcul client (moins riche mais toujours dispo). */
  const getDisplayDSE = stock => {
    const d2 = stock && stock.dse2;
    if (d2 && typeof d2.score === 'number') {
      return {
        score: d2.score, label: RATING_LABELS_FR[d2.rating] || d2.rating,
        color: RATING_COLORS[d2.rating] || color(d2.score), method: 'v2',
        confidence: d2.confidence, breakdown: d2.breakdown, metrics: d2.metrics,
        reconstructed: d2.reconstructed, explanation: d2.explanation || [],
      };
    }
    const r = calculate(stock || {});
    return { score: r.score, label: label(r.riskLevel), color: color(r.score), method: 'v1', raw: r };
  };

  const getStockDSE = m => getDisplayDSE(m).score;

  const getPortfolioDSE = () => {
    let totalMV = 0, weightedDSE = 0;
    for (const pos of Calc.raw) {
      const m = Data.assets[pos.ticker] || {};
      weightedDSE += getStockDSE(m) * pos.mv;
      totalMV += pos.mv;
    }
    return totalMV > 0 ? Math.round(weightedDSE / totalMV) : 0;
  };

  return { calculate, color, label, getPortfolioDSE, getDisplayDSE };
})();

export const calculateDividendSafety = DividendSafety.calculate;
export const dseColor  = DividendSafety.color;
export const dseLabel  = DividendSafety.label;
export const getDisplayDSE = DividendSafety.getDisplayDSE;
export const DSE_WEIGHTS = {payout_ratio:.25,fcf_payout:.20,debt_ebitda:.15,interest_cov:.10,div_streak:.10,div_cagr_5y:.10,earn_stability:.05,recession_res:.05};
