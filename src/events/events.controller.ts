import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
import {
  SubmitEventTeamDto,
  UpdateEventTeamDto,
} from './dto/event-team.dto';
import { EventsService, RequestingUser } from './events.service';
import { EventTeamsService } from './event-teams.service';

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

  @Roles(Role.ADMIN, Role.ORGANIZER)
  @Get(':id/teams')
  @ApiOperation({ summary: 'List squads registered for an event' })
  findTeams(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.eventTeamsService.findAllForEvent(id, req.user);
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
