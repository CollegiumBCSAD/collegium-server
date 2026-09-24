import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import {
  BracketSide,
  GameTitle,
  MatchMode,
  Prisma,
  TeamMemberStatus,
} from '@prisma/client';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(gameTitle?: GameTitle) {
    if (!gameTitle) {
      return this.prisma.university.findMany({
        orderBy: { name: 'asc' },
      });
    }

    const [teams, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { gameTitle },
        orderBy: { glicko2_rating: 'desc' },
        include: {
          university: true,
        },
      }),
      this.prisma.match.findMany({
        where: {
          title: gameTitle,
          isVerified: true,
          matchMode: MatchMode.TOURNAMENT,
        },
        orderBy: {
          playedAt: 'desc',
        },
      }),
    ]);

    return teams.map((team) => {
      const teamMatches = matches.filter(
        (m) =>
          m.winnerId === team.universityId ||
          m.loserId === team.universityId ||
          m.winnerId === team.id ||
          m.loserId === team.id,
      );

      let wins = 0;
      let losses = 0;

      for (const m of teamMatches) {
        if (m.winnerId === team.universityId || m.winnerId === team.id) {
          wins++;
        } else if (m.loserId === team.universityId || m.loserId === team.id) {
          losses++;
        }
      }

      const totalMatches = wins + losses;
      const winRate =
        totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

      let streak = '-';
      if (teamMatches.length > 0) {
        const firstMatchWon =
          teamMatches[0].winnerId === team.universityId ||
          teamMatches[0].winnerId === team.id;
        let count = 0;
        for (const m of teamMatches) {
          const won =
            m.winnerId === team.universityId || m.winnerId === team.id;
          if (won === firstMatchWon) {
            count++;
          } else {
            break;
          }
        }
        streak = `${count}${firstMatchWon ? 'W' : 'L'}`;
      }

      const isProvisional = team.glicko2_rd >= 100 || totalMatches === 0;

      return {
        id: team.university.id,
        name: team.university.name,
        domain: team.university.domain,
        teamId: team.id,
        teamName: team.name,
        gameTitle: team.gameTitle,
        glicko2_rating: team.glicko2_rating,
        glicko2_rd: team.glicko2_rd,
        glicko2_sigma: team.glicko2_sigma,
        wins,
        losses,
        winRate,
        streak,
        isProvisional,
        createdAt: team.university.created_at.toISOString(),
      };
    });
  }

  async findOne(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      include: {
        teams: {
          orderBy: { gameTitle: 'asc' },
          // Explicit select rather than `true`: this route is @Public(), and a
          // bare include would publish every squad's inviteCode.
          select: {
            id: true,
            name: true,
            gameTitle: true,
            universityId: true,
            captainId: true,
            glicko2_rating: true,
            glicko2_rd: true,
            glicko2_sigma: true,
            last_rated_at: true,
            min_roster_size: true,
            max_roster_size: true,
            createdAt: true,
            captain: { select: { id: true, displayName: true } },
            members: {
              where: { status: TeamMemberStatus.ACCEPTED },
              orderBy: { joinedAt: 'asc' },
              select: {
                id: true,
                userId: true,
                gameHandle: true,
                preferredRole: true,
                status: true,
                joinedAt: true,
                user: { select: { id: true, displayName: true } },
              },
            },
          },
        },
      },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    return university;
  }

  async findMatches(
    id: string,
    gameTitle?: GameTitle,
    matchMode?: 'ALL' | 'TOURNAMENT' | 'SCRIM',
    page = 1,
    limit = 10,
  ) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    const conditions: Prisma.MatchWhereInput[] = [
      { OR: [{ winnerId: id }, { loserId: id }] },
    ];
    const where: Prisma.MatchWhereInput = {
      isVerified: true,
      loserId: { not: null },
      AND: conditions,
    };

    if (matchMode && matchMode !== 'ALL') {
      where.matchMode =
        matchMode === 'SCRIM' ? MatchMode.SCRIM : MatchMode.TOURNAMENT;
    }

    // A tournament match takes its game from the tournament, because
    // Match.title falls back to LOL whenever the tournament has no gameTitle.
    // A scrim has no tournament to read, so it has to be filtered on
    // Match.title - matching through the relation alone would silently drop
    // every scrim from the ledger.
    if (gameTitle) {
      conditions.push({
        OR: [
          { tournament: { gameTitle } },
          { tournamentId: null, title: gameTitle },
        ],
      });
    }

    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
    const safePage = Math.max(Math.trunc(page) || 1, 1);

    const total = await this.prisma.match.count({ where });

    const matches = await this.prisma.match.findMany({
      where,
      orderBy: { playedAt: 'desc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      include: {
        tournament: { select: { id: true, name: true, gameTitle: true } },
        scrim: {
          select: {
            id: true,
            team: { select: { id: true, name: true } },
            opponent: { select: { id: true, name: true } },
          },
        },
        winner: { select: { id: true, name: true } },
        loser: { select: { id: true, name: true } },
        playerStats: {
          orderBy: { kills: 'desc' },
          include: {
            user: { select: { id: true, displayName: true } },
            valorantStat: true,
          },
        },
      },
    });

    const roundIndex = await this.buildRoundIndex(matches);

    const items = matches.map((match) => {
      const won = match.winnerId === id;
      const opponent = won ? match.loser : match.winner;
      const isForfeit = match.isForfeit;
      const isScrim = match.matchMode === MatchMode.SCRIM;

      let result = won ? 'WIN' : 'LOSS';
      if (isForfeit) {
        result = won ? 'FORFEIT_WIN' : 'FORFEIT_LOSS';
      }

      const roundLabel = isScrim
        ? 'Scrim Practice'
        : this.roundLabel(match, roundIndex);

      return {
        id: match.id,
        // Only present on a scrim-mode entry - lets the scrim page route an
        // "edit this log" action back to the Scrim that produced it, since a
        // scrim's Match row is otherwise indistinguishable from a
        // tournament's from this ledger alone.
        scrimId: match.scrimId,
        playedAt: match.playedAt.toISOString(),
        tournamentId: match.tournamentId,
        tournamentName:
          match.tournament?.name ?? (isScrim ? 'Practice Scrimmage' : null),
        gameTitle: match.tournament?.gameTitle ?? match.title ?? null,
        round: match.round,
        bracketSide: match.bracketSide,
        roundLabel,
        matchMode: match.matchMode,
        isForfeit: match.isForfeit,
        result,
        opponent: opponent ? { id: opponent.id, name: opponent.name } : null,
        playerStats: match.playerStats.map((stat) => ({
          universityId: stat.universityId,
          userId: stat.userId,
          name: stat.summonerName,
          displayName: stat.user?.displayName ?? null,
          kills: stat.kills,
          deaths: stat.deaths,
          assists: stat.assists,
          win: stat.win,
          combatScore: stat.valorantStat?.combatScore ?? null,
          headshotPct: stat.valorantStat?.headshotPct ?? null,
          agentName: stat.valorantStat?.agentName ?? null,
        })),
      };
    });

    return {
      matches: items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(Math.ceil(total / safeLimit), 1),
    };
  }

  // TOURNAMENT TRACKER — derives a placement finish per tournament from the
  // bracket itself, so no placement has to be stored or hand-entered.
  // A squad's finish is decided by the last round it was eliminated in: the
  // deeper the elimination round sits in the tree, the smaller the bracket it
  // survived to (final -> 2nd, semis -> Top 4, quarters -> Top 8, ...).
  async findTournamentPlacements(id: string, gameTitle?: GameTitle) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    const played = await this.prisma.match.findMany({
      where: {
        matchMode: MatchMode.TOURNAMENT,
        tournamentId: { not: null },
        ...(gameTitle ? { title: gameTitle } : {}),
        OR: [{ winnerId: id }, { loserId: id }],
      },
      select: { tournamentId: true },
    });

    const tournamentIds = [
      ...new Set(
        played
          .map((match) => match.tournamentId)
          .filter((tid): tid is string => !!tid),
      ),
    ];

    if (tournamentIds.length === 0) return [];

    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: tournamentIds } },
      select: {
        id: true,
        name: true,
        gameTitle: true,
        status: true,
        image: true,
        startDate: true,
        createdAt: true,
        // Every match, not just the verified ones: an unplayed round is the
        // only signal that the bracket has not crowned a champion yet.
        matches: {
          select: {
            round: true,
            bracketSide: true,
            winnerId: true,
            loserId: true,
            isVerified: true,
            isForfeit: true,
            playedAt: true,
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    return tournaments.map((tournament) => {
      const bracketMatches = tournament.matches.filter((m) => m.round > 0);
      // In a double-elim tree a loss on the winners side is not an exit, so
      // only the losers bracket and the grand final can eliminate a squad.
      const hasLosersBracket = bracketMatches.some(
        (m) => m.bracketSide === BracketSide.LOSERS,
      );
      const eliminationMatches = hasLosersBracket
        ? bracketMatches.filter(
            (m) =>
              m.bracketSide === BracketSide.LOSERS ||
              m.bracketSide === BracketSide.GRAND_FINAL,
          )
        : bracketMatches;

      const rounds = [...new Set(eliminationMatches.map((m) => m.round))].sort(
        (a, b) => a - b,
      );

      // A pending match holds both contestants in winnerId/loserId, so only a
      // verified match says anything about who actually won or lost.
      const ourMatches = tournament.matches.filter(
        (m) => m.isVerified && (m.winnerId === id || m.loserId === id),
      );
      const wins = ourMatches.filter((m) => m.winnerId === id).length;
      const losses = ourMatches.filter((m) => m.loserId === id).length;

      const exit = eliminationMatches
        .filter((m) => m.isVerified && m.loserId === id)
        .sort((a, b) => b.round - a.round)[0];

      const bracketComplete =
        tournament.status === 'COMPLETED' ||
        (tournament.matches.length > 0 &&
          tournament.matches.every((m) => m.isVerified));

      let placement: number | null = null;
      let placementLabel = 'PARTICIPANT';

      if (!exit) {
        // Never eliminated: champion once the bracket has been played out.
        if (bracketComplete && ourMatches.length > 0) {
          placement = 1;
          placementLabel = 'CHAMPIONS';
        } else {
          placementLabel = 'STILL ALIVE';
        }
      } else {
        const positionFromEnd = rounds.length - 1 - rounds.indexOf(exit.round);
        if (positionFromEnd <= 0) {
          placement = 2;
          placementLabel = 'RUNNER-UP';
        } else {
          // Eliminated n rounds from the end means the squad outlasted every
          // team below a bracket of 2^(n+1).
          placement = Math.pow(2, positionFromEnd + 1);
          placementLabel = `TOP ${placement}`;
        }
      }

      return {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        gameTitle: tournament.gameTitle,
        image: tournament.image,
        status: tournament.status,
        startDate: (tournament.startDate ?? tournament.createdAt).toISOString(),
        placement,
        placementLabel,
        wins,
        losses,
        matchesPlayed: ourMatches.length,
      };
    });
  }

  // A round's name depends on how far it sits from the end of its own bracket,
  // so the sibling rounds of each tournament have to be known before any one
  // match can be labelled.
  private async buildRoundIndex(matches: { tournamentId: string | null }[]) {
    const tournamentIds = [
      ...new Set(
        matches
          .map((match) => match.tournamentId)
          .filter((tournamentId): tournamentId is string => !!tournamentId),
      ),
    ];

    const index = new Map<string, number[]>();
    if (tournamentIds.length === 0) {
      return index;
    }

    const siblings = await this.prisma.match.findMany({
      where: { tournamentId: { in: tournamentIds } },
      select: { tournamentId: true, round: true, bracketSide: true },
    });

    for (const sibling of siblings) {
      const key = `${sibling.tournamentId}:${sibling.bracketSide ?? ''}`;
      const rounds = index.get(key) ?? [];
      if (!rounds.includes(sibling.round)) {
        rounds.push(sibling.round);
      }
      index.set(key, rounds);
    }

    for (const rounds of index.values()) {
      rounds.sort((a, b) => a - b);
    }

    return index;
  }

  // Mirrors the bracket view's naming so a history row reads the same as the
  // bracket it came from.
  private roundLabel(
    match: {
      tournamentId: string | null;
      round: number;
      bracketSide: BracketSide | null;
    },
    index: Map<string, number[]>,
  ): string {
    if (match.bracketSide === BracketSide.GRAND_FINAL) return 'GRAND FINALS';
    if (match.round === 0) return 'GROUP STAGE';

    const rounds = index.get(
      `${match.tournamentId}:${match.bracketSide ?? ''}`,
    ) ?? [match.round];
    const positionFromEnd = rounds.length - 1 - rounds.indexOf(match.round);
    const prefix = match.bracketSide === BracketSide.LOSERS ? 'LOSERS ' : '';

    if (positionFromEnd === 0) {
      if (match.bracketSide === BracketSide.LOSERS) return 'LOSERS FINAL';
      if (match.bracketSide === BracketSide.WINNERS) return 'WINNERS FINAL';
      return 'GRAND FINALS';
    }
    if (positionFromEnd === 1) return `${prefix}SEMIFINALS`;
    if (positionFromEnd === 2 && match.bracketSide !== BracketSide.LOSERS) {
      return `${prefix}QUARTERFINALS`;
    }
    return `${prefix}ROUND ${match.round}`;
  }

  async create(createUniversityDto: CreateUniversityDto) {
    const { name, domain } = createUniversityDto;

    // Check if a university with the same name already exists
    const existingUniversity = await this.prisma.university.findUnique({
      where: { domain },
    });

    if (existingUniversity) {
      throw new ConflictException(
        'A university with this name already exists.',
      );
    }

    // Create the new university
    return this.prisma.university.create({
      data: {
        name,
        domain,
      },
    });
  }

  async update(id: string, updateUniversityDto: UpdateUniversityDto) {
    const university = await this.prisma.university.findUnique({
      where: { id },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    if (
      updateUniversityDto.domain &&
      updateUniversityDto.domain !== university.domain
    ) {
      const conflict = await this.prisma.university.findUnique({
        where: { domain: updateUniversityDto.domain },
      });
      if (conflict) {
        throw new ConflictException(
          'Another university is already using that domain.',
        );
      }
    }

    return this.prisma.university.update({
      where: { id },
      data: updateUniversityDto,
    });
  }

  async remove(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    try {
      return await this.prisma.university.delete({ where: { id } });
    } catch {
      throw new ConflictException(
        'This university has registered users, teams, or matches and cannot be removed.',
      );
    }
  }
}
