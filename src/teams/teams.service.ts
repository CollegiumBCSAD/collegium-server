import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GameTitle,
  NotificationCategory,
  NotificationType,
  Role,
  TeamMemberStatus,
} from '@prisma/client';
import { CreateTeamDto, JoinTeamDto } from './dto/teams.dto';
import { randomBytes } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';

const COACH_SELECT = { id: true, displayName: true, email: true } as const;

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
        coach: { select: COACH_SELECT },
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
        coach: { select: COACH_SELECT },
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

  async createTeam(
    captain: { id: string; universityId: string },
    dto: CreateTeamDto,
  ) {
    const university = await this.prisma.university.findUnique({
      where: { id: captain.universityId },
    });

    if (university && university.name.toLowerCase().includes('unregistered')) {
      throw new ForbiddenException(
        `Your institution (${university.domain}) is not yet verified in Collegium. Athletes from unregistered institutions cannot create active squads until verified by an administrator.`,
      );
    }

    const existingMembership = await this.prisma.teamMember.findFirst({
      where: {
        userId: captain.id,
        status: TeamMemberStatus.ACCEPTED,
      },
      include: { team: true },
    });

    if (existingMembership) {
      throw new BadRequestException(
        `You already belong to ${existingMembership.team.name}. Each athlete is limited to 1 varsity team. Please leave your current squad before creating a new one.`,
      );
    }

    const existing = await this.prisma.team.findFirst({
      where: {
        name: { equals: dto.name, mode: 'insensitive' },
        universityId: captain.universityId,
        gameTitle: dto.gameTitle,
      },
    });

    if (existing) {
      throw new ConflictException(
        'A team with this name already exists for your university in this game.',
      );
    }

    const inviteCode = this.generateInviteCode();
    const min_roster_size = 5;
    const max_roster_size = dto.gameTitle === GameTitle.LOL ? 7 : 6;

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        gameTitle: dto.gameTitle,
        universityId: captain.universityId,
        captainId: captain.id,
        inviteCode,
        min_roster_size,
        max_roster_size,
        members: {
          create: {
            userId: captain.id,
            gameHandle: dto.gameHandle.trim(),
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
      where: { id: captain.id, role: Role.NON_ATHLETE },
      data: { role: Role.ATHLETE },
    });

    // Also sync the captain's typed handle to their default profile IGN
    await this.prisma.userGameHandle.upsert({
      where: {
        userId_gameTitle: {
          userId: captain.id,
          gameTitle: dto.gameTitle,
        },
      },
      update: { handle: dto.gameHandle.trim() },
      create: {
        userId: captain.id,
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

  async joinTeam(teamId: string, userId: string, dto: JoinTeamDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    if (team.coachId === userId) {
      throw new BadRequestException(
        'You coach this team, so you cannot also hold a player slot on its roster.',
      );
    }

    const existingMember = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: userId },
    });

    if (existingMember) {
      throw new BadRequestException(
        'User is already a member or applicant of this team.',
      );
    }

    const existingMembership = await this.prisma.teamMember.findFirst({
      where: {
        userId: userId,
        status: TeamMemberStatus.ACCEPTED,
      },
      include: { team: true },
    });

    if (existingMembership) {
      throw new BadRequestException(
        `You already belong to ${existingMembership.team.name}. Each athlete is limited to 1 varsity team. Please leave your current squad before joining another.`,
      );
    }

    const isInstantJoin = dto.inviteCode && dto.inviteCode === team.inviteCode;
    const memberStatus = isInstantJoin
      ? TeamMemberStatus.ACCEPTED
      : TeamMemberStatus.PENDING;

    const member = await this.prisma.teamMember.create({
      data: {
        teamId,
        userId: userId,
        gameHandle: dto.gameHandle.trim(),
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
        where: { id: userId, role: Role.NON_ATHLETE },
        data: { role: Role.ATHLETE },
      });
      await this.claimCaptaincyIfVacant(teamId, userId);
    }

    // Also sync the athlete's typed handle to their default profile IGN
    await this.prisma.userGameHandle.upsert({
      where: {
        userId_gameTitle: {
          userId: userId,
          gameTitle: team.gameTitle,
        },
      },
      update: { handle: dto.gameHandle.trim() },
      create: {
        userId: userId,
        gameTitle: team.gameTitle,
        handle: dto.gameHandle.trim(),
      },
    });

    const reviewerId = team.captainId ?? team.coachId;
    if (memberStatus === TeamMemberStatus.PENDING && reviewerId) {
      await this.notificationsService.create({
        userId: reviewerId,
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
        : `Join request submitted. Awaiting ${team.captainId ? 'Team Captain' : 'Coach'} approval.`,
    };
  }

  async getTeamRequests(teamId: string, captainId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (!this.canManageRoster(team, captainId)) {
      throw new BadRequestException(
        'Only the Team Captain or Coach can manage join requests.',
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

    if (!team || !this.canManageRoster(team, captainId)) {
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
      await this.claimCaptaincyIfVacant(teamId, updatedMember.userId);
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
      } else if (team.coachId) {
        await this.prisma.team.update({
          where: { id: teamId },
          data: { captainId: null },
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

  private canManageRoster(
    team: { captainId: string | null; coachId: string | null },
    userId: string,
  ) {
    return team.captainId === userId || team.coachId === userId;
  }

  // A squad a coach created starts without a captain; the first athlete
  // accepted onto it takes the armband.
  private async claimCaptaincyIfVacant(teamId: string, userId: string) {
    await this.prisma.team.updateMany({
      where: { id: teamId, captainId: null },
      data: { captainId: userId },
    });
  }
}
