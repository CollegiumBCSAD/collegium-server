import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TeamMemberStatus } from "@prisma/client";
import { CreateTeamDto, JoinTeamDto } from "./dto/teams.dto";
import { randomBytes } from "crypto";

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateInviteCode(): string {
    return randomBytes(4).toString("hex").toLowerCase();
  }

  async createTeam(dto: CreateTeamDto) {
    const existing = await this.prisma.team.findFirst({
      where: {
        name: { equals: dto.name, mode: "insensitive" },
        universityId: dto.universityId,
        gameTitle: dto.gameTitle,
      },
    });

    if (existing) {
      throw new ConflictException("A team with this name already exists for your university in this game.");
    }

    const inviteCode = this.generateInviteCode();

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        gameTitle: dto.gameTitle,
        universityId: dto.universityId,
        captainId: dto.captainId,
        inviteCode,
        members: {
          create: {
            userId: dto.captainId,
            gameHandle: dto.gameHandle,
            preferredRole: dto.preferredRole,
            status: TeamMemberStatus.ACCEPTED,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                email: true,
              },
            },
          },
        },
        university: true,
      },
    });

    return team;
  }

  async getTeamByInviteCode(inviteCode: string) {
    const team = await this.prisma.team.findUnique({
      where: { inviteCode },
      include: {
        university: true,
        members: {
          where: { status: TeamMemberStatus.ACCEPTED },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException("Invalid or expired invite link.");
    }

    return team;
  }

  async joinTeam(teamId: string, dto: JoinTeamDto) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { university: true },
    });

    if (!team) {
      throw new NotFoundException("Team not found.");
    }

    const existingMember = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: dto.userId },
    });

    if (existingMember) {
      throw new BadRequestException("User is already a member or applicant of this team.");
    }

    const isInstantJoin = dto.inviteCode && dto.inviteCode === team.inviteCode;
    const memberStatus = isInstantJoin ? TeamMemberStatus.ACCEPTED : TeamMemberStatus.PENDING;

    const member = await this.prisma.teamMember.create({
      data: {
        teamId,
        userId: dto.userId,
        gameHandle: dto.gameHandle,
        preferredRole: dto.preferredRole,
        status: memberStatus,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    return {
      member,
      status: memberStatus,
      message: isInstantJoin
        ? "Successfully joined the team via invite link!"
        : "Join request submitted. Awaiting Team Captain approval.",
    };
  }

  async getTeamRequests(teamId: string, captainId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new NotFoundException("Team not found.");
    }

    if (team.captainId !== captainId) {
      throw new BadRequestException("Only the Team Captain can manage join requests.");
    }

    return this.prisma.teamMember.findMany({
      where: { teamId, status: TeamMemberStatus.PENDING },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    });
  }

  async handleJoinRequest(teamId: string, requestId: string, captainId: string, accept: boolean) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team || team.captainId !== captainId) {
      throw new BadRequestException("Unauthorized to manage requests for this team.");
    }

    const newStatus = accept ? TeamMemberStatus.ACCEPTED : TeamMemberStatus.DECLINED;

    return this.prisma.teamMember.update({
      where: { id: requestId },
      data: { status: newStatus },
    });
  }
}
