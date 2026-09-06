import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationCategory,
  NotificationType,
  Role,
  TeamMemberStatus,
} from '@prisma/client';
import { CreateTeamDto, JoinTeamDto } from './dto/teams.dto';
import { randomBytes } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private generateInviteCode(): string {
    return randomBytes(4).toString('hex').toLowerCase();
  }

  async findAll() {
    return this.prisma.team.findMany({
      include: {
        university: true,
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
      },
    });
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        university: true,
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
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    return team;
  }

  async createTeam(dto: CreateTeamDto) {
    const university = await this.prisma.university.findUnique({
      where: { id: dto.universityId },
    });

    if (university && university.name.toLowerCase().includes('unregistered')) {
      throw new ForbiddenException(
        `Your institution (${university.domain}) is not yet verified in Collegium. Athletes from unregistered institutions cannot create active squads until verified by an administrator.`,
      );
    }

    const existing = await this.prisma.team.findFirst({
      where: {
        name: { equals: dto.name, mode: 'insensitive' },
        universityId: dto.universityId,
        gameTitle: dto.gameTitle,
      },
    });

    if (existing) {
      throw new ConflictException(
        'A team with this name already exists for your university in this game.',
      );
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

    // Automatically promote creator/captain to ATHLETE role if not ADMIN
    await this.prisma.user.updateMany({
      where: { id: dto.captainId, role: Role.NON_ATHLETE },
      data: { role: Role.ATHLETE },
    });

    // Also sync the captain's typed handle to their default profile IGN
    await this.prisma.userGameHandle.upsert({
      where: {
        userId_gameTitle: {
          userId: dto.captainId,
          gameTitle: dto.gameTitle,
        },
      },
      update: { handle: dto.gameHandle.trim() },
      create: {
        userId: dto.captainId,
        gameTitle: dto.gameTitle,
        handle: dto.gameHandle.trim(),
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
      throw new NotFoundException('Invalid or expired invite link.');
    }

    return team;
  }

  async joinTeam(teamId: string, dto: JoinTeamDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { university: true },
    });

    if (
      user?.university &&
      user.university.name.toLowerCase().includes('unregistered')
    ) {
      throw new ForbiddenException(
        `Your institution (${user.university.domain}) is not yet verified in Collegium. Athletes from unregistered institutions cannot join active squads until verified by an administrator.`,
      );
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { university: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const existingMember = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: dto.userId },
    });

    if (existingMember) {
      throw new BadRequestException(
        'User is already a member or applicant of this team.',
      );
    }

    const isInstantJoin = dto.inviteCode && dto.inviteCode === team.inviteCode;
    const memberStatus = isInstantJoin
      ? TeamMemberStatus.ACCEPTED
      : TeamMemberStatus.PENDING;

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

    if (memberStatus === TeamMemberStatus.ACCEPTED) {
      // Instant join via invite code promotes to ATHLETE
      await this.prisma.user.updateMany({
        where: { id: dto.userId, role: Role.NON_ATHLETE },
        data: { role: Role.ATHLETE },
      });
    }

    // Also sync the athlete's typed handle to their default profile IGN
    await this.prisma.userGameHandle.upsert({
      where: {
        userId_gameTitle: {
          userId: dto.userId,
          gameTitle: team.gameTitle,
        },
      },
      update: { handle: dto.gameHandle.trim() },
      create: {
        userId: dto.userId,
        gameTitle: team.gameTitle,
        handle: dto.gameHandle.trim(),
      },
    });

    if (memberStatus === TeamMemberStatus.PENDING) {
      await this.notificationsService.create({
        userId: team.captainId,
        category: NotificationCategory.TEAM,
        type: NotificationType.TEAM_JOIN_REQUEST,
        title: '👥 New Roster Join Request',
        message: `${user?.displayName || 'An athlete'} requested to join ${team.name}.`,
        link: '/dashboard',
        refId: member.id,
      });
    }

    return {
      member,
      status: memberStatus,
      message: isInstantJoin
        ? 'Successfully joined the team via invite link!'
        : 'Join request submitted. Awaiting Team Captain approval.',
    };
  }

  async getTeamRequests(teamId: string, captainId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (team.captainId !== captainId) {
      throw new BadRequestException(
        'Only the Team Captain can manage join requests.',
      );
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

  async handleJoinRequest(
    teamId: string,
    requestId: string,
    captainId: string,
    accept: boolean,
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team || team.captainId !== captainId) {
      throw new BadRequestException(
        'Unauthorized to manage requests for this team.',
      );
    }

    const newStatus = accept
      ? TeamMemberStatus.ACCEPTED
      : TeamMemberStatus.DECLINED;

    const updatedMember = await this.prisma.teamMember.update({
      where: { id: requestId },
      data: { status: newStatus },
    });

    if (accept) {
      // Promoted to ATHLETE when accepted
      await this.prisma.user.updateMany({
        where: { id: updatedMember.userId, role: Role.NON_ATHLETE },
        data: { role: Role.ATHLETE },
      });
    }

    await this.notificationsService.create({
      userId: updatedMember.userId,
      category: NotificationCategory.TEAM,
      type: accept
        ? NotificationType.TEAM_REQUEST_ACCEPTED
        : NotificationType.TEAM_REQUEST_DECLINED,
      title: accept
        ? '✅ Roster Request Accepted'
        : '🚫 Roster Request Declined',
      message: accept
        ? `Your request to join ${team.name} was accepted!`
        : `Your request to join ${team.name} was declined.`,
      link: '/dashboard',
      refId: updatedMember.id,
    });

    return updatedMember;
  }

  async leaveTeam(teamId: string, userId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const member = await this.prisma.teamMember.findFirst({
      where: { teamId, userId },
    });

    if (!member) {
      throw new NotFoundException('You are not a member of this team.');
    }

    await this.prisma.teamMember.delete({
      where: { id: member.id },
    });

    if (team.captainId === userId) {
      const remainingMembers = team.members.filter(
        (m) => m.id !== member.id && m.status === TeamMemberStatus.ACCEPTED,
      );
      if (remainingMembers.length > 0) {
        await this.prisma.team.update({
          where: { id: teamId },
          data: { captainId: remainingMembers[0].userId },
        });
      } else {
        await this.prisma.team.delete({
          where: { id: teamId },
        });
      }
    }

    // Check if user has any remaining accepted memberships or captaincies
    const [captainCount, memberCount] = await Promise.all([
      this.prisma.team.count({ where: { captainId: userId } }),
      this.prisma.teamMember.count({
        where: { userId, status: TeamMemberStatus.ACCEPTED },
      }),
    ]);

    if (captainCount === 0 && memberCount === 0) {
      await this.prisma.user.updateMany({
        where: { id: userId, role: Role.ATHLETE },
        data: { role: Role.NON_ATHLETE },
      });
    }

    return { success: true, message: 'Successfully left the team roster.' };
  }
}
