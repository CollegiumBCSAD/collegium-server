import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Event, EventStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_LENGTH = 8;

export interface RequestingUser {
  id: string;
  role: Role;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.event.update({
      where: { id },
      data: {
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
      },
    });

    if (!event || event.status === EventStatus.DRAFT) {
      throw new NotFoundException('Event not found');
    }

    return { ...event, signupsOpen: this.signupsOpen(event) };
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
