import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoachService } from './coach.service';
import { PracticeService } from './practice.service';
import { InviteCoachDto } from './dto/coach.dto';

// Team-side coaching routes: the captain inviting or removing a coach, and
// the roster viewing what the coach has scheduled and logged.
@ApiTags('Teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamCoachingController {
  constructor(
    private readonly coachService: CoachService,
    private readonly practiceService: PracticeService,
  ) {}

  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.ADMIN)
  @Post(':id/coach-invitations')
  @ApiOperation({ summary: 'Captain invites an approved coach by email' })
  inviteCoach(
    @Req() req: { user: User },
    @Param('id') teamId: string,
    @Body() dto: InviteCoachDto,
  ) {
    return this.coachService.inviteCoach(teamId, req.user, dto.email);
  }

  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.COACH, Role.ADMIN)
  @Delete(':id/coach')
  @ApiOperation({ summary: 'Remove the team coach, or step down as coach' })
  removeCoach(@Req() req: { user: User }, @Param('id') teamId: string) {
    return this.coachService.removeCoach(teamId, req.user);
  }

  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.COACH, Role.ADMIN)
  @Get(':id/practice-schedules')
  @ApiOperation({ summary: 'View the team practice schedule' })
  async listSchedules(@Req() req: { user: User }, @Param('id') teamId: string) {
    await this.practiceService.assertCanView(teamId, req.user);
    return this.practiceService.listSchedules(teamId);
  }

  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.COACH, Role.ADMIN)
  @Get(':id/practice-records')
  @ApiOperation({ summary: 'View the team scrim practice records' })
  async listRecords(@Req() req: { user: User }, @Param('id') teamId: string) {
    await this.practiceService.assertCanView(teamId, req.user);
    return this.practiceService.listRecords(teamId);
  }
}
