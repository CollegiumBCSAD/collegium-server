import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  RosterChangeReason,
  RosterChangeStatus,
  Role,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamAuthorityService } from '../coach/team-authority.service';
import { RostersService } from './rosters.service';

const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

const mockPrismaService = {
  team: { findUnique: jest.fn(), update: jest.fn() },
  teamMember: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  tournamentApplication: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  tournament: { findUnique: jest.fn() },
  rosterChangeRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: { updateMany: jest.fn() },
  userGameHandle: { upsert: jest.fn() },
  teamAuditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = { create: jest.fn() };

const team = {
  id: 'team-1',
  name: 'Herons',
  captainId: 'cap',
  coachId: 'coach',
  gameTitle: 'VALORANT',
  min_roster_size: 5,
  max_roster_size: 6,
};
const coach = { id: 'coach', role: Role.COACH, displayName: 'Coach' } as User;
const lineup = ['cap', 'p1', 'p2', 'p3', 'p4'].map((userId) => ({ userId }));

describe('RostersService', () => {
  let service: RostersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.team.findUnique.mockResolvedValue(team);
    mockPrismaService.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        fn(mockPrismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RostersService,
        TeamAuthorityService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get(RostersService);
  });

  it('refuses roster edits from a regular athlete', async () => {
    await expect(
      service.getRoster('team-1', { id: 'p1', role: Role.ATHLETE } as User),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('removeMember()', () => {
    it('blocks removing a player on a submitted lineup', async () => {
      mockPrismaService.teamMember.findUnique.mockResolvedValue({
        id: 'm-1',
        teamId: 'team-1',
        userId: 'p1',
        gameHandle: 'Kaze',
        status: 'ACCEPTED',
      });
      mockPrismaService.tournamentApplication.findMany.mockResolvedValue([
        { rosterSnapshot: lineup, tournament: { name: 'UAAP S1' } },
      ]);

      await expect(
        service.removeMember('team-1', 'm-1', coach),
      ).rejects.toThrow(ConflictException);
      expect(mockPrismaService.teamMember.delete).not.toHaveBeenCalled();
    });

    it('removes a bench player and notifies them', async () => {
      mockPrismaService.teamMember.findUnique.mockResolvedValue({
        id: 'm-6',
        teamId: 'team-1',
        userId: 'bench',
        gameHandle: 'Bench',
        status: 'ACCEPTED',
      });
      mockPrismaService.tournamentApplication.findMany.mockResolvedValue([
        { rosterSnapshot: lineup, tournament: { name: 'UAAP S1' } },
      ]);
      mockPrismaService.teamMember.count.mockResolvedValue(0);

      await service.removeMember('team-1', 'm-6', coach);

      expect(mockPrismaService.teamMember.delete).toHaveBeenCalledWith({
        where: { id: 'm-6' },
      });
      expect(mockNotificationsService.create).toHaveBeenCalledTimes(1);
    });

    it('refuses to remove the captain', async () => {
      mockPrismaService.teamMember.findUnique.mockResolvedValue({
        id: 'm-0',
        teamId: 'team-1',
        userId: 'cap',
        status: 'ACCEPTED',
      });

      await expect(
        service.removeMember('team-1', 'm-0', coach),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('requestChange()', () => {
    const dto = {
      applicationId: 'app-1',
      outUserId: 'p1',
      inUserId: 'bench',
      reason: RosterChangeReason.INJURY,
      details: 'Sprained wrist at practice, cleared by team physician.',
    };

    beforeEach(() => {
      mockPrismaService.tournamentApplication.findFirst.mockResolvedValue({
        id: 'app-1',
        tournamentId: 't-1',
        rosterSnapshot: lineup,
        tournament: { name: 'UAAP S1', organizerId: 'org' },
      });
    });

    it('files the change and notifies the organizer', async () => {
      mockPrismaService.teamMember.findFirst.mockResolvedValue({ id: 'm-6' });
      mockPrismaService.rosterChangeRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rosterChangeRequest.create.mockResolvedValue({
        id: 'chg-1',
        outUser: { displayName: 'Kaze' },
        inUser: { displayName: 'Bench' },
      });

      await service.requestChange('team-1', coach, dto);

      expect(
        firstCallArg<{ userId: string }>(mockNotificationsService.create)
          .userId,
      ).toBe('org');
    });

    it('rejects an incoming player who is not on the team', async () => {
      mockPrismaService.teamMember.findFirst.mockResolvedValue(null);

      await expect(service.requestChange('team-1', coach, dto)).rejects.toThrow(
        /must already be on the team/,
      );
    });

    it('rejects an outgoing player who is not on the lineup', async () => {
      await expect(
        service.requestChange('team-1', coach, { ...dto, outUserId: 'nobody' }),
      ).rejects.toThrow(/not on the submitted lineup/);
    });
  });

  describe('reviewChange()', () => {
    const pending = {
      id: 'chg-1',
      teamId: 'team-1',
      tournamentId: 't-1',
      applicationId: 'app-1',
      outUserId: 'p1',
      inUserId: 'bench',
      reason: RosterChangeReason.INJURY,
      requestedById: 'coach',
      status: RosterChangeStatus.PENDING,
      outUser: { displayName: 'Kaze' },
      inUser: { displayName: 'Bench' },
      team: { name: 'Herons' },
      tournament: { name: 'UAAP S1' },
    };
    const organizer = { id: 'org', role: Role.ORGANIZER } as User;

    it('swaps the player in the submitted lineup on approval', async () => {
      mockPrismaService.rosterChangeRequest.findUnique.mockResolvedValue(
        pending,
      );
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        organizerId: 'org',
      });
      mockPrismaService.tournamentApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        rosterSnapshot: lineup,
      });
      mockPrismaService.teamMember.findFirst.mockResolvedValue({
        userId: 'bench',
        gameHandle: 'BenchIGN',
        preferredRole: null,
        user: { displayName: 'Bench', status: 'ACTIVE' },
      });

      await service.reviewChange('chg-1', organizer, { approve: true });

      const { data } = firstCallArg<{
        data: { rosterSnapshot: Array<{ userId: string }> };
      }>(mockPrismaService.tournamentApplication.update);
      expect(data.rosterSnapshot.map((s) => s.userId)).toEqual([
        'cap',
        'bench',
        'p2',
        'p3',
        'p4',
      ]);
      // requester, outgoing, and incoming player each hear about it
      expect(mockNotificationsService.create).toHaveBeenCalledTimes(3);
    });

    it("refuses a reviewer who doesn't run the tournament", async () => {
      mockPrismaService.rosterChangeRequest.findUnique.mockResolvedValue(
        pending,
      );
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        organizerId: 'org',
      });

      await expect(
        service.reviewChange(
          'chg-1',
          { id: 'org-2', role: Role.ORGANIZER } as User,
          { approve: true },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
