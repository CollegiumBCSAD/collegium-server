import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamMemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamsService } from './teams.service';

const mockPrismaService = {
  user: { findUnique: jest.fn(), updateMany: jest.fn() },
  team: { findUnique: jest.fn(), updateMany: jest.fn() },
  teamMember: {
    findFirst: jest.fn(),
    create: jest.fn<
      Promise<unknown>,
      [{ data: { status: TeamMemberStatus } }]
    >(),
  },
  userGameHandle: { upsert: jest.fn() },
};

const mockNotificationsService = { create: jest.fn() };

const team = {
  id: 'team-1',
  name: 'QA Owls',
  universityId: 'uni-a',
  university: { id: 'uni-a', name: 'QA State College' },
  captainId: 'captain-1',
  coachId: null,
  inviteCode: 'abc123',
  gameTitle: 'MOBILE_LEGENDS',
};

describe('TeamsService', () => {
  let service: TeamsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
    jest.clearAllMocks();
  });

  describe('joinTeam()', () => {
    it('rejects a player from another university even with a valid invite code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        universityId: 'uni-b',
        university: { id: 'uni-b', name: 'Other University' },
      });
      mockPrismaService.team.findUnique.mockResolvedValue(team);

      await expect(
        service.joinTeam('team-1', 'user-1', {
          inviteCode: 'abc123',
          gameHandle: '12345678 (9999)',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.teamMember.create).not.toHaveBeenCalled();
    });

    it('lets a player from the same university join with the invite code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        universityId: 'uni-a',
        university: { id: 'uni-a', name: 'QA State College' },
      });
      mockPrismaService.team.findUnique.mockResolvedValue(team);
      mockPrismaService.teamMember.findFirst.mockResolvedValue(null);
      mockPrismaService.teamMember.create.mockResolvedValue({
        id: 'member-1',
        userId: 'user-1',
        status: TeamMemberStatus.ACCEPTED,
      });

      await service.joinTeam('team-1', 'user-1', {
        inviteCode: 'abc123',
        gameHandle: '12345678 (9999)',
      });

      expect(
        mockPrismaService.teamMember.create.mock.calls[0][0].data.status,
      ).toBe(TeamMemberStatus.ACCEPTED);
    });
  });
});
