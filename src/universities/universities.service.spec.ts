import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GameTitle, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UniversitiesService } from './universities.service';

// Narrow shapes for the Prisma call arguments these tests inspect.
type UniversityFindUniqueCall = {
  where: Prisma.UniversityWhereUniqueInput;
  include: { teams: { select: Record<string, unknown> } };
};
type MatchFindManyCall = {
  where: Prisma.MatchWhereInput & { AND: Prisma.MatchWhereInput[] };
  skip: number;
  take: number;
};

// Reads the first argument of a mock's first call. Untyped jest.fn() mocks
// record calls as any[][], so this is the one typed way in.
const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

const mockPrismaService = {
  university: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  team: {
    findMany: jest.fn(),
  },
  match: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  tournament: {
    findMany: jest.fn(),
  },
};

describe('UniversitiesService', () => {
  let service: UniversitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UniversitiesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UniversitiesService>(UniversitiesService);
    jest.clearAllMocks();
    mockPrismaService.match.count.mockResolvedValue(0);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll()', () => {
    it('should return an array of universities ordered by name ascending when no gameTitle is provided', async () => {
      const mockUniversities = [
        { id: '1', name: 'Adamson University' },
        { id: '2', name: 'Ateneo de Manila University' },
      ];
      mockPrismaService.university.findMany.mockResolvedValue(mockUniversities);

      const result = await service.findAll();

      expect(mockPrismaService.university.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(mockUniversities);
    });

    it('should return enriched teams with match stats when gameTitle is provided', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const mockTeams = [
        {
          id: 'team-1',
          name: 'UMak Valorant',
          gameTitle: 'VALORANT',
          glicko2_rating: 1650,
          glicko2_rd: 65,
          glicko2_sigma: 0.06,
          universityId: 'uni-1',
          university: {
            id: 'uni-1',
            name: 'University of Makati',
            domain: 'umak.edu.ph',
            created_at: createdAt,
          },
        },
      ];
      const mockMatches = [
        {
          id: 'm1',
          title: 'VALORANT',
          isVerified: true,
          matchMode: 'TOURNAMENT',
          winnerId: 'uni-1',
          loserId: 'uni-2',
          playedAt: new Date('2026-08-01'),
        },
        {
          id: 'm2',
          title: 'VALORANT',
          isVerified: true,
          matchMode: 'TOURNAMENT',
          winnerId: 'uni-1',
          loserId: 'uni-3',
          playedAt: new Date('2026-07-25'),
        },
      ];

      mockPrismaService.team.findMany.mockResolvedValue(mockTeams);
      mockPrismaService.match.findMany.mockResolvedValue(mockMatches);

      const result = await service.findAll('VALORANT');

      expect(mockPrismaService.team.findMany).toHaveBeenCalledWith({
        where: { gameTitle: 'VALORANT' },
        orderBy: { glicko2_rating: 'desc' },
        include: { university: true },
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'uni-1',
        name: 'University of Makati',
        domain: 'umak.edu.ph',
        teamId: 'team-1',
        teamName: 'UMak Valorant',
        gameTitle: 'VALORANT',
        glicko2_rating: 1650,
        glicko2_rd: 65,
        glicko2_sigma: 0.06,
        wins: 2,
        losses: 0,
        winRate: 100,
        streak: '2W',
        isProvisional: false,
        createdAt: createdAt.toISOString(),
      });
    });
  });

  describe('findOne()', () => {
    it('should return a university with its accepted rosters if found', async () => {
      const mockUniversity = { id: '1', name: 'Uni A', teams: [] };
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);

      const result = await service.findOne('1');

      const call = firstCallArg<UniversityFindUniqueCall>(
        mockPrismaService.university.findUnique,
      );
      expect(call.where).toEqual({ id: '1' });
      expect(call.include.teams.select.members).toBeDefined();
      expect(result).toEqual(mockUniversity);
    });

    it('should never select inviteCode, because the profile route is public', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({ id: '1' });

      await service.findOne('1');

      const call = firstCallArg<UniversityFindUniqueCall>(
        mockPrismaService.university.findUnique,
      );
      expect(call.include.teams.select.inviteCode).toBeUndefined();
    });

    it('should throw NotFoundException if university is not found', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMatches()', () => {
    const university = { id: 'uni-1' };

    const playedMatch = {
      id: 'match-1',
      scrimId: null,
      playedAt: new Date('2026-08-16T10:00:00.000Z'),
      tournamentId: 'tour-1',
      tournament: { id: 'tour-1', name: 'Metro Clash', gameTitle: 'VALORANT' },
      winnerId: 'uni-1',
      loserId: 'uni-2',
      winner: { id: 'uni-1', name: 'Uni A' },
      loser: { id: 'uni-2', name: 'Uni B' },
      round: 2,
      bracketSide: null,
      playerStats: [],
    };

    it('should report the opponent and a WIN when the university won', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany
        .mockResolvedValueOnce([playedMatch])
        .mockResolvedValueOnce([
          { tournamentId: 'tour-1', round: 1, bracketSide: null },
          { tournamentId: 'tour-1', round: 2, bracketSide: null },
        ]);

      const { matches: entries } = await service.findMatches('uni-1');
      const entry = entries[0];

      expect(entry.result).toBe('WIN');
      expect(entry.scrimId).toBeNull();
      expect(entry.opponent).toEqual({ id: 'uni-2', name: 'Uni B' });
      expect(entry.tournamentName).toBe('Metro Clash');
      // Round 2 of 2 is the last round of its bracket.
      expect(entry.roundLabel).toBe('GRAND FINALS');
    });

    it('should report a LOSS and the winning opponent when the university lost', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany
        .mockResolvedValueOnce([
          { ...playedMatch, winnerId: 'uni-2', loserId: 'uni-1' },
        ])
        .mockResolvedValueOnce([
          { tournamentId: 'tour-1', round: 2, bracketSide: null },
        ]);

      const { matches: entries } = await service.findMatches('uni-1');
      const entry = entries[0];

      expect(entry.result).toBe('LOSS');
      expect(entry.opponent).toEqual({ id: 'uni-1', name: 'Uni A' });
    });

    it('should exclude byes, which are verified but were never played', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1');

      const where = firstCallArg<MatchFindManyCall>(
        mockPrismaService.match.findMany,
      ).where;
      expect(where.loserId).toEqual({ not: null });
      expect(where.isVerified).toBe(true);
    });

    it('should read a tournament match game from the tournament, not the unreliable Match.title', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1', GameTitle.VALORANT);

      const where = firstCallArg<MatchFindManyCall>(
        mockPrismaService.match.findMany,
      ).where;
      const gameFilter = where.AND.find((clause) =>
        clause.OR?.some((option) => option.tournament),
      );
      expect(gameFilter?.OR).toContainEqual({
        tournament: { gameTitle: GameTitle.VALORANT },
      });
      expect(where.title).toBeUndefined();
    });

    it('should still match scrims on Match.title, since a scrim has no tournament to read the game from', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1', GameTitle.VALORANT, 'SCRIM');

      const where = firstCallArg<MatchFindManyCall>(
        mockPrismaService.match.findMany,
      ).where;
      const gameFilter = where.AND.find((clause) =>
        clause.OR?.some((option) => option.title),
      );
      expect(gameFilter?.OR).toContainEqual({
        tournamentId: null,
        title: GameTitle.VALORANT,
      });
      expect(where.matchMode).toBe('SCRIM');
    });

    it('should page the ledger and report the total, so a long history is not fetched at once', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.count.mockResolvedValue(24);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      const result = await service.findMatches(
        'uni-1',
        undefined,
        'ALL',
        3,
        10,
      );

      const call = firstCallArg<MatchFindManyCall>(
        mockPrismaService.match.findMany,
      );
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
      expect(result.total).toBe(24);
      expect(result.page).toBe(3);
      expect(result.totalPages).toBe(3);
    });

    it('should clamp a junk page or limit instead of asking Prisma for a negative skip', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1', undefined, 'ALL', 0, 5000);

      const call = firstCallArg<MatchFindManyCall>(
        mockPrismaService.match.findMany,
      );
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });

    it('should throw NotFoundException if the university does not exist', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.findMatches('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should expose scrimId on a scrim-mode entry so the scrim page can route back to it for editing', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany
        .mockResolvedValueOnce([
          {
            ...playedMatch,
            id: 'match-2',
            scrimId: 'scrim-1',
            matchMode: 'SCRIM',
          },
        ])
        .mockResolvedValueOnce([
          { tournamentId: 'tour-1', round: 2, bracketSide: null },
        ]);

      const { matches: entries } = await service.findMatches('uni-1');

      expect(entries[0].scrimId).toBe('scrim-1');
    });
  });

  describe('findTournamentPlacements()', () => {
    const university = { id: 'uni-1' };

    // An 8-team single-elim tree: rounds 1 (quarters), 2 (semis), 3 (final).
    const bracket = (overrides: Record<string, any>[] = []) => [
      {
        round: 1,
        bracketSide: null,
        winnerId: 'uni-1',
        loserId: 'uni-8',
        isVerified: true,
        isForfeit: false,
        playedAt: new Date(),
      },
      {
        round: 2,
        bracketSide: null,
        winnerId: 'uni-1',
        loserId: 'uni-4',
        isVerified: true,
        isForfeit: false,
        playedAt: new Date(),
      },
      {
        round: 3,
        bracketSide: null,
        winnerId: 'uni-1',
        loserId: 'uni-2',
        isVerified: true,
        isForfeit: false,
        playedAt: new Date(),
      },
      ...overrides,
    ];

    const mockTournament = (matches: any[], status = 'COMPLETED') => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([
        { tournamentId: 'tour-1' },
      ]);
      mockPrismaService.tournament.findMany.mockResolvedValue([
        {
          id: 'tour-1',
          name: 'Metro Clash',
          gameTitle: GameTitle.VALORANT,
          status,
          image: null,
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          matches,
        },
      ]);
    };

    it('should crown the squad that was never eliminated', async () => {
      mockTournament(bracket());

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBe(1);
      expect(entry.placementLabel).toBe('CHAMPIONS');
      expect(entry.wins).toBe(3);
      expect(entry.losses).toBe(0);
    });

    it('should place a squad that lost the final as runner-up', async () => {
      mockTournament([
        ...bracket().slice(0, 2),
        {
          round: 3,
          bracketSide: null,
          winnerId: 'uni-2',
          loserId: 'uni-1',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
      ]);

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBe(2);
      expect(entry.placementLabel).toBe('RUNNER-UP');
    });

    it('should place a semifinal exit in the top 4', async () => {
      mockTournament([
        bracket()[0],
        {
          round: 2,
          bracketSide: null,
          winnerId: 'uni-4',
          loserId: 'uni-1',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
        {
          round: 3,
          bracketSide: null,
          winnerId: 'uni-4',
          loserId: 'uni-2',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
      ]);

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBe(4);
      expect(entry.placementLabel).toBe('TOP 4');
    });

    it('should place a quarterfinal exit in the top 8', async () => {
      mockTournament([
        {
          round: 1,
          bracketSide: null,
          winnerId: 'uni-8',
          loserId: 'uni-1',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
        bracket()[1],
        bracket()[2],
      ]);

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBe(8);
      expect(entry.placementLabel).toBe('TOP 8');
    });

    it('should not crown a squad while its bracket is still being played', async () => {
      mockTournament(
        [
          {
            round: 1,
            bracketSide: null,
            winnerId: 'uni-1',
            loserId: 'uni-8',
            isVerified: true,
            isForfeit: false,
            playedAt: new Date(),
          },
          // The final is seeded but unplayed, so nobody has won this bracket.
          {
            round: 2,
            bracketSide: null,
            winnerId: 'uni-1',
            loserId: 'uni-4',
            isVerified: false,
            isForfeit: false,
            playedAt: new Date(),
          },
        ],
        'ONGOING',
      );

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBeNull();
      expect(entry.placementLabel).toBe('STILL ALIVE');
    });

    it('should not treat a winners-bracket loss as an exit in double elimination', async () => {
      mockTournament([
        {
          round: 1,
          bracketSide: 'WINNERS',
          winnerId: 'uni-2',
          loserId: 'uni-1',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
        {
          round: 1,
          bracketSide: 'LOSERS',
          winnerId: 'uni-1',
          loserId: 'uni-3',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
        {
          round: 2,
          bracketSide: 'LOSERS',
          winnerId: 'uni-1',
          loserId: 'uni-4',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
        {
          round: 3,
          bracketSide: 'GRAND_FINAL',
          winnerId: 'uni-1',
          loserId: 'uni-2',
          isVerified: true,
          isForfeit: false,
          playedAt: new Date(),
        },
      ]);

      const [entry] = await service.findTournamentPlacements('uni-1');

      expect(entry.placement).toBe(1);
      expect(entry.placementLabel).toBe('CHAMPIONS');
    });

    it('should return nothing when the university never played a tournament match', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      const result = await service.findTournamentPlacements('uni-1');

      expect(result).toEqual([]);
      expect(mockPrismaService.tournament.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the university does not exist', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.findTournamentPlacements('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create()', () => {
    const dto = { name: 'Ateneo de Manila', domain: 'admu.edu.ph' };

    it('should create and return a new university', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null); // domain not taken

      const mockCreated = { id: 'uuid', ...dto };
      mockPrismaService.university.create.mockResolvedValue(mockCreated);

      const result = await service.create(dto);

      expect(mockPrismaService.university.create).toHaveBeenCalledWith({
        data: { name: dto.name, domain: dto.domain },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should throw ConflictException if domain already exists', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({
        id: 'existing',
      });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('update()', () => {
    it('updates name/domain when found and no domain conflict', async () => {
      mockPrismaService.university.findUnique.mockResolvedValueOnce({
        id: '1',
        name: 'Old Name',
        domain: 'old.edu.ph',
      });
      const updated = { id: '1', name: 'New Name', domain: 'old.edu.ph' };
      mockPrismaService.university.update.mockResolvedValue(updated);

      const result = await service.update('1', { name: 'New Name' });

      expect(mockPrismaService.university.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { name: 'New Name' },
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException if the university does not exist', async () => {
      mockPrismaService.university.findUnique.mockResolvedValueOnce(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if the new domain is already taken by another university', async () => {
      mockPrismaService.university.findUnique
        .mockResolvedValueOnce({ id: '1', name: 'Old', domain: 'old.edu.ph' })
        .mockResolvedValueOnce({ id: '2', name: 'Other' });

      await expect(
        service.update('1', { domain: 'taken.edu.ph' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove()', () => {
    it('deletes the university when found', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({ id: '1' });
      mockPrismaService.university.delete.mockResolvedValue({ id: '1' });

      const result = await service.remove('1');

      expect(mockPrismaService.university.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
      expect(result).toEqual({ id: '1' });
    });

    it('throws NotFoundException if the university does not exist', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if the university has dependent records', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({ id: '1' });
      mockPrismaService.university.delete.mockRejectedValue(
        new Error('Foreign key constraint failed'),
      );

      await expect(service.remove('1')).rejects.toThrow(ConflictException);
    });
  });
});
