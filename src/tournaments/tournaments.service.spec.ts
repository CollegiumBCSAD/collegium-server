import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchMode, TournamentStatus, GameTitle } from '@prisma/client';
import { MatchLoggingService } from '../match-logging/match-logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from './tournaments.service';

// MOCK FACTORIES
// We never hit a real database in unit tests. We mock PrismaService
// with jest.fn() so we can control what it returns in each test.

import { GlickoService } from '../universities/glicko.service';

const mockPrismaService = {
  tournament: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  university: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  match: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockMatchLoggingService = {
  logMatch: jest.fn(),
};

describe('TournamentsService', () => {
  let service: TournamentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentsService,
        GlickoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MatchLoggingService, useValue: mockMatchLoggingService },
      ],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);

    // Reset all mocks before each test so they don't bleed into each other
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // create()
  describe('create()', () => {
    it('should create a tournament and return it', async () => {
      const dto = { name: 'Intercollegiate Cup 2026' };
      const mockResult = {
        id: 'tournament-uuid',
        name: dto.name,
        status: TournamentStatus.UPCOMING,
      };

      mockPrismaService.tournament.create.mockResolvedValue(mockResult);

      const result = await service.create(dto);

      expect(mockPrismaService.tournament.create).toHaveBeenCalledWith({
        data: { name: dto.name },
      });
      expect(result).toEqual(mockResult);
    });
  });

  // registerUniversity()
  describe('registerUniversity()', () => {
    const tournamentId = 'tournament-uuid';
    const universityId = 'university-uuid';

    it('should register a university to an UPCOMING tournament', async () => {
      const mockTournament = {
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
      };
      const mockUpdated = {
        id: tournamentId,
        universities: [{ id: universityId }],
      };

      mockPrismaService.tournament.findUnique.mockResolvedValue(mockTournament);
      mockPrismaService.tournament.update.mockResolvedValue(mockUpdated);

      const result = await service.registerUniversity(
        tournamentId,
        universityId,
      );

      expect(result).toEqual(mockUpdated);
    });

    it('should throw NotFoundException if tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(
        service.registerUniversity(tournamentId, universityId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if tournament is not UPCOMING', async () => {
      const mockTournament = {
        id: tournamentId,
        status: TournamentStatus.ONGOING,
      };
      mockPrismaService.tournament.findUnique.mockResolvedValue(mockTournament);

      await expect(
        service.registerUniversity(tournamentId, universityId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // generateBracket()
  describe('generateBracket()', () => {
    const tournamentId = 'tournament-uuid';

    it('should throw NotFoundException if tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(service.generateBracket(tournamentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if fewer than 2 universities are registered', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
        universities: [{ id: 'uni-1' }],
      });

      await expect(service.generateBracket(tournamentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if odd number of universities are registered', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
        universities: [{ id: 'uni-1' }, { id: 'uni-2' }, { id: 'uni-3' }],
      });

      await expect(service.generateBracket(tournamentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if tournament is not UPCOMING', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.ONGOING,
        universities: [{ id: 'uni-1' }, { id: 'uni-2' }],
      });

      await expect(service.generateBracket(tournamentId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // getBracket()
  describe('getBracket()', () => {
    const tournamentId = 'tournament-uuid';

    it('should return the tournament bracket', async () => {
      const mockTournament = {
        id: tournamentId,
        matches: [],
        universities: [],
      };

      mockPrismaService.tournament.findUnique.mockResolvedValue(mockTournament);

      const result = await service.getBracket(tournamentId);
      expect(result).toEqual(mockTournament);
    });

    it('should throw NotFoundException if tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(service.getBracket(tournamentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // confirmMatch()
  describe('confirmMatch()', () => {
    const tournamentId = 'tournament-uuid';
    const matchId = 'match-uuid';
    const dto = { riotMatchId: 'SEA_12345' };

    it('should confirm a match and trigger the Riot pipeline', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        riotMatchId: null,
        title: GameTitle.LOL,
      };
      const mockUpdated = { ...mockMatch, riotMatchId: dto.riotMatchId };

      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockMatchLoggingService.logMatch.mockResolvedValue(undefined);
      mockPrismaService.match.update.mockResolvedValue(mockUpdated);
      mockPrismaService.match.findUnique.mockResolvedValue(mockUpdated);

      const result = await service.confirmMatch(tournamentId, matchId, dto);

      expect(mockMatchLoggingService.logMatch).toHaveBeenCalledWith(
        GameTitle.LOL,
        dto.riotMatchId,
        MatchMode.TOURNAMENT,
        true,
        matchId,
      );
      expect(result!.riotMatchId).toEqual(dto.riotMatchId);
    });

    it('should throw NotFoundException if match is not found', async () => {
      mockPrismaService.match.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmMatch(tournamentId, matchId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if match is already confirmed', async () => {
      const mockMatch = { id: matchId, tournamentId, isVerified: true };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(
        service.confirmMatch(tournamentId, matchId, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // closeMatch()
  describe('closeMatch()', () => {
    const tournamentId = 'tournament-uuid';
    const matchId = 'match-uuid';

    it('should close a confirmed match successfully', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        riotMatchId: 'SEA_12345',
      };
      const mockClosed = { ...mockMatch, isVerified: true };

      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockPrismaService.match.update.mockResolvedValue(mockClosed);

      const result = await service.closeMatch(tournamentId, matchId);
      expect(result.isVerified).toBe(true);
    });

    it('should throw NotFoundException if match does not exist', async () => {
      mockPrismaService.match.findFirst.mockResolvedValue(null);

      await expect(service.closeMatch(tournamentId, matchId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if match has no riotMatchId (not yet confirmed)', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        riotMatchId: null,
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(service.closeMatch(tournamentId, matchId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if match is already closed', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: true,
        riotMatchId: 'SEA_12345',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(service.closeMatch(tournamentId, matchId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
