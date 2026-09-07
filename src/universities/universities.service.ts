import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import { GameTitle } from '@prisma/client';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(gameTitle?: GameTitle) {
    if (!gameTitle) {
      return this.prisma.university.findMany({
        orderBy: { name: 'asc' },
      });
    }

    const teams = await this.prisma.team.findMany({
      where: { gameTitle },
      orderBy: { glicko2_rating: 'desc' },
      include: {
        university: true,
      },
    });

    return teams.map((team) => ({
      id: team.university.id,
      name: team.university.name,
      domain: team.university.domain,
      teamId: team.id,
      teamName: team.name,
      gameTitle: team.gameTitle,
      glicko2_rating: team.glicko2_rating,
      glicko2_rd: team.glicko2_rd,
      glicko2_sigma: team.glicko2_sigma,
      createdAt: team.university.created_at.toISOString(),
    }));
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
