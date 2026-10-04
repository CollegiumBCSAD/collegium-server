import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountStatus,
  GameTitle,
  NotificationType,
  Role,
  TeamInvitationStatus,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CoachService } from './coach.service';
import { TeamAuthorityService } from './team-authority.service';

const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

const mockPrismaService = {
  user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  university: { findUnique: jest.fn() },
  team: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  teamMember: { findFirst: jest.fn() },
  teamInvitation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  teamAuditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = { create: jest.fn() };

const coach = {
  id: 'coach-1',
  displayName: 'Coach Reyes',
  role: Role.COACH,
  status: AccountStatus.ACTIVE,
  universityId: 'uni-1',
} as User;

const captain = {
  id: 'cap-1',
  displayName: 'Cap',
  role: Role.ATHLETE,
  universityId: 'uni-1',
} as User;

describe('CoachService', () => {
  let service: CoachService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        fn(mockPrismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachService,
        TeamAuthorityService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get(CoachService);
  });

  describe('reviewApplication()', () => {
    it('activates a pending coach and notifies them', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'coach-1',
        role: Role.COACH,
        status: AccountStatus.PENDING,
      });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'coach-1',
        status: AccountStatus.ACTIVE,
      });

      await service.reviewApplication('coach-1', true);

      expect(
        firstCallArg<{ data: unknown }>(mockPrismaService.user.update).data,
      ).toEqual({ status: AccountStatus.ACTIVE });
      expect(
        firstCallArg<{ type: NotificationType }>(
          mockNotificationsService.create,
        ).type,
      ).toBe(NotificationType.COACH_ACCOUNT_APPROVED);
    });

    it('rejects reviewing a user who is not a coach', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u-1',
        role: Role.ATHLETE,
        status: AccountStatus.PENDING,
      });

      await expect(service.reviewApplication('u-1', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects reviewing an application that is no longer pending', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'coach-1',
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
      });

      await expect(service.reviewApplication('coach-1', false)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createTeam()', () => {
    it('auto-assigns the coach and leaves the captain slot open', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({
        id: 'uni-1',
        name: 'University of Makati',
      });
      mockPrismaService.team.findFirst.mockResolvedValue(null);
      mockPrismaService.team.create.mockResolvedValue({
        id: 'team-1',
        name: 'UMak Herons',
        gameTitle: GameTitle.LOL,
      });

      await service.createTeam(coach, {
        name: ' UMak Herons ',
        gameTitle: GameTitle.LOL,
      });

      const { data } = firstCallArg<{ data: Record<string, unknown> }>(
        mockPrismaService.team.create,
      );
      expect(data).toMatchObject({
        name: 'UMak Herons',
        coachId: 'coach-1',
        universityId: 'uni-1',
        max_roster_size: 7,
      });
      expect(data.captainId).toBeUndefined();
      expect(mockPrismaService.teamAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a duplicate team name within the university and title', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({
        id: 'uni-1',
        name: 'University of Makati',
      });
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 'other' });

      await expect(
        service.createTeam(coach, {
          name: 'UMak Herons',
          gameTitle: GameTitle.VALORANT,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('inviteCoach()', () => {
    const team = {
      id: 'team-1',
      name: 'UMak Herons',
      captainId: 'cap-1',
      coachId: null,
      universityId: 'uni-1',
    };

    it('lets the captain invite an approved coach from the same university', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue(team);
      mockPrismaService.user.findUnique.mockResolvedValue(coach);
      mockPrismaService.teamInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.teamInvitation.create.mockResolvedValue({
        id: 'inv-1',
      });

      await service.inviteCoach('team-1', captain, 'COACH@umak.edu.ph');

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'coach@umak.edu.ph' },
      });
      expect(
        firstCallArg<{ type: NotificationType; userId: string }>(
          mockNotificationsService.create,
        ),
      ).toMatchObject({
        type: NotificationType.COACH_INVITE_RECEIVED,
        userId: 'coach-1',
      });
    });

    it('refuses invites from anyone but the captain', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue(team);

      await expect(
        service.inviteCoach(
          'team-1',
          { ...captain, id: 'someone-else' },
          'coach@umak.edu.ph',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses when the team already has a coach', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue({
        ...team,
        coachId: 'coach-9',
      });

      await expect(
        service.inviteCoach('team-1', captain, 'coach@umak.edu.ph'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a coach account that is still awaiting approval', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue(team);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...coach,
        status: AccountStatus.PENDING,
      });

      await expect(
        service.inviteCoach('team-1', captain, 'coach@umak.edu.ph'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respondToInvitation()', () => {
    const future = new Date(Date.now() + 86_400_000);
    const invitation = {
      id: 'inv-1',
      coachId: 'coach-1',
      invitedById: 'cap-1',
      status: TeamInvitationStatus.PENDING,
      expiresAt: future,
      team: { id: 'team-1', name: 'UMak Herons' },
    };

    it('assigns the coach and cancels other pending invites on accept', async () => {
      mockPrismaService.teamInvitation.findUnique.mockResolvedValue(invitation);
      mockPrismaService.teamMember.findFirst.mockResolvedValue(null);
      mockPrismaService.team.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.respondToInvitation(coach, 'inv-1', true);

      expect(res.status).toBe(TeamInvitationStatus.ACCEPTED);
      expect(mockPrismaService.team.updateMany).toHaveBeenCalledWith({
        where: { id: 'team-1', coachId: null },
        data: { coachId: 'coach-1' },
      });
      expect(mockPrismaService.teamInvitation.updateMany).toHaveBeenCalled();
    });

    it('refuses when another coach claimed the team first', async () => {
      mockPrismaService.teamInvitation.findUnique.mockResolvedValue(invitation);
      mockPrismaService.teamMember.findFirst.mockResolvedValue(null);
      mockPrismaService.team.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.respondToInvitation(coach, 'inv-1', true),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a coach who already holds a player slot on the team', async () => {
      mockPrismaService.teamInvitation.findUnique.mockResolvedValue(invitation);
      mockPrismaService.teamMember.findFirst.mockResolvedValue({ id: 'm-1' });

      await expect(
        service.respondToInvitation(coach, 'inv-1', true),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.team.updateMany).not.toHaveBeenCalled();
    });

    it('marks an expired invitation and refuses it', async () => {
      mockPrismaService.teamInvitation.findUnique.mockResolvedValue({
        ...invitation,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.respondToInvitation(coach, 'inv-1', true),
      ).rejects.toThrow(/expired/);
      expect(mockPrismaService.teamInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: TeamInvitationStatus.EXPIRED },
      });
    });

    it("hides another coach's invitation", async () => {
      mockPrismaService.teamInvitation.findUnique.mockResolvedValue({
        ...invitation,
        coachId: 'coach-2',
      });

      await expect(
        service.respondToInvitation(coach, 'inv-1', false),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
