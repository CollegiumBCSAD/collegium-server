import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UniversitiesService } from './universities.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Role, GameTitle } from '@prisma/client';

@ApiTags('Universities')
@ApiBearerAuth() // This indicates that the endpoints require authentication
@Controller('universities')
export class UniversitiesController {
  constructor(private readonly universitiesService: UniversitiesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all universities (Leaderboard)' })
  findAll(@Query('gameTitle') gameTitle?: GameTitle) {
    return this.universitiesService.findAll(gameTitle);
  }

  @Public()
  @Get(':id/matches')
  @ApiOperation({
    summary: "Get a university's verified match history (Tournament and Scrims)",
  })
  findMatches(
    @Param('id') id: string,
    @Query('gameTitle') gameTitle?: GameTitle,
    @Query('matchMode') matchMode?: 'ALL' | 'TOURNAMENT' | 'SCRIM',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.universitiesService.findMatches(
      id,
      gameTitle,
      matchMode,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Public()
  @Get(':id/tournaments')
  @ApiOperation({
    summary: "Get a university's tournament placement tracker",
  })
  findTournamentPlacements(
    @Param('id') id: string,
    @Query('gameTitle') gameTitle?: GameTitle,
  ) {
    return this.universitiesService.findTournamentPlacements(id, gameTitle);
  }

  @Public()
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

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Edit a university's name/domain (Admin only)" })
  update(
    @Param('id') id: string,
    @Body() updateUniversityDto: UpdateUniversityDto,
  ) {
    return this.universitiesService.update(id, updateUniversityDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove a university (Admin only)' })
  remove(@Param('id') id: string) {
    return this.universitiesService.remove(id);
  }
}
