import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  Event,
  EventApprovalStatus,
  EventStatus,
  NotificationCategory,
  NotificationType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateEventDto,
  ReviewEventDto,
  UpdateEventDto,
} from './dto/event.dto';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_LENGTH = 8;

export interface RequestingUser {
  id: string;
  role: Role;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  generateInviteCode(): string {
    const bytes = randomBytes(INVITE_LENGTH);
    let code = '';
    for (const byte of bytes) {
      code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
    }
    return code;
  }

  async createEvent(user: RequestingUser, dto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        name: dto.name,
        gameTitle: dto.gameTitle,
        ...(dto.bracketFormat ? { bracketFormat: dto.bracketFormat } : {}),
        inviteCode: this.generateInviteCode(),
        organizerId: user.id,
        // Organizer-made events wait for an admin; an admin's own are pre-approved.
        approvalStatus:
          user.role === Role.ADMIN
            ? EventApprovalStatus.APPROVED
            : EventApprovalStatus.PENDING,
        ...(dto.signupsCloseAt
          ? { signupsCloseAt: new Date(dto.signupsCloseAt) }
          : {}),
        ...(dto.rules ? { rules: dto.rules } : {}),
        ...(dto.maxSubs !== undefined ? { maxSubs: dto.maxSubs } : {}),
      },
    });
  }

  async findAllForUser(user: RequestingUser) {
    return this.prisma.event.findMany({
      where: user.role === Role.ADMIN ? {} : { organizerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { teams: true } } },
    });
  }

  async findOneForOrganizer(id: string, user: RequestingUser) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { _count: { select: { teams: true, matches: true } } },
    });

    this.assertOwned(event, user);
    return event;
  }

  /** Squads, matches and documents go with it via onDelete: Cascade. */
  async deleteEvent(id: string, user: RequestingUser) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    this.assertOwned(event, user);

    await this.prisma.event.delete({ where: { id } });
    return { id, deleted: true };
  }

  async updateEvent(id: string, user: RequestingUser, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    this.assertOwned(event, user);

    // Opening signups (or anything past DRAFT) needs an admin's approval.
    if (
      dto.status !== undefined &&
      dto.status !== EventStatus.DRAFT &&
      event.approvalStatus !== EventApprovalStatus.APPROVED
    ) {
      throw new ForbiddenException(
        event.approvalStatus === EventApprovalStatus.REJECTED
          ? 'This event was rejected by an admin. Edit it to resubmit for approval.'
          : 'This event is awaiting admin approval before signups can open.',
      );
    }

    // An organizer editing a rejected event sends it back to the admin queue.
    const resubmit =
      event.approvalStatus === EventApprovalStatus.REJECTED &&
      user.role !== Role.ADMIN;

    return this.prisma.event.update({
      where: { id },
      data: {
        ...(resubmit
          ? {
              approvalStatus: EventApprovalStatus.PENDING,
              rejectionReason: null,
            }
          : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.bracketFormat !== undefined
          ? { bracketFormat: dto.bracketFormat }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.signupsCloseAt !== undefined
          ? { signupsCloseAt: new Date(dto.signupsCloseAt) }
          : {}),
        ...(dto.rules !== undefined ? { rules: dto.rules } : {}),
        ...(dto.maxSubs !== undefined ? { maxSubs: dto.maxSubs } : {}),
      },
    });
  }

  async findByInviteCode(code: string) {
    const event = await this.prisma.event.findUnique({
      where: { inviteCode: code },
      select: {
        id: true,
        name: true,
        gameTitle: true,
        bracketFormat: true,
        status: true,
        rules: true,
        maxSubs: true,
        signupsCloseAt: true,
        approvalStatus: true,
      },
    });

    if (
      !event ||
      event.status === EventStatus.DRAFT ||
      event.approvalStatus !== EventApprovalStatus.APPROVED
    ) {
      throw new NotFoundException('Event not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { approvalStatus, ...publicEvent } = event;
    return { ...publicEvent, signupsOpen: this.signupsOpen(event) };
  }

  /** Admin review queue: every event still waiting for a decision. */
  async findPendingApproval() {
    return this.prisma.event.findMany({
      where: { approvalStatus: EventApprovalStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        organizer: { select: { id: true, displayName: true, email: true } },
        _count: { select: { teams: true } },
      },
    });
  }

  async reviewEvent(id: string, dto: ReviewEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    const reason = dto.reason?.trim();
    if (!dto.approve && !reason) {
      throw new BadRequestException('Give a reason when rejecting an event');
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: dto.approve
        ? {
            approvalStatus: EventApprovalStatus.APPROVED,
            rejectionReason: null,
          }
        : {
            approvalStatus: EventApprovalStatus.REJECTED,
            rejectionReason: reason,
            // A rejected event can't keep taking signups.
            status: EventStatus.DRAFT,
          },
    });

    await this.notificationsService.create({
      userId: event.organizerId,
      category: NotificationCategory.TOURNAMENT,
      type: dto.approve
        ? NotificationType.TOURNAMENT_APPROVED
        : NotificationType.TOURNAMENT_REJECTED,
      title: dto.approve
        ? 'Invite-only event approved'
        : 'Invite-only event rejected',
      message: dto.approve
        ? `"${event.name}" was approved. You can now open signups and share the invite code.`
        : `"${event.name}" was rejected. Reason: ${reason}`,
      link: `/organize/events/${event.id}`,
      refId: `event:${event.id}:${updated.approvalStatus}`,
    });

    return updated;
  }

  signupsOpen(event: {
    status: EventStatus;
    signupsCloseAt: Date | null;
  }): boolean {
    if (event.status !== EventStatus.OPEN) return false;
    if (!event.signupsCloseAt) return true;
    return event.signupsCloseAt.getTime() > Date.now();
  }

  private assertOwned(
    event: Pick<Event, 'organizerId'> | null,
    user: RequestingUser,
  ): asserts event is Event {
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.organizerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'You do not have permission to manage this event',
      );
    }
  }
}
