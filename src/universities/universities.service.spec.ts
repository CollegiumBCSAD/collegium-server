import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GameTitle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UniversitiesService } from './universities.service';

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

      const call = mockPrismaService.university.findUnique.mock
        .calls[0][0] as Record<string, any>;
      expect(call.where).toEqual({ id: '1' });
      expect(call.include.teams.select.members).toBeDefined();
      expect(result).toEqual(mockUniversity);
    });

    it('should never select inviteCode, because the profile route is public', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({ id: '1' });

      await service.findOne('1');

      const call = mockPrismaService.university.findUnique.mock
        .calls[0][0] as Record<string, any>;
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

      const [entry] = await service.findMatches('uni-1');

      expect(entry.result).toBe('WIN');
      expect(entry.opponent).toEqual({ id: 'uni-2', name: 'Uni B' });
      expect(entry.tournamentName).toBe('Metro Clash');
      // Round 2 of 2 is the last round of its bracket.
      expect(entry.roundLabel).toBe('GRAND FINALS');
    });

    it('should report a LOSS and the winning opponent when the university lost', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany
        .mockResolvedValueOnce([{ ...playedMatch, winnerId: 'uni-2', loserId: 'uni-1' }])
        .mockResolvedValueOnce([{ tournamentId: 'tour-1', round: 2, bracketSide: null }]);

      const [entry] = await service.findMatches('uni-1');

      expect(entry.result).toBe('LOSS');
      expect(entry.opponent).toEqual({ id: 'uni-1', name: 'Uni A' });
    });

    it('should exclude byes, which are verified but were never played', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1');

      const where = (
        mockPrismaService.match.findMany.mock.calls[0][0] as Record<string, any>
      ).where;
      expect(where.loserId).toEqual({ not: null });
      expect(where.isVerified).toBe(true);
    });

    it('should filter on the tournament game title, not the unreliable Match.title', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(university);
      mockPrismaService.match.findMany.mockResolvedValue([]);

      await service.findMatches('uni-1', GameTitle.VALORANT);

      const where = (
        mockPrismaService.match.findMany.mock.calls[0][0] as Record<string, any>
      ).where;
      expect(where.tournament).toEqual({ gameTitle: GameTitle.VALORANT });
      expect(where.title).toBeUndefined();
    });

    it('should throw NotFoundException if the university does not exist', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.findMatches('nope')).rejects.toThrow(NotFoundException);
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
