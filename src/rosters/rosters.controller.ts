import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RostersService } from './rosters.service';
import {
  CreateRosterChangeDto,
  ReviewRosterChangeDto,
  UpdateRosterMemberDto,
} from './dto/rosters.dto';

// Captain/coach roster management. Who may act is checked per team in the
// service (captain, coach, or admin), not by account tier alone.
@ApiTags('Rosters')
@ApiBearerAuth()
@Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.COACH, Role.ADMIN)
@Controller('teams')
export class TeamRosterController {
  constructor(private readonly rostersService: RostersService) {}

  @Get(':id/roster')
  @ApiOperation({ summary: 'Roster, lineup locks, and change requests' })
  getRoster(@Req() req: { user: User }, @Param('id') teamId: string) {
    return this.rostersService.getRoster(teamId, req.user);
  }

  @Patch(':id/members/:memberId')
  @ApiOperation({ summary: "Edit a player's role or in-game name" })
  updateMember(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateRosterMemberDto,
  ) {
    return this.rostersService.updateMember(teamId, memberId, req.user, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: 'Remove a player not on a locked lineup' })
  removeMember(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.rostersService.removeMember(teamId, memberId, req.user);
  }

  @Post(':id/members/:memberId/captain')
  @ApiOperation({ summary: 'Hand the captaincy to another player' })
  transferCaptaincy(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.rostersService.transferCaptaincy(teamId, memberId, req.user);
  }

  @Post(':id/roster-changes')
  @ApiOperation({
    summary: 'File a last-minute substitution on a submitted lineup',
  })
  requestChange(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Body() dto: CreateRosterChangeDto,
  ) {
    return this.rostersService.requestChange(teamId, req.user, dto);
  }

  @Post(':id/roster-changes/:changeId/cancel')
  @ApiOperation({ summary: 'Cancel a pending roster change' })
  cancelChange(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Param('changeId') changeId: string,
  ) {
    return this.rostersService.cancelChange(teamId, changeId, req.user);
  }
}

// Organizer / admin review of last-minute changes.
@ApiTags('Rosters')
@ApiBearerAuth()
@Roles(Role.ORGANIZER, Role.ADMIN)
@Controller('roster-changes')
export class RosterChangesController {
  constructor(private readonly rostersService: RostersService) {}

  @Get()
  @ApiOperation({ summary: "List a tournament's roster change requests" })
  list(
    @Req() req: { user: User },
    @Query('tournamentId') tournamentId: string,
  ) {
    return this.rostersService.listForTournament(tournamentId, req.user);
  }

  @Patch(':changeId')
  @ApiOperation({ summary: 'Approve or reject a roster change' })
  review(
    @Req() req: { user: User },
    @Param('changeId') changeId: string,
    @Body() dto: ReviewRosterChangeDto,
  ) {
    return this.rostersService.reviewChange(changeId, req.user, dto);
  }
}
