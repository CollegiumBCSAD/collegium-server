import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import { GameTitle, MatchMode } from '@prisma/client';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(gameTitle?: GameTitle) {
    if (!gameTitle) {
      return this.prisma.university.findMany({
        orderBy: { name: 'asc' },
      });
    }

    const [teams, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { gameTitle },
        orderBy: { glicko2_rating: 'desc' },
        include: {
          university: true,
        },
      }),
      this.prisma.match.findMany({
        where: {
          title: gameTitle,
          isVerified: true,
          matchMode: MatchMode.TOURNAMENT,
        },
        orderBy: {
          playedAt: 'desc',
        },
      }),
    ]);

    return teams.map((team) => {
      const teamMatches = matches.filter(
        (m) =>
          m.winnerId === team.universityId ||
          m.loserId === team.universityId ||
          m.winnerId === team.id ||
          m.loserId === team.id,
      );

      let wins = 0;
      let losses = 0;

      for (const m of teamMatches) {
        if (m.winnerId === team.universityId || m.winnerId === team.id) {
          wins++;
        } else if (m.loserId === team.universityId || m.loserId === team.id) {
          losses++;
        }
      }

      const totalMatches = wins + losses;
      const winRate =
        totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

      let streak = '-';
      if (teamMatches.length > 0) {
        const firstMatchWon =
          teamMatches[0].winnerId === team.universityId ||
          teamMatches[0].winnerId === team.id;
        let count = 0;
        for (const m of teamMatches) {
          const won =
            m.winnerId === team.universityId || m.winnerId === team.id;
          if (won === firstMatchWon) {
            count++;
          } else {
            break;
          }
        }
        streak = `${count}${firstMatchWon ? 'W' : 'L'}`;
      }

      const isProvisional = team.glicko2_rd >= 100 || totalMatches === 0;

      return {
        id: team.university.id,
        name: team.university.name,
        domain: team.university.domain,
        teamId: team.id,
        teamName: team.name,
        gameTitle: team.gameTitle,
        glicko2_rating: team.glicko2_rating,
        glicko2_rd: team.glicko2_rd,
        glicko2_sigma: team.glicko2_sigma,
        wins,
        losses,
        winRate,
        streak,
        isProvisional,
        createdAt: team.university.created_at.toISOString(),
      };
    });
  }

  async findOne(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      include: {
        teams: true,
      },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    return university;
  }

  async create(createUniversityDto: CreateUniversityDto) {
    const { name, domain } = createUniversityDto;

    // Check if a university with the same name already exists
    const existingUniversity = await this.prisma.university.findUnique({
      where: { domain },
    });

    if (existingUniversity) {
      throw new ConflictException(
        'A university with this name already exists.',
      );
    }

    // Create the new university
    return this.prisma.university.create({
      data: {
        name,
        domain,
      },
    });
  }

  async update(id: string, updateUniversityDto: UpdateUniversityDto) {
    const university = await this.prisma.university.findUnique({
      where: { id },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    if (
      updateUniversityDto.domain &&
      updateUniversityDto.domain !== university.domain
    ) {
      const conflict = await this.prisma.university.findUnique({
        where: { domain: updateUniversityDto.domain },
      });
      if (conflict) {
        throw new ConflictException(
          'Another university is already using that domain.',
        );
      }
    }

    return this.prisma.university.update({
      where: { id },
      data: updateUniversityDto,
    });
  }

  async remove(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
    });

    if (!university) {
      throw new NotFoundException('University not found.');
    }

    try {
      return await this.prisma.university.delete({ where: { id } });
    } catch {
      throw new ConflictException(
        'This university has registered users, teams, or matches and cannot be removed.',
      );
    }
  }
}
