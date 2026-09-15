/**
 * Glicko-2 Rating Engine Utility
 *
 * Implements the 7-step Glicko-2 rating algorithm as specified by Dr. Mark E. Glickman (2013)
 * and detailed in claude_collegium-server-reference-v2.md §5.
 */

export const GLICKO2_CONSTANTS = {
  SCALE: 173.7178,
  R0: 1500,
  RD0: 350,
  SIGMA0: 0.06,
  TAU: 0.5,
  EPSILON: 0.000001,
  RD_MIN: 30,
  RD_MAX: 350,
  EVENT_WEIGHT_MIN: 1.0,
  EVENT_WEIGHT_MAX: 2.0,
} as const;

export interface Glicko2Player {
  rating: number; // r
  rd: number; // RD
  sigma: number; // σ
}

export interface Glicko2OpponentMatch {
  rating: number; // r_j
  rd: number; // RD_j
  score: number; // s_j: 1 for win, 0 for loss/forfeit-loss
}

export interface Glicko2Result {
  rating: number; // r' (unscaled)
  rd: number; // RD'
  sigma: number; // σ'
  rawDelta: number; // r' - r
}

export interface RatingWithEventWeightResult extends Glicko2Result {
  finalRating: number; // r + (rawDelta * eventWeight)
  eventWeight: number;
}

/**
 * Step 1 helper: g(φ)
 */
export function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/**
 * Step 1 helper: E(μ, μ_j, φ_j)
 */
export function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Computes Glicko-2 update for a single team given their matches in a rating period.
 * Follows Glickman (2013) Steps 1–7.
 */
export function calculateGlicko2(
  player: Glicko2Player,
  matches: Glicko2OpponentMatch[],
  tau: number = GLICKO2_CONSTANTS.TAU,
  epsilon: number = GLICKO2_CONSTANTS.EPSILON,
): Glicko2Result {
  const { SCALE, RD_MIN, RD_MAX } = GLICKO2_CONSTANTS;

  // Convert to Glicko-2 scale
  const mu = (player.rating - GLICKO2_CONSTANTS.R0) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.sigma;

  // If no matches played in this rating period, only RD increases per Step 6 of Glickman (no games)
  if (matches.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    const newRd = Math.min(Math.max(phiStar * SCALE, RD_MIN), RD_MAX);
    return {
      rating: player.rating,
      rd: newRd,
      sigma,
      rawDelta: 0,
    };
  }

  // Precompute g(φ_j) and E(μ, μ_j, φ_j)
  const precomputed = matches.map((m) => {
    const muJ = (m.rating - GLICKO2_CONSTANTS.R0) / SCALE;
    const phiJ = m.rd / SCALE;
    const gVal = g(phiJ);
    const eVal = E(mu, muJ, phiJ);
    return {
      gVal,
      eVal,
      score: m.score,
    };
  });

  // Step 2: Estimated variance v
  let vInv = 0;
  for (const item of precomputed) {
    vInv += item.gVal * item.gVal * item.eVal * (1 - item.eVal);
  }
  const v = 1 / vInv;

  // Step 3: Estimated improvement delta
  let sumOutcome = 0;
  for (const item of precomputed) {
    sumOutcome += item.gVal * (item.score - item.eVal);
  }
  const delta = v * sumOutcome;

  // Step 4: Determine new volatility σ' via Illinois / regula falsi algorithm
  const a = Math.log(sigma * sigma);
  const tauSq = tau * tau;
  const phiSq = phi * phi;
  const deltaSq = delta * delta;

  const f = (x: number): number => {
    const expX = Math.exp(x);
    const denom = phiSq + v + expX;
    const part1 = (expX * (deltaSq - phiSq - v - expX)) / (2 * denom * denom);
    const part2 = (x - a) / tauSq;
    return part1 - part2;
  };

  // Set initial bounds A and B
  let A = a;
  let B: number;

  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  // Illinois method iteration
  let iterations = 0;
  const maxIterations = 1000;

  while (Math.abs(B - A) > epsilon && iterations < maxIterations) {
    iterations++;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2; // Illinois modification to prevent stagnation
    }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);

  // Step 5: Update prior standard deviation φ*
  const phiStar = Math.sqrt(phiSq + newSigma * newSigma);

  // Step 6: Update φ' and μ'
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * sumOutcome;

  // Step 7: Convert back to Glicko scale
  const newRating = newMu * SCALE + GLICKO2_CONSTANTS.R0;
  const unclampedRd = newPhi * SCALE;
  const newRd = Math.min(Math.max(unclampedRd, RD_MIN), RD_MAX);

  return {
    rating: newRating,
    rd: newRd,
    sigma: newSigma,
    rawDelta: newRating - player.rating,
  };
}

/**
 * Applies Event Weight post-processing (§5.5).
 * Only scales the rating delta; RD and σ are untouched.
 */
export function applyEventWeight(
  glickoResult: Glicko2Result,
  playerBefore: Glicko2Player,
  eventWeight: number,
): RatingWithEventWeightResult {
  const boundedWeight = Math.min(
    Math.max(eventWeight, GLICKO2_CONSTANTS.EVENT_WEIGHT_MIN),
    GLICKO2_CONSTANTS.EVENT_WEIGHT_MAX,
  );

  const finalRating =
    playerBefore.rating + glickoResult.rawDelta * boundedWeight;

  return {
    ...glickoResult,
    finalRating,
    eventWeight: boundedWeight,
  };
}

/**
 * Determines default event weight from unique participating team count (§5.5).
 * Small (<8): 1.0x
 * Medium (8–15): 1.25x
 * Large (>=16): 1.5x
 */
export function determineEventWeightFromTeamCount(teamCount: number): number {
  if (teamCount >= 16) return 1.5;
  if (teamCount >= 8) return 1.25;
  return 1.0;
}
