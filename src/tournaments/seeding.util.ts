export interface SeedPair {
  seed1: number;
  seed2: number;
}

export function getStandardSeedPairs(n: number): SeedPair[] {
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`Seed pair count must be a power of two, received ${n}`);
  }

  let seeds = [1, 2];
  while (seeds.length < n) {
    const nextSize = seeds.length * 2;
    const nextSeeds: number[] = [];
    for (const seed of seeds) {
      nextSeeds.push(seed);
      nextSeeds.push(nextSize + 1 - seed);
    }
    seeds = nextSeeds;
  }

  const pairs: SeedPair[] = [];
  for (let i = 0; i < seeds.length; i += 2) {
    pairs.push({ seed1: seeds[i], seed2: seeds[i + 1] });
  }
  return pairs;
}

export function calculateEventWeight(
  teamCount: number,
  override?: number | null,
): number {
  if (override !== undefined && override !== null && !isNaN(override)) {
    return Math.min(2.0, Math.max(1.0, Number(override)));
  }
  if (teamCount >= 16) return 1.5;
  if (teamCount >= 8) return 1.25;
  return 1.0;
}

export function orderForStandardPairing<T>(seeded: T[]): T[] {
  return getStandardSeedPairs(seeded.length).flatMap((pair) => [
    seeded[pair.seed1 - 1],
    seeded[pair.seed2 - 1],
  ]);
}

export function largestPowerOfTwoWithin(count: number): number {
  let size = 1;
  while (size * 2 <= count) size *= 2;
  return size;
}
