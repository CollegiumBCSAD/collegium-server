import { GameTitle } from '@prisma/client';
import {
  bracketSizeFor,
  buildSingleEliminationBracket,
  nextSlotFor,
} from './bracket.util';

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => `seed${i + 1}`);

describe('bracketSizeFor', () => {
  it.each([
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [6, 8],
    [8, 8],
    [12, 16],
    [16, 16],
  ])('rounds %i teams up to a %i slot bracket', (count, expected) => {
    expect(bracketSizeFor(count)).toBe(expected);
  });
});

describe('buildSingleEliminationBracket', () => {
  it('rejects a field of fewer than two teams', () => {
    expect(() =>
      buildSingleEliminationBracket(teams(1), GameTitle.MLBB),
    ).toThrow();
  });

  it.each([2, 3, 4, 5, 6, 8, 12, 16])(
    'creates one bye per empty slot for %i teams',
    (count) => {
      const rows = buildSingleEliminationBracket(teams(count), GameTitle.MLBB);
      const byes = rows.filter((row) => row.isBye);
      expect(byes).toHaveLength(bracketSizeFor(count) - count);
      for (const bye of byes) {
        expect(bye.winnerId).not.toBeNull();
        expect(bye.teamBId).toBeNull();
      }
    },
  );

  it.each([2, 3, 4, 5, 6, 8, 12, 16])(
    'gives every round one slot per pairing for %i teams',
    (count) => {
      const rows = buildSingleEliminationBracket(teams(count), GameTitle.MLBB);
      const size = bracketSizeFor(count);

      for (let round = 1, slots = size / 2; slots >= 1; round++, slots /= 2) {
        const inRound = rows.filter((row) => row.round === round);
        expect(inRound).toHaveLength(slots);
        expect(new Set(inRound.map((row) => row.slot)).size).toBe(slots);
      }
    },
  );

  it('places every team exactly once in round one', () => {
    const rows = buildSingleEliminationBracket(teams(6), GameTitle.MLBB);
    const placed = rows
      .filter((row) => row.round === 1)
      .flatMap((row) => [row.teamAId, row.teamBId])
      .filter((id): id is string => id !== null);

    expect(placed.sort()).toEqual(teams(6).sort());
  });

  it('keeps the top two seeds apart until the final', () => {
    for (const count of [3, 5, 6, 7, 11, 13]) {
      const rows = buildSingleEliminationBracket(teams(count), GameTitle.MLBB);
      const size = bracketSizeFor(count);
      const finalRound = Math.log2(size);

      const halfOf = (seed: string) => {
        const row = rows.find(
          (candidate) =>
            candidate.round === 1 &&
            (candidate.teamAId === seed || candidate.teamBId === seed),
        )!;
        let slot = row.slot;
        for (let round = 1; round <= finalRound - 2; round++) {
          slot = Math.floor(slot / 2);
        }
        return slot;
      };

      expect(halfOf('seed1')).not.toBe(halfOf('seed2'));
    }
  });

  it('advances a bye winner straight into round two', () => {
    const rows = buildSingleEliminationBracket(teams(6), GameTitle.MLBB);
    const byes = rows.filter((row) => row.isBye);

    for (const bye of byes) {
      const { round, slot, isTeamA } = nextSlotFor(bye.round, bye.slot);
      const next = rows.find(
        (row) => row.round === round && row.slot === slot,
      )!;
      expect(isTeamA ? next.teamAId : next.teamBId).toBe(bye.winnerId);
    }
  });

  it('escalates the series length for mobile legends', () => {
    const rows = buildSingleEliminationBracket(teams(8), GameTitle.MLBB);
    const played = (round: number) =>
      rows.find((row) => row.round === round && !row.isBye)!.bestOf;

    expect(played(1)).toBe(3);
    expect(played(2)).toBe(5);
    expect(played(3)).toBe(7);
  });

  it('keeps call of duty flat at best of three', () => {
    const rows = buildSingleEliminationBracket(teams(8), GameTitle.CODM);
    for (const row of rows.filter((candidate) => !candidate.isBye)) {
      expect(row.bestOf).toBe(3);
    }
  });

  it('honours an organizer series override', () => {
    const rows = buildSingleEliminationBracket(teams(8), GameTitle.MLBB, {
      bestOfEarly: 1,
      bestOfFinal: 5,
    });

    expect(rows.find((row) => row.round === 1)!.bestOf).toBe(1);
    expect(rows.find((row) => row.round === 2)!.bestOf).toBe(5);
    expect(rows.find((row) => row.round === 3)!.bestOf).toBe(5);
  });
});
