import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MatchesService, GetMatchesQuery } from './matches.service';
import { Public } from '../auth/decorators/public.decorator';
import { GameTitle } from '@prisma/client';

@ApiTags('Matches')
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get paginated competitive matches (Tournaments and Scrims)',
  })
  getMatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('gameTitle') gameTitle?: GameTitle,
    @Query('status') status?: 'ALL' | 'LIVE' | 'UPCOMING' | 'COMPLETED',
    @Query('matchMode') matchMode?: 'ALL' | 'TOURNAMENT' | 'SCRIM',
  ) {
    const query: GetMatchesQuery = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      gameTitle,
      status,
      matchMode,
    };
    return this.matchesService.getMatches(query);
  }
}
