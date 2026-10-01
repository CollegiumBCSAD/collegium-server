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
import { EventsService, RequestingUser } from './events.service';

interface AuthenticatedRequest {
  user: RequestingUser;
}

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

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
