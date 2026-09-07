import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RankingService } from './ranking.service';

@ApiTags('Ranking')
@ApiBearerAuth()
@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Post('tournaments/:id/close')
  @Roles(Role.ADMIN, Role.ORGANIZER)
  @ApiOperation({
    summary:
      'Close a tournament rating period in batch, computing Glicko-2 updates and recording RatingHistory',
  })
  closeTournamentRatingPeriod(@Param('id') tournamentId: string) {
    return this.rankingService.closeTournamentRatingPeriod(tournamentId);
  }

  @Get('teams/:id/history')
  @ApiOperation({
    summary: 'Get immutable Glicko-2 rating history ledger for a team',
  })
  getTeamRatingHistory(@Param('id') teamId: string) {
    return this.rankingService.getTeamRatingHistory(teamId);
  }
}
