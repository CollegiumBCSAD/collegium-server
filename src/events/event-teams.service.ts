import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { EventStatus, EventTeamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, RequestingUser } from './events.service';
import {
  ReviewEventTeamDto,
  RosterPlayerDto,
  SubmitEventTeamDto,
  UpdateEventTeamDto,
} from './dto/event-team.dto';

export const STARTER_COUNT = 5;

export interface RosterEntry {
  id: string;
  fullName: string;
  studentNumber: string;
  ign: string;
  isSubstitute: boolean;
}

@Injectable()
export class EventTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async submitTeam(code: string, dto: SubmitEventTeamDto) {
    const event = await this.prisma.event.findUnique({
      where: { inviteCode: code },
    });

    if (!event || event.status === EventStatus.DRAFT) {
      throw new NotFoundException('Event not found');
    }

    if (!this.eventsService.signupsOpen(event)) {
      throw new BadRequestException('Sign-ups are closed for this event');
    }

    const roster = this.buildRoster(dto.roster, event.maxSubs, []);

    try {
      const team = await this.prisma.eventTeam.create({
        data: {
          eventId: event.id,
          name: dto.name.trim(),
          captainName: dto.captainName.trim(),
          captainEmail: dto.captainEmail.toLowerCase().trim(),
          editToken: this.generateEditToken(),
          roster: roster as unknown as Prisma.InputJsonValue,
        },
      });

      return this.present(team);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A squad named "${dto.name}" is already registered for this event`,
        );
      }
      throw error;
    }
  }

  async findByEditToken(token: string) {
    const team = await this.prisma.eventTeam.findUnique({
      where: { editToken: token },
      include: {
        event: { select: { name: true, gameTitle: true, status: true } },
      },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    return this.present(team);
  }

  /**
   * Squads whose captain email matches the caller's account. Only verified
   * emails count, since the result hands back each squad's edit token.
   */
  async findForCaptain(user: { email: string; emailVerified: boolean }) {
    if (!user.emailVerified) {
      return [];
    }

    const teams = await this.prisma.eventTeam.findMany({
      where: { captainEmail: user.email.toLowerCase().trim() },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        reviewNote: true,
        editToken: true,
        eventId: true,
        createdAt: true,
        roster: true,
        event: { select: { name: true, gameTitle: true, status: true } },
      },
    });

    return teams.map(({ roster, ...team }) => ({
      ...team,
      playerCount: this.readRoster({ roster }).length,
    }));
  }

  async updateByEditToken(token: string, dto: UpdateEventTeamDto) {
    const team = await this.prisma.eventTeam.findUnique({
      where: { editToken: token },
      include: { event: true },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    if (team.status === EventTeamStatus.APPROVED) {
      throw new ForbiddenException(
        'This squad has been approved and can no longer be edited',
      );
    }

    if (!this.eventsService.signupsOpen(team.event)) {
      throw new BadRequestException('Sign-ups are closed for this event');
    }

    const roster = dto.roster
      ? this.buildRoster(dto.roster, team.event.maxSubs, this.readRoster(team))
      : undefined;

    const updated = await this.prisma.eventTeam.update({
      where: { id: team.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.captainName !== undefined
          ? { captainName: dto.captainName.trim() }
          : {}),
        ...(dto.captainEmail !== undefined
          ? { captainEmail: dto.captainEmail.toLowerCase().trim() }
          : {}),
        ...(roster
          ? { roster: roster as unknown as Prisma.InputJsonValue }
          : {}),
        status: EventTeamStatus.PENDING,
        reviewNote: null,
      },
    });

    return this.present(updated);
  }

  async findAllForEvent(eventId: string, user: RequestingUser) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    return this.prisma.eventTeam.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(
    eventId: string,
    teamId: string,
    user: RequestingUser,
    dto: ReviewEventTeamDto,
  ) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    const team = await this.prisma.eventTeam.findFirst({
      where: { id: teamId, eventId },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    if (dto.status === EventTeamStatus.REJECTED && !dto.reviewNote) {
      throw new BadRequestException(
        'Tell the captain why the squad was rejected',
      );
    }

    return this.prisma.eventTeam.update({
      where: { id: team.id },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote ?? null,
      },
    });
  }

  readRoster(team: { roster: Prisma.JsonValue }): RosterEntry[] {
    return (team.roster ?? []) as unknown as RosterEntry[];
  }

  generateEditToken(): string {
    return randomBytes(24).toString('base64url');
  }

  private buildRoster(
    players: RosterPlayerDto[],
    maxSubs: number,
    previous: RosterEntry[],
  ): RosterEntry[] {
    const starters = players.filter((p) => !p.isSubstitute);
    const substitutes = players.filter((p) => p.isSubstitute);

    if (starters.length !== STARTER_COUNT) {
      throw new BadRequestException(
        `A squad needs exactly ${STARTER_COUNT} starters, received ${starters.length}`,
      );
    }

    if (substitutes.length > maxSubs) {
      throw new BadRequestException(
        `This event allows at most ${maxSubs} substitute(s), received ${substitutes.length}`,
      );
    }

    const studentNumbers = players.map((p) =>
      p.studentNumber.trim().toLowerCase(),
    );
    if (new Set(studentNumbers).size !== studentNumbers.length) {
      throw new BadRequestException(
        'Each player must have a distinct student number',
      );
    }

    const knownIds = new Set(previous.map((entry) => entry.id));

    return [...starters, ...substitutes].map((player) => ({
      id: player.id && knownIds.has(player.id) ? player.id : randomUUID(),
      fullName: player.fullName.trim(),
      studentNumber: player.studentNumber.trim(),
      ign: player.ign.trim(),
      isSubstitute: player.isSubstitute === true,
    }));
  }

  private present<T extends { roster: Prisma.JsonValue }>(team: T) {
    return { ...team, roster: this.readRoster(team) };
  }
}
