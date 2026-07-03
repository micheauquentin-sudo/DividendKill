// Dividend Safety Score V2 — moteur serveur, tolère données partielles/absentes.
// Aucune dépendance externe (pas de fetch/KV/env) : module pur, entrée = objet JS simple.

const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const round4 = v => v == null ? null : Math.round(v * 10000) / 10000;
const round3 = v => v == null ? null : Math.round(v * 1000) / 1000;

// Accepte plusieurs variantes de clé (Finnhub ne documente pas toujours le nom exact) — jamais crash si aucune trouvée.
const pick = (obj, ...keys) => {
  if (obj == null) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !Number.isNaN(v)) return v;
  }
  return null;
};

const isNum = v => typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Bandes de score par palier (spec produit) — bornes strictes telles que fournies
// ---------------------------------------------------------------------------

export function scoreEpsPayout(v) {
  if (v <= 0.25) return 100;
  if (v <= 0.40) return 90;
  if (v <= 0.55) return 70;
  if (v <= 0.70) return 45;
  if (v <= 0.85) return 20;
  return 0;
}

export function scoreFcfPayout(v) {
  if (v <= 0.30) return 100;
  if (v <= 0.50) return 90;
  if (v <= 0.70) return 70;
  if (v <= 0.90) return 35;
  return 0;
}

export function scoreDebtToFCF(v) {
  if (v <= 1.5) return 100;
  if (v <= 3) return 80;
  if (v <= 5) return 55;
  if (v <= 7) return 30;
  return 0;
}

export function scoreInterestCoverage(v) {
  if (v >= 10) return 100;
  if (v >= 6) return 80;
  if (v >= 3) return 55;
  if (v >= 1.5) return 25;
  return 0;
}

// Réutilisée pour CAGR dividende, EPS et revenue (bandes identiques, spec explicite).
export function scoreCAGR(c) {
  if (c > 0.08) return 100;
  if (c >= 0.04) return 80;
  if (c >= 0.01) return 60;
  if (c >= 0) return 45;
  return 20;
}

export function scoreVolatilityBucket(bucket) {
  return { low: 100, medium: 70, high: 30, extreme: 0 }[bucket] ?? 0;
}

export function scoreCutCount(n) {
  if (n <= 0) return 100;
  if (n === 1) return 40;
  return 0;
}

// ---------------------------------------------------------------------------
// Reconstruction de l'historique de dividendes à partir de EPS/FCF + payout courant
// ---------------------------------------------------------------------------

function reconstructDividendHistory(annualDividend, payoutRatio, incomeStatements, cashFlowStatements) {
  // Sans payout courant on ne peut rien estimer — pas de valeur inventée.
  if (!isNum(payoutRatio)) return { history: [], sources: new Set() };

  const epsByYear = new Map();
  for (const s of incomeStatements || []) {
    if (s && isNum(s.year) && isNum(s.eps)) epsByYear.set(s.year, s.eps);
  }
  const fcfByYear = new Map();
  for (const s of cashFlowStatements || []) {
    if (s && isNum(s.year) && isNum(s.freeCashFlowPerShare)) fcfByYear.set(s.year, s.freeCashFlowPerShare);
  }

  const years = Array.from(new Set([...epsByYear.keys(), ...fcfByYear.keys()])).sort((a, b) => a - b);
  const history = [];
  const sources = new Set(); // 'eps' et/ou 'fcf' utilisés au moins une fois

  for (const year of years) {
    const eps = epsByYear.get(year);
    const fcf = fcfByYear.get(year);
    const estEps = isNum(eps) ? eps * payoutRatio : null;
    const estFcf = isNum(fcf) ? fcf * payoutRatio : null;

    let value = null;
    if (estEps != null && estFcf != null) {
      value = Math.min(estEps, estFcf); // conservateur, per spec
      sources.add('eps'); sources.add('fcf');
    } else if (estEps != null) {
      value = estEps; sources.add('eps');
    } else if (estFcf != null) {
      value = estFcf; sources.add('fcf');
    } else {
      continue; // ni l'un ni l'autre connu cette année → on saute
    }
    history.push({ year, dividend: value });
  }

  return { history, sources };
}

// ---------------------------------------------------------------------------
// Helpers CAGR / volatilité / cuts sur une série {year, value} triée ascendante
// ---------------------------------------------------------------------------

function cagrFromSeries(series) {
  if (!series || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const years = last.year - first.year;
  if (years <= 0 || first.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / years) - 1;
}

function yoyChanges(series) {
  const changes = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    if (prev === 0) continue; // évite division par zéro, point ignoré
    changes.push((cur - prev) / prev);
  }
  return changes;
}

function coefficientOfVariation(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return Math.abs(stddev / mean);
}

function volatilityBucket(cv) {
  if (cv == null) return null;
  if (cv < 0.10) return 'low';
  if (cv < 0.25) return 'medium';
  if (cv < 0.50) return 'high';
  return 'extreme';
}

// Tolérance 2% pour ignorer les micro-arrondis, cohérent avec computeStreak ailleurs dans l'appli.
function countCuts(series) {
  let cuts = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    if (prev <= 0) continue;
    const drop = (prev - cur) / prev;
    if (drop > 0.02) cuts++;
  }
  return cuts;
}

// ---------------------------------------------------------------------------
// A) Coverage
// ---------------------------------------------------------------------------

function computeCoverage(annualDividend, epsTTM, fcfPerShareTTM) {
  const epsPayout = (isNum(annualDividend) && isNum(epsTTM) && epsTTM !== 0) ? annualDividend / epsTTM : null;
  const fcfPayout = (isNum(annualDividend) && isNum(fcfPerShareTTM) && fcfPerShareTTM !== 0) ? annualDividend / fcfPerShareTTM : null;

  const epsScore = epsPayout != null ? scoreEpsPayout(epsPayout) : null;
  const fcfScore = fcfPayout != null ? scoreFcfPayout(fcfPayout) : null;

  let coverageScore = null;
  if (epsScore != null && fcfScore != null) {
    coverageScore = 0.4 * epsScore + 0.6 * fcfScore;
  } else if (epsScore != null) {
    coverageScore = epsScore;
  } else if (fcfScore != null) {
    coverageScore = fcfScore;
  }

  return { coverageScore, epsPayout, fcfPayout };
}

// ---------------------------------------------------------------------------
// B) Balance sheet
// ---------------------------------------------------------------------------

function computeBalance(totalDebt, cashFlowStatements, interestCoverageDirect, finnhubInterestCoverage) {
  const fcfValues = (cashFlowStatements || [])
    .map(s => s && isNum(s.freeCashFlow) ? s.freeCashFlow : null)
    .filter(isNum);

  let debtToFCF = null;
  if (isNum(totalDebt) && fcfValues.length > 0) {
    const avgFcf = fcfValues.reduce((a, b) => a + b, 0) / fcfValues.length;
    if (avgFcf !== 0) debtToFCF = totalDebt / avgFcf;
  }

  // Finnhub fournit un ratio déjà annualisé, substitut direct si FMP indisponible.
  const interestCoverage = isNum(interestCoverageDirect) ? interestCoverageDirect
    : isNum(finnhubInterestCoverage) ? finnhubInterestCoverage
    : null;

  const debtScore = (debtToFCF != null && isNum(debtToFCF)) ? scoreDebtToFCF(debtToFCF) : null;
  const intScore = interestCoverage != null ? scoreInterestCoverage(interestCoverage) : null;

  let balanceScore = null;
  if (debtScore != null && intScore != null) {
    balanceScore = 0.65 * debtScore + 0.35 * intScore;
  } else if (debtScore != null) {
    balanceScore = debtScore;
  } else if (intScore != null) {
    balanceScore = intScore;
  }

  return { balanceScore, debtToFCF, interestCoverage };
}

// ---------------------------------------------------------------------------
// C) Dividend stability (sur historique reconstruit)
// ---------------------------------------------------------------------------

// dividendCagrHint : CAGR dividende précalculé par une source tierce (ex. Finnhub
// dividendGrowthRate5Y) — utilisé UNIQUEMENT quand l'historique reconstruit ne permet
// pas de calculer son propre CAGR (aucune source de dividende historique n'est gratuite
// nulle part, confirmé empiriquement). Volatilité/cuts restent indisponibles dans ce cas
// (le hint ne donne qu'un taux composé, pas la série complète) — gérés par le
// renormalization existant ci-dessous, qui tolère déjà des sous-parties manquantes.
function computeStability(history, dividendCagrHint) {
  const usingHint = (!history || history.length < 2);
  const series = usingHint ? [] : history.map(h => ({ year: h.year, value: h.dividend }));
  const cagr = usingHint ? (isNum(dividendCagrHint) ? dividendCagrHint : null) : cagrFromSeries(series);
  const changes = usingHint ? [] : yoyChanges(series);
  const cv = usingHint ? null : coefficientOfVariation(changes);
  const bucket = usingHint ? null : volatilityBucket(cv);
  const cuts = usingHint ? null : countCuts(series);

  const cagrScore = cagr != null ? scoreCAGR(cagr) : null;
  const volScore = bucket != null ? scoreVolatilityBucket(bucket) : null;
  const cutScore = cuts != null ? scoreCutCount(cuts) : null;

  const parts = [];
  if (cagrScore != null) parts.push([cagrScore, 0.45]);
  if (volScore != null) parts.push([volScore, 0.30]);
  if (cutScore != null) parts.push([cutScore, 0.25]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const stabilityScore = wsum > 0 ? parts.reduce((a, [s, w]) => a + s * w, 0) / wsum : null;

  return { stabilityScore, dividendCAGR: cagr, volatilityBucketName: bucket, cutCount: cuts, cagrFromHint: usingHint && cagr != null };
}

// ---------------------------------------------------------------------------
// D) Business growth
// ---------------------------------------------------------------------------

// epsGrowthHint/revenueGrowthHint : CAGR précalculés par une source tierce (ex. Finnhub
// epsGrowth5Y/revenueGrowth5Y) — utilisés UNIQUEMENT quand l'historique FMP
// (incomeStatements) ne suffit pas (cas quasi systématique hors mega-cap, ces 5 endpoints
// FMP étant bloqués sur le plan gratuit).
function computeGrowth(incomeStatements, epsGrowthHint, revenueGrowthHint) {
  const epsSeries = (incomeStatements || [])
    .filter(s => s && isNum(s.year) && isNum(s.eps))
    .map(s => ({ year: s.year, value: s.eps }))
    .sort((a, b) => a.year - b.year);
  const revSeries = (incomeStatements || [])
    .filter(s => s && isNum(s.year) && isNum(s.revenue))
    .map(s => ({ year: s.year, value: s.revenue }))
    .sort((a, b) => a.year - b.year);

  let epsCAGR = epsSeries.length >= 2 ? cagrFromSeries(epsSeries) : null;
  if (epsCAGR == null && isNum(epsGrowthHint)) epsCAGR = epsGrowthHint;
  let revenueCAGR = revSeries.length >= 2 ? cagrFromSeries(revSeries) : null;
  if (revenueCAGR == null && isNum(revenueGrowthHint)) revenueCAGR = revenueGrowthHint;

  const epsScore = epsCAGR != null ? scoreCAGR(epsCAGR) : null;
  const revScore = revenueCAGR != null ? scoreCAGR(revenueCAGR) : null;

  let growthScore = null;
  if (epsScore != null && revScore != null) {
    growthScore = 0.55 * epsScore + 0.45 * revScore;
  } else if (epsScore != null) {
    growthScore = epsScore;
  } else if (revScore != null) {
    growthScore = revScore;
  }

  return { growthScore, epsCAGR, revenueCAGR };
}

// ---------------------------------------------------------------------------
// E) Market stability — à partir d'une série de prix (peut être vide)
// ---------------------------------------------------------------------------

function computeMarket(priceHistory) {
  const closes = (priceHistory || [])
    .filter(p => p && isNum(p.close))
    .map(p => p.close);

  if (closes.length < 30) return { marketScore: null, volatility: null, drawdown: null, enoughPoints: false };

  // Fenêtre ~252 points (1 an de trading) ou tout ce qui est dispo si moins.
  const window = closes.slice(Math.max(0, closes.length - 252));

  const logReturns = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] > 0 && window[i] > 0) logReturns.push(Math.log(window[i] / window[i - 1]));
  }
  let volatility = null;
  if (logReturns.length > 1) {
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
    volatility = Math.sqrt(variance) * Math.sqrt(252);
  }

  // Max drawdown sur la série complète disponible.
  let peak = closes[0];
  let maxDrawdown = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (peak - c) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  // Proxy de "tendance" : fraction du temps où la SMA-20 est croissante d'un point au suivant
  // (choix arbitraire documenté ici — la spec laisse le proxy au jugement de l'ingénieur).
  let trendConsistency = null;
  if (window.length >= 25) {
    const smaWindow = 20;
    const sma = [];
    for (let i = smaWindow - 1; i < window.length; i++) {
      const slice = window.slice(i - smaWindow + 1, i + 1);
      sma.push(slice.reduce((a, b) => a + b, 0) / smaWindow);
    }
    let rising = 0;
    for (let i = 1; i < sma.length; i++) if (sma[i] >= sma[i - 1]) rising++;
    trendConsistency = sma.length > 1 ? rising / (sma.length - 1) : null;
  }

  // Bandes volatilité annualisée : <15% quasi-100, >60% quasi-0, linéaire entre les deux.
  let volScore = 50;
  if (volatility != null) {
    if (volatility <= 0.15) volScore = 100;
    else if (volatility >= 0.60) volScore = 0;
    else volScore = 100 - ((volatility - 0.15) / (0.60 - 0.15)) * 100;
  }

  // Drawdown : 0% => 100, >=60% => 0, linéaire entre les deux.
  let ddScore = 50;
  if (maxDrawdown != null) {
    if (maxDrawdown <= 0.10) ddScore = 100;
    else if (maxDrawdown >= 0.60) ddScore = 0;
    else ddScore = 100 - ((maxDrawdown - 0.10) / (0.60 - 0.10)) * 100;
  }

  const trendScore = trendConsistency != null ? trendConsistency * 100 : 50;

  const marketScore = 0.5 * volScore + 0.3 * ddScore + 0.2 * trendScore;

  return { marketScore, volatility, drawdown: maxDrawdown, enoughPoints: true };
}

// ---------------------------------------------------------------------------
// Pénalités de risque
// ---------------------------------------------------------------------------

function computePenalties({ fcfPayout, epsPayout, debtToFCF, cashFlowStatements, epsCAGR, revenueCAGR, cutCount }) {
  let total = 0;

  if (fcfPayout != null && fcfPayout > 1.00) total += 25;
  if (epsPayout != null && epsPayout > 0.90) total += 15;
  if (debtToFCF != null && debtToFCF > 7) total += 15;

  const fcfValues = (cashFlowStatements || [])
    .map(s => s && isNum(s.freeCashFlow) ? s.freeCashFlow : null)
    .filter(isNum);
  const negativeFcfYears = fcfValues.filter(v => v < 0).length;
  if (negativeFcfYears >= 2) total += 20;

  if (epsCAGR != null && epsCAGR < 0) total += 15;
  if (revenueCAGR != null && revenueCAGR < 0) total += 10;
  if (cutCount != null && cutCount >= 2) total += 25;

  return total;
}

// ---------------------------------------------------------------------------
// Confiance
// ---------------------------------------------------------------------------

function computeSourceAgreement(epsTTM, finnhubEps) {
  if (!isNum(epsTTM) || !isNum(finnhubEps)) return 0.5; // ne peut pas être vérifié, neutre
  if (epsTTM === 0 && finnhubEps === 0) return 1.0;
  const base = Math.max(Math.abs(epsTTM), Math.abs(finnhubEps));
  if (base === 0) return 0.5;
  const divergence = Math.abs(epsTTM - finnhubEps) / base;
  if (divergence <= 0.05) return 1.0;
  if (divergence >= 0.30) return 0.0;
  return 1.0 - (divergence - 0.05) / (0.30 - 0.05);
}

function computeReconstructionQuality(historyLen, sources) {
  if (historyLen < 2) return 0.2;
  const usedEps = sources.has('eps');
  const usedFcf = sources.has('fcf');
  if (usedEps && usedFcf) return 0.6;
  if (usedEps || usedFcf) return 0.4;
  return 1.0; // structurellement supporté : historique réel (jamais observé en pratique)
}

// ---------------------------------------------------------------------------
// Explications (FR, terse)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  coverage: 'couverture du dividende',
  balance: 'santé du bilan',
  stability: 'stabilité du dividende',
  growth: 'croissance',
  market: 'stabilité du marché',
};

const SCORE_CATEGORY_KEYS = ['coverage', 'balance', 'stability', 'growth', 'market'];

function buildExplanation({ breakdown, penalties, reconstructedFields, confidence }) {
  const lines = [];
  // 'penalties' n'est pas une catégorie de score — exclue explicitement, sinon son 0 (!= null) polluait le classement.
  const available = SCORE_CATEGORY_KEYS
    .map(k => [k, breakdown[k]])
    .filter(([, v]) => v != null);

  if (available.length === 0) {
    lines.push('Données insuffisantes pour une analyse fiable — score neutre par défaut.');
    return lines;
  }

  const sorted = [...available].sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  if (best) lines.push(`Point fort : ${CATEGORY_LABELS[best[0]]} (${best[1]}/100).`);
  if (worst && worst[0] !== best[0]) lines.push(`Point faible : ${CATEGORY_LABELS[worst[0]]} (${worst[1]}/100).`);

  // Distinction volontaire : une estimation via EPS/FCF × payout (dividend_history) est
  // bien plus incertaine qu'un taux de croissance précalculé par Finnhub (probablement
  // dérivé de leurs propres données réelles, juste non exposées en historique brut) —
  // les mélanger sous un même avertissement "reconstitué" serait trompeur.
  if (reconstructedFields.includes('dividend_history')) {
    lines.push('Historique de dividendes reconstitué (pas de données réelles disponibles) — confiance réduite.');
  } else if (reconstructedFields.includes('dividend_cagr_from_finnhub')) {
    lines.push('Croissance du dividende basée sur une estimation Finnhub (pas d\'historique détaillé disponible).');
  }

  if (penalties > 0) {
    lines.push(`Pénalités de risque appliquées : -${penalties} points.`);
  }

  if (confidence < 0.4) {
    lines.push('Confiance faible — données limitées sur ce titre.');
  }

  if (available.length < 5) {
    lines.push(`${5 - available.length} sous-score(s) indisponible(s) faute de données.`);
  }

  return lines.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Fonction principale
// ---------------------------------------------------------------------------

export function computeDividendSafetyV2(input) {
  input = input || {};
  const symbol = input.symbol || null;

  try {
    const annualDividend = isNum(input.annualDividend) ? input.annualDividend : null;
    const payoutRatio = isNum(input.payoutRatio) ? input.payoutRatio : null;
    const epsTTM = isNum(input.epsTTM) ? input.epsTTM : null;
    const fcfPerShareTTM = isNum(input.fcfPerShareTTM) ? input.fcfPerShareTTM : null;
    const totalDebt = isNum(input.totalDebt) ? input.totalDebt : null;
    const interestCoverageDirect = isNum(input.interestCoverageDirect) ? input.interestCoverageDirect : null;
    const finnhubInterestCoverage = isNum(input.finnhubInterestCoverage) ? input.finnhubInterestCoverage : null;
    const finnhubEps = isNum(input.finnhubEps) ? input.finnhubEps : null;
    const incomeStatements = Array.isArray(input.incomeStatements) ? input.incomeStatements : [];
    const cashFlowStatements = Array.isArray(input.cashFlowStatements) ? input.cashFlowStatements : [];
    const priceHistory = Array.isArray(input.priceHistory) ? input.priceHistory : [];
    // Taux de croissance précalculés par une source tierce (Finnhub) — n'interviennent
    // que si l'historique FMP ne suffit pas à calculer le CAGR nous-mêmes.
    const epsGrowth5yHint = isNum(input.epsGrowth5yHint) ? input.epsGrowth5yHint : null;
    const revenueGrowth5yHint = isNum(input.revenueGrowth5yHint) ? input.revenueGrowth5yHint : null;
    const dividendGrowth5yHint = isNum(input.dividendGrowth5yHint) ? input.dividendGrowth5yHint : null;

    // --- Reconstruction historique dividende ---
    const { history, sources } = reconstructDividendHistory(annualDividend, payoutRatio, incomeStatements, cashFlowStatements);
    const reconstructedFields = [];
    if (history.length > 0) reconstructedFields.push('dividend_history');

    // --- A) Coverage ---
    const { coverageScore, epsPayout, fcfPayout } = computeCoverage(annualDividend, epsTTM, fcfPerShareTTM);

    // --- B) Balance ---
    const { balanceScore, debtToFCF, interestCoverage } = computeBalance(totalDebt, cashFlowStatements, interestCoverageDirect, finnhubInterestCoverage);

    // --- C) Stability ---
    const { stabilityScore, dividendCAGR, cutCount, cagrFromHint } = computeStability(history, dividendGrowth5yHint);
    if (cagrFromHint) reconstructedFields.push('dividend_cagr_from_finnhub');

    // --- D) Growth ---
    const { growthScore, epsCAGR, revenueCAGR } = computeGrowth(incomeStatements, epsGrowth5yHint, revenueGrowth5yHint);

    // --- E) Market ---
    const { marketScore, volatility, drawdown, enoughPoints } = computeMarket(priceHistory);

    // --- Renormalisation pondérée sur les sous-scores disponibles ---
    const WEIGHTS = { coverage: 0.35, balance: 0.25, stability: 0.20, growth: 0.10, market: 0.10 };
    const raw = { coverage: coverageScore, balance: balanceScore, stability: stabilityScore, growth: growthScore, market: marketScore };

    let weightedTotal = 0, weightSum = 0;
    for (const k in WEIGHTS) {
      if (raw[k] == null) continue;
      weightedTotal += raw[k] * WEIGHTS[k];
      weightSum += WEIGHTS[k];
    }
    // Aucune catégorie disponible → neutre 50, la confiance (DataCompleteness=0) porte le vrai signal.
    let rawScore = weightSum > 0 ? weightedTotal / weightSum : 50;

    // --- Pénalités ---
    const penalties = computePenalties({ fcfPayout, epsPayout, debtToFCF, cashFlowStatements, epsCAGR, revenueCAGR, cutCount });
    rawScore -= penalties;

    // --- Confiance ---
    const availableCount = Object.values(raw).filter(v => v != null).length;
    const dataCompleteness = availableCount / 5;
    const sourceAgreement = computeSourceAgreement(epsTTM, finnhubEps);
    const reconstructionQuality = computeReconstructionQuality(history.length, sources);
    const marketDataCompleteness = enoughPoints ? 1.0 : (priceHistory.length > 0 ? 0.3 : 0);

    const confidence = 0.4 * dataCompleteness + 0.3 * sourceAgreement + 0.2 * reconstructionQuality + 0.1 * marketDataCompleteness;

    const adjustedScore = rawScore * (0.75 + 0.25 * confidence);
    const score = clamp(adjustedScore);

    const rating = score >= 80 ? 'Very Safe' : score >= 65 ? 'Safe' : score >= 50 ? 'Borderline' : score >= 35 ? 'Risky' : 'Unsafe';

    const breakdown = {
      coverage: coverageScore != null ? Math.round(coverageScore) : null,
      balance: balanceScore != null ? Math.round(balanceScore) : null,
      stability: stabilityScore != null ? Math.round(stabilityScore) : null,
      growth: growthScore != null ? Math.round(growthScore) : null,
      market: marketScore != null ? Math.round(marketScore) : null,
      // Convention de signe : valeur positive = points retirés (pas -25, mais 25).
      penalties,
    };

    const metrics = {
      epsPayout: round4(epsPayout),
      fcfPayout: round4(fcfPayout),
      debtToFCF: round4(debtToFCF),
      dividendCAGR: round4(dividendCAGR),
      epsCAGR: round4(epsCAGR),
      revenueCAGR: round4(revenueCAGR),
      volatility: round4(volatility),
      drawdown: round4(drawdown),
    };

    const reconstructedUsed = reconstructedFields.length > 0;

    const explanation = buildExplanation({ breakdown, penalties, reconstructedFields, confidence });

    return {
      symbol,
      score,
      rating,
      confidence: round3(confidence),
      breakdown,
      metrics,
      reconstructed: { used: reconstructedUsed, fields: reconstructedFields },
      explanation,
    };
  } catch (e) {
    console.warn('[DivScore] erreur inattendue, retour score neutre', symbol, e && e.message);
    return {
      symbol,
      score: 50,
      rating: 'Borderline',
      confidence: 0,
      breakdown: { coverage: null, balance: null, stability: null, growth: null, market: null, penalties: 0 },
      metrics: { epsPayout: null, fcfPayout: null, debtToFCF: null, dividendCAGR: null, epsCAGR: null, revenueCAGR: null, volatility: null, drawdown: null },
      reconstructed: { used: false, fields: [] },
      explanation: ['Erreur interne lors du calcul — données probablement incomplètes.'],
    };
  }
}
