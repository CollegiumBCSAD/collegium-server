import { GameTitle } from '@prisma/client';
import {
  orderForStandardPairing,
  largestPowerOfTwoWithin,
} from '../tournaments/seeding.util';
import {
  SeriesOverrides,
  seriesLengthFor,
  tierForEliminationRound,
} from '../tournaments/series.util';

export interface BracketMatchRow {
  round: number;
  slot: number;
  bestOf: number;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  isBye: boolean;
}

export function bracketSizeFor(teamCount: number): number {
  const within = largestPowerOfTwoWithin(teamCount);
  return within === teamCount ? teamCount : within * 2;
}

export function buildSingleEliminationBracket(
  seeded: string[],
  gameTitle: GameTitle,
  overrides?: SeriesOverrides | null,
): BracketMatchRow[] {
  if (seeded.length < 2) {
    throw new Error('A bracket needs at least 2 teams');
  }

  const bracketSize = bracketSizeFor(seeded.length);
  const totalRounds = Math.log2(bracketSize);

  const field: (string | null)[] = [
    ...seeded,
    ...(Array(bracketSize - seeded.length).fill(null) as null[]),
  ];
  const ordered = orderForStandardPairing(field);

  const bestOfAt = (round: number) =>
    seriesLengthFor(
      tierForEliminationRound(round, totalRounds),
      gameTitle,
      overrides,
    );

  const rows: BracketMatchRow[] = [];

  for (let slot = 0; slot < bracketSize / 2; slot++) {
    const teamAId = ordered[slot * 2];
    const teamBId = ordered[slot * 2 + 1];
    const isBye = teamAId === null || teamBId === null;

    rows.push({
      round: 1,
      slot,
      bestOf: isBye ? 1 : bestOfAt(1),
      teamAId,
      teamBId,
      winnerId: isBye ? (teamAId ?? teamBId) : null,
      isBye,
    });
  }

  for (
    let round = 2, slots = bracketSize / 4;
    slots >= 1;
    round++, slots /= 2
  ) {
    for (let slot = 0; slot < slots; slot++) {
      rows.push({
        round,
        slot,
        bestOf: bestOfAt(round),
        teamAId: null,
        teamBId: null,
        winnerId: null,
        isBye: false,
      });
    }
  }

  for (const row of rows) {
    if (row.round !== 1 || !row.winnerId) continue;
    const next = rows.find(
      (candidate) =>
        candidate.round === 2 && candidate.slot === Math.floor(row.slot / 2),
    );
    if (!next) continue;
    if (row.slot % 2 === 0) next.teamAId = row.winnerId;
    else next.teamBId = row.winnerId;
  }

  return rows;
}

export function nextSlotFor(round: number, slot: number) {
  return { round: round + 1, slot: Math.floor(slot / 2), isTeamA: slot % 2 === 0 };
}
