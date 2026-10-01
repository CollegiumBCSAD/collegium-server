import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventStatus, EventTeamStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';
import { EventTeamsService, RosterEntry } from './event-teams.service';
import { RosterPlayerDto } from './dto/event-team.dto';

const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

const mockPrismaService = {
  event: { findUnique: jest.fn() },
  eventTeam: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const openEvent = {
  id: 'event-1',
  status: EventStatus.OPEN,
  signupsCloseAt: null,
  maxSubs: 2,
};

const player = (i: number, isSubstitute = false): RosterPlayerDto => ({
  fullName: `Player ${i}`,
  studentNumber: `2021-0000${i}`,
  ign: `ign${i}`,
  isSubstitute,
});

const squad = (starters = 5, subs = 0) => [
  ...Array.from({ length: starters }, (_, i) => player(i)),
  ...Array.from({ length: subs }, (_, i) => player(100 + i, true)),
];

const submission = (starters = 5, subs = 0) => ({
  name: 'Byte Force',
  captainName: 'Juan Dela Cruz',
  captainEmail: 'JUAN@umak.edu.ph',
  roster: squad(starters, subs),
});

describe('EventTeamsService', () => {
  let service: EventTeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventTeamsService,
        EventsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<EventTeamsService>(EventTeamsService);
    mockPrismaService.event.findUnique.mockResolvedValue(openEvent);
    mockPrismaService.eventTeam.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'team-1', ...data }),
    );
  });

  describe('submitTeam', () => {
    it('accepts five starters and assigns a stable id to every player', async () => {
      const team = await service.submitTeam('CODE', submission());
      const roster = team.roster as RosterEntry[];

      expect(roster).toHaveLength(5);
      expect(new Set(roster.map((entry) => entry.id)).size).toBe(5);
      for (const entry of roster) {
        expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('lowercases the captain email', async () => {
      const team = await service.submitTeam('CODE', submission());
      expect(team.captainEmail).toBe('juan@umak.edu.ph');
    });

    it('orders substitutes after starters', async () => {
      const team = await service.submitTeam('CODE', submission(5, 2));
      const roster = team.roster as RosterEntry[];

      expect(roster.map((entry) => entry.isSubstitute)).toEqual([
        false,
        false,
        false,
        false,
        false,
        true,
        true,
      ]);
    });

    it('rejects a squad with fewer than five starters', async () => {
      await expect(service.submitTeam('CODE', submission(4))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a squad with more than five starters', async () => {
      await expect(service.submitTeam('CODE', submission(6))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects more substitutes than the event allows', async () => {
      await expect(
        service.submitTeam('CODE', submission(5, 3)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicated student number', async () => {
      const dto = submission();
      dto.roster[1].studentNumber = dto.roster[0].studentNumber;

      await expect(service.submitTeam('CODE', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a sign-up once the deadline has passed', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...openEvent,
        signupsCloseAt: new Date(Date.now() - 1000),
      });

      await expect(service.submitTeam('CODE', submission())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a sign-up for a draft event', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...openEvent,
        status: EventStatus.DRAFT,
      });

      await expect(service.submitTeam('CODE', submission())).rejects.toThrow();
    });
  });

  describe('updateByEditToken', () => {
    const existing: RosterEntry[] = [
      {
        id: 'known-id',
        fullName: 'Player 0',
        studentNumber: '2021-00000',
        ign: 'ign0',
        isSubstitute: false,
      },
    ];

    beforeEach(() => {
      mockPrismaService.eventTeam.findUnique.mockResolvedValue({
        id: 'team-1',
        status: EventTeamStatus.PENDING,
        roster: existing,
        event: openEvent,
      });
      mockPrismaService.eventTeam.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'team-1', roster: existing, ...data }),
      );
    });

    it('keeps the id of a player who was already on the roster', async () => {
      const dto = submission();
      dto.roster[0] = { ...dto.roster[0], id: 'known-id' };

      const team = await service.updateByEditToken('token', dto);
      const roster = team.roster as RosterEntry[];

      expect(roster[0].id).toBe('known-id');
    });

    it('issues a fresh id when an unknown one is supplied', async () => {
      const dto = submission();
      dto.roster[0] = { ...dto.roster[0], id: 'forged-id' };

      const team = await service.updateByEditToken('token', dto);
      const roster = team.roster as RosterEntry[];

      expect(roster[0].id).not.toBe('forged-id');
    });

    it('sends an edited squad back for review', async () => {
      await service.updateByEditToken('token', submission());

      const call = firstCallArg<{ data: { status: EventTeamStatus } }>(
        mockPrismaService.eventTeam.update,
      );
      expect(call.data.status).toBe(EventTeamStatus.PENDING);
    });

    it('refuses to edit an approved squad', async () => {
      mockPrismaService.eventTeam.findUnique.mockResolvedValue({
        id: 'team-1',
        status: EventTeamStatus.APPROVED,
        roster: existing,
        event: openEvent,
      });

      await expect(
        service.updateByEditToken('token', submission()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findForCaptain', () => {
    it('returns nothing for an unverified email without querying', async () => {
      await expect(
        service.findForCaptain({
          email: 'juan@umak.edu.ph',
          emailVerified: false,
        }),
      ).resolves.toEqual([]);
      expect(mockPrismaService.eventTeam.findMany).not.toHaveBeenCalled();
    });

    it('matches the lowercased email and swaps the roster for a count', async () => {
      mockPrismaService.eventTeam.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Byte Force', roster: squad(5, 1) },
      ]);

      const result = await service.findForCaptain({
        email: 'JUAN@umak.edu.ph',
        emailVerified: true,
      });

      const query = firstCallArg<{ where: { captainEmail: string } }>(
        mockPrismaService.eventTeam.findMany,
      );
      expect(query.where.captainEmail).toBe('juan@umak.edu.ph');
      expect(result).toEqual([
        { id: 'team-1', name: 'Byte Force', playerCount: 6 },
      ]);
    });
  });

  describe('generateEditToken', () => {
    it('produces distinct url-safe tokens', () => {
      const tokens = new Set(
        Array.from({ length: 50 }, () => service.generateEditToken()),
      );

      expect(tokens.size).toBe(50);
      for (const token of tokens) {
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });
  });
});
