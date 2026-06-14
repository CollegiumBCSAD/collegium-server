import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto } from './dto/create-university.dto';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUniversityDto: CreateUniversityDto) {
    const { name, domain } = createUniversityDto;

    // Check if a university with the same name already exists
    const existingUniversity = await this.prisma.university.findUnique({
      where: { domain }, 
    });

    if (existingUniversity) {
      throw new ConflictException('A university with this name already exists.');
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
