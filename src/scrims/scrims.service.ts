import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameTitle, ScrimStatus } from '@prisma/client';
import { CreateScrimDto, AcceptScrimDto } from './dto/scrims.dto';

@Injectable()
export class ScrimsService {
  constructor(private readonly prisma: PrismaService) {}

  async createScrim(dto: CreateScrimDto) {
    let team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      team = await this.prisma.team.findFirst({
        where: { captainId: dto.teamId, gameTitle: dto.gameTitle },
      });
    }

    if (!team) {
      throw new BadRequestException('Host team not found in database. Please register your squad first.');
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
        ...(status ? { status } : { status: { in: [ScrimStatus.OPEN, ScrimStatus.PENDING, ScrimStatus.CONFIRMED, ScrimStatus.CANCELLED] } }),
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
      let pendingRequests: Array<{ teamId: string; teamName: string; universityName?: string }> = [];
      if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
        try {
          const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
          pendingRequests = JSON.parse(jsonStr);
        } catch {
          pendingRequests = [];
        }
      }

      if (pendingRequests.length === 0 && scrim.opponent) {
        pendingRequests = [{
          teamId: scrim.opponent.id,
          teamName: scrim.opponent.name,
          universityName: scrim.opponent.university?.name,
        }];
      }

      const cleanedNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';

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
      throw new BadRequestException('This scrim match has already been booked by an opponent.');
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

    let currentReqs: Array<{ teamId: string; teamName: string; universityName?: string }> = [];
    if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
      try {
        const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
        currentReqs = JSON.parse(jsonStr);
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

    return this.prisma.scrim.update({
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
  }

  async confirmScrim(scrimId: string, selectedOpponentId?: string) {
    const scrim = await this.prisma.scrim.findUnique({ where: { id: scrimId } });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const opponentIdToSet = selectedOpponentId || scrim.opponentId;
    const baseNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';

    return this.prisma.scrim.update({
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
  }

  async cancelScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({ where: { id: scrimId } });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (scrim.status === ScrimStatus.CONFIRMED || scrim.status === ScrimStatus.PENDING) {
      return this.prisma.scrim.update({
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

  async deleteScrim(scrimId: string) {
    return this.prisma.scrim.delete({
      where: { id: scrimId },
    });
  }

  private scrimChats = new Map<string, Array<{ id: string; senderName: string; teamName: string; text: string; timestamp: string }>>();

  getScrimChat(scrimId: string) {
    return this.scrimChats.get(scrimId) || [];
  }

  sendScrimChat(scrimId: string, dto: { id?: string; senderName: string; teamName: string; text: string; timestamp?: string }) {
    const list = this.scrimChats.get(scrimId) || [];
    const msg = {
      id: dto.id || `msg-${Date.now()}-${Math.random()}`,
      senderName: dto.senderName || 'Anonymous',
      teamName: dto.teamName || 'Squad Member',
      text: dto.text,
      timestamp: dto.timestamp || new Date().toISOString(),
    };
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg);
    }
    this.scrimChats.set(scrimId, list);
    return list;
  }
}
