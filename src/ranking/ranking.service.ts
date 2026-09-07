import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  GameTitle,
  Team,
  TournamentApplicationStatus,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateGlicko2,
  applyEventWeight,
  determineEventWeightFromTeamCount,
  Glicko2OpponentMatch,
  Glicko2Player,
} from './glicko2.util';

export interface RatingPeriodClosureSummary {
  tournamentId: string;
  closedAt: Date;
  eventWeight: number;
  teamsUpdated: Array<{
    teamId: string;
    teamName: string;
    ratingBefore: number;
    ratingAfter: number;
    rdBefore: number;
    rdAfter: number;
    rawDelta: number;
  }>;
}

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Closes the rating period for a tournament in batch.
   * Follows claude_collegium-server-reference-v2.md §5.3 - §5.5.
   *
   * 1. Validates tournament status and idempotency (rating_period_closed_at).
   * 2. Resolves participating teams and takes an immutable pre-period snapshot.
   * 3. Calculates Glicko-2 ratings over all tournament matches in batch.
   * 4. Applies event weight scaling to the rating delta.
   * 5. Atomically persists Team updates, RatingHistory entries, and closes Tournament.
   */
  async closeTournamentRatingPeriod(
    tournamentId: string,
  ): Promise<RatingPeriodClosureSummary> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      throw new NotFoundException(
        `Tournament with ID ${tournamentId} not found.`,
      );
    }

    if (tournament.rating_period_closed_at) {
      throw new ConflictException(
        `Rating period for tournament "${tournament.name}" has already been closed.`,
      );
    }

    // Fetch all verified matches for this tournament
    const matches = await this.prisma.match.findMany({
      where: {
        tournamentId,
        isVerified: true,
      },
    });

    const now = new Date();

    // If tournament ended with 0 verified matches (e.g. cancelled/abandoned), close cleanly without rating mutations
    if (matches.length === 0) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.COMPLETED,
          rating_period_closed_at: now,
        },
      });

      return {
        tournamentId,
        closedAt: now,
        eventWeight: tournament.event_weight ?? 1.0,
        teamsUpdated: [],
      };
    }

    // Resolve participating teams from matches
    const contestantToTeamMap = new Map<string, Team>();
    const uniqueContestantIds = new Set<string>();

    for (const m of matches) {
      if (m.winnerId) uniqueContestantIds.add(m.winnerId);
      if (m.loserId) uniqueContestantIds.add(m.loserId);
    }

    for (const contestantId of uniqueContestantIds) {
      const team = await this.resolveTeam(contestantId, tournament);
      if (team) {
        contestantToTeamMap.set(contestantId, team);
      } else {
        this.logger.warn(
          `Could not resolve team for contestant ${contestantId} in tournament ${tournamentId}`,
        );
      }
    }

    // Collect unique participating teams
    const teams = Array.from(
      new Map(
        Array.from(contestantToTeamMap.values()).map((t) => [t.id, t]),
      ).values(),
    );

    // If no teams could be resolved, mark closed and return
    if (teams.length === 0) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.COMPLETED,
          rating_period_closed_at: now,
        },
      });

      return {
        tournamentId,
        closedAt: now,
        eventWeight: tournament.event_weight ?? 1.0,
        teamsUpdated: [],
      };
    }

    // Pre-period immutable snapshot of all teams entering this rating period (§5.3)
    const snapshot = new Map<string, Glicko2Player>();
    for (const team of teams) {
      snapshot.set(team.id, {
        rating: team.glicko2_rating,
        rd: team.glicko2_rd,
        sigma: team.glicko2_sigma,
      });
    }

    // Build match lists for each team evaluated against the snapshot
    const teamMatchLists = new Map<string, Glicko2OpponentMatch[]>();
    for (const team of teams) {
      teamMatchLists.set(team.id, []);
    }

    for (const m of matches) {
      if (!m.winnerId || !m.loserId) continue;

      const winnerTeam = contestantToTeamMap.get(m.winnerId);
      const loserTeam = contestantToTeamMap.get(m.loserId);

      if (!winnerTeam || !loserTeam || winnerTeam.id === loserTeam.id) {
        continue;
      }

      const winnerSnapshot = snapshot.get(winnerTeam.id)!;
      const loserSnapshot = snapshot.get(loserTeam.id)!;

      // Winner plays against snapshot of Loser, score = 1
      teamMatchLists.get(winnerTeam.id)?.push({
        rating: loserSnapshot.rating,
        rd: loserSnapshot.rd,
        score: 1,
      });

      // Loser plays against snapshot of Winner, score = 0
      teamMatchLists.get(loserTeam.id)?.push({
        rating: winnerSnapshot.rating,
        rd: winnerSnapshot.rd,
        score: 0,
      });
    }

    // Event weight resolution (§5.5)
    const eventWeight =
      tournament.event_weight ??
      determineEventWeightFromTeamCount(teams.length);

    // Calculate rating updates for each team
    const updates: Array<{
      team: Team;
      playerBefore: Glicko2Player;
      finalRating: number;
      newRd: number;
      newSigma: number;
      rawDelta: number;
    }> = [];

    for (const team of teams) {
      const playerBefore = snapshot.get(team.id)!;
      const teamMatches = teamMatchLists.get(team.id) || [];

      const glickoResult = calculateGlicko2(playerBefore, teamMatches);
      const weightedResult = applyEventWeight(
        glickoResult,
        playerBefore,
        eventWeight,
      );

      updates.push({
        team,
        playerBefore,
        finalRating: weightedResult.finalRating,
        newRd: weightedResult.rd,
        newSigma: weightedResult.sigma,
        rawDelta: weightedResult.rawDelta,
      });
    }

    // Atomic persistence in a transaction
    await this.prisma.$transaction(async (tx) => {
      // 1. Update Team records
      for (const u of updates) {
        await tx.team.update({
          where: { id: u.team.id },
          data: {
            glicko2_rating: u.finalRating,
            glicko2_rd: u.newRd,
            glicko2_sigma: u.newSigma,
            rd_anchor: u.newRd,
            last_rated_at: now,
          },
        });

        // 2. Insert RatingHistory record
        await tx.ratingHistory.create({
          data: {
            team_id: u.team.id,
            tournament_id: tournament.id,
            rating_before: u.playerBefore.rating,
            rd_before: u.playerBefore.rd,
            sigma_before: u.playerBefore.sigma,
            rating_after: u.finalRating,
            rd_after: u.newRd,
            sigma_after: u.newSigma,
            raw_delta: u.rawDelta,
            event_weight: eventWeight,
            closed_at: now,
          },
        });
      }

      // 3. Mark tournament closed and completed
      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: TournamentStatus.COMPLETED,
          rating_period_closed_at: now,
          event_weight: eventWeight,
        },
      });
    });

    this.logger.log(
      `Successfully closed rating period for tournament "${tournament.name}" (${tournament.id}). Updated ${updates.length} teams with event weight ${eventWeight}.`,
    );

    return {
      tournamentId,
      closedAt: now,
      eventWeight,
      teamsUpdated: updates.map((u) => ({
        teamId: u.team.id,
        teamName: u.team.name,
        ratingBefore: u.playerBefore.rating,
        ratingAfter: u.finalRating,
        rdBefore: u.playerBefore.rd,
        rdAfter: u.newRd,
        rawDelta: u.rawDelta,
      })),
    };
  }

  /**
   * Fetches rating history for a specific team.
   */
  async getTeamRatingHistory(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} not found.`);
    }

    return this.prisma.ratingHistory.findMany({
      where: { team_id: teamId },
      orderBy: { closed_at: 'desc' },
      include: {
        tournament: {
          select: {
            id: true,
            name: true,
            gameTitle: true,
          },
        },
      },
    });
  }

  /**
   * Resolves a tournament contestant ID (which may be a team ID or university ID) to a Team.
   */
  private async resolveTeam(
    contestantId: string,
    tournament: { id: string; gameTitle: GameTitle | null },
  ): Promise<Team | null> {
    // 1. Direct team lookup
    const directTeam = await this.prisma.team.findUnique({
      where: { id: contestantId },
    });
    if (directTeam) return directTeam;

    // 2. Tournament application lookup
    const app = await this.prisma.tournamentApplication.findFirst({
      where: {
        tournamentId: tournament.id,
        universityId: contestantId,
        status: TournamentApplicationStatus.APPROVED,
      },
    });

    if (app?.teamId) {
      const appTeam = await this.prisma.team.findUnique({
        where: { id: app.teamId },
      });
      if (appTeam) return appTeam;
    }

    // 3. Fallback: Find team for this university and game title
    const gameTitle = tournament.gameTitle ?? GameTitle.VALORANT;
    return this.prisma.team.findFirst({
      where: {
        universityId: contestantId,
        gameTitle,
      },
    });
  }
}
