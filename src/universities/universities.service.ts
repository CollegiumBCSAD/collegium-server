import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { GameTitle } from '@prisma/client';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(gameTitle?: GameTitle) {
    if (!gameTitle) {
      return this.prisma.university.findMany({
        orderBy: { glicko2_rating: 'desc' },
      });
    }

    const universities = await this.prisma.university.findMany();

    const withStats = await Promise.all(
      universities.map(async (uni) => {
        const wins = await this.prisma.match.count({
          where: { title: gameTitle, winnerId: uni.id },
        });
        const losses = await this.prisma.match.count({
          where: { title: gameTitle, loserId: uni.id },
        });
        return { ...uni, wins, losses };
      }),
    );

    return withStats
      .filter((u) => u.wins + u.losses > 0)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  }

  async findOne(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
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
}
