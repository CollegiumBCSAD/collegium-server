import { Controller, Post, Get, Param, Query } from '@nestjs/common';
import { MatchLoggingService } from './match-logging.service';
import { MatchMode } from '@prisma/client';

@Controller('match-logging')
export class MatchLoggingController {
  constructor(private readonly matchLoggingService: MatchLoggingService) { }

  @Post('log/:matchId')
  async logMatch(
    @Param('matchId') matchId: string,
    @Query('mode') mode: MatchMode = MatchMode.TOURNAMENT,
  ) {
    await this.matchLoggingService.logMatch(matchId, mode, true); // true, mock data from fixture file
    return { message: `Match ${matchId} logged successfully in mode ${mode}` };
  }

  @Get('stats/:matchId')
  async getMatchStats(@Param('matchId') matchId: string) {
    const stats = await this.matchLoggingService.getMatchStats(matchId);
    return stats;
  }

}
