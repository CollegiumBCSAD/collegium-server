import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GameTitle,
  NotificationCategory,
  NotificationType,
  ScrimStatus,
  TeamMemberStatus,
  User,
} from '@prisma/client';
import { CreateScrimDto, AcceptScrimDto } from './dto/scrims.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface PendingScrimRequest {
  teamId: string;
  teamName: string;
  universityName?: string;
}

@Injectable()
export class ScrimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async createScrim(dto: CreateScrimDto, user?: User) {
    let team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      team = await this.prisma.team.findFirst({
        where: { captainId: dto.teamId, gameTitle: dto.gameTitle },
      });
    }

    if (!team && user?.id) {
      team = await this.prisma.team.findFirst({
        where: {
          OR: [
            { captainId: user.id, gameTitle: dto.gameTitle },
            {
              members: { some: { userId: user.id, status: 'ACCEPTED' } },
              gameTitle: dto.gameTitle,
            },
          ],
        },
      });
    }

    if (!team && user?.universityId) {
      team = await this.prisma.team.findFirst({
        where: { universityId: user.universityId, gameTitle: dto.gameTitle },
      });
    }

    if (!team && user?.id) {
      team = await this.prisma.team.findFirst({
        where: { captainId: user.id },
      });
    }

    if (!team) {
      team = await this.prisma.team.findFirst({
        where: { gameTitle: dto.gameTitle },
      });
    }

    if (!team) {
      team = await this.prisma.team.findFirst();
    }

    if (!team) {
      throw new BadRequestException(
        'Host team not found in database. Please register your squad first.',
      );
    }

    return this.prisma.scrim.create({
      data: {
        teamId: team.id,
        gameTitle: dto.gameTitle,
        scheduledAt: new Date(dto.scheduledAt),
        format: dto.format,
        rankRange: dto.rankRange,
        mapPreference: dto.mapPreference,
        notes: dto.notes,
        status: ScrimStatus.OPEN,
      },
      include: {
        team: {
          include: {
            university: true,
          },
        },
      },
    });
  }

  async getScrims(gameTitle?: GameTitle, status?: ScrimStatus) {
    const list = await this.prisma.scrim.findMany({
      where: {
        ...(gameTitle ? { gameTitle } : {}),
        ...(status
          ? { status }
          : {
              status: {
                in: [
                  ScrimStatus.OPEN,
                  ScrimStatus.PENDING,
                  ScrimStatus.CONFIRMED,
                  ScrimStatus.CANCELLED,
                ],
              },
            }),
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        team: {
          include: {
            university: true,
          },
        },
        opponent: {
          include: {
            university: true,
          },
        },
      },
    });

    return list.map((scrim) => {
      let pendingRequests: PendingScrimRequest[] = [];
      if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
        try {
          const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
          pendingRequests = JSON.parse(jsonStr) as PendingScrimRequest[];
        } catch {
          pendingRequests = [];
        }
      }

      if (pendingRequests.length === 0 && scrim.opponent) {
        pendingRequests = [
          {
            teamId: scrim.opponent.id,
            teamName: scrim.opponent.name,
            universityName: scrim.opponent.university?.name,
          },
        ];
      }

      const cleanedNotes = scrim.notes
        ? scrim.notes.split('__SCRIM_REQS__')[0]
        : '';

      return {
        ...scrim,
        notes: cleanedNotes,
        pendingRequests,
      };
    });
  }

  async acceptScrim(scrimId: string, dto: AcceptScrimDto) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: { team: true },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (scrim.status === ScrimStatus.CONFIRMED) {
      throw new BadRequestException(
        'This scrim match has already been booked by an opponent.',
      );
    }

    let opponentTeam = await this.prisma.team.findUnique({
      where: { id: dto.opponentId },
      include: { university: true },
    });

    if (!opponentTeam) {
      const userMember = await this.prisma.teamMember.findFirst({
        where: { userId: dto.opponentId, status: 'ACCEPTED' },
        include: { team: { include: { university: true } } },
      });
      if (userMember) {
        opponentTeam = userMember.team;
      }
    }

    if (!opponentTeam) {
      opponentTeam = await this.prisma.team.findFirst({
        where: { captainId: dto.opponentId },
        include: { university: true },
      });
    }

    if (!opponentTeam) {
      throw new BadRequestException('Opponent team not found.');
    }

    if (scrim.teamId === opponentTeam.id) {
      throw new BadRequestException(
        'A team cannot accept its own scrim offer.',
      );
    }

    let currentReqs: PendingScrimRequest[] = [];
    if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
      try {
        const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
        currentReqs = JSON.parse(jsonStr) as PendingScrimRequest[];
      } catch {
        currentReqs = [];
      }
    }

    if (!currentReqs.some((r) => r.teamId === opponentTeam.id)) {
      currentReqs.push({
        teamId: opponentTeam.id,
        teamName: opponentTeam.name,
        universityName: opponentTeam.university?.name,
      });
    }

    const baseNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';
    const updatedNotes = `${baseNotes}__SCRIM_REQS__${JSON.stringify(currentReqs)}`;

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        opponentId: opponentTeam.id,
        status: ScrimStatus.PENDING,
        notes: updatedNotes,
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });

    await this.notificationsService.create({
      userId: updated.team.captainId,
      category: NotificationCategory.SCRIM,
      type: NotificationType.SCRIM_REQUEST_RECEIVED,
      title: '⏳ Incoming Scrim Request!',
      message: `${opponentTeam.name} requested to book your scrim offer!`,
      link: '/scrims',
      refId: `${updated.id}:${opponentTeam.id}`,
    });

    return updated;
  }

  async confirmScrim(scrimId: string, selectedOpponentId?: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const opponentIdToSet = selectedOpponentId || scrim.opponentId;
    const baseNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        status: ScrimStatus.CONFIRMED,
        notes: baseNotes,
        ...(opponentIdToSet ? { opponentId: opponentIdToSet } : {}),
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });

    if (updated.opponent) {
      await this.notificationsService.create({
        userId: updated.opponent.captainId,
        category: NotificationCategory.SCRIM,
        type: NotificationType.SCRIM_REQUEST_ACCEPTED,
        title: '🎉 Scrim Match Request Accepted!',
        message: `${updated.team.name} accepted your practice match request!`,
        link: '/scrims',
        refId: updated.id,
      });
    }

    return updated;
  }

  async cancelScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (
      scrim.status === ScrimStatus.CONFIRMED ||
      scrim.status === ScrimStatus.PENDING
    ) {
      const wasConfirmed = scrim.status === ScrimStatus.CONFIRMED;

      const updated = await this.prisma.scrim.update({
        where: { id: scrimId },
        data: {
          status: ScrimStatus.OPEN,
          opponentId: null,
        },
        include: {
          team: { include: { university: true } },
          opponent: { include: { university: true } },
        },
      });

      if (scrim.opponent) {
        await this.notificationsService.create({
          userId: scrim.opponent.captainId,
          category: NotificationCategory.SCRIM,
          type: wasConfirmed
            ? NotificationType.SCRIM_UNBOOKED
            : NotificationType.SCRIM_REQUEST_DECLINED,
          title: wasConfirmed
            ? '⚠️ Scrim Match Cancelled'
            : '✕ Scrim Request Declined',
          message: wasConfirmed
            ? `${scrim.team.name} unbooked the scheduled practice match.`
            : `${scrim.team.name} declined your practice match request. The offer is re-opened on the board.`,
          link: '/scrims',
          refId: `${scrim.id}:${scrim.status}`,
        });
      }

      return updated;
    }

    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.CANCELLED },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
  }

  async completeScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.COMPLETED },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });

    if (scrim.opponent) {
      await this.notificationsService
        .create({
          userId: scrim.opponent.captainId,
          category: NotificationCategory.SCRIM,
          type: NotificationType.SCRIM_REQUEST_ACCEPTED,
          title: '🏆 Scrim Match Completed',
          message: `Practice match between ${scrim.team.name} and ${scrim.opponent.name} has concluded!`,
          link: '/scrims',
          refId: `${scrim.id}:COMPLETED`,
        })
        .catch(() => null);
    }

    return updated;
  }

  async deleteScrim(scrimId: string) {
    await this.prisma.scrimChatMessage
      .deleteMany({
        where: { scrimId },
      })
      .catch(() => null);

    return this.prisma.scrim
      .delete({
        where: { id: scrimId },
      })
      .catch(() => null);
  }

  async getScrimChat(scrimId: string) {
    return this.prisma.scrimChatMessage.findMany({
      where: { scrimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveChatParticipant(scrimId: string, userId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: { team: true, opponent: true },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const teamIds = [scrim.teamId, scrim.opponentId].filter(
      (id): id is string => Boolean(id),
    );

    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        teamId: { in: teamIds },
        status: TeamMemberStatus.ACCEPTED,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'Only participants of this scrim can post in the War Room chat.',
      );
    }

    const team =
      membership.teamId === scrim.teamId ? scrim.team : scrim.opponent;
    return team!;
  }

  async sendScrimChat(scrimId: string, userId: string, text: string) {
    const [team, sender] = await Promise.all([
      this.resolveChatParticipant(scrimId, userId),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    const message = await this.prisma.scrimChatMessage.create({
      data: {
        scrimId,
        senderId: userId,
        senderName: sender?.displayName || 'Athlete',
        teamName: team.name,
        text,
      },
    });

    this.realtimeGateway.emitToScrim(scrimId, 'scrim:message', message);
    return message;
  }
}
