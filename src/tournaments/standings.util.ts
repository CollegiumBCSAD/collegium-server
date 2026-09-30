export interface StandingInput {
  universityId: string;
  matchWins: number;
  matchLosses: number;
  mapsWon: number;
  mapsLost: number;
}

export interface StandingRow extends StandingInput {
  mapDiff: number;
  rank: number;
  tied: boolean;
}

export type HeadToHead = Map<string, Map<string, number>>;

function headToHeadWinsWithin(
  universityId: string,
  group: StandingInput[],
  headToHead: HeadToHead,
): number {
  const beaten = headToHead.get(universityId);
  if (!beaten) return 0;
  let wins = 0;
  for (const rival of group) {
    if (rival.universityId === universityId) continue;
    wins += beaten.get(rival.universityId) ?? 0;
  }
  return wins;
}

export function rankStandings(
  rows: StandingInput[],
  headToHead: HeadToHead = new Map(),
): StandingRow[] {
  const byWins = new Map<number, StandingInput[]>();
  for (const row of rows) {
    const bucket = byWins.get(row.matchWins) ?? [];
    bucket.push(row);
    byWins.set(row.matchWins, bucket);
  }

  const ordered: { row: StandingInput; keys: number[] }[] = [];
  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const group = byWins.get(wins)!;
    const keyed = group.map((row) => ({
      row,
      keys: [
        headToHeadWinsWithin(row.universityId, group, headToHead),
        row.mapsWon - row.mapsLost,
        row.mapsWon,
      ],
    }));
    keyed.sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) {
        if (a.keys[i] !== b.keys[i]) return b.keys[i] - a.keys[i];
      }
      return 0;
    });
    ordered.push(...keyed.map((e) => ({ row: e.row, keys: [wins, ...e.keys] })));
  }

  return ordered.map((entry, index) => {
    const sameAs = (other?: { keys: number[] }) =>
      !!other && other.keys.every((key, i) => key === entry.keys[i]);
    return {
      ...entry.row,
      mapDiff: entry.row.mapsWon - entry.row.mapsLost,
      rank: index + 1,
      tied: sameAs(ordered[index - 1]) || sameAs(ordered[index + 1]),
    };
  });
}
