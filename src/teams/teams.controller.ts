import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Request,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service';
import { CreateTeamDto, JoinTeamDto } from './dto/teams.dto';
import { Roles } from '../auth/decorators/roles.decorator';

type AuthedRequest = { user: { id: string; universityId: string } };

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Roles(Role.ATHLETE, Role.NON_ATHLETE)
  @Post()
  async createTeam(@Request() req: AuthedRequest, @Body() dto: CreateTeamDto) {
    return this.teamsService.createTeam(req.user, dto);
  }

  @Get()
  async getTeams() {
    return this.teamsService.findAll();
  }

  @Get(':id')
  async getTeamById(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Get('invite/:code')
  async getByInviteCode(@Param('code') code: string) {
    return this.teamsService.getTeamByInviteCode(code);
  }

  @Roles(Role.ATHLETE, Role.NON_ATHLETE)
  @Post(':id/join')
  async joinTeam(
    @Param('id') teamId: string,
    @Request() req: AuthedRequest,
    @Body() dto: JoinTeamDto,
  ) {
    return this.teamsService.joinTeam(teamId, req.user.id, dto);
  }

  @Get(':id/requests')
  async getRequests(
    @Param('id') teamId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.teamsService.getTeamRequests(teamId, req.user.id);
  }

  @Patch(':id/requests/:requestId')
  async handleRequest(
    @Param('id') teamId: string,
    @Param('requestId') requestId: string,
    @Request() req: AuthedRequest,
    @Body('accept') accept: boolean,
  ) {
    return this.teamsService.handleJoinRequest(
      teamId,
      requestId,
      req.user.id,
      accept,
    );
  }

  @Post(':id/leave')
  async leaveTeam(@Param('id') teamId: string, @Request() req: AuthedRequest) {
    return this.teamsService.leaveTeam(teamId, req.user.id);
  }
}
