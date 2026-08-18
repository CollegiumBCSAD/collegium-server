import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationCategory, NotificationType } from '@prisma/client';

const mockPrismaService = {
  notification: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockRealtimeGateway = {
  emitToUser: jest.fn(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RealtimeGateway, useValue: mockRealtimeGateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create()', () => {
    const input = {
      userId: 'user-1',
      category: NotificationCategory.TEAM,
      type: NotificationType.TEAM_JOIN_REQUEST,
      title: 'title',
      message: 'message',
      refId: 'team-1:member-1',
    };

    it('creates a notification when no duplicate exists', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(null);
      mockPrismaService.notification.create.mockResolvedValue({ id: 'notif-1', ...input });

      const result = await service.create(input);

      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({ data: input });
      expect(mockRealtimeGateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        'notification:new',
        { id: 'notif-1', ...input },
      );
      expect(result).toEqual({ id: 'notif-1', ...input });
    });

    it('returns the existing notification instead of creating a duplicate', async () => {
      const existing = { id: 'notif-1', ...input };
      mockPrismaService.notification.findFirst.mockResolvedValue(existing);

      const result = await service.create(input);

      expect(mockPrismaService.notification.create).not.toHaveBeenCalled();
      expect(mockRealtimeGateway.emitToUser).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });
  });

  describe('markAsRead()', () => {
    it('marks the notification read when owned by the requesting user', async () => {
      mockPrismaService.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });
      mockPrismaService.notification.update.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        read: true,
      });

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(mockPrismaService.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { read: true },
      });
      expect(mockRealtimeGateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        'notification:updated',
        { id: 'notif-1', userId: 'user-1', read: true },
      );
      expect(result.read).toBe(true);
    });

    it('throws NotFoundException when the notification does not exist', async () => {
      mockPrismaService.notification.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the notification belongs to another user', async () => {
      mockPrismaService.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'someone-else',
      });

      await expect(service.markAsRead('notif-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
