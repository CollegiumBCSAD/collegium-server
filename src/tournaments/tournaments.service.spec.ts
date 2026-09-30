import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BracketFormat,
  BracketSide,
  TournamentStatus,
  GameTitle,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { OcrService } from '../ocr/ocr.service';
import { RankingService } from '../ranking/ranking.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TournamentsService } from './tournaments.service';

// Reads the first argument of a mock's first call. Untyped jest.fn() mocks
// record calls as any[][], so this is the one typed way in.
const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

// MOCK FACTORIES
// We never hit a real database in unit tests. We mock PrismaService
// with jest.fn() so we can control what it returns in each test.

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
    createMany: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  playerStat: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  team: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  tournamentApplication: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  tournamentChatMessage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  // Explicit return type breaks the self-reference that would otherwise make
  // TypeScript infer the whole mock object as `any`.
  $transaction: jest.fn((cb: (tx: unknown) => unknown): unknown =>
    cb(mockPrismaService),
  ),
};

const mockNotificationsService = {
  create: jest.fn(),
};

const mockCloudinaryService = {
  upload: jest.fn(),
  destroy: jest.fn(),
};

const mockOcrService = {
  recognize: jest.fn(),
};

const mockRankingService = {
  closeTournamentRatingPeriod: jest.fn().mockResolvedValue({}),
  getTeamRatingHistory: jest.fn().mockResolvedValue([]),
};

const mockRealtimeGateway = {
  emitToTournament: jest.fn(),
  emitToUser: jest.fn(),
  emitToScrim: jest.fn(),
};

describe('TournamentsService', () => {
  let service: TournamentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: OcrService, useValue: mockOcrService },
        { provide: RankingService, useValue: mockRankingService },
        { provide: RealtimeGateway, useValue: mockRealtimeGateway },
      ],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);

    // Reset all mocks before each test so they don't bleed into each other
    jest.clearAllMocks();

    mockPrismaService.team.findMany.mockResolvedValue([]);
    mockPrismaService.team.findFirst.mockResolvedValue(null);
    mockPrismaService.team.findUnique.mockResolvedValue(null);
    mockPrismaService.playerStat.createMany.mockResolvedValue({ count: 0 });
    mockPrismaService.match.updateMany.mockResolvedValue({ count: 1 });
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
          gameTitle: undefined,
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
          gameTitle: undefined,
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

    it('persists gameTitle, bracketFormat, teamQuota, and rules when provided', async () => {
      const dto = {
        name: 'Community Cup',
        gameTitle: GameTitle.VALORANT,
        bracketFormat: BracketFormat.SINGLE_ELIM,
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
          gameTitle: dto.gameTitle,
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
          gameTitle: undefined,
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

  // startTournament()
  describe('startTournament()', () => {
    const tournamentId = 'tournament-uuid';
    const user = { id: 'organizer-uuid', role: Role.ADMIN };

    it('generates the bracket for Round Robin + Playoffs with an odd university count', async () => {
      // Regression check: startTournament used to gate bracket generation on
      // an even university count regardless of format, which silently skipped
      // generating a Round Robin + Playoffs bracket (it has no such
      // requirement) and left the tournament ONGOING with zero matches.
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        id: tournamentId,
        organizerId: user.id,
        status: TournamentStatus.UPCOMING,
        bracketFormat: BracketFormat.TWO_STAGE,
        matches: [],
        universities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
        bracketFormat: BracketFormat.TWO_STAGE,
        universities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        id: tournamentId,
        matches: [],
        universities: [],
      });
      mockPrismaService.match.createMany.mockResolvedValue({ count: 3 });
      mockPrismaService.tournament.update.mockResolvedValue({});

      await service.startTournament(tournamentId, user);

      expect(mockPrismaService.match.createMany).toHaveBeenCalledTimes(1);
      const firstCall = mockPrismaService.match.createMany.mock
        .calls[0] as unknown as [{ data: Array<{ round: number }> }];
      const { data } = firstCall[0];
      expect(data).toHaveLength(3); // C(3,2) round-robin pairings, no evenness required
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

    it('seeds a single-elim round 1 with a bye for an odd (non-power-of-2) field', async () => {
      mockPrismaService.tournament.findUnique
        .mockResolvedValueOnce({
          id: tournamentId,
          status: TournamentStatus.UPCOMING,
          gameTitle: GameTitle.LOL,
          universities: [{ id: 'uni-1' }, { id: 'uni-2' }, { id: 'uni-3' }],
        })
        .mockResolvedValueOnce({
          id: tournamentId,
          matches: [],
          universities: [],
        });
      mockPrismaService.match.createMany.mockResolvedValue({ count: 2 });
      mockPrismaService.tournament.update.mockResolvedValue({});

      await service.generateBracket(tournamentId);

      const firstCall = mockPrismaService.match.createMany.mock.calls[0] as [
        {
          data: Array<{
            round: number;
            slot: number;
            isVerified: boolean;
            winnerId?: string;
            loserId?: string;
          }>;
        },
      ];
      const { data } = firstCall[0];
      // 3 teams -> pad to 4: one pre-verified bye + one real round-1 match,
      // plus the round-2 final created up front as an empty placeholder.
      const round1 = data.filter((m) => m.round === 1);
      expect(round1).toHaveLength(2);
      const byes = round1.filter((m) => m.isVerified);
      expect(byes).toHaveLength(1);
      expect(byes[0].loserId).toBeUndefined();

      const round2 = data.filter((m) => m.round === 2);
      expect(round2).toHaveLength(1);
      expect(round2[0].winnerId).toBeUndefined();
      expect(round2[0].loserId).toBeUndefined();
      expect(round2[0].slot).toBe(0);
    });

    it('creates the full tree up front for an 8-team single-elim field', async () => {
      mockPrismaService.tournament.findUnique
        .mockResolvedValueOnce({
          id: tournamentId,
          status: TournamentStatus.UPCOMING,
          gameTitle: GameTitle.VALORANT,
          universities: Array.from({ length: 8 }, (_, i) => ({
            id: `uni-${i + 1}`,
          })),
        })
        .mockResolvedValueOnce({
          id: tournamentId,
          matches: [],
          universities: [],
        });
      mockPrismaService.team.findMany.mockResolvedValue([]);
      mockPrismaService.match.createMany.mockResolvedValue({ count: 7 });
      mockPrismaService.tournament.update.mockResolvedValue({});

      await service.generateBracket(tournamentId);

      const firstCall = mockPrismaService.match.createMany.mock.calls[0] as [
        {
          data: Array<{
            round: number;
            slot: number;
            title: GameTitle;
            winnerId?: string;
          }>;
        },
      ];
      const { data } = firstCall[0];

      // 4 quarterfinals + 2 semifinals + 1 final, all at once.
      expect(data).toHaveLength(7);
      expect(data.filter((m) => m.round === 1)).toHaveLength(4);
      expect(data.filter((m) => m.round === 2)).toHaveLength(2);
      expect(data.filter((m) => m.round === 3)).toHaveLength(1);

      // Round 1 is fully drawn, later rounds are empty TBD slots.
      expect(data.filter((m) => m.round === 1).every((m) => !!m.winnerId)).toBe(
        true,
      );
      expect(data.filter((m) => m.round > 1).every((m) => !m.winnerId)).toBe(
        true,
      );

      // Slots number left to right within each round.
      expect(data.filter((m) => m.round === 1).map((m) => m.slot)).toEqual([
        0, 1, 2, 3,
      ]);

      // Matches carry the tournament's own game, not a hardcoded LOL.
      expect(data.every((m) => m.title === GameTitle.VALORANT)).toBe(true);
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

  // generateBracket() — format dispatch for the two new bracket formats
  describe('generateBracket() format dispatch', () => {
    const tournamentId = 'tournament-uuid';

    beforeEach(() => {
      mockPrismaService.match.createMany.mockResolvedValue({ count: 0 });
      mockPrismaService.tournament.update.mockResolvedValue({});
    });

    it('creates all-pairs round-robin matches at round 0 (order-agnostic to team count parity)', async () => {
      mockPrismaService.tournament.findUnique
        .mockResolvedValueOnce({
          id: tournamentId,
          status: TournamentStatus.UPCOMING,
          bracketFormat: BracketFormat.TWO_STAGE,
          universities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        })
        .mockResolvedValueOnce({
          id: tournamentId,
          matches: [],
          universities: [],
        });

      await service.generateBracket(tournamentId);

      const firstCall = mockPrismaService.match.createMany.mock.calls[0] as [
        { data: Array<{ round: number }> },
      ];
      const { data } = firstCall[0];
      expect(data).toHaveLength(3); // C(3,2) pairings for 3 universities
      expect(data.every((m: { round: number }) => m.round === 0)).toBe(true);
    });

    it('rejects Double Elimination when the university count is not a power of 2', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        id: tournamentId,
        status: TournamentStatus.UPCOMING,
        bracketFormat: BracketFormat.DOUBLE_ELIM,
        universities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });

      await expect(service.generateBracket(tournamentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('seeds Double Elimination winners-bracket round 1', async () => {
      mockPrismaService.tournament.findUnique
        .mockResolvedValueOnce({
          id: tournamentId,
          status: TournamentStatus.UPCOMING,
          bracketFormat: BracketFormat.DOUBLE_ELIM,
          universities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
        })
        .mockResolvedValueOnce({
          id: tournamentId,
          matches: [],
          universities: [],
        });

      await service.generateBracket(tournamentId);

      const firstCall = mockPrismaService.match.createMany.mock.calls[0] as [
        { data: Array<{ round: number; bracketSide: BracketSide }> },
      ];
      const { data } = firstCall[0];
      expect(data).toHaveLength(2);
      expect(
        data.every(
          (m: { round: number; bracketSide: BracketSide }) =>
            m.round === 1 && m.bracketSide === BracketSide.WINNERS,
        ),
      ).toBe(true);
    });
  });

  // losersBracketSchedule() — the double-elim losers-bracket round plan
  describe('losersBracketSchedule()', () => {
    it('produces the correct seed/merge/pure schedule for 4, 8, and 16 team fields', () => {
      const svc = service as unknown as {
        losersBracketSchedule: (wbRounds: number) => unknown[];
      };

      expect(svc.losersBracketSchedule(2)).toEqual([
        { type: 'seed', consumesWbRound: 1 },
        { type: 'merge', consumesWbRound: 2 },
      ]);

      expect(svc.losersBracketSchedule(3)).toEqual([
        { type: 'seed', consumesWbRound: 1 },
        { type: 'merge', consumesWbRound: 2 },
        { type: 'pure' },
        { type: 'merge', consumesWbRound: 3 },
      ]);

      expect(svc.losersBracketSchedule(4)).toEqual([
        { type: 'seed', consumesWbRound: 1 },
        { type: 'merge', consumesWbRound: 2 },
        { type: 'pure' },
        { type: 'merge', consumesWbRound: 3 },
        { type: 'pure' },
        { type: 'merge', consumesWbRound: 4 },
      ]);
    });
  });

  // closeMatch() bracket advancement
  describe('closeMatch() bracket advancement', () => {
    const tournamentId = 'tournament-uuid';
    const matchId = 'match-2';

    const closeDto = {
      winnerId: 'uni-a',
      players: [
        {
          universityId: 'uni-a',
          name: 'Player 1',
          kills: 5,
          deaths: 1,
          assists: 3,
        },
      ],
    };

    it('advances to the next single-elimination round once the current round is fully verified', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a',
        loserId: 'uni-b',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockPrismaService.match.update.mockResolvedValue({
        ...mockMatch,
        isVerified: true,
      });
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        status: TournamentStatus.ONGOING,
        bracketFormat: null,
      });
      mockPrismaService.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          round: 1,
          bracketSide: null,
          winnerId: 'uni-a',
          loserId: 'uni-b',
          isVerified: true,
        },
        {
          id: 'm2',
          round: 1,
          bracketSide: null,
          winnerId: 'uni-c',
          loserId: 'uni-d',
          isVerified: true,
        },
      ]);
      mockPrismaService.match.createMany.mockResolvedValue({ count: 1 });

      await service.closeMatch(tournamentId, matchId, closeDto);

      const expectedData = expect.arrayContaining([
        expect.objectContaining({
          round: 2,
          winnerId: 'uni-a',
          loserId: 'uni-c',
        }),
      ]) as unknown;
      expect(mockPrismaService.match.createMany).toHaveBeenCalledWith({
        data: expectedData,
      });
    });

    it('marks the tournament COMPLETED once the final round produces a single winner', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a',
        loserId: 'uni-b',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockPrismaService.match.update.mockResolvedValue({
        ...mockMatch,
        isVerified: true,
      });
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        status: TournamentStatus.ONGOING,
        bracketFormat: null,
      });
      mockPrismaService.match.findMany.mockResolvedValue([
        {
          id: 'gf',
          round: 3,
          bracketSide: null,
          winnerId: 'uni-a',
          loserId: 'uni-b',
          isVerified: true,
        },
      ]);

      await service.closeMatch(tournamentId, matchId, closeDto);

      expect(
        mockRankingService.closeTournamentRatingPeriod,
      ).toHaveBeenCalledWith(tournamentId);
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

  // closeMatch()
  describe('closeMatch()', () => {
    const tournamentId = 'tournament-uuid';
    const matchId = 'match-uuid';
    const closeDto = {
      winnerId: 'uni-a',
      players: [
        {
          universityId: 'uni-a',
          name: 'Player 1',
          kills: 10,
          deaths: 2,
          assists: 5,
        },
        {
          universityId: 'uni-b',
          name: 'Player 2',
          kills: 3,
          deaths: 8,
          assists: 1,
        },
      ],
    };

    it('closes a match by writing the organizer-picked winner and per-player stats', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a', // pairing slot from generateBracket, not a real result yet
        loserId: 'uni-b',
        title: GameTitle.LOL,
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockPrismaService.match.update.mockResolvedValue({
        ...mockMatch,
        isVerified: true,
      });

      const result = await service.closeMatch(tournamentId, matchId, closeDto);

      expect(mockPrismaService.playerStat.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            universityId: 'uni-a',
            summonerName: 'Player 1',
            win: true,
            dataSource: 'PEER_VERIFIED',
          }),
          expect.objectContaining({
            universityId: 'uni-b',
            summonerName: 'Player 2',
            win: false,
            dataSource: 'PEER_VERIFIED',
          }),
        ],
      });
      expect(mockPrismaService.match.update).toHaveBeenCalledWith({
        where: { id: matchId },
        data: { winnerId: 'uni-a', loserId: 'uni-b', isVerified: true },
      });
      expect(result.isVerified).toBe(true);
    });

    it('rolls the isVerified claim back when the stat insert fails, so the match stays closeable', async () => {
      mockPrismaService.match.findFirst.mockResolvedValue({
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a',
        loserId: 'uni-b',
        title: GameTitle.LOL,
      });
      mockPrismaService.match.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.playerStat.createMany.mockRejectedValue(
        new Error('stat insert blew up'),
      );

      // A real $transaction rolls the claim back on a throw. The mock runs the
      // callback inline, so the guarantee under test is that the claim and the
      // insert are inside the same transaction callback at all.
      await expect(
        service.closeMatch(tournamentId, matchId, closeDto),
      ).rejects.toThrow('stat insert blew up');

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.match.update).not.toHaveBeenCalled();
    });

    it('writes the flipped winner/loser when the organizer picks the other team', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a', // pairing slot only — organizer picks uni-b as the real winner below
        loserId: 'uni-b',
        title: GameTitle.LOL,
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);
      mockPrismaService.match.update.mockResolvedValue({
        ...mockMatch,
        isVerified: true,
      });

      await service.closeMatch(tournamentId, matchId, {
        ...closeDto,
        winnerId: 'uni-b',
      });

      expect(mockPrismaService.match.update).toHaveBeenCalledWith({
        where: { id: matchId },
        data: { winnerId: 'uni-b', loserId: 'uni-a', isVerified: true },
      });
    });

    it('should throw NotFoundException if match does not exist', async () => {
      mockPrismaService.match.findFirst.mockResolvedValue(null);

      await expect(
        service.closeMatch(tournamentId, matchId, closeDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if match is already closed', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: true,
        winnerId: 'uni-a',
        loserId: 'uni-b',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(
        service.closeMatch(tournamentId, matchId, closeDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if winnerId is not one of the two universities in the match', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a',
        loserId: 'uni-b',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(
        service.closeMatch(tournamentId, matchId, {
          ...closeDto,
          winnerId: 'uni-zzz',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a player is attributed to a university not in the match', async () => {
      const mockMatch = {
        id: matchId,
        tournamentId,
        isVerified: false,
        winnerId: 'uni-a',
        loserId: 'uni-b',
      };
      mockPrismaService.match.findFirst.mockResolvedValue(mockMatch);

      await expect(
        service.closeMatch(tournamentId, matchId, {
          winnerId: 'uni-a',
          players: [
            {
              universityId: 'uni-zzz',
              name: 'Ghost',
              kills: 0,
              deaths: 0,
              assists: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
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
      mockPrismaService.playerStat.deleteMany.mockResolvedValue({ count: 4 });
      mockPrismaService.match.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.tournament.delete.mockResolvedValue({
        id: tournamentId,
      });
      mockCloudinaryService.destroy.mockResolvedValue(undefined);

      await service.deleteTournament(tournamentId);

      expect(mockPrismaService.playerStat.deleteMany).toHaveBeenCalledWith({
        where: { match: { tournamentId } },
      });
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

  // getAllPendingApplications()
  describe('getAllPendingApplications()', () => {
    it('returns pending applications across tournaments, enriched with the real tournament name/game', async () => {
      mockPrismaService.tournamentApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          tournamentId: 'tournament-1',
          universityId: 'uni-1',
          userId: 'user-1',
          applicantName: 'Captain One',
          status: 'PENDING',
          teamId: null,
          teamName: null,
          appliedAt: new Date('2026-01-01'),
          university: { name: 'University of Makati' },
          tournament: { name: 'Community Cup', gameTitle: GameTitle.VALORANT },
        },
      ]);

      const result = await service.getAllPendingApplications();

      expect(result).toEqual([
        expect.objectContaining({
          id: 'app-1',
          tournamentId: 'tournament-1',
          universityName: 'University of Makati',
          status: 'PENDING',
          tournamentName: 'Community Cup',
          gameTitle: GameTitle.VALORANT,
        }),
      ]);
    });

    it('returns an empty list when nothing is pending', async () => {
      mockPrismaService.tournamentApplication.findMany.mockResolvedValue([]);
      const result = await service.getAllPendingApplications();
      expect(result).toEqual([]);
    });
  });

  // Squad-level application & validation
  describe('applyForTournament()', () => {
    it('rejects squad application if active roster count is less than min_roster_size', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        status: TournamentStatus.UPCOMING,
        gameTitle: GameTitle.VALORANT,
      });

      mockPrismaService.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'UP Fighting Maroons',
        universityId: 'uni-1',
        captainId: 'u-cap',
        min_roster_size: 5,
        members: [{ userId: 'u-1', status: 'ACCEPTED' }], // Only 2 total active slots (captain + 1 member)
        captain: { id: 'u-cap', displayName: 'Captain' },
      });

      await expect(
        service.applyForTournament(
          't1',
          { id: 'u-cap', universityId: 'uni-1' },
          { teamId: 'team-1' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('snapshots roster and creates a single team-level application when roster meets min size', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        status: TournamentStatus.UPCOMING,
        gameTitle: GameTitle.VALORANT,
      });

      const members = [
        { userId: 'u-1', status: 'ACCEPTED', gameHandle: 'Player1' },
        { userId: 'u-2', status: 'ACCEPTED', gameHandle: 'Player2' },
        { userId: 'u-3', status: 'ACCEPTED', gameHandle: 'Player3' },
        { userId: 'u-4', status: 'ACCEPTED', gameHandle: 'Player4' },
      ];

      mockPrismaService.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'UP Fighting Maroons',
        universityId: 'uni-1',
        captainId: 'u-cap',
        min_roster_size: 5,
        members,
        captain: { id: 'u-cap', displayName: 'Captain' },
      });

      mockPrismaService.tournamentApplication.upsert.mockResolvedValue({
        id: 'app-1',
        tournamentId: 't1',
        universityId: 'uni-1',
        userId: 'u-cap',
        applicantName: 'Captain',
        status: 'PENDING',
        teamId: 'team-1',
        teamName: 'UP Fighting Maroons',
        appliedAt: new Date(),
        rosterSnapshot: [{ userId: 'u-cap', role: 'Captain / Starter' }],
        university: { name: 'University of the Philippines' },
        team: { name: 'UP Fighting Maroons' },
      });

      const res = await service.applyForTournament(
        't1',
        { id: 'u-cap', displayName: 'Captain', universityId: 'uni-1' },
        { teamId: 'team-1' },
      );

      expect(res.teamId).toBe('team-1');
      expect(res.status).toBe('PENDING');
      expect(
        mockPrismaService.tournamentApplication.upsert,
      ).toHaveBeenCalledTimes(1);
    });
  });

  // forfeitMatch()
  describe('forfeitMatch()', () => {
    it('forfeits match with zero player stats and advances non-forfeiting team', async () => {
      mockPrismaService.match.findFirst.mockResolvedValue({
        id: 'm1',
        tournamentId: 't1',
        isVerified: false,
        winnerId: 'uni-1',
        loserId: 'uni-2',
        round: 1,
        slot: 0,
      });

      mockPrismaService.match.update.mockResolvedValue({
        id: 'm1',
        winnerId: 'uni-2', // uni-1 forfeited, so uni-2 wins
        loserId: 'uni-1',
        isVerified: true,
        isForfeit: true,
        forfeitingTeamId: 'uni-1',
      });

      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        status: TournamentStatus.ONGOING,
        bracketFormat: BracketFormat.SINGLE_ELIM,
      });

      mockPrismaService.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          round: 1,
          bracketSide: null,
          winnerId: 'uni-2',
          loserId: 'uni-1',
          isVerified: true,
          slot: 0,
        },
        {
          id: 'm2',
          round: 1,
          bracketSide: null,
          winnerId: null,
          loserId: null,
          isVerified: false, // Still unverified! Championship guard blocks completion
          slot: 1,
        },
      ]);

      const result = await service.forfeitMatch('t1', 'm1', 'uni-1');

      expect(result.isForfeit).toBe(true);
      expect(result.winnerId).toBe('uni-2');
      // Verify no player stats were created
      expect(mockPrismaService.playerStat.createMany).not.toHaveBeenCalled();
    });
  });

  // Tournament global channel messages
  describe('tournament global channel', () => {
    it('blocks a non-participant from reading the channel', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        organizerId: 'org-1',
      });
      mockPrismaService.tournamentApplication.findFirst.mockResolvedValue(null);

      await expect(
        service.getTournamentMessages('t1', {
          id: 'outsider-1',
          role: Role.ATHLETE,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets an athlete on an approved participating squad read the channel', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        organizerId: 'org-1',
      });
      mockPrismaService.tournamentApplication.findFirst.mockResolvedValue({
        teamName: 'Squad Alpha',
      });
      mockPrismaService.tournamentChatMessage.findMany.mockResolvedValue([]);

      const res = await service.getTournamentMessages('t1', {
        id: 'user-1',
        role: Role.ATHLETE,
      });

      expect(res).toEqual([]);
    });

    it('blocks a non-participant from posting to the channel', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        organizerId: 'org-1',
      });
      mockPrismaService.tournamentApplication.findFirst.mockResolvedValue(null);

      await expect(
        service.createTournamentMessage(
          't1',
          {
            id: 'outsider-1',
            displayName: 'Random Athlete',
            role: Role.ATHLETE,
          },
          { text: 'Can I sneak in?' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a message and emits to socket room', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        organizerId: 'org-1',
      });

      mockPrismaService.tournamentApplication.findFirst.mockResolvedValue({
        teamName: 'Squad Alpha',
      });

      mockPrismaService.tournamentChatMessage.create.mockResolvedValue({
        id: 'msg-1',
        tournamentId: 't1',
        senderId: 'user-1',
        senderName: 'Player One',
        teamName: 'Squad Alpha',
        text: 'Ready for the match!',
        isPinned: false,
        isAnnouncement: false,
      });

      const res = await service.createTournamentMessage(
        't1',
        { id: 'user-1', displayName: 'Player One', role: Role.ATHLETE },
        { text: 'Ready for the match!' },
      );

      expect(res.id).toBe('msg-1');
      expect(mockRealtimeGateway.emitToTournament).toHaveBeenCalledWith(
        't1',
        'tournament:new_message',
        expect.any(Object),
      );
    });

    it('allows organizer to create pinned announcements', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't1',
        organizerId: 'org-1',
      });

      mockPrismaService.tournamentChatMessage.create.mockResolvedValue({
        id: 'msg-announcement',
        tournamentId: 't1',
        senderId: 'org-1',
        senderName: 'Tournament Director',
        text: 'Bracket matches will begin at 2:00 PM!',
        isPinned: true,
        isAnnouncement: true,
      });

      const res = await service.createTournamentMessage(
        't1',
        {
          id: 'org-1',
          displayName: 'Tournament Director',
          role: Role.ORGANIZER,
        },
        {
          text: 'Bracket matches will begin at 2:00 PM!',
          isPinned: true,
          isAnnouncement: true,
        },
      );

      expect(
        firstCallArg<object>(mockPrismaService.tournamentChatMessage.create),
      ).toMatchObject({
        data: { isPinned: true, isAnnouncement: true },
      });
      expect(res.isPinned).toBe(true);
    });
  });
});
