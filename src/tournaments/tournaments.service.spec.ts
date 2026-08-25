import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchMode, TournamentStatus, GameTitle, Role } from '@prisma/client';
import { MatchLoggingService } from '../match-logging/match-logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { TournamentsService } from './tournaments.service';

// MOCK FACTORIES
// We never hit a real database in unit tests. We mock PrismaService
// with jest.fn() so we can control what it returns in each test.

import { GlickoService } from '../universities/glicko.service';

const mockPrismaService = {
  tournament: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
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
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockMatchLoggingService = {
  logMatch: jest.fn(),
};

const mockNotificationsService = {
  create: jest.fn(),
};

const mockCloudinaryService = {
  upload: jest.fn(),
  destroy: jest.fn(),
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
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
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
    it('creates an ATHLETE-authored tournament as UPCOMING with no organizer', async () => {
      const dto = { name: 'Intercollegiate Cup 2026' };
      mockPrismaService.tournament.create.mockResolvedValue({
        id: 'tournament-uuid',
        name: dto.name,
        status: TournamentStatus.UPCOMING,
      });

      await service.create(dto, { id: 'user-1', role: Role.ATHLETE });

      expect(mockPrismaService.tournament.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          bracketFormat: undefined,
          teamQuota: undefined,
          rules: undefined,
          image: undefined,
          imagePublicId: undefined,
          organizerId: undefined,
          status: TournamentStatus.UPCOMING,
        },
      });
    });

    it('creates an ORGANIZER-authored tournament as PENDING_APPROVAL with organizerId set', async () => {
      const dto = { name: 'Community Cup' };
      mockPrismaService.tournament.create.mockResolvedValue({
        id: 'tournament-uuid',
        name: dto.name,
        status: TournamentStatus.PENDING_APPROVAL,
      });

      await service.create(dto, { id: 'organizer-1', role: Role.ORGANIZER });

      expect(mockPrismaService.tournament.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          bracketFormat: undefined,
          teamQuota: undefined,
          rules: undefined,
          image: undefined,
          imagePublicId: undefined,
          organizerId: 'organizer-1',
          status: TournamentStatus.PENDING_APPROVAL,
        },
      });
    });

    it('persists bracketFormat, teamQuota, and rules when provided', async () => {
      const dto = {
        name: 'Community Cup',
        bracketFormat: 'Single Elimination',
        teamQuota: 8,
        rules: 'Best of 3 semis, Bo5 finals',
      };
      mockPrismaService.tournament.create.mockResolvedValue({
        id: 'tournament-uuid',
        name: dto.name,
        status: TournamentStatus.PENDING_APPROVAL,
      });

      await service.create(dto, { id: 'organizer-1', role: Role.ORGANIZER });

      expect(mockPrismaService.tournament.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          bracketFormat: dto.bracketFormat,
          teamQuota: dto.teamQuota,
          rules: dto.rules,
          image: undefined,
          imagePublicId: undefined,
          organizerId: 'organizer-1',
          status: TournamentStatus.PENDING_APPROVAL,
        },
      });
    });

    it('uploads a cover image to Cloudinary when one is provided', async () => {
      const dto = { name: 'Community Cup' };
      const fakeFile = { buffer: Buffer.from('fake') } as Express.Multer.File;
      mockCloudinaryService.upload.mockResolvedValue({
        url: 'https://res.cloudinary.com/x/img.png',
        publicId: 'collegium/tournaments/abc123',
      });
      mockPrismaService.tournament.create.mockResolvedValue({
        id: 'tournament-uuid',
        name: dto.name,
        status: TournamentStatus.PENDING_APPROVAL,
      });

      await service.create(
        dto,
        { id: 'organizer-1', role: Role.ORGANIZER },
        fakeFile,
      );

      expect(mockCloudinaryService.upload).toHaveBeenCalledWith(
        fakeFile.buffer,
        'collegium/tournaments',
      );
      expect(mockPrismaService.tournament.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          bracketFormat: undefined,
          teamQuota: undefined,
          rules: undefined,
          image: 'https://res.cloudinary.com/x/img.png',
          imagePublicId: 'collegium/tournaments/abc123',
          organizerId: 'organizer-1',
          status: TournamentStatus.PENDING_APPROVAL,
        },
      });
    });
  });

  // findAll()
  describe('findAll()', () => {
    it('excludes PENDING_APPROVAL/REJECTED by default', async () => {
      mockPrismaService.tournament.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrismaService.tournament.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              notIn: [
                TournamentStatus.PENDING_APPROVAL,
                TournamentStatus.REJECTED,
              ],
            },
          },
        }),
      );
    });

    it('filters by the given status when provided', async () => {
      mockPrismaService.tournament.findMany.mockResolvedValue([]);

      await service.findAll(TournamentStatus.PENDING_APPROVAL);

      expect(mockPrismaService.tournament.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: TournamentStatus.PENDING_APPROVAL },
        }),
      );
    });
  });

  // findMine()
  describe('findMine()', () => {
    it('returns tournaments for the given organizer regardless of status', async () => {
      mockPrismaService.tournament.findMany.mockResolvedValue([]);

      await service.findMine('organizer-1');

      expect(mockPrismaService.tournament.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizerId: 'organizer-1' },
        }),
      );
    });
  });

  // updateApprovalStatus()
  describe('updateApprovalStatus()', () => {
    const tournamentId = 'tournament-uuid';

    it('approves a pending tournament and notifies the organizer', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        name: 'Community Cup',
        organizerId: 'organizer-1',
        status: TournamentStatus.PENDING_APPROVAL,
      });
      mockPrismaService.tournament.update.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
      });

      await service.updateApprovalStatus(
        tournamentId,
        TournamentStatus.UPCOMING,
      );

      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith({
        where: { id: tournamentId },
        data: { status: TournamentStatus.UPCOMING, rejectionReason: null },
      });
      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'organizer-1',
          type: 'TOURNAMENT_APPROVED',
        }),
      );
    });

    it('rejects a pending tournament with a reason and notifies the organizer', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        name: 'Community Cup',
        organizerId: 'organizer-1',
        status: TournamentStatus.PENDING_APPROVAL,
      });
      mockPrismaService.tournament.update.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.REJECTED,
      });

      await service.updateApprovalStatus(
        tournamentId,
        TournamentStatus.REJECTED,
        'Missing bracket format',
      );

      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.REJECTED,
          rejectionReason: 'Missing bracket format',
        },
      });
      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'organizer-1',
          type: 'TOURNAMENT_REJECTED',
        }),
      );
    });

    it('throws NotFoundException if the tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(
        service.updateApprovalStatus(tournamentId, TournamentStatus.UPCOMING),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for any status other than UPCOMING/REJECTED', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        organizerId: 'organizer-1',
        status: TournamentStatus.PENDING_APPROVAL,
      });

      await expect(
        service.updateApprovalStatus(tournamentId, TournamentStatus.ONGOING),
      ).rejects.toThrow(BadRequestException);
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

  // deleteTournament()
  describe('deleteTournament()', () => {
    const tournamentId = 'tournament-uuid';

    it('deletes the tournament and its matches, and cleans up the Cloudinary asset', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        imagePublicId: 'collegium/tournaments/abc123',
      });
      mockPrismaService.match.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.tournament.delete.mockResolvedValue({
        id: tournamentId,
      });
      mockCloudinaryService.destroy.mockResolvedValue(undefined);

      await service.deleteTournament(tournamentId);

      expect(mockPrismaService.match.deleteMany).toHaveBeenCalledWith({
        where: { tournamentId },
      });
      expect(mockPrismaService.tournament.delete).toHaveBeenCalledWith({
        where: { id: tournamentId },
      });
      expect(mockCloudinaryService.destroy).toHaveBeenCalledWith(
        'collegium/tournaments/abc123',
      );
    });

    it('skips Cloudinary cleanup when the tournament has no image', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        imagePublicId: null,
      });
      mockPrismaService.match.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.tournament.delete.mockResolvedValue({
        id: tournamentId,
      });

      await service.deleteTournament(tournamentId);

      expect(mockCloudinaryService.destroy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(service.deleteTournament(tournamentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
