import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  GameTitle,
  MatchMode,
  NotificationCategory,
  NotificationType,
  Role,
  TeamAuditAction,
  TeamInvitationStatus,
  TeamMemberStatus,
  User,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamAuthorityService } from './team-authority.service';
import { CreateCoachTeamDto } from './dto/coach.dto';

const INVITATION_TTL_DAYS = 7;

const USER_SUMMARY = { id: true, displayName: true, email: true } as const;

const TEAM_SUMMARY_INCLUDE = {
  university: { select: { id: true, name: true } },
  captain: { select: USER_SUMMARY },
  members: {
    where: { status: TeamMemberStatus.ACCEPTED },
    include: { user: { select: USER_SUMMARY } },
  },
  _count: {
    select: {
      members: { where: { status: TeamMemberStatus.PENDING } },
    },
  },
} as const;

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly authority: TeamAuthorityService,
  ) {}

  // ── Coach account approval (Admin) ────────────────────────────────────

  listApplications(status: AccountStatus = AccountStatus.PENDING) {
    return this.prisma.user.findMany({
      where: { role: Role.COACH, status },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        university: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async reviewApplication(userId: string, approve: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.role !== Role.COACH) {
      throw new NotFoundException('Coach application not found.');
    }

    if (user.status !== AccountStatus.PENDING) {
      throw new BadRequestException(
        `This coach application was already ${user.status.toLowerCase()}.`,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: approve ? AccountStatus.ACTIVE : AccountStatus.REJECTED,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
      },
    });

    await this.notificationsService.create({
      userId,
      category: NotificationCategory.TEAM,
      type: approve
        ? NotificationType.COACH_ACCOUNT_APPROVED
        : NotificationType.COACH_ACCOUNT_REJECTED,
      title: approve
        ? '✅ Coach Account Approved'
        : '🚫 Coach Application Declined',
      message: approve
        ? 'Your Coach/Manager account is active. Create a team or accept a team invite to get started.'
        : 'Your Coach/Manager application was declined. You may reapply by registering again with the same email.',
      link: '/coach',
      // A coach can be declined, reapply, and be reviewed again.
      refId: `${userId}:${Date.now()}`,
    });

    return updated;
  }

  // ── Coach teams ───────────────────────────────────────────────────────

  listTeams(coachId: string) {
    return this.prisma.team.findMany({
      where: { coachId },
      include: TEAM_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTeam(coach: User, dto: CreateCoachTeamDto) {
    const university = await this.prisma.university.findUnique({
      where: { id: coach.universityId },
    });

    if (!university || university.name.toLowerCase().includes('unregistered')) {
      throw new ForbiddenException(
        'Your institution is not yet verified in Collegium. Coaches from unregistered institutions cannot create teams until verified by an administrator.',
      );
    }

    const name = dto.name.trim();
    const existing = await this.prisma.team.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        universityId: coach.universityId,
        gameTitle: dto.gameTitle,
      },
    });

    if (existing) {
      throw new ConflictException(
        'A team with this name already exists for your university in this game.',
      );
    }

    const team = await this.prisma.team.create({
      data: {
        name,
        gameTitle: dto.gameTitle,
        universityId: coach.universityId,
        coachId: coach.id,
        inviteCode: randomBytes(4).toString('hex').toLowerCase(),
        min_roster_size: 5,
        max_roster_size: dto.gameTitle === GameTitle.LOL ? 7 : 6,
      },
      include: TEAM_SUMMARY_INCLUDE,
    });

    await this.authority.record(
      coach.id,
      team.id,
      TeamAuditAction.TEAM_CREATED,
      {
        name: team.name,
        gameTitle: team.gameTitle,
      },
    );

    return team;
  }

  async getTeamDashboard(teamId: string) {
    const now = new Date();
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        ...TEAM_SUMMARY_INCLUDE,
        practiceSchedules: {
          where: { startsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
          take: 5,
        },
        tournamentApplications: {
          include: {
            tournament: {
              select: { id: true, name: true, status: true, startDate: true },
            },
          },
          orderBy: { appliedAt: 'desc' },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const records = await this.prisma.practiceRecord.groupBy({
      by: ['result'],
      where: { teamId },
      _count: { _all: true },
    });
    const wins = records.find((r) => r.result === 'WIN')?._count._all ?? 0;
    const losses = records.find((r) => r.result === 'LOSS')?._count._all ?? 0;

    return { ...team, practiceSummary: { wins, losses, total: wins + losses } };
  }

  // Captain, coach (stepping down), or Admin detaches the coach.
  async removeCoach(teamId: string, user: User) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (!team.coachId) {
      throw new BadRequestException('This team has no coach.');
    }

    const allowed =
      user.role === Role.ADMIN ||
      user.id === team.captainId ||
      user.id === team.coachId;

    if (!allowed) {
      throw new ForbiddenException(
        'Only the team captain, its coach, or an administrator can remove the coach.',
      );
    }

    if (!team.captainId) {
      throw new BadRequestException(
        'This team has no captain yet, so it cannot be left without a coach.',
      );
    }

    const removedCoachId = team.coachId;
    await this.prisma.team.update({
      where: { id: teamId },
      data: { coachId: null },
    });

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.COACH_REMOVED,
      {
        coachId: removedCoachId,
      },
    );

    return { success: true, message: 'Coach removed from the team.' };
  }

  // ── Invitations ───────────────────────────────────────────────────────

  async inviteCoach(teamId: string, inviter: User, email: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (inviter.role !== Role.ADMIN && team.captainId !== inviter.id) {
      throw new ForbiddenException('Only the team captain can invite a coach.');
    }

    if (team.coachId) {
      throw new ConflictException(
        'This team already has a coach. Remove them before inviting another.',
      );
    }

    const coach = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!coach || coach.role !== Role.COACH) {
      throw new NotFoundException(
        'No Coach/Manager account is registered with that email.',
      );
    }

    if (coach.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException(
        'That coach account has not been approved by an administrator yet.',
      );
    }

    if (coach.universityId !== team.universityId) {
      throw new BadRequestException(
        'A coach can only be invited to teams from their own university.',
      );
    }

    await this.expireStaleInvitations({ teamId });

    const pending = await this.prisma.teamInvitation.findFirst({
      where: {
        teamId,
        coachId: coach.id,
        status: TeamInvitationStatus.PENDING,
      },
    });

    if (pending) {
      throw new ConflictException(
        'This coach already has a pending invitation to the team.',
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    const invitation = await this.prisma.teamInvitation.create({
      data: { teamId, coachId: coach.id, invitedById: inviter.id, expiresAt },
    });

    await this.notificationsService.create({
      userId: coach.id,
      category: NotificationCategory.TEAM,
      type: NotificationType.COACH_INVITE_RECEIVED,
      title: '📋 Coaching Invitation',
      message: `${inviter.displayName} invited you to coach ${team.name}. The invite expires in ${INVITATION_TTL_DAYS} days.`,
      link: '/coach',
      refId: invitation.id,
    });

    await this.authority.record(
      inviter.id,
      teamId,
      TeamAuditAction.COACH_INVITE_SENT,
      { invitationId: invitation.id, coachId: coach.id },
    );

    return invitation;
  }

  async listInvitations(coachId: string) {
    await this.expireStaleInvitations({ coachId });

    return this.prisma.teamInvitation.findMany({
      where: { coachId, status: TeamInvitationStatus.PENDING },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            gameTitle: true,
            university: { select: { id: true, name: true } },
          },
        },
        invitedBy: { select: USER_SUMMARY },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondToInvitation(
    coach: User,
    invitationId: string,
    accept: boolean,
  ) {
    const invitation = await this.prisma.teamInvitation.findUnique({
      where: { id: invitationId },
      include: { team: true },
    });

    if (!invitation || invitation.coachId !== coach.id) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.status !== TeamInvitationStatus.PENDING) {
      throw new BadRequestException(
        `This invitation is already ${invitation.status.toLowerCase()}.`,
      );
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.teamInvitation.update({
        where: { id: invitationId },
        data: { status: TeamInvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invitation has expired.');
    }

    const { team } = invitation;

    if (!accept) {
      await this.prisma.teamInvitation.update({
        where: { id: invitationId },
        data: {
          status: TeamInvitationStatus.DECLINED,
          respondedAt: new Date(),
        },
      });
      await this.notificationsService.create({
        userId: invitation.invitedById,
        category: NotificationCategory.TEAM,
        type: NotificationType.COACH_INVITE_DECLINED,
        title: '✕ Coaching Invitation Declined',
        message: `${coach.displayName} declined the invitation to coach ${team.name}.`,
        link: '/dashboard',
        refId: invitation.id,
      });
      return { success: true, status: TeamInvitationStatus.DECLINED };
    }

    const isRostered = await this.prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: coach.id },
    });

    if (isRostered) {
      throw new BadRequestException(
        'You are on this team’s player roster, so you cannot also be its coach.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional update so two concurrent accepts can't both win.
      const claimed = await tx.team.updateMany({
        where: { id: team.id, coachId: null },
        data: { coachId: coach.id },
      });

      if (claimed.count === 0) {
        throw new ConflictException('This team already has a coach.');
      }

      await tx.teamInvitation.update({
        where: { id: invitationId },
        data: {
          status: TeamInvitationStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      await tx.teamInvitation.updateMany({
        where: {
          teamId: team.id,
          status: TeamInvitationStatus.PENDING,
          id: { not: invitationId },
        },
        data: { status: TeamInvitationStatus.CANCELLED },
      });
    });

    await this.notificationsService.create({
      userId: invitation.invitedById,
      category: NotificationCategory.TEAM,
      type: NotificationType.COACH_INVITE_ACCEPTED,
      title: '🤝 Coach Joined Your Team',
      message: `${coach.displayName} is now the coach of ${team.name}.`,
      link: '/dashboard',
      refId: invitation.id,
    });

    await this.authority.record(
      coach.id,
      team.id,
      TeamAuditAction.COACH_INVITE_ACCEPTED,
      { invitationId },
    );

    return { success: true, status: TeamInvitationStatus.ACCEPTED };
  }

  private async expireStaleInvitations(scope: {
    teamId?: string;
    coachId?: string;
  }) {
    await this.prisma.teamInvitation.updateMany({
      where: {
        ...scope,
        status: TeamInvitationStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: TeamInvitationStatus.EXPIRED },
    });
  }

  // ── Stats & audit ─────────────────────────────────────────────────────

  // Tournament match statistics for the team's current roster. Scrim
  // matches are excluded; they never count as competitive results.
  async getTeamStats(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          where: { status: TeamMemberStatus.ACCEPTED },
          include: { user: { select: USER_SUMMARY } },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const rosterIds = team.members.map((m) => m.userId);

    const stats = rosterIds.length
      ? await this.prisma.playerStat.findMany({
          where: {
            userId: { in: rosterIds },
            match: { matchMode: MatchMode.TOURNAMENT, isVerified: true },
          },
          select: {
            userId: true,
            kills: true,
            deaths: true,
            assists: true,
            win: true,
            matchId: true,
          },
        })
      : [];

    const players = team.members.map((m) => {
      const rows = stats.filter((s) => s.userId === m.userId);
      const kills = rows.reduce((n, r) => n + r.kills, 0);
      const deaths = rows.reduce((n, r) => n + r.deaths, 0);
      const assists = rows.reduce((n, r) => n + r.assists, 0);
      return {
        userId: m.userId,
        displayName: m.user.displayName,
        gameHandle: m.gameHandle,
        role: m.preferredRole,
        games: rows.length,
        wins: rows.filter((r) => r.win).length,
        kills,
        deaths,
        assists,
        kda: deaths === 0 ? kills + assists : (kills + assists) / deaths,
      };
    });

    return {
      teamId: team.id,
      teamName: team.name,
      gameTitle: team.gameTitle,
      rating: {
        rating: team.glicko2_rating,
        rd: team.glicko2_rd,
        lastRatedAt: team.last_rated_at,
      },
      matchesPlayed: new Set(stats.map((s) => s.matchId)).size,
      players,
    };
  }

  getAuditLog(teamId: string) {
    return this.prisma.teamAuditLog.findMany({
      where: { teamId },
      include: { actor: { select: USER_SUMMARY } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
