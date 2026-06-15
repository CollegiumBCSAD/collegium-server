import { Controller, Post, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MatchLoggingService } from './match-logging.service';
import { MatchMode } from '@prisma/client';

@ApiTags('Match Logging')
@Controller('match-logging')
export class MatchLoggingController {
  constructor(private readonly matchLoggingService: MatchLoggingService) { }

  @Post('log/:matchId')
  @ApiOperation({ summary: 'Log a match and fetch data from Riot API' })
  async logMatch(
    @Param('matchId') matchId: string,
    @Query('mode') mode: MatchMode = MatchMode.TOURNAMENT,
  ) {
    await this.matchLoggingService.logMatch(matchId, mode, true); // true, mock data from fixture file
    return { message: `Match ${matchId} logged successfully in mode ${mode}` };
  }

  @Get('stats/:matchId')
  @ApiOperation({ summary: 'Get match statistics by Riot Match ID' })
  async getMatchStats(@Param('matchId') matchId: string) {
    const stats = await this.matchLoggingService.getMatchStats(matchId);
    return stats;
  }
}
