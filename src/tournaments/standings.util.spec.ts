import { HeadToHead, rankStandings, StandingInput } from './standings.util';

function row(
  universityId: string,
  matchWins: number,
  matchLosses: number,
  mapsWon = 0,
  mapsLost = 0,
): StandingInput {
  return { universityId, matchWins, matchLosses, mapsWon, mapsLost };
}

function h2h(...results: [string, string][]): HeadToHead {
  const map: HeadToHead = new Map();
  for (const [winner, loser] of results) {
    const beaten = map.get(winner) ?? new Map<string, number>();
    beaten.set(loser, (beaten.get(loser) ?? 0) + 1);
    map.set(winner, beaten);
  }
  return map;
}

describe('rankStandings', () => {
  it('ranks by match wins first', () => {
    const ranked = rankStandings([
      row('ateneo', 1, 2),
      row('umak', 3, 0),
      row('dlsu', 2, 1),
    ]);
    expect(ranked.map((r) => r.universityId)).toEqual([
      'umak',
      'dlsu',
      'ateneo',
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.every((r) => !r.tied)).toBe(true);
  });

  it('breaks a two-way tie on head-to-head, ignoring a worse map differential', () => {
    const ranked = rankStandings(
      [row('umak', 2, 1, 4, 3), row('feu', 2, 1, 6, 1)],
      h2h(['umak', 'feu']),
    );
    expect(ranked.map((r) => r.universityId)).toEqual(['umak', 'feu']);
    expect(ranked.every((r) => !r.tied)).toBe(true);
  });

  it('falls through to map differential when head-to-head is circular', () => {
    const ranked = rankStandings(
      [row('a', 2, 1, 4, 3), row('b', 2, 1, 5, 2), row('c', 2, 1, 3, 4)],
      h2h(['a', 'b'], ['b', 'c'], ['c', 'a']),
    );
    expect(ranked.map((r) => r.universityId)).toEqual(['b', 'a', 'c']);
  });

  it('falls through to map differential when the teams never met', () => {
    const ranked = rankStandings([row('a', 2, 1, 3, 3), row('b', 2, 1, 5, 1)]);
    expect(ranked.map((r) => r.universityId)).toEqual(['b', 'a']);
    expect(ranked[0].mapDiff).toBe(4);
  });

  it('breaks an equal map differential on total maps won', () => {
    const ranked = rankStandings([row('a', 1, 1, 2, 1), row('b', 1, 1, 4, 3)]);
    expect(ranked.map((r) => r.universityId)).toEqual(['b', 'a']);
  });

  it('flags a tie that no criterion resolves', () => {
    const ranked = rankStandings([row('a', 1, 1, 2, 2), row('b', 1, 1, 2, 2)]);
    expect(ranked.every((r) => r.tied)).toBe(true);
  });

  it('does not flag teams separated by a criterion', () => {
    const ranked = rankStandings([row('a', 1, 1, 3, 1), row('b', 1, 1, 2, 2)]);
    expect(ranked.every((r) => !r.tied)).toBe(true);
  });

  it('returns nothing for an empty group stage', () => {
    expect(rankStandings([])).toEqual([]);
  });
});
