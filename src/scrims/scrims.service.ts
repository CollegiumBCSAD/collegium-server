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
        where: { gameTitle: dto.gameTitle },
      });
      if (!team) {
        team = await this.prisma.team.findFirst();
      }
    }

    if (!team) {
      throw new BadRequestException('No host team found in database. Please create a team first.');
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
        ...(status ? { status } : { status: { in: [ScrimStatus.OPEN, ScrimStatus.CONFIRMED, ScrimStatus.CANCELLED] } }),
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

    let opponentTeam = await this.prisma.team.findUnique({
      where: { id: dto.opponentId },
    });

    if (!opponentTeam) {
      const userMember = await this.prisma.teamMember.findFirst({
        where: { userId: dto.opponentId, status: 'ACCEPTED' },
        include: { team: true },
      });
      if (userMember) {
        opponentTeam = userMember.team;
      } else {
        opponentTeam = await this.prisma.team.findFirst({
          where: { id: { not: scrim.teamId }, gameTitle: scrim.gameTitle },
        });
        if (!opponentTeam) {
          opponentTeam = await this.prisma.team.findFirst({
            where: { id: { not: scrim.teamId } },
          });
        }
      }
    }

    if (!opponentTeam) {
      throw new BadRequestException('Opponent team not found.');
    }

    if (scrim.teamId === opponentTeam.id) {
      throw new BadRequestException(
        'A team cannot accept its own scrim offer.',
      );
    }

    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        opponentId: opponentTeam.id,
        status: ScrimStatus.PENDING,
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
  }

  async confirmScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({ where: { id: scrimId } });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.CONFIRMED },
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
}
