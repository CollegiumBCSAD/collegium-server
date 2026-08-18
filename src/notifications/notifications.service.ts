import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationCategory, NotificationType } from '@prisma/client';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface CreateNotificationInput {
  userId: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  refId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async create(input: CreateNotificationInput) {
    if (input.refId) {
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          refId: input.refId,
        },
      });
      if (existing) return existing;
    }

    const notification = await this.prisma.notification.create({ data: input });
    this.realtimeGateway.emitToUser(
      notification.userId,
      'notification:new',
      notification,
    );
    return notification;
  }

  async findAllForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException(
        "You cannot modify another user's notification.",
      );
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    this.realtimeGateway.emitToUser(userId, 'notification:updated', updated);
    return updated;
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    this.realtimeGateway.emitToUser(userId, 'notification:all-read', {
      userId,
    });
    return { success: true };
  }

  async clearAll(userId: string) {
    await this.prisma.notification.deleteMany({ where: { userId } });
    this.realtimeGateway.emitToUser(userId, 'notification:cleared', { userId });
    return { success: true };
  }
}
