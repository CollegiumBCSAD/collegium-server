import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

const mockPrismaService = {
  event: { findUnique: jest.fn(), delete: jest.fn() },
};

const organizer = { id: 'org-1', role: Role.ORGANIZER };

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('deleteEvent', () => {
    it('deletes an event the caller organizes', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizerId: 'org-1',
      });

      await expect(service.deleteEvent('event-1', organizer)).resolves.toEqual({
        id: 'event-1',
        deleted: true,
      });
      expect(mockPrismaService.event.delete).toHaveBeenCalledWith({
        where: { id: 'event-1' },
      });
    });

    it('refuses another organizer', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizerId: 'someone-else',
      });

      await expect(service.deleteEvent('event-1', organizer)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrismaService.event.delete).not.toHaveBeenCalled();
    });

    it('lets an admin delete any event', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizerId: 'someone-else',
      });

      await service.deleteEvent('event-1', { id: 'admin', role: Role.ADMIN });
      expect(mockPrismaService.event.delete).toHaveBeenCalled();
    });

    it('404s for a missing event', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(null);

      await expect(service.deleteEvent('nope', organizer)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
