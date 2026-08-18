import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto, JoinTeamDto } from './dto/teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  async createTeam(@Body() dto: CreateTeamDto) {
    return this.teamsService.createTeam(dto);
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

  @Post(':id/join')
  async joinTeam(@Param('id') teamId: string, @Body() dto: JoinTeamDto) {
    return this.teamsService.joinTeam(teamId, dto);
  }

  @Get(':id/requests')
  async getRequests(
    @Param('id') teamId: string,
    @Query('captainId') captainId: string,
  ) {
    return this.teamsService.getTeamRequests(teamId, captainId);
  }

  @Patch(':id/requests/:requestId')
  async handleRequest(
    @Param('id') teamId: string,
    @Param('requestId') requestId: string,
    @Body('captainId') captainId: string,
    @Body('accept') accept: boolean,
  ) {
    return this.teamsService.handleJoinRequest(
      teamId,
      requestId,
      captainId,
      accept,
    );
  }

  @Post(':id/leave')
  async leaveTeam(@Param('id') teamId: string, @Body('userId') userId: string) {
    return this.teamsService.leaveTeam(teamId, userId);
  }
}
