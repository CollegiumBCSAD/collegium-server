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
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      throw new NotFoundException('Host team not found.');
    }

    return this.prisma.scrim.create({
      data: {
        teamId: dto.teamId,
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
    return this.prisma.scrim.findMany({
      where: {
        ...(gameTitle ? { gameTitle } : {}),
        ...(status ? { status } : { status: ScrimStatus.OPEN }),
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
  }

  async acceptScrim(scrimId: string, dto: AcceptScrimDto) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (scrim.status !== ScrimStatus.OPEN) {
      throw new BadRequestException('This scrim is no longer available.');
    }

    if (scrim.teamId === dto.opponentId) {
      throw new BadRequestException(
        'A team cannot accept its own scrim offer.',
      );
    }

    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        opponentId: dto.opponentId,
        status: ScrimStatus.CONFIRMED,
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
  }

  async cancelScrim(scrimId: string) {
    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.CANCELLED },
    });
  }
}
