import {
  calculateGlicko2,
  applyEventWeight,
  determineEventWeightFromTeamCount,
  Glicko2Player,
  Glicko2OpponentMatch,
} from './glicko2.util';

describe('Glicko-2 Mathematical Engine (glicko2.util)', () => {
  describe('Glickman (2013) Worked Example Validation', () => {
    it('matches Dr. Mark Glickmans published worked example within rounding precision', () => {
      // Player: r = 1500, RD = 200, σ = 0.06
      const player: Glicko2Player = {
        rating: 1500,
        rd: 200,
        sigma: 0.06,
      };

      // 3 opponents from paper:
      // Opponent 1: r = 1400, RD = 30, s = 1 (Win)
      // Opponent 2: r = 1550, RD = 100, s = 0 (Loss)
      // Opponent 3: r = 1700, RD = 300, s = 0 (Loss)
      const matches: Glicko2OpponentMatch[] = [
        { rating: 1400, rd: 30, score: 1 },
        { rating: 1550, rd: 100, score: 0 },
        { rating: 1700, rd: 300, score: 0 },
      ];

      const result = calculateGlicko2(player, matches, 0.5);

      // Glickman paper expected values:
      // r' = 1464.06 (or ~1464.05)
      // RD' = 151.52
      // σ' = 0.05999
      expect(result.rating).toBeCloseTo(1464.051, 1);
      expect(result.rd).toBeCloseTo(151.52, 1);
      expect(result.sigma).toBeCloseTo(0.05999, 4);
      expect(result.rawDelta).toBeCloseTo(-35.95, 1);
    });
  });

  describe('No Games / Inactivity within Rating Period', () => {
    it('only increases RD while leaving rating and sigma untouched when no games are played', () => {
      const player: Glicko2Player = {
        rating: 1600,
        rd: 100,
        sigma: 0.06,
      };

      const result = calculateGlicko2(player, []);

      // Rating and sigma must not change
      expect(result.rating).toBe(1600);
      expect(result.sigma).toBe(0.06);
      expect(result.rawDelta).toBe(0);
      // RD increases from 100
      expect(result.rd).toBeGreaterThan(100);
    });
  });

  describe('Defensive Clamping (RD_MIN = 30, RD_MAX = 350)', () => {
    it('clamps RD to RD_MIN (30) when certainty is extremely high', () => {
      const player: Glicko2Player = {
        rating: 2000,
        rd: 30,
        sigma: 0.01,
      };

      // 50 matches against high certainty opponents
      const matches: Glicko2OpponentMatch[] = Array.from(
        { length: 50 },
        () => ({
          rating: 2000,
          rd: 30,
          score: 1,
        }),
      );

      const result = calculateGlicko2(player, matches);
      expect(result.rd).toBeGreaterThanOrEqual(30);
    });

    it('clamps RD to RD_MAX (350) and never exceeds 350', () => {
      const player: Glicko2Player = {
        rating: 1500,
        rd: 350,
        sigma: 0.06,
      };

      const result = calculateGlicko2(player, []);
      expect(result.rd).toBeLessThanOrEqual(350);
    });
  });

  describe('Event Weight Scaling (§5.5)', () => {
    it('scales only the rating delta, leaving RD and sigma untouched', () => {
      const player: Glicko2Player = {
        rating: 1500,
        rd: 200,
        sigma: 0.06,
      };

      const matches: Glicko2OpponentMatch[] = [
        { rating: 1400, rd: 30, score: 1 },
      ];

      const glicko = calculateGlicko2(player, matches);
      const withWeight = applyEventWeight(glicko, player, 1.5);

      // Raw delta scaled by 1.5
      expect(withWeight.finalRating).toBeCloseTo(
        player.rating + glicko.rawDelta * 1.5,
        4,
      );
      // RD and sigma must match pure Glicko
      expect(withWeight.rd).toBe(glicko.rd);
      expect(withWeight.sigma).toBe(glicko.sigma);
      expect(withWeight.eventWeight).toBe(1.5);
    });

    it('clamps event weight between EVENT_WEIGHT_MIN (1.0) and EVENT_WEIGHT_MAX (2.0)', () => {
      const player: Glicko2Player = { rating: 1500, rd: 100, sigma: 0.06 };
      const glicko = { rating: 1520, rd: 95, sigma: 0.06, rawDelta: 20 };

      const clampedLow = applyEventWeight(glicko, player, 0.5);
      expect(clampedLow.eventWeight).toBe(1.0);
      expect(clampedLow.finalRating).toBe(1520);

      const clampedHigh = applyEventWeight(glicko, player, 3.0);
      expect(clampedHigh.eventWeight).toBe(2.0);
      expect(clampedHigh.finalRating).toBe(1540);
    });
  });

  describe('determineEventWeightFromTeamCount', () => {
    it('returns 1.0 for small events (< 8 teams)', () => {
      expect(determineEventWeightFromTeamCount(4)).toBe(1.0);
      expect(determineEventWeightFromTeamCount(7)).toBe(1.0);
    });

    it('returns 1.25 for medium events (8-15 teams)', () => {
      expect(determineEventWeightFromTeamCount(8)).toBe(1.25);
      expect(determineEventWeightFromTeamCount(12)).toBe(1.25);
      expect(determineEventWeightFromTeamCount(15)).toBe(1.25);
    });

    it('returns 1.5 for large events (>= 16 teams)', () => {
      expect(determineEventWeightFromTeamCount(16)).toBe(1.5);
      expect(determineEventWeightFromTeamCount(32)).toBe(1.5);
    });
  });
});
