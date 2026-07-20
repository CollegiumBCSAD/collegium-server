import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UniversitiesService } from './universities.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Universities')
@ApiBearerAuth() // This indicates that the endpoints require authentication
@Controller('universities')
export class UniversitiesController {
  constructor(private readonly universitiesService: UniversitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all universities (Leaderboard)' })
  findAll() {
    return this.universitiesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get university profile by ID' })
  findOne(@Param('id') id: string) {
    // Fixed this from @Body to @Param!
    return this.universitiesService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN) // Only admins can create universities
  @ApiOperation({ summary: 'Register a new university (Admin only)' })
  create(@Body() createUniversityDto: CreateUniversityDto) {
    return this.universitiesService.create(createUniversityDto);
  }
}
