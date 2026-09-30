import { GameTitle } from '@prisma/client';

export interface SeriesGameResult {
  winnerId: string;
}

export type SeriesTier = 'EARLY' | 'LATE' | 'FINAL';

export interface SeriesOverrides {
  bestOfEarly?: number | null;
  bestOfLate?: number | null;
  bestOfFinal?: number | null;
}

// Mobile Legends escalates the series as the stakes rise. Call of Duty: Mobile
// is a flat best of three at every stage (Hardpoint, Search and Destroy,
// Control). Valorant and League report one result per match.
const SERIES_DEFAULTS: Record<GameTitle, Record<SeriesTier, number>> = {
  [GameTitle.MLBB]: { EARLY: 3, LATE: 5, FINAL: 7 },
  [GameTitle.CODM]: { EARLY: 3, LATE: 3, FINAL: 3 },
  [GameTitle.VALORANT]: { EARLY: 1, LATE: 1, FINAL: 1 },
  [GameTitle.LOL]: { EARLY: 1, LATE: 1, FINAL: 1 },
};

const OVERRIDE_KEYS: Record<SeriesTier, keyof SeriesOverrides> = {
  EARLY: 'bestOfEarly',
  LATE: 'bestOfLate',
  FINAL: 'bestOfFinal',
};

export function seriesLengthFor(
  tier: SeriesTier,
  gameTitle: GameTitle | null,
  overrides?: SeriesOverrides | null,
): number {
  const override = overrides?.[OVERRIDE_KEYS[tier]];
  if (typeof override === 'number' && override > 0) return override;
  return SERIES_DEFAULTS[gameTitle ?? GameTitle.LOL][tier];
}

export function tierForEliminationRound(
  round: number,
  totalRounds: number,
): SeriesTier {
  if (round >= totalRounds) return 'FINAL';
  if (round === totalRounds - 1) return 'LATE';
  return 'EARLY';
}

export function gamesNeededToWin(bestOf: number): number {
  return Math.floor(Math.max(1, bestOf) / 2) + 1;
}

export function tallySeriesWins(
  games: SeriesGameResult[],
): Map<string, number> {
  const wins = new Map<string, number>();
  for (const game of games) {
    wins.set(game.winnerId, (wins.get(game.winnerId) ?? 0) + 1);
  }
  return wins;
}

export function resolveSeriesWinner(
  games: SeriesGameResult[],
  bestOf: number,
): string | null {
  const needed = gamesNeededToWin(bestOf);
  for (const [universityId, won] of tallySeriesWins(games)) {
    if (won >= needed) return universityId;
  }
  return null;
}
