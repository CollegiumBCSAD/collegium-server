import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventApprovalStatus, EventStatus, Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

const mockPrismaService = {
  event: {
    findUnique: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockNotificationsService = { create: jest.fn() };

const organizer = { id: 'org-1', role: Role.ORGANIZER };

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
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

  describe('admin approval', () => {
    const pending = {
      id: 'event-1',
      name: 'CCIS Cup',
      organizerId: 'org-1',
      status: EventStatus.DRAFT,
      approvalStatus: EventApprovalStatus.PENDING,
    };

    it('creates organizer events as pending', async () => {
      await service.createEvent(organizer, {
        name: 'CCIS Cup',
        gameTitle: 'VALORANT',
      });
      expect(mockPrismaService.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: EventApprovalStatus.PENDING,
          }) as unknown,
        }),
      );
    });

    it('creates admin events as already approved', async () => {
      await service.createEvent(
        { id: 'admin-1', role: Role.ADMIN },
        { name: 'CCIS Cup', gameTitle: 'VALORANT' },
      );
      expect(mockPrismaService.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: EventApprovalStatus.APPROVED,
          }) as unknown,
        }),
      );
    });

    it('blocks opening signups before approval', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(pending);
      await expect(
        service.updateEvent('event-1', organizer, { status: EventStatus.OPEN }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.event.update).not.toHaveBeenCalled();
    });

    it('hides an unapproved event from its invite link', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...pending,
        status: EventStatus.OPEN,
      });
      await expect(service.findByInviteCode('ABCD2345')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('requires a reason to reject and notifies the organizer', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(pending);
      await expect(
        service.reviewEvent('event-1', { approve: false }),
      ).rejects.toThrow('Give a reason');

      mockPrismaService.event.update.mockResolvedValue({
        ...pending,
        approvalStatus: EventApprovalStatus.REJECTED,
      });
      await service.reviewEvent('event-1', {
        approve: false,
        reason: 'Missing rules',
      });
      expect(mockPrismaService.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: {
          approvalStatus: EventApprovalStatus.REJECTED,
          rejectionReason: 'Missing rules',
          status: EventStatus.DRAFT,
        },
      });
      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'org-1' }),
      );
    });

    it('sends an edited rejected event back to the queue', async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...pending,
        approvalStatus: EventApprovalStatus.REJECTED,
      });
      await service.updateEvent('event-1', organizer, { rules: 'Bo3' });
      expect(mockPrismaService.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: EventApprovalStatus.PENDING,
          }) as unknown,
        }),
      );
    });
  });
});
