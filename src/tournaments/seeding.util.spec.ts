import { calculateEventWeight, getStandardSeedPairs } from './seeding.util';

describe('getStandardSeedPairs', () => {
  it('pairs two seeds', () => {
    expect(getStandardSeedPairs(2)).toEqual([{ seed1: 1, seed2: 2 }]);
  });

  it('pairs four seeds best against worst', () => {
    expect(getStandardSeedPairs(4)).toEqual([
      { seed1: 1, seed2: 4 },
      { seed1: 2, seed2: 3 },
    ]);
  });

  it('pairs eight seeds so the top two seeds can only meet in the final', () => {
    const pairs = getStandardSeedPairs(8);
    expect(pairs).toEqual([
      { seed1: 1, seed2: 8 },
      { seed1: 4, seed2: 5 },
      { seed1: 2, seed2: 7 },
      { seed1: 3, seed2: 6 },
    ]);

    const semiFinalists = [
      Math.min(pairs[0].seed1, pairs[1].seed1),
      Math.min(pairs[2].seed1, pairs[3].seed1),
    ];
    expect(semiFinalists).toEqual([1, 2]);
  });

  it('keeps every seed exactly once at each size', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const seen = getStandardSeedPairs(size)
        .flatMap((pair) => [pair.seed1, pair.seed2])
        .sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    }
  });

  it('pairs every seed with its complement', () => {
    for (const pair of getStandardSeedPairs(16)) {
      expect(pair.seed1 + pair.seed2).toBe(17);
    }
  });

  it('rejects a field that is not a power of two', () => {
    expect(() => getStandardSeedPairs(6)).toThrow(/power of two/);
    expect(() => getStandardSeedPairs(1)).toThrow(/power of two/);
  });
});

describe('calculateEventWeight', () => {
  it('tiers by unique team count', () => {
    expect(calculateEventWeight(4)).toBe(1.0);
    expect(calculateEventWeight(7)).toBe(1.0);
    expect(calculateEventWeight(8)).toBe(1.25);
    expect(calculateEventWeight(15)).toBe(1.25);
    expect(calculateEventWeight(16)).toBe(1.5);
  });

  it('clamps an override to the permitted range', () => {
    expect(calculateEventWeight(4, 1.75)).toBe(1.75);
    expect(calculateEventWeight(4, 0.2)).toBe(1.0);
    expect(calculateEventWeight(4, 9)).toBe(2.0);
  });

  it('falls back to the tier when no override is given', () => {
    expect(calculateEventWeight(16, null)).toBe(1.5);
    expect(calculateEventWeight(16, undefined)).toBe(1.5);
  });
});
