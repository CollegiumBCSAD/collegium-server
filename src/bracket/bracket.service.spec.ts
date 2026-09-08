import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BracketFormat,
  BracketSection,
  GameTitle,
  Role,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BracketService } from './bracket.service';

describe('BracketService', () => {
  let service: BracketService;

  // In-memory mock store for transaction simulation
  let matchStore: any[] = [];
  let rosterStore: any[] = [];
  let rosterMemberStore: any[] = [];
  let tournamentStore: Record<string, any> = {};

  const mockTx = {
    match: {
      create: jest.fn((args) => {
        const item = { id: `match-${matchStore.length + 1}`, ...args.data };
        matchStore.push(item);
        return Promise.resolve(item);
      }),
      findUnique: jest.fn((args) => {
        return Promise.resolve(matchStore.find((m) => m.id === args.where.id) || null);
      }),
      findFirst: jest.fn((args) => {
        return Promise.resolve(
          matchStore.find(
            (m) =>
              (!args.where.tournamentId || m.tournamentId === args.where.tournamentId) &&
              (!args.where.isBracketReset || m.isBracketReset === args.where.isBracketReset),
          ) || null,
        );
      }),
      update: jest.fn((args) => {
        const item = matchStore.find((m) => m.id === args.where.id);
        if (item) {
          if (args.data.team1?.connect?.id) item.team1Id = args.data.team1.connect.id;
          if (args.data.team2?.connect?.id) item.team2Id = args.data.team2.connect.id;
          Object.assign(item, args.data);
        }
        return Promise.resolve(item);
      }),
    },
    tournamentRoster: {
      create: jest.fn((args) => {
        const item = { id: `roster-${rosterStore.length + 1}`, ...args.data };
        rosterStore.push(item);
        return Promise.resolve(item);
      }),
    },
    tournamentRosterMember: {
      create: jest.fn((args) => {
        const item = { id: `member-${rosterMemberStore.length + 1}`, ...args.data };
        rosterMemberStore.push(item);
        return Promise.resolve(item);
      }),
    },
    tournament: {
      update: jest.fn((args) => {
        const t = tournamentStore[args.where.id];
        if (t) Object.assign(t, args.data);
        return Promise.resolve(t);
      }),
      findUnique: jest.fn((args) => {
        const t = tournamentStore[args.where.id];
        return Promise.resolve({
          ...t,
          matches: matchStore.filter((m) => m.tournamentId === args.where.id),
          rosters: rosterStore.filter((r) => r.tournamentId === args.where.id),
        });
      }),
    },
  };

  const mockPrismaService = {
    tournament: {
      findUnique: jest.fn((args) => Promise.resolve(tournamentStore[args.where.id] || null)),
      update: jest.fn((args) => {
        const t = tournamentStore[args.where.id];
        if (t) Object.assign(t, args.data);
        return Promise.resolve(t);
      }),
    },
    team: {
      findMany: jest.fn(),
    },
    match: {
      findFirst: jest.fn((args) => {
        return Promise.resolve(
          matchStore.find((m) => m.id === args.where.id) || null,
        );
      }),
      findUnique: jest.fn((args) => {
        return Promise.resolve(
          matchStore.find((m) => m.id === args.where.id) || null,
        );
      }),
      update: jest.fn((args) => {
        const item = matchStore.find((m) => m.id === args.where.id);
        if (item) {
          if (args.data.team1?.connect?.id) item.team1Id = args.data.team1.connect.id;
          if (args.data.team2?.connect?.id) item.team2Id = args.data.team2.connect.id;
          Object.assign(item, args.data);
        }
        return Promise.resolve(item);
      }),
    },
    $transaction: jest.fn((cb) => cb(mockTx)),
  };

  beforeEach(async () => {
    matchStore = [];
    rosterStore = [];
    rosterMemberStore = [];
    tournamentStore = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BracketService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<BracketService>(BracketService);
    jest.clearAllMocks();
  });

  function createMockTeams(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `team-${i + 1}`,
      name: `Team ${i + 1}`,
      gameTitle: GameTitle.VALORANT,
      universityId: `uni-${i + 1}`,
      university: { id: `uni-${i + 1}`, name: `University ${i + 1}` },
      members: Array.from({ length: 5 }, (__, m) => ({
        userId: `user-${i + 1}-${m + 1}`,
        gameHandle: `Player${m + 1}#PH1`,
        preferredRole: 'Duelist',
        status: 'ACCEPTED',
        user: { id: `user-${i + 1}-${m + 1}` },
      })),
    }));
  }

  // AC 1: 8-team Single Elimination
  it('AC 1: generates a complete 8-team single-elimination tree with 7 matches, correct linkage and 1v8/4v5/3v6/2v7 seeding', async () => {
    const teams = createMockTeams(8);
    const tournamentId = 'tourney-8';

    tournamentStore[tournamentId] = {
      id: tournamentId,
      name: 'Valorant Collegiate Open',
      status: TournamentStatus.UPCOMING,
      bracketFormat: BracketFormat.SINGLE_ELIM,
      organizerId: 'org-1',
      lockedAt: null,
      universities: teams.map((t) => t.university),
      warRoom: { id: 'wr-1', tournamentId },
    };

    mockPrismaService.team.findMany.mockResolvedValue(teams);

    const result = await service.generateBracket(
      tournamentId,
      { seeds: teams.map((t) => t.id) },
      { id: 'org-1', role: Role.ORGANIZER },
    );

    expect(result.status).toBe(TournamentStatus.ONGOING);
    expect(result.lockedAt).toBeDefined();

    // 8 teams in single elim = 7 matches total
    expect(matchStore.length).toBe(7);

    // Round 1 has 4 matches
    const r1Matches = matchStore.filter((m) => m.round === 1);
    expect(r1Matches.length).toBe(4);

    // Seeding check: 1v8, 4v5, 3v6, 2v7
    expect(r1Matches[0].team1Id).toBe('team-1');
    expect(r1Matches[0].team2Id).toBe('team-8');

    expect(r1Matches[1].team1Id).toBe('team-4');
    expect(r1Matches[1].team2Id).toBe('team-5');

    expect(r1Matches[2].team1Id).toBe('team-3');
    expect(r1Matches[2].team2Id).toBe('team-6');

    expect(r1Matches[3].team1Id).toBe('team-2');
    expect(r1Matches[3].team2Id).toBe('team-7');

    // Linkage check: Round 1 matches feed into Round 2 (Semifinals)
    const r2Matches = matchStore.filter((m) => m.round === 2);
    expect(r2Matches.length).toBe(2);
    expect(r1Matches[0].nextMatchId).toBe(r2Matches[0].id);
    expect(r1Matches[1].nextMatchId).toBe(r2Matches[0].id);
    expect(r1Matches[2].nextMatchId).toBe(r2Matches[1].id);
    expect(r1Matches[3].nextMatchId).toBe(r2Matches[1].id);

    // Semis feed into Grand Final (Round 3)
    const gf = matchStore.find((m) => m.round === 3);
    expect(gf).toBeDefined();
    expect(gf.roundName).toBe('GRAND FINAL');
    expect(r2Matches[0].nextMatchId).toBe(gf.id);
    expect(r2Matches[1].nextMatchId).toBe(gf.id);
  });

  // AC 2: 6-team Single Elimination with Byes
  it('AC 2: generates valid bracket for 6 teams with 2 byes for top 2 seeds and is_bye flag', async () => {
    const teams = createMockTeams(6);
    const tournamentId = 'tourney-6';

    tournamentStore[tournamentId] = {
      id: tournamentId,
      status: TournamentStatus.UPCOMING,
      bracketFormat: BracketFormat.SINGLE_ELIM,
      organizerId: 'org-1',
      lockedAt: null,
      universities: teams.map((t) => t.university),
      warRoom: { id: 'wr-1', tournamentId },
    };

    mockPrismaService.team.findMany.mockResolvedValue(teams);

    await service.generateBracket(
      tournamentId,
      { seeds: teams.map((t) => t.id) },
      { id: 'org-1', role: Role.ORGANIZER },
    );

    // Matches with byes
    const byeMatches = matchStore.filter((m) => m.isBye === true);
    expect(byeMatches.length).toBe(2);

    // Top 2 seeds received the byes
    const byeWinners = byeMatches.map((m) => m.winnerTeamId);
    expect(byeWinners).toContain('team-1');
    expect(byeWinners).toContain('team-2');

    // Winner of bye auto-advanced into Round 2
    const r2Matches = matchStore.filter((m) => m.round === 2);
    expect(r2Matches[0].team1Id).toBe('team-1');
    expect(r2Matches[1].team2Id).toBe('team-2');
  });

  // AC 3: 8-team Double Elimination
  it('AC 3: generates complete 8-team double elimination bracket with Upper and Lower sections', async () => {
    const teams = createMockTeams(8);
    const tournamentId = 'tourney-double-8';

    tournamentStore[tournamentId] = {
      id: tournamentId,
      status: TournamentStatus.UPCOMING,
      bracketFormat: BracketFormat.DOUBLE_ELIM,
      organizerId: 'org-1',
      lockedAt: null,
      universities: teams.map((t) => t.university),
      warRoom: { id: 'wr-1', tournamentId },
    };

    mockPrismaService.team.findMany.mockResolvedValue(teams);

    await service.generateBracket(
      tournamentId,
      { seeds: teams.map((t) => t.id) },
      { id: 'org-1', role: Role.ORGANIZER },
    );

    // 8 teams double elim has 14 pre-created matches
    expect(matchStore.length).toBe(14);

    const ubMatches = matchStore.filter((m) => m.bracketSection === BracketSection.UPPER);
    const lbMatches = matchStore.filter((m) => m.bracketSection === BracketSection.LOWER);
    const gf = matchStore.find((m) => m.bracketSection === BracketSection.GRAND_FINAL);

    expect(ubMatches.length).toBe(7); // 4 (UB R1) + 2 (UB R2) + 1 (UB Final)
    expect(lbMatches.length).toBe(6); // 2 (LB R1) + 2 (LB R2) + 1 (LB R3) + 1 (LB Final)
    expect(gf).toBeDefined();

    // UB R1 losers routed to LB R1
    const ubR1 = ubMatches.filter((m) => m.round === 1);
    const lbR1 = lbMatches.filter((m) => m.round === 1);
    expect(ubR1[0].loserNextMatchId).toBe(lbR1[0].id);
    expect(ubR1[1].loserNextMatchId).toBe(lbR1[0].id);

    // Lower bracket final is BO5 per Valorant convention
    const lbFinal = lbMatches.find((m) => m.roundName === 'LOWER BRACKET FINAL');
    expect(lbFinal.bestOf).toBe(5);
    expect(gf.bestOf).toBe(5);
  });

  // AC 4: Result advancement & idempotency
  it('AC 4: advances winner and loser downstream, and re-confirming is idempotent', async () => {
    const tournamentId = 'tourney-adv';
    const match1 = {
      id: 'm-1',
      tournamentId,
      round: 1,
      bracketSection: BracketSection.UPPER,
      team1Id: 'team-1',
      team2Id: 'team-2',
      nextMatchId: 'm-next',
      loserNextMatchId: 'm-lb',
      isVerified: false,
    };
    const nextMatch = {
      id: 'm-next',
      tournamentId,
      round: 2,
      team1Id: null,
      team2Id: null,
    };
    const loserMatch = {
      id: 'm-lb',
      tournamentId,
      round: 1,
      team1Id: null,
      team2Id: null,
    };

    matchStore.push(match1, nextMatch, loserMatch);

    // First confirmation
    await service.advanceMatchResult(tournamentId, 'm-1', 'team-1', 'team-2');

    expect(match1.isVerified).toBe(true);
    expect(match1.winnerTeamId).toBe('team-1');
    expect(nextMatch.team1Id).toBe('team-1');
    expect(loserMatch.team1Id).toBe('team-2');

    // Second confirmation (idempotent no-op)
    const idempotentResult = await service.advanceMatchResult(tournamentId, 'm-1', 'team-1', 'team-2');
    expect(idempotentResult.winnerTeamId).toBe('team-1');
  });

  // AC 5: Lower-bracket win in Grand Final triggers Bracket Reset
  it('AC 5: creates a separate bracket reset match when the LB team wins Grand Final', async () => {
    const tournamentId = 'tourney-reset';
    const gfMatch = {
      id: 'm-gf',
      tournamentId,
      round: 4,
      title: GameTitle.VALORANT,
      bracketSection: BracketSection.GRAND_FINAL,
      team1Id: 'ub-champ',
      team2Id: 'lb-champ',
      isBracketReset: false,
      isVerified: false,
    };
    matchStore.push(gfMatch);
    tournamentStore[tournamentId] = { id: tournamentId, status: TournamentStatus.ONGOING };

    // LB winner wins Grand Final!
    await service.advanceMatchResult(tournamentId, 'm-gf', 'lb-champ', 'ub-champ');

    const resetMatch = matchStore.find((m) => m.isBracketReset === true);
    expect(resetMatch).toBeDefined();
    expect(resetMatch.roundName).toBe('GRAND FINALS RESET');
    expect(resetMatch.bracketSection).toBe(BracketSection.BRACKET_RESET);
    expect(resetMatch.bestOf).toBe(5);
    expect(tournamentStore[tournamentId].status).toBe(TournamentStatus.ONGOING);
  });

  // AC 6: Event Weight freezing & rejection of second lock
  it('AC 6: freezes event_weight and locked_at, rejecting second lock attempt', async () => {
    const teams = createMockTeams(8);
    const tournamentId = 'tourney-weight';

    tournamentStore[tournamentId] = {
      id: tournamentId,
      status: TournamentStatus.UPCOMING,
      bracketFormat: BracketFormat.SINGLE_ELIM,
      organizerId: 'org-1',
      lockedAt: null,
      universities: teams.map((t) => t.university),
      warRoom: { id: 'wr-1', tournamentId },
    };

    mockPrismaService.team.findMany.mockResolvedValue(teams);

    // 8 teams = Medium tier -> 1.25x
    const res = await service.generateBracket(
      tournamentId,
      {},
      { id: 'org-1', role: Role.ORGANIZER },
    );
    expect(res.eventWeight).toBe(1.25);

    // Second lock attempt must reject
    tournamentStore[tournamentId].lockedAt = new Date();
    await expect(
      service.generateBracket(tournamentId, {}, { id: 'org-1', role: Role.ORGANIZER }),
    ).rejects.toThrow(BadRequestException);
  });

  // AC 7: Rejection when no War Room exists
  it('AC 7: rejects bracket generation when War Room does not exist', async () => {
    const teams = createMockTeams(8);
    const tournamentId = 'tourney-no-war-room';

    tournamentStore[tournamentId] = {
      id: tournamentId,
      status: TournamentStatus.UPCOMING,
      bracketFormat: BracketFormat.SINGLE_ELIM,
      organizerId: 'org-1',
      lockedAt: null,
      universities: teams.map((t) => t.university),
      warRoom: null, // No War Room!
    };

    mockPrismaService.team.findMany.mockResolvedValue(teams);

    await expect(
      service.generateBracket(tournamentId, {}, { id: 'org-1', role: Role.ORGANIZER }),
    ).rejects.toThrow(/War Room does not exist/);
  });

  // AC 8: RBAC check
  it('AC 8: rejects bracket generation if caller is not tournament organizer or admin', async () => {
    const tournamentId = 'tourney-rbac';
    tournamentStore[tournamentId] = {
      id: tournamentId,
      status: TournamentStatus.UPCOMING,
      organizerId: 'org-1',
      warRoom: { id: 'wr-1' },
      universities: [{ id: 'u1' }, { id: 'u2' }],
    };

    // Different organizer tries to lock
    await expect(
      service.generateBracket(tournamentId, {}, { id: 'different-org', role: Role.ORGANIZER }),
    ).rejects.toThrow(ForbiddenException);

    // Athlete tries to lock
    await expect(
      service.generateBracket(tournamentId, {}, { id: 'athlete-1', role: Role.ATHLETE }),
    ).rejects.toThrow(ForbiddenException);
  });
});
