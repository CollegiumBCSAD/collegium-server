import { Controller, Post, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MatchLoggingService } from './match-logging.service';
import { MatchMode, GameTitle } from '@prisma/client';

@ApiTags('Match Logging')
@ApiBearerAuth()
@Controller('match-logging')
export class MatchLoggingController {
  constructor(private readonly matchLoggingService: MatchLoggingService) {}

  @Post('log/:title/:matchId')
  @ApiOperation({ summary: 'Log a match and fetch data from Riot API' })
  async logMatch(
    @Param('title') title: GameTitle,
    @Param('matchId') matchId: string,
    @Query('mode') mode: string = MatchMode.TOURNAMENT,
    @Query('useMock') useMock: string = 'true',
  ) {
    const matchMode = mode as MatchMode;
    const isMock = useMock === 'true';
    await this.matchLoggingService.logMatch(title, matchId, matchMode, isMock);
    return {
      message: `${title} match ${matchId} logged successfully in mode ${matchMode} (mock=${isMock})`,
    };
  }

  @Get('stats/:matchId')
  @ApiOperation({ summary: 'Get match statistics by Riot Match ID' })
  async getMatchStats(@Param('matchId') matchId: string) {
    const stats = await this.matchLoggingService.getMatchStats(matchId);
    return stats;
  }
}
