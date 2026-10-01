import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';
import { EventDocumentsService } from './event-documents.service';
import { EventBracketService } from './event-bracket.service';

const tx = {
  eventMatch: {
    updateMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  event: { update: jest.fn() },
};

const mockPrismaService = {
  eventMatch: { findFirst: jest.fn(), findUnique: jest.fn() },
  event: { findUnique: jest.fn() },
  $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
    fn(tx),
  ),
};

const mockEventsService = { findOneForOrganizer: jest.fn() };

const organizer = { id: 'org-1', role: 'ORGANIZER' as const };

const played = {
  id: 'm-1',
  eventId: 'event-1',
  round: 1,
  slot: 1,
  isBye: false,
  teamAId: 'a',
  teamBId: 'b',
  winnerId: 'b',
};

describe('EventBracketService', () => {
  let service: EventBracketService;

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.eventMatch.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'event-1',
      teams: [],
      matches: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBracketService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: EventDocumentsService, useValue: {} },
      ],
    }).compile();

    service = module.get<EventBracketService>(EventBracketService);
  });

  describe('clearResult', () => {
    it('clears the score and pulls the winner out of the next match', async () => {
      mockPrismaService.eventMatch.findFirst.mockResolvedValue(played);
      mockPrismaService.eventMatch.findUnique.mockResolvedValue({
        id: 'm-next',
        winnerId: null,
      });
      tx.eventMatch.count.mockResolvedValue(1);

      await service.clearResult('event-1', 'm-1', organizer);

      expect(tx.eventMatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', winnerId: 'b' },
        data: { winnerId: null, scoreA: null, scoreB: null, playedAt: null },
      });
      // Slot 1 feeds the B side of the next match.
      expect(tx.eventMatch.update).toHaveBeenCalledWith({
        where: { id: 'm-next' },
        data: { teamBId: null },
      });
      expect(tx.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: EventStatus.ONGOING },
      });
    });

    it('reopens the event when the final is undone and nothing else stands', async () => {
      mockPrismaService.eventMatch.findFirst.mockResolvedValue({
        ...played,
        slot: 0,
      });
      mockPrismaService.eventMatch.findUnique.mockResolvedValue(null);
      tx.eventMatch.count.mockResolvedValue(0);

      await service.clearResult('event-1', 'm-1', organizer);

      expect(tx.eventMatch.update).not.toHaveBeenCalled();
      expect(tx.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: EventStatus.LOCKED },
      });
    });

    it('refuses while the next match already has a result', async () => {
      mockPrismaService.eventMatch.findFirst.mockResolvedValue(played);
      mockPrismaService.eventMatch.findUnique.mockResolvedValue({
        id: 'm-next',
        winnerId: 'b',
      });

      await expect(
        service.clearResult('event-1', 'm-1', organizer),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a match without a result, and byes', async () => {
      mockPrismaService.eventMatch.findFirst.mockResolvedValue({
        ...played,
        winnerId: null,
      });
      await expect(
        service.clearResult('event-1', 'm-1', organizer),
      ).rejects.toThrow(BadRequestException);

      mockPrismaService.eventMatch.findFirst.mockResolvedValue({
        ...played,
        isBye: true,
      });
      await expect(
        service.clearResult('event-1', 'm-1', organizer),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
