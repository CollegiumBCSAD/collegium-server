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
        include: { gameRatings: true },
      });
    }

    const universities = await this.prisma.university.findMany({
      include: {
        gameRatings: {
          where: { gameTitle },
        },
      },
    });

    const mapped = universities.map((uni) => {
      const ratingRecord = uni.gameRatings[0];
      return {
        id: uni.id,
        name: uni.name,
        domain: uni.domain,
        glicko2_rating: ratingRecord ? ratingRecord.glicko2_rating : 1500,
        glicko2_rd: ratingRecord ? ratingRecord.glicko2_rd : 350,
        glicko2_sigma: ratingRecord ? ratingRecord.glicko2_sigma : 0.06,
        wins: ratingRecord ? ratingRecord.wins : 0,
        losses: ratingRecord ? ratingRecord.losses : 0,
        createdAt: uni.created_at.toISOString(),
      };
    });

    return mapped.sort((a, b) => b.glicko2_rating - a.glicko2_rating);
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
