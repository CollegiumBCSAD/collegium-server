import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { TournamentsService } from './tournaments.service';

@ApiTags('Tournaments')
@ApiBearerAuth() // This indicates that the endpoints require authentication
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  // GET /tournaments — Anyone logged in can list all tournaments
  @Get()
  @ApiOperation({ summary: 'List all tournaments' })
  findAll() {
    return this.tournamentsService.findAll();
  }

  // POST /tournaments — Admin or Coach creates a tournament
  @Post()
  @Roles(Role.ADMIN, Role.COACH)
  @ApiOperation({ summary: 'Create a new tournament (Admin or Coach only)' })
  create(@Body() createTournamentDto: CreateTournamentDto) {
    return this.tournamentsService.create(createTournamentDto);
  }

  // POST /tournaments/:id/register — Coach registers their university
  @Post(':id/register')
  @Roles(Role.COACH)
  @ApiOperation({ summary: 'Register your university for a tournament' })
  register(
    @Param('id') tournamentId: string,
    @Request() req: { user: { universityId: string } },
  ) {
    const universityId = req.user.universityId;
    return this.tournamentsService.registerUniversity(
      tournamentId,
      universityId,
    );
  }

  // POST /tournaments/:id/bracket — Admin or Coach generates the bracket
  @Post(':id/bracket')
  @Roles(Role.ADMIN, Role.COACH)
  @ApiOperation({ summary: 'Generate the tournament bracket' })
  generateBracket(@Param('id') tournamentId: string) {
    return this.tournamentsService.generateBracket(tournamentId);
  }

  // GET /tournaments/:id/bracket — Anyone logged in can view the bracket
  @Get(':id/bracket')
  @ApiOperation({ summary: 'View the tournament bracket' })
  getBracket(@Param('id') tournamentId: string) {
    return this.tournamentsService.getBracket(tournamentId);
  }

  // POST /tournaments/:id/matches/:mid/confirm — Coach submits the Riot match ID
  @Post(':id/matches/:mid/confirm')
  @Roles(Role.COACH)
  @ApiOperation({
    summary: 'Confirm a match result by submitting the Riot match ID',
  })
  confirmMatch(
    @Param('id') tournamentId: string,
    @Param('mid') matchId: string,
    @Body() confirmMatchDto: ConfirmMatchDto,
  ) {
    return this.tournamentsService.confirmMatch(
      tournamentId,
      matchId,
      confirmMatchDto,
    );
  }

  // POST /tournaments/:id/matches/:mid/close — Admin closes and verifies the match
  @Post(':id/matches/:mid/close')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Close and verify a match (Admin only)' })
  closeMatch(@Param('id') tournamentId: string, @Param('mid') matchId: string) {
    return this.tournamentsService.closeMatch(tournamentId, matchId);
  }
}
