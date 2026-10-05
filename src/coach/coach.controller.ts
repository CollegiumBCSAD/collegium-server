import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoachService } from './coach.service';
import { PracticeService } from './practice.service';
import { TeamCoachGuard } from './guards/team-coach.guard';
import {
  CreateCoachTeamDto,
  CreatePracticeRecordDto,
  CreatePracticeScheduleDto,
  UpdatePracticeScheduleDto,
} from './dto/coach.dto';

const SCOREBOARD_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    const isImage = file.mimetype.startsWith('image/');
    callback(
      isImage ? null : new Error('Only image files are allowed'),
      isImage,
    );
  },
};

// Guard 1 (account tier) is the class-level @Roles(Role.COACH), checked by
// the global RolesGuard against an ACTIVE (admin-approved) account. Guard 2
// (team role) is TeamCoachGuard on every :teamId route.
@ApiTags('Coach')
@ApiBearerAuth()
@Roles(Role.COACH)
@Controller('coach')
export class CoachController {
  constructor(
    private readonly coachService: CoachService,
    private readonly practiceService: PracticeService,
  ) {}

  @Get('teams')
  @ApiOperation({ summary: 'List the teams the logged-in coach manages' })
  listTeams(@Req() req: { user: User }) {
    return this.coachService.listTeams(req.user.id);
  }

  @Post('teams')
  @ApiOperation({ summary: 'Create a team with the coach auto-assigned' })
  createTeam(@Req() req: { user: User }, @Body() dto: CreateCoachTeamDto) {
    return this.coachService.createTeam(req.user, dto);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List pending coaching invitations' })
  listInvitations(@Req() req: { user: User }) {
    return this.coachService.listInvitations(req.user.id);
  }

  @Post('invitations/:invitationId/accept')
  @ApiOperation({ summary: 'Accept a coaching invitation' })
  acceptInvitation(
    @Req() req: { user: User },
    @Param('invitationId') invitationId: string,
  ) {
    return this.coachService.respondToInvitation(req.user, invitationId, true);
  }

  @Post('invitations/:invitationId/decline')
  @ApiOperation({ summary: 'Decline a coaching invitation' })
  declineInvitation(
    @Req() req: { user: User },
    @Param('invitationId') invitationId: string,
  ) {
    return this.coachService.respondToInvitation(req.user, invitationId, false);
  }

  @UseGuards(TeamCoachGuard)
  @Get('teams/:teamId')
  @ApiOperation({ summary: 'Coach team dashboard' })
  getTeam(@Param('teamId') teamId: string) {
    return this.coachService.getTeamDashboard(teamId);
  }

  @UseGuards(TeamCoachGuard)
  @Get('teams/:teamId/stats')
  @ApiOperation({ summary: 'Tournament match statistics for the own team' })
  getStats(@Param('teamId') teamId: string) {
    return this.coachService.getTeamStats(teamId);
  }

  @UseGuards(TeamCoachGuard)
  @Get('teams/:teamId/audit-log')
  @ApiOperation({ summary: 'Audit trail of coach actions on the team' })
  getAuditLog(@Param('teamId') teamId: string) {
    return this.coachService.getAuditLog(teamId);
  }

  @UseGuards(TeamCoachGuard)
  @Post('teams/:teamId/practice-schedules')
  @ApiOperation({ summary: 'Schedule a team practice' })
  createSchedule(
    @Req() req: { user: User },
    @Param('teamId') teamId: string,
    @Body() dto: CreatePracticeScheduleDto,
  ) {
    return this.practiceService.createSchedule(teamId, req.user, dto);
  }

  @UseGuards(TeamCoachGuard)
  @Patch('teams/:teamId/practice-schedules/:scheduleId')
  @ApiOperation({ summary: 'Update a team practice' })
  updateSchedule(
    @Req() req: { user: User },
    @Param('teamId') teamId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdatePracticeScheduleDto,
  ) {
    return this.practiceService.updateSchedule(
      teamId,
      scheduleId,
      req.user,
      dto,
    );
  }

  @UseGuards(TeamCoachGuard)
  @Delete('teams/:teamId/practice-schedules/:scheduleId')
  @ApiOperation({ summary: 'Cancel a team practice' })
  deleteSchedule(
    @Req() req: { user: User },
    @Param('teamId') teamId: string,
    @Param('scheduleId') scheduleId: string,
  ) {
    return this.practiceService.deleteSchedule(teamId, scheduleId, req.user);
  }

  @UseGuards(TeamCoachGuard)
  @Post('teams/:teamId/practice-records/scan')
  @UseInterceptors(FileInterceptor('image', SCOREBOARD_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'OCR a scrim scoreboard for its win/loss and completion',
  })
  scanRecord(
    @Param('teamId') teamId: string,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.practiceService.scanRecord(teamId, image);
  }

  @UseGuards(TeamCoachGuard)
  @Post('teams/:teamId/practice-records')
  @ApiOperation({ summary: 'Confirm and save an unranked practice record' })
  createRecord(
    @Req() req: { user: User },
    @Param('teamId') teamId: string,
    @Body() dto: CreatePracticeRecordDto,
  ) {
    return this.practiceService.createRecord(teamId, req.user, dto);
  }
}
