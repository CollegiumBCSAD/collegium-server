import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  BracketFormat,
  BracketSection,
  GameTitle,
  MatchMode,
  Prisma,
  Role,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateBracketDto, SeedingMode } from './dto/generate-bracket.dto';

interface SeedPair {
  seed1: number;
  seed2: number;
}

@Injectable()
export class BracketService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates standard tournament seeding pairs for power-of-two N participants.
   * e.g., N=8 -> 1v8, 4v5, 3v6, 2v7.
   */
  getStandardSeedPairs(n: number): SeedPair[] {
    if (n === 2) {
      return [{ seed1: 1, seed2: 2 }];
    }
    if (n === 4) {
      return [
        { seed1: 1, seed2: 4 },
        { seed1: 2, seed2: 3 },
      ];
    }
    if (n === 8) {
      return [
        { seed1: 1, seed2: 8 },
        { seed1: 4, seed2: 5 },
        { seed1: 3, seed2: 6 },
        { seed1: 2, seed2: 7 },
      ];
    }

    // General recursive / standard seeding generator for arbitrary power of 2
    let seeds = [1, 2];
    while (seeds.length < n) {
      const nextSize = seeds.length * 2;
      const nextSeeds: number[] = [];
      for (const s of seeds) {
        nextSeeds.push(s);
        nextSeeds.push(nextSize + 1 - s);
      }
      seeds = nextSeeds;
    }

    const pairs: SeedPair[] = [];
    for (let i = 0; i < seeds.length; i += 2) {
      pairs.push({ seed1: seeds[i], seed2: seeds[i + 1] });
    }
    return pairs;
  }

  /**
   * Computes the Event Weight tier based on unique participating teams.
   * Small: < 8 teams -> 1.0x
   * Medium: 8–15 teams -> 1.25x
   * Large: >= 16 teams -> 1.5x
   * Clamped to [1.0, 2.0] if override provided.
   */
  calculateEventWeight(teamCount: number, override?: number): number {
    if (override !== undefined && override !== null && !isNaN(override)) {
      return Math.min(2.0, Math.max(1.0, Number(override)));
    }
    if (teamCount >= 16) return 1.5;
    if (teamCount >= 8) return 1.25;
    return 1.0;
  }

  /**
   * LOCK ROSTERS & GENERATE BRACKET (Atomic transaction)
   */
  async generateBracket(
    tournamentId: string,
    dto: GenerateBracketDto = {},
    user?: { id: string; role: Role },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        universities: true,
        warRoom: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // RBAC: Only the tournament's organizer or an Admin may lock and generate
    if (user) {
      if (
        user.role !== Role.ADMIN &&
        tournament.organizerId &&
        tournament.organizerId !== user.id
      ) {
        throw new ForbiddenException(
          'Only the tournament organizer or an administrator can lock rosters and generate the bracket.',
        );
      }
    }

    // Guard 1: Status must be UPCOMING
    if (tournament.status !== TournamentStatus.UPCOMING) {
      throw new BadRequestException(
        'Bracket can only be generated for UPCOMING tournaments.',
      );
    }

    // Guard 2: Reject double locking
    if (tournament.lockedAt) {
      throw new BadRequestException(
        'Tournament bracket is already locked. Bracket generation is irreversible.',
      );
    }

    // Guard 3: War Room must already exist per spec
    if (!tournament.warRoom) {
      throw new BadRequestException(
        'Bracket generation rejected: War Room does not exist for this tournament. Instantiate the War Room first.',
      );
    }

    // Format dispatch
    const format = tournament.bracketFormat || BracketFormat.SINGLE_ELIM;
    if (
      format === BracketFormat.SWISS ||
      format === BracketFormat.ROUND_ROBIN ||
      format === BracketFormat.TWO_STAGE
    ) {
      throw new NotImplementedException(
        `Bracket format ${format} is not yet implemented.`,
      );
    }

    // Resolve participating teams
    // For Valorant scope: resolve registered universities to Team (title = VALORANT)
    const universities = tournament.universities;
    if (universities.length < 2) {
      throw new BadRequestException(
        'At least 2 participating teams are required before generating a bracket.',
      );
    }

    const universityIds = universities.map((u) => u.id);
    const candidateTeams = await this.prisma.team.findMany({
      where: {
        universityId: { in: universityIds },
        gameTitle: GameTitle.VALORANT,
      },
      include: {
        members: {
          where: { status: 'ACCEPTED' },
          include: { user: true },
        },
        university: true,
      },
    });

    if (candidateTeams.length < 2) {
      throw new BadRequestException(
        'At least 2 eligible Valorant teams are required to generate the bracket.',
      );
    }

    // Guard 4: Snapshot check — Each team must have at least 5 eligible Valorant athletes
    for (const team of candidateTeams) {
      if (team.members.length < 5) {
        throw new BadRequestException(
          `Team "${team.name}" (${team.university?.name || 'Unknown'}) has fewer than 5 verified Valorant athletes (found ${team.members.length}). Minimum roster size is 5.`,
        );
      }
    }

    // Order seeds
    let orderedTeams = [...candidateTeams];
    if (dto.seeds && dto.seeds.length > 0) {
      const seedMap = new Map(candidateTeams.map((t) => [t.id, t]));
      const ordered: typeof candidateTeams = [];
      for (const id of dto.seeds) {
        const t = seedMap.get(id);
        if (t) {
          ordered.push(t);
          seedMap.delete(id);
        }
      }
      // Append any unseeded teams
      for (const t of seedMap.values()) {
        ordered.push(t);
      }
      orderedTeams = ordered;
    } else if (dto.seedingMode === SeedingMode.RANDOM) {
      orderedTeams.sort(() => Math.random() - 0.5);
    }

    // Calculate Event Weight
    const eventWeight = this.calculateEventWeight(
      orderedTeams.length,
      dto.eventWeightOverride,
    );

    // Atomically execute bracket generation in transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Snapshot rosters (TournamentRoster + TournamentRosterMember)
      for (let i = 0; i < orderedTeams.length; i++) {
        const team = orderedTeams[i];
        const roster = await tx.tournamentRoster.create({
          data: {
            tournamentId: tournament.id,
            teamId: team.id,
            seed: i + 1,
          },
        });

        for (let mIdx = 0; mIdx < team.members.length; mIdx++) {
          const member = team.members[mIdx];
          await tx.tournamentRosterMember.create({
            data: {
              tournamentRosterId: roster.id,
              userId: member.userId,
              gameHandle: member.gameHandle,
              role: member.preferredRole,
              isSubstitute: mIdx >= 5,
            },
          });
        }
      }

      // 2. Generate tree based on format
      if (format === BracketFormat.DOUBLE_ELIM) {
        await this.generateDoubleEliminationTree(
          tx,
          tournament.id,
          orderedTeams,
          dto.bestOfOverrides,
        );
      } else {
        await this.generateSingleEliminationTree(
          tx,
          tournament.id,
          orderedTeams,
          dto.bestOfOverrides,
        );
      }

      // 3. Freeze event_weight, locked_at, and transition to ONGOING
      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          lockedAt: new Date(),
          eventWeight,
          eventWeightOverride: dto.eventWeightOverride ?? null,
          status: TournamentStatus.ONGOING,
        },
      });

      return tx.tournament.findUnique({
        where: { id: tournament.id },
        include: {
          matches: {
            include: {
              team1: true,
              team2: true,
              winnerTeam: true,
              loserTeam: true,
              playerStats: true,
            },
            orderBy: [{ round: 'asc' }, { matchOrder: 'asc' }],
          },
          rosters: {
            include: {
              team: true,
              members: { include: { user: true } },
            },
            orderBy: { seed: 'asc' },
          },
          warRoom: true,
        },
      });
    });
  }

  /**
   * SINGLE ELIMINATION GENERATOR
   * Pre-creates the entire single-elimination tree, linking matches via next_match_id.
   * Handles byes for non-power-of-two participant counts.
   */
  private async generateSingleEliminationTree(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    teams: Array<{ id: string; name: string }>,
    bestOfOverrides?: Record<string, number>,
  ) {
    const K = teams.length;
    let N = 2;
    while (N < K) N *= 2;

    const totalRounds = Math.log2(N);
    const seedPairs = this.getStandardSeedPairs(N);
    const byesCount = N - K;

    // Build map from seed (1-indexed) to team
    const seedToTeam = new Map<number, { id: string; name: string }>();
    for (let i = 0; i < teams.length; i++) {
      seedToTeam.set(i + 1, teams[i]);
    }

    // Pre-create match placeholder records round-by-round from final down to R1
    // Round totalRounds: 1 match (Grand Final)
    // Round totalRounds - 1: 2 matches (Semifinals)
    // ...
    // Round 1: N/2 matches
    const roundMatches: Map<number, string[]> = new Map();

    // Work backwards to link nextMatchId
    for (let r = totalRounds; r >= 1; r--) {
      const matchCount = Math.pow(2, totalRounds - r);
      const matchIds: string[] = [];
      const isFinal = r === totalRounds;
      const isSemis = r === totalRounds - 1;
      const defaultBo = isFinal ? 5 : 3;

      let roundName = `ROUND ${r}`;
      if (isFinal) roundName = 'GRAND FINAL';
      else if (isSemis) roundName = 'SEMIFINALS';
      else if (r === totalRounds - 2) roundName = 'QUARTERFINALS';

      for (let m = 0; m < matchCount; m++) {
        // Next match destination is match m >> 1 in round r + 1
        const nextRoundMatches = roundMatches.get(r + 1);
        const nextMatchId = nextRoundMatches ? nextRoundMatches[Math.floor(m / 2)] : null;

        const bestOf =
          bestOfOverrides?.[roundName] ??
          bestOfOverrides?.[`R${r}`] ??
          defaultBo;

        const match = await tx.match.create({
          data: {
            title: GameTitle.VALORANT,
            matchMode: MatchMode.TOURNAMENT,
            tournamentId,
            gameDuration: 0,
            gameMode: 'STANDARD',
            platformId: 'PH',
            round: r,
            roundName,
            bracketSection: isFinal ? BracketSection.GRAND_FINAL : BracketSection.UPPER,
            matchOrder: m + 1,
            bestOf,
            nextMatchId,
            isVerified: false,
          },
        });
        matchIds.push(match.id);
      }
      roundMatches.set(r, matchIds);
    }

    // Populate Round 1 pairings with teams and byes
    const r1MatchIds = roundMatches.get(1)!;
    for (let i = 0; i < seedPairs.length; i++) {
      const pair = seedPairs[i];
      const matchId = r1MatchIds[i];

      const team1 = seedToTeam.get(pair.seed1);
      const team2 = seedToTeam.get(pair.seed2);

      // Check if this match is a BYE
      // Byes are awarded to the highest seeds when opponent exceeds K
      const isBye = !team2;

      if (isBye) {
        // Auto-advance seeded team into round 2
        // Bye matches are flagged so rating engine will exclude them
        await tx.match.update({
          where: { id: matchId },
          data: {
            team1Id: team1?.id ?? null,
            team2Id: null,
            winnerTeamId: team1?.id ?? null,
            isBye: true,
            isVerified: true,
          },
        });

        // Advance winner directly into downstream round 2 slot
        const match = await tx.match.findUnique({ where: { id: matchId } });
        if (match?.nextMatchId && team1) {
          const nextMatch = await tx.match.findUnique({
            where: { id: match.nextMatchId },
          });
          if (nextMatch) {
            const isSlot1 = i % 2 === 0;
            await tx.match.update({
              where: { id: match.nextMatchId },
              data: isSlot1 ? { team1Id: team1.id } : { team2Id: team1.id },
            });
          }
        }
      } else {
        await tx.match.update({
          where: { id: matchId },
          data: {
            team1Id: team1?.id ?? null,
            team2Id: team2?.id ?? null,
            isBye: false,
          },
        });
      }
    }
  }

  /**
   * DOUBLE ELIMINATION GENERATOR (Spec 2.4)
   * Handles upper bracket, lower bracket (alternating minor and major rounds),
   * and Grand Final with pre-linked winner and loser destinations.
   */
  private async generateDoubleEliminationTree(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    teams: Array<{ id: string; name: string }>,
    bestOfOverrides?: Record<string, number>,
  ) {
    const K = teams.length;
    let N = 2;
    while (N < K) N *= 2;

    const seedPairs = this.getStandardSeedPairs(N);
    const seedToTeam = new Map<number, { id: string; name: string }>();
    for (let i = 0; i < teams.length; i++) {
      seedToTeam.set(i + 1, teams[i]);
    }

    const ubRoundsCount = Math.log2(N);
    const lbRoundsCount = 2 * (ubRoundsCount - 1);

    // 1. Create Grand Final
    const gfBo = bestOfOverrides?.['GRAND FINAL'] ?? bestOfOverrides?.['GF'] ?? 5;
    const grandFinal = await tx.match.create({
      data: {
        title: GameTitle.VALORANT,
        matchMode: MatchMode.TOURNAMENT,
        tournamentId,
        gameDuration: 0,
        gameMode: 'STANDARD',
        platformId: 'PH',
        round: ubRoundsCount + 1,
        roundName: 'GRAND FINAL',
        bracketSection: BracketSection.GRAND_FINAL,
        matchOrder: 1,
        bestOf: gfBo,
        isVerified: false,
      },
    });

    // 2. Pre-create Lower Bracket rounds backwards from LB Final to LB R1
    // For N=8: LB R4 (1), LB R3 (1), LB R2 (2), LB R1 (2)
    const lbMatches: Map<number, string[]> = new Map();

    for (let lbR = lbRoundsCount; lbR >= 1; lbR--) {
      // Determine match count in this LB round
      // Pattern:
      // lbR = 1 -> N/4
      // lbR = 2 -> N/4
      // lbR = 3 -> N/8
      // lbR = 4 -> N/8
      const stage = Math.floor((lbR - 1) / 2); // 0 for r=1,2; 1 for r=3,4
      const matchCount = Math.max(1, N / Math.pow(2, stage + 2));

      const isLbFinal = lbR === lbRoundsCount;
      const defaultBo = isLbFinal ? 5 : 3;
      const roundName = isLbFinal ? 'LOWER BRACKET FINAL' : `LB ROUND ${lbR}`;
      const bestOf =
        bestOfOverrides?.[roundName] ??
        bestOfOverrides?.[`LB_R${lbR}`] ??
        defaultBo;

      const ids: string[] = [];
      for (let m = 0; m < matchCount; m++) {
        let nextMatchId: string | null = null;
        if (isLbFinal) {
          nextMatchId = grandFinal.id;
        } else {
          const nextLbMatches = lbMatches.get(lbR + 1)!;
          // In minor -> major: match m feeds into match m
          // In major -> minor: match 2m and 2m+1 feed into match m
          const isMinorToMajor = lbR % 2 === 1;
          const targetIndex = isMinorToMajor ? m : Math.floor(m / 2);
          nextMatchId = nextLbMatches[targetIndex];
        }

        const match = await tx.match.create({
          data: {
            title: GameTitle.VALORANT,
            matchMode: MatchMode.TOURNAMENT,
            tournamentId,
            gameDuration: 0,
            gameMode: 'STANDARD',
            platformId: 'PH',
            round: lbR,
            roundName,
            bracketSection: BracketSection.LOWER,
            matchOrder: m + 1,
            bestOf,
            nextMatchId,
            isVerified: false,
          },
        });
        ids.push(match.id);
      }
      lbMatches.set(lbR, ids);
    }

    // 3. Pre-create Upper Bracket rounds backwards from UB Final (R_ub) to UB R1
    const ubMatches: Map<number, string[]> = new Map();

    for (let ubR = ubRoundsCount; ubR >= 1; ubR--) {
      const matchCount = Math.pow(2, ubRoundsCount - ubR);
      const isUbFinal = ubR === ubRoundsCount;
      const roundName = isUbFinal ? 'UPPER BRACKET FINAL' : `UB ROUND ${ubR}`;
      const bestOf =
        bestOfOverrides?.[roundName] ??
        bestOfOverrides?.[`UB_R${ubR}`] ??
        3;

      const ids: string[] = [];
      for (let m = 0; m < matchCount; m++) {
        // Winner destination:
        let nextMatchId: string | null = null;
        if (isUbFinal) {
          nextMatchId = grandFinal.id;
        } else {
          const nextUb = ubMatches.get(ubR + 1)!;
          nextMatchId = nextUb[Math.floor(m / 2)];
        }

        // Loser dropdown destination:
        let loserNextMatchId: string | null = null;
        if (isUbFinal) {
          // UB Final loser drops to LB Final (LB R_max)
          const lbFinalMatches = lbMatches.get(lbRoundsCount)!;
          loserNextMatchId = lbFinalMatches[0];
        } else if (ubR === 1) {
          // UB R1 losers drop to LB R1
          const lbR1 = lbMatches.get(1)!;
          loserNextMatchId = lbR1[Math.floor(m / 2)];
        } else {
          // UB R_k (k > 1) losers drop to LB major round 2*(k - 1)
          const targetLbR = 2 * (ubR - 1);
          const lbTargetMatches = lbMatches.get(targetLbR)!;
          // Cross placement to avoid immediate rematches
          const targetIdx = (lbTargetMatches.length - 1) - m;
          loserNextMatchId = lbTargetMatches[Math.max(0, targetIdx)];
        }

        const match = await tx.match.create({
          data: {
            title: GameTitle.VALORANT,
            matchMode: MatchMode.TOURNAMENT,
            tournamentId,
            gameDuration: 0,
            gameMode: 'STANDARD',
            platformId: 'PH',
            round: ubR,
            roundName,
            bracketSection: BracketSection.UPPER,
            matchOrder: m + 1,
            bestOf,
            nextMatchId,
            loserNextMatchId,
            isVerified: false,
          },
        });
        ids.push(match.id);
      }
      ubMatches.set(ubR, ids);
    }

    // 4. Populate UB R1 with seeds and byes
    const ubR1Ids = ubMatches.get(1)!;
    for (let i = 0; i < seedPairs.length; i++) {
      const pair = seedPairs[i];
      const matchId = ubR1Ids[i];

      const team1 = seedToTeam.get(pair.seed1);
      const team2 = seedToTeam.get(pair.seed2);
      const isBye = !team2;

      if (isBye) {
        // Award bye to highest seed; auto-advance to UB R2
        await tx.match.update({
          where: { id: matchId },
          data: {
            team1Id: team1?.id ?? null,
            team2Id: null,
            winnerTeamId: team1?.id ?? null,
            isBye: true,
            isVerified: true,
          },
        });

        const match = await tx.match.findUnique({ where: { id: matchId } });
        if (match?.nextMatchId && team1) {
          const isSlot1 = i % 2 === 0;
          await tx.match.update({
            where: { id: match.nextMatchId },
            data: isSlot1 ? { team1Id: team1.id } : { team2Id: team1.id },
          });
        }
      } else {
        await tx.match.update({
          where: { id: matchId },
          data: {
            team1Id: team1?.id ?? null,
            team2Id: team2?.id ?? null,
            isBye: false,
          },
        });
      }
    }
  }

  /**
   * ADVANCE MATCH RESULT (Spec 2.6)
   * Idempotent winner & loser slot propagation, bracket reset creation, and tournament completion.
   */
  async advanceMatchResult(
    tournamentId: string,
    matchId: string,
    winnerTeamId: string,
    loserTeamId: string,
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
      include: { tournament: true },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    // Idempotency: If already verified with identical winner/loser, return early
    if (
      match.isVerified &&
      match.winnerTeamId === winnerTeamId &&
      match.loserTeamId === loserTeamId
    ) {
      return match;
    }

    return this.prisma.$transaction(async (tx) => {
      // Update the match result
      const updatedMatch = await tx.match.update({
        where: { id: matchId },
        data: {
          winnerTeamId,
          loserTeamId,
          isVerified: true,
        },
      });

      // 1. Advance Winner into next_match_id
      if (match.nextMatchId) {
        const nextMatch = await tx.match.findUnique({
          where: { id: match.nextMatchId },
        });

        if (nextMatch) {
          // If team1 is empty or already this team, put in slot 1; else slot 2
          const data: Prisma.MatchUpdateInput = {};
          if (!nextMatch.team1Id || nextMatch.team1Id === winnerTeamId) {
            data.team1 = { connect: { id: winnerTeamId } };
          } else {
            data.team2 = { connect: { id: winnerTeamId } };
          }
          await tx.match.update({
            where: { id: match.nextMatchId },
            data,
          });
        }
      }

      // 2. Advance Loser into loser_next_match_id (Double Elimination)
      if (match.loserNextMatchId) {
        const loserNext = await tx.match.findUnique({
          where: { id: match.loserNextMatchId },
        });

        if (loserNext) {
          const data: Prisma.MatchUpdateInput = {};
          if (!loserNext.team1Id || loserNext.team1Id === loserTeamId) {
            data.team1 = { connect: { id: loserTeamId } };
          } else {
            data.team2 = { connect: { id: loserTeamId } };
          }
          await tx.match.update({
            where: { id: match.loserNextMatchId },
            data,
          });
        }
      }

      // 3. Grand Final & Bracket Reset Handling
      if (
        match.bracketSection === BracketSection.GRAND_FINAL &&
        !match.isBracketReset
      ) {
        // In double elimination: team1 is UB undefeated winner, team2 is LB winner
        const isLbWinner = winnerTeamId === match.team2Id;

        if (isLbWinner) {
          // LB team won! Both teams have 1 loss -> Create separate Bracket Reset match
          const existingReset = await tx.match.findFirst({
            where: {
              tournamentId,
              isBracketReset: true,
            },
          });

          if (!existingReset) {
            await tx.match.create({
              data: {
                title: match.title,
                matchMode: MatchMode.TOURNAMENT,
                tournamentId,
                gameDuration: 0,
                gameMode: 'STANDARD',
                platformId: 'PH',
                round: match.round + 1,
                roundName: 'GRAND FINALS RESET',
                bracketSection: BracketSection.BRACKET_RESET,
                matchOrder: 1,
                bestOf: 5,
                team1Id: match.team1Id, // UB team
                team2Id: match.team2Id, // LB team
                isBracketReset: true,
                isVerified: false,
              },
            });
          }
          // Do NOT complete tournament yet; reset match must be played!
        } else {
          // UB winner won Grand Final -> Champion determined!
          await tx.tournament.update({
            where: { id: tournamentId },
            data: { status: TournamentStatus.COMPLETED },
          });

          // TODO(ranking): Trigger Glicko-2 rating period calculation here
        }
      } else if (
        match.bracketSection === BracketSection.BRACKET_RESET ||
        match.isBracketReset
      ) {
        // Reset match concluded -> Tournament is complete!
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.COMPLETED },
        });

        // TODO(ranking): Trigger Glicko-2 rating period calculation here
      } else if (!match.nextMatchId) {
        // Single Elimination final concluded!
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.COMPLETED },
        });

        // TODO(ranking): Trigger Glicko-2 rating period calculation here
      }

      return updatedMatch;
    });
  }

  /**
   * Helper to instantiate a War Room for a tournament (used before bracket lock).
   */
  async ensureWarRoom(tournamentId: string) {
    return this.prisma.tournamentWarRoom.upsert({
      where: { tournamentId },
      create: { tournamentId },
      update: {},
    });
  }
}
