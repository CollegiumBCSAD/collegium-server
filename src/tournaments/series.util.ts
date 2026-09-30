export interface SeriesGameResult {
  winnerId: string;
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
