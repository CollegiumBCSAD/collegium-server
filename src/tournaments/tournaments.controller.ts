import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role, TournamentStatus } from '@prisma/client';
import {
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { TournamentsService } from './tournaments.service';

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    callback(
      file.mimetype.startsWith('image/')
        ? null
        : new Error('Only image files are allowed'),
      file.mimetype.startsWith('image/'),
    );
  },
};

@ApiTags('Tournaments')
@ApiBearerAuth() // This indicates that the endpoints require authentication
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  // GET /tournaments — Anyone logged in can list all tournaments (optionally filtered by status)
  @Get()
  @ApiOperation({ summary: 'List all tournaments' })
  findAll(@Query('status') status?: TournamentStatus) {
    return this.tournamentsService.findAll(status);
  }

  // GET /tournaments/mine — Organizer views their own tournaments, any status
  // (including PENDING_APPROVAL/REJECTED, hidden from the public GET /tournaments list)
  @Get('mine')
  @ApiOperation({
    summary: 'List tournaments created by the logged-in organizer',
  })
  findMine(@Request() req: { user: { id: string } }) {
    return this.tournamentsService.findMine(req.user.id);
  }

  // POST /tournaments — Admin, Organizer, or Athlete creates a tournament
  // Organizer-created tournaments require Admin approval before going live
  // Cover image is optional, uploaded to Cloudinary server-side (multipart/form-data)
  @Post()
  @Roles(Role.ADMIN, Role.ORGANIZER, Role.ATHLETE)
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new tournament' })
  create(
    @Body() createTournamentDto: CreateTournamentDto,
    @Request() req: { user: { id: string; role: Role } },
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.tournamentsService.create(createTournamentDto, req.user, image);
  }

  // PATCH /tournaments/:id/status — Admin approves or rejects a pending tournament
  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Approve or reject a pending tournament (Admin only)',
  })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: TournamentStatus,
    @Body('reason') reason?: string,
  ) {
    return this.tournamentsService.updateApprovalStatus(id, status, reason);
  }

  // DELETE /tournaments/:id — Admin or Organizer deletes a tournament
  @Delete(':id')
  @Roles(Role.ADMIN, Role.ORGANIZER)
  @ApiOperation({ summary: 'Delete or remove a tournament' })
  deleteTournament(@Param('id') tournamentId: string) {
    return this.tournamentsService.deleteTournament(tournamentId);
  }

  // POST /tournaments/:id/apply — Athlete or squad submits an application
  @Post(':id/apply')
  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({ summary: 'Apply for a tournament' })
  apply(
    @Param('id') tournamentId: string,
    @Request()
    req: { user: { id: string; displayName?: string; universityId?: string } },
  ) {
    return this.tournamentsService.applyForTournament(tournamentId, req.user);
  }

  // POST /tournaments/:id/withdraw — Athlete or squad withdraws/undoes their application
  @Post(':id/withdraw')
  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({ summary: 'Withdraw application for a tournament' })
  withdraw(
    @Param('id') tournamentId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.tournamentsService.withdrawApplication(
      tournamentId,
      req.user.id,
    );
  }

  // GET /tournaments/:id/applications — Organizer or Admin views pending applications
  @Get(':id/applications')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({ summary: 'Get all squad applications for a tournament' })
  getApplications(@Param('id') tournamentId: string) {
    return this.tournamentsService.getApplications(tournamentId);
  }

  // POST /tournaments/:id/applications/:appId/approve — Organizer approves squad application
  @Post(':id/applications/:appId/approve')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({ summary: 'Approve squad application for a tournament' })
  approveApplication(
    @Param('id') tournamentId: string,
    @Param('appId') appId: string,
  ) {
    return this.tournamentsService.approveApplication(tournamentId, appId);
  }

  // POST /tournaments/:id/applications/:appId/reject — Organizer declines squad application
  @Post(':id/applications/:appId/reject')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({ summary: 'Reject squad application for a tournament' })
  rejectApplication(
    @Param('id') tournamentId: string,
    @Param('appId') appId: string,
  ) {
    return this.tournamentsService.rejectApplication(tournamentId, appId);
  }

  // POST /tournaments/:id/register — Direct register (Admin/Legacy)
  @Post(':id/register')
  @Roles(Role.ATHLETE, Role.NON_ATHLETE, Role.ORGANIZER, Role.ADMIN)
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

  // POST /tournaments/:id/bracket — Admin, Organizer, or Athlete generates the bracket
  @Post(':id/bracket')
  @Roles(Role.ADMIN, Role.ORGANIZER, Role.ATHLETE)
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

  // POST /tournaments/:id/matches/:mid/confirm — Athlete submits the Riot match ID
  @Post(':id/matches/:mid/confirm')
  @Roles(Role.ATHLETE)
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

  // POST /tournaments/:id/matches/:mid/close — Admin or Organizer closes and verifies the match
  @Post(':id/matches/:mid/close')
  @Roles(Role.ADMIN, Role.ORGANIZER)
  @ApiOperation({ summary: 'Close and verify a match (Admin or Organizer)' })
  closeMatch(@Param('id') tournamentId: string, @Param('mid') matchId: string) {
    return this.tournamentsService.closeMatch(tournamentId, matchId);
  }
}
