import {
  calculateGlicko2,
  applyEventWeight,
  Glicko2Player,
  Glicko2OpponentMatch,
} from './glicko2.util';

describe('Rating Period Order Independence (§5.3)', () => {
  interface MatchRecord {
    team1Id: string;
    team2Id: string;
    winnerId: string;
  }

  /**
   * Helper that simulates batch rating calculation for a tournament with a pre-period snapshot.
   */
  function runTournamentBatch(
    teams: Record<string, Glicko2Player>,
    matches: MatchRecord[],
    eventWeight: number = 1.0,
  ): Record<string, { rating: number; rd: number; sigma: number }> {
    // 1. Immutable pre-period snapshot
    const snapshot: Record<string, Glicko2Player> = {};
    for (const [id, t] of Object.entries(teams)) {
      snapshot[id] = { ...t };
    }

    // 2. Build match list per team against snapshot values
    const teamMatches: Record<string, Glicko2OpponentMatch[]> = {};
    for (const id of Object.keys(teams)) {
      teamMatches[id] = [];
    }

    for (const m of matches) {
      const isTeam1Winner = m.winnerId === m.team1Id;

      // Team 1 plays against snapshot of Team 2
      teamMatches[m.team1Id].push({
        rating: snapshot[m.team2Id].rating,
        rd: snapshot[m.team2Id].rd,
        score: isTeam1Winner ? 1 : 0,
      });

      // Team 2 plays against snapshot of Team 1
      teamMatches[m.team2Id].push({
        rating: snapshot[m.team1Id].rating,
        rd: snapshot[m.team1Id].rd,
        score: isTeam1Winner ? 0 : 1,
      });
    }

    // 3. Calculate updates for all teams
    const results: Record<
      string,
      { rating: number; rd: number; sigma: number }
    > = {};
    for (const [id, pBefore] of Object.entries(snapshot)) {
      const glicko = calculateGlicko2(pBefore, teamMatches[id]);
      const weighted = applyEventWeight(glicko, pBefore, eventWeight);
      results[id] = {
        rating: weighted.finalRating,
        rd: weighted.rd,
        sigma: weighted.sigma,
      };
    }

    return results;
  }

  it('guarantees identical ratings regardless of match execution or evaluation order', () => {
    // 4 teams in a mini tournament
    const initialTeams: Record<string, Glicko2Player> = {
      'team-ust': { rating: 1500, rd: 350, sigma: 0.06 },
      'team-admu': { rating: 1550, rd: 200, sigma: 0.06 },
      'team-dlsu': { rating: 1480, rd: 250, sigma: 0.06 },
      'team-up': { rating: 1600, rd: 150, sigma: 0.06 },
    };

    // Forward match order (Round 1 then Finals)
    const matchesForward: MatchRecord[] = [
      { team1Id: 'team-ust', team2Id: 'team-admu', winnerId: 'team-ust' },
      { team1Id: 'team-dlsu', team2Id: 'team-up', winnerId: 'team-up' },
      { team1Id: 'team-ust', team2Id: 'team-up', winnerId: 'team-ust' }, // Grand final
      { team1Id: 'team-admu', team2Id: 'team-dlsu', winnerId: 'team-dlsu' }, // Consolation
    ];

    // Reversed match order
    const matchesReversed = [...matchesForward].reverse();

    // Shuffled match order
    const matchesShuffled = [
      matchesForward[2],
      matchesForward[0],
      matchesForward[3],
      matchesForward[1],
    ];

    const resultsForward = runTournamentBatch(
      initialTeams,
      matchesForward,
      1.25,
    );
    const resultsReversed = runTournamentBatch(
      initialTeams,
      matchesReversed,
      1.25,
    );
    const resultsShuffled = runTournamentBatch(
      initialTeams,
      matchesShuffled,
      1.25,
    );

    // Assert UST's rating is mathematically identical across all match orderings
    expect(resultsForward['team-ust'].rating).toBeCloseTo(
      resultsReversed['team-ust'].rating,
      10,
    );
    expect(resultsForward['team-ust'].rating).toBeCloseTo(
      resultsShuffled['team-ust'].rating,
      10,
    );

    // Assert all other teams are also identical
    for (const id of Object.keys(initialTeams)) {
      expect(resultsForward[id].rating).toBeCloseTo(
        resultsReversed[id].rating,
        10,
      );
      expect(resultsForward[id].rd).toBeCloseTo(resultsReversed[id].rd, 10);
      expect(resultsForward[id].sigma).toBeCloseTo(
        resultsReversed[id].sigma,
        10,
      );

      expect(resultsForward[id].rating).toBeCloseTo(
        resultsShuffled[id].rating,
        10,
      );
      expect(resultsForward[id].rd).toBeCloseTo(resultsShuffled[id].rd, 10);
      expect(resultsForward[id].sigma).toBeCloseTo(
        resultsShuffled[id].sigma,
        10,
      );
    }

    // UST won 2 games as underdog -> rating must have increased
    expect(resultsForward['team-ust'].rating).toBeGreaterThan(1500);
  });
});
