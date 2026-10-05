import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  GameTitle,
  PracticeRecordSource,
  PracticeResult,
  Role,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OcrService } from '../ocr/ocr.service';
import { FuzzyMatcherService } from '../ocr/fuzzy-matcher.service';
import { PracticeService } from './practice.service';
import { TeamAuthorityService } from './team-authority.service';

const mockPrismaService = {
  team: { findUnique: jest.fn() },
  teamMember: { findFirst: jest.fn(), findMany: jest.fn() },
  practiceSchedule: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  practiceRecord: { create: jest.fn(), findMany: jest.fn() },
  teamAuditLog: { create: jest.fn() },
};

const mockNotificationsService = { create: jest.fn() };
const mockOcrService = { recognize: jest.fn() };

const coach = { id: 'coach-1', displayName: 'Coach', role: Role.COACH } as User;

const roster = ['Kaze', 'Mirai', 'Tobi', 'Yuki', 'Hana'].map((handle, i) => ({
  userId: `u-${i}`,
  gameHandle: handle,
  preferredRole: null,
  user: { displayName: handle },
}));

const scanRow = (ign: string, extra: Record<string, unknown> = {}) => ({
  ign,
  team: null,
  kills: 0,
  deaths: 0,
  assists: 0,
  extra,
});

describe('PracticeService', () => {
  let service: PracticeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeService,
        TeamAuthorityService,
        FuzzyMatcherService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: OcrService, useValue: mockOcrService },
      ],
    }).compile();

    service = module.get(PracticeService);
  });

  describe('createSchedule()', () => {
    it('rejects a practice that ends before it starts', async () => {
      await expect(
        service.createSchedule('team-1', coach, {
          title: 'VOD review',
          startsAt: '2026-10-10T10:00:00.000Z',
          endsAt: '2026-10-10T09:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifies every rostered athlete', async () => {
      mockPrismaService.practiceSchedule.create.mockResolvedValue({
        id: 's-1',
        title: 'Scrim block',
        team: { name: 'Herons' },
      });
      mockPrismaService.teamMember.findMany.mockResolvedValue([
        { userId: 'u-1' },
        { userId: 'u-2' },
      ]);

      await service.createSchedule('team-1', coach, {
        title: 'Scrim block',
        startsAt: '2026-10-10T10:00:00.000Z',
      });

      expect(mockNotificationsService.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.teamAuditLog.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('scanRecord()', () => {
    beforeEach(() => {
      mockPrismaService.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Herons',
        gameTitle: GameTitle.VALORANT,
        members: roster,
      });
    });

    it('accepts a read that found the result and the roster', async () => {
      mockOcrService.recognize.mockResolvedValue({
        game: GameTitle.VALORANT,
        players: roster.map((m) =>
          scanRow(m.gameHandle, { result: 'Victory' }),
        ),
      });

      const res = await service.scanRecord('team-1', {
        buffer: Buffer.from(''),
      } as Express.Multer.File);

      expect(res.detectedResult).toBe(PracticeResult.WIN);
      expect(res.isConfident).toBe(true);
      expect(res.rosterMatched).toBe(5);
    });

    it('hands the result back to the coach when no outcome is on the board', async () => {
      mockOcrService.recognize.mockResolvedValue({
        game: GameTitle.VALORANT,
        players: roster.map((m) => scanRow(m.gameHandle)),
      });

      const res = await service.scanRecord('team-1', {
        buffer: Buffer.from(''),
      } as Express.Multer.File);

      expect(res.detectedResult).toBeNull();
      expect(res.isConfident).toBe(false);
      expect(res.confidence).toBe(0);
    });

    it('requires a screenshot', async () => {
      await expect(service.scanRecord('team-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createRecord()', () => {
    it('rejects a schedule from another team', async () => {
      mockPrismaService.practiceSchedule.findUnique.mockResolvedValue({
        id: 's-1',
        teamId: 'team-2',
      });

      await expect(
        service.createRecord('team-1', coach, {
          scheduleId: 's-1',
          result: PracticeResult.LOSS,
          completed: true,
          source: PracticeRecordSource.MANUAL,
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('assertCanView()', () => {
    it('blocks an organizer who is not on the team', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue({
        coachId: 'coach-1',
        captainId: 'cap-1',
      });
      mockPrismaService.teamMember.findFirst.mockResolvedValue(null);

      await expect(
        service.assertCanView('team-1', {
          id: 'org-1',
          role: Role.ORGANIZER,
        } as User),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
