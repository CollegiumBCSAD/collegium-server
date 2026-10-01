import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
import {
  ReviewEventTeamDto,
  SubmitEventTeamDto,
  UpdateEventTeamDto,
} from './dto/event-team.dto';
import { UploadEventDocumentDto } from './dto/event-document.dto';
import { ReportEventResultDto } from './dto/event-match.dto';
import { EventsService, RequestingUser } from './events.service';
import { EventTeamsService } from './event-teams.service';
import { EventDocumentsService } from './event-documents.service';
import { EventBracketService } from './event-bracket.service';
import { DOCUMENT_UPLOAD_OPTIONS } from './upload-options';

interface AuthenticatedRequest {
  user: RequestingUser;
}

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventTeamsService: EventTeamsService,
    private readonly eventDocumentsService: EventDocumentsService,
    private readonly eventBracketService: EventBracketService,
  ) {}

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Post()
  @ApiOperation({ summary: 'Create an invite-only event' })
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(req.user, dto);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Get()
  @ApiOperation({ summary: 'List events the caller organizes' })
  findAll(@Request() req: AuthenticatedRequest) {
    return this.eventsService.findAllForUser(req.user);
  }

  @Public()
  @Get('invite/:code')
  @ApiOperation({ summary: 'Read an event by its invite code' })
  findByInviteCode(@Param('code') code: string) {
    return this.eventsService.findByInviteCode(code);
  }

  @Public()
  @Post('invite/:code/teams')
  @ApiOperation({ summary: 'Register a squad through an invite code' })
  submitTeam(@Param('code') code: string, @Body() dto: SubmitEventTeamDto) {
    return this.eventTeamsService.submitTeam(code, dto);
  }

  @Public()
  @Get('teams/:editToken')
  @ApiOperation({ summary: 'Read a squad with its edit token' })
  findTeamByEditToken(@Param('editToken') editToken: string) {
    return this.eventTeamsService.findByEditToken(editToken);
  }

  @Public()
  @Patch('teams/:editToken')
  @ApiOperation({ summary: 'Edit a squad with its edit token' })
  updateTeamByEditToken(
    @Param('editToken') editToken: string,
    @Body() dto: UpdateEventTeamDto,
  ) {
    return this.eventTeamsService.updateByEditToken(editToken, dto);
  }

  @Public()
  @Post('teams/:editToken/documents')
  @UseInterceptors(FileInterceptor('file', DOCUMENT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a player document with the edit token' })
  uploadDocument(
    @Param('editToken') editToken: string,
    @Body() dto: UploadEventDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.eventDocumentsService.uploadByEditToken(
      editToken,
      dto.rosterPlayerId,
      dto.kind,
      file,
    );
  }

  @Public()
  @Get('teams/:editToken/documents')
  @ApiOperation({ summary: 'List uploaded documents for a squad' })
  listDocuments(@Param('editToken') editToken: string) {
    return this.eventDocumentsService.listByEditToken(editToken);
  }

  @Public()
  @Delete('teams/:editToken/documents/:documentId')
  @ApiOperation({ summary: 'Remove an uploaded document' })
  deleteDocument(
    @Param('editToken') editToken: string,
    @Param('documentId') documentId: string,
  ) {
    return this.eventDocumentsService.deleteByEditToken(editToken, documentId);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Get(':id/documents/:documentId')
  @ApiOperation({ summary: 'Download a squad document as the organizer' })
  async readDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const document = await this.eventDocumentsService.readForOrganizer(
      id,
      documentId,
      req.user,
    );

    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.filename)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Buffer.from(document.data));
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Get(':id/teams')
  @ApiOperation({ summary: 'List squads registered for an event' })
  findTeams(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.eventTeamsService.findAllForEvent(id, req.user);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Patch(':id/teams/:teamId/review')
  @ApiOperation({ summary: 'Approve or reject a squad' })
  reviewTeam(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: ReviewEventTeamDto,
  ) {
    return this.eventTeamsService.review(id, teamId, req.user, dto);
  }

  @Public()
  @Get(':id/bracket')
  @ApiOperation({ summary: 'Read the public bracket for an event' })
  getBracket(@Param('id') id: string) {
    return this.eventBracketService.getBracket(id);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Post(':id/bracket')
  @ApiOperation({ summary: 'Generate the bracket and lock sign-ups' })
  generateBracket(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.eventBracketService.generate(id, req.user);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Patch(':id/matches/:matchId')
  @ApiOperation({ summary: 'Report a match result and advance the winner' })
  reportResult(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: ReportEventResultDto,
  ) {
    return this.eventBracketService.reportResult(id, matchId, req.user, dto);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Post(':id/close')
  @ApiOperation({ summary: 'Close the event and purge player documents' })
  closeEvent(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.eventBracketService.close(id, req.user);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Get(':id')
  @ApiOperation({ summary: 'Read one event the caller organizes' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.eventsService.findOneForOrganizer(id, req.user);
  }

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update an event' })
  update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.updateEvent(id, req.user, dto);
  }
}
