import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationCategory,
  NotificationType,
  Prisma,
  Role,
  RosterChangeReason,
  RosterChangeStatus,
  TeamAuditAction,
  TeamMemberStatus,
  TournamentApplicationStatus,
  TournamentStatus,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamAuthorityService } from '../coach/team-authority.service';
import {
  CreateRosterChangeDto,
  ReviewRosterChangeDto,
  UpdateRosterMemberDto,
} from './dto/rosters.dto';

type SnapshotEntry = Record<string, unknown> & { userId?: string };

const REASON_LABELS: Record<RosterChangeReason, string> = {
  INJURY: 'Injury',
  ILLNESS: 'Illness',
  ACADEMIC: 'Academic conflict',
  PERSONAL_EMERGENCY: 'Personal emergency',
  ELIGIBILITY: 'Eligibility issue',
  TECHNICAL: 'Technical / connectivity issue',
  OTHER: 'Other',
};

// A lineup is locked once it's been submitted to a tournament that is still
// running: pending or approved, and the tournament not finished or rejected.
const ACTIVE_ENTRY = {
  status: {
    in: [
      TournamentApplicationStatus.PENDING,
      TournamentApplicationStatus.APPROVED,
    ],
  },
  tournament: {
    status: {
      notIn: [TournamentStatus.COMPLETED, TournamentStatus.REJECTED],
    },
  },
} satisfies Prisma.TournamentApplicationWhereInput;

const USER_SUMMARY = { id: true, displayName: true, email: true } as const;

const CHANGE_INCLUDE = {
  outUser: { select: USER_SUMMARY },
  inUser: { select: USER_SUMMARY },
  requestedBy: { select: USER_SUMMARY },
  reviewedBy: { select: USER_SUMMARY },
  tournament: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} as const;

const snapshotOf = (value: Prisma.JsonValue | null): SnapshotEntry[] =>
  Array.isArray(value) ? (value as SnapshotEntry[]) : [];

@Injectable()
export class RostersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly authority: TeamAuthorityService,
  ) {}

  // ── Roster view ───────────────────────────────────────────────────────

  async getRoster(teamId: string, user: User) {
    const team = await this.findManagedTeam(teamId, user);

    const [members, entries, changes] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { teamId, status: TeamMemberStatus.ACCEPTED },
        include: { user: { select: USER_SUMMARY } },
        // Seeded players share a joinedAt; id keeps the order stable across edits.
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      }),
      this.activeEntries(teamId),
      this.prisma.rosterChangeRequest.findMany({
        where: { teamId },
        include: CHANGE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      team: {
        id: team.id,
        name: team.name,
        captainId: team.captainId,
        coachId: team.coachId,
        minRosterSize: team.min_roster_size,
        maxRosterSize: team.max_roster_size,
      },
      members,
      locks: entries.map((e) => ({
        applicationId: e.id,
        tournamentId: e.tournamentId,
        tournamentName: e.tournament.name,
        tournamentStatus: e.tournament.status,
        applicationStatus: e.status,
        lockedUserIds: snapshotOf(e.rosterSnapshot)
          .map((s) => s.userId)
          .filter((id): id is string => typeof id === 'string'),
      })),
      changes,
    };
  }

  // ── Direct roster edits ───────────────────────────────────────────────

  async updateMember(
    teamId: string,
    memberId: string,
    user: User,
    dto: UpdateRosterMemberDto,
  ) {
    const team = await this.findManagedTeam(teamId, user);
    const member = await this.findMember(teamId, memberId);

    const gameHandle = dto.gameHandle?.trim();
    const updated = await this.prisma.teamMember.update({
      where: { id: memberId },
      data: {
        preferredRole:
          dto.preferredRole !== undefined
            ? dto.preferredRole.trim() || null
            : undefined,
        gameHandle,
      },
      include: { user: { select: USER_SUMMARY } },
    });

    if (gameHandle && gameHandle !== member.gameHandle) {
      await this.prisma.userGameHandle.upsert({
        where: {
          userId_gameTitle: {
            userId: member.userId,
            gameTitle: team.gameTitle,
          },
        },
        update: { handle: gameHandle },
        create: {
          userId: member.userId,
          gameTitle: team.gameTitle,
          handle: gameHandle,
        },
      });
    }

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.ROSTER_MEMBER_UPDATED,
      { memberId, userId: member.userId, ...dto },
    );

    return updated;
  }

  async removeMember(teamId: string, memberId: string, user: User) {
    const team = await this.findManagedTeam(teamId, user);
    const member = await this.findMember(teamId, memberId);

    if (member.userId === team.captainId) {
      throw new BadRequestException(
        'Hand the captaincy to another player before removing the captain.',
      );
    }

    const locked = (await this.activeEntries(teamId)).find((e) =>
      snapshotOf(e.rosterSnapshot).some((s) => s.userId === member.userId),
    );

    if (locked) {
      throw new ConflictException(
        `${member.gameHandle} is on the lineup submitted to ${locked.tournament.name}. File a last-minute roster change with a reason instead.`,
      );
    }

    await this.prisma.teamMember.delete({ where: { id: memberId } });

    // Same demotion leaveTeam applies: no roster spot anywhere → not an athlete.
    const remaining = await this.prisma.teamMember.count({
      where: { userId: member.userId, status: TeamMemberStatus.ACCEPTED },
    });
    if (remaining === 0) {
      await this.prisma.user.updateMany({
        where: { id: member.userId, role: Role.ATHLETE },
        data: { role: Role.NON_ATHLETE },
      });
    }

    await this.notificationsService.create({
      userId: member.userId,
      category: NotificationCategory.TEAM,
      type: NotificationType.ROSTER_MEMBER_REMOVED,
      title: '👋 Removed From Roster',
      message: `${user.displayName} removed you from the ${team.name} roster.`,
      link: '/dashboard',
      refId: member.id,
    });

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.ROSTER_MEMBER_REMOVED,
      { memberId, userId: member.userId, gameHandle: member.gameHandle },
    );

    return { success: true };
  }

  async transferCaptaincy(teamId: string, memberId: string, user: User) {
    const team = await this.findManagedTeam(teamId, user);
    const member = await this.findMember(teamId, memberId);

    if (member.userId === team.captainId) {
      throw new BadRequestException('That player is already the captain.');
    }

    await this.prisma.team.update({
      where: { id: teamId },
      data: { captainId: member.userId },
    });

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.CAPTAIN_TRANSFERRED,
      { from: team.captainId, to: member.userId },
    );

    return { success: true, captainId: member.userId };
  }

  // ── Last-minute changes ───────────────────────────────────────────────

  async requestChange(teamId: string, user: User, dto: CreateRosterChangeDto) {
    const team = await this.findManagedTeam(teamId, user);

    const application = await this.prisma.tournamentApplication.findFirst({
      where: { id: dto.applicationId, teamId, ...ACTIVE_ENTRY },
      include: { tournament: true },
    });

    if (!application) {
      throw new NotFoundException(
        'This team has no active tournament entry with that id.',
      );
    }

    const snapshot = snapshotOf(application.rosterSnapshot);

    if (!snapshot.some((s) => s.userId === dto.outUserId)) {
      throw new BadRequestException(
        'The outgoing player is not on the submitted lineup.',
      );
    }

    if (snapshot.some((s) => s.userId === dto.inUserId)) {
      throw new BadRequestException(
        'The incoming player is already on the submitted lineup.',
      );
    }

    const incoming = await this.prisma.teamMember.findFirst({
      where: {
        teamId,
        userId: dto.inUserId,
        status: TeamMemberStatus.ACCEPTED,
      },
    });

    if (!incoming) {
      throw new BadRequestException(
        'The incoming player must already be on the team roster.',
      );
    }

    const duplicate = await this.prisma.rosterChangeRequest.findFirst({
      where: {
        applicationId: application.id,
        outUserId: dto.outUserId,
        status: RosterChangeStatus.PENDING,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'There is already a pending change for that player in this tournament.',
      );
    }

    const change = await this.prisma.rosterChangeRequest.create({
      data: {
        applicationId: application.id,
        teamId,
        tournamentId: application.tournamentId,
        outUserId: dto.outUserId,
        inUserId: dto.inUserId,
        reason: dto.reason,
        details: dto.details.trim(),
        requestedById: user.id,
      },
      include: CHANGE_INCLUDE,
    });

    if (application.tournament.organizerId) {
      await this.notificationsService.create({
        userId: application.tournament.organizerId,
        category: NotificationCategory.TOURNAMENT,
        type: NotificationType.ROSTER_CHANGE_REQUESTED,
        title: '🔁 Last-Minute Roster Change',
        message: `${team.name} wants to swap ${change.outUser.displayName} for ${change.inUser.displayName} in ${application.tournament.name} (${REASON_LABELS[dto.reason]}).`,
        link: '/organize',
        refId: change.id,
      });
    }

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.ROSTER_CHANGE_REQUESTED,
      {
        changeId: change.id,
        tournamentId: application.tournamentId,
        reason: dto.reason,
      },
    );

    return change;
  }

  async cancelChange(teamId: string, changeId: string, user: User) {
    await this.findManagedTeam(teamId, user);
    const change = await this.prisma.rosterChangeRequest.findUnique({
      where: { id: changeId },
    });

    if (!change || change.teamId !== teamId) {
      throw new NotFoundException('Roster change not found.');
    }

    if (change.status !== RosterChangeStatus.PENDING) {
      throw new BadRequestException('Only a pending change can be cancelled.');
    }

    await this.prisma.rosterChangeRequest.update({
      where: { id: changeId },
      data: { status: RosterChangeStatus.CANCELLED },
    });

    await this.authority.record(
      user.id,
      teamId,
      TeamAuditAction.ROSTER_CHANGE_CANCELLED,
      { changeId },
    );

    return { success: true };
  }

  async listForTournament(tournamentId: string, user: User) {
    await this.assertCanReview(tournamentId, user);

    return this.prisma.rosterChangeRequest.findMany({
      where: { tournamentId },
      include: CHANGE_INCLUDE,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async reviewChange(changeId: string, user: User, dto: ReviewRosterChangeDto) {
    const change = await this.prisma.rosterChangeRequest.findUnique({
      where: { id: changeId },
      include: { ...CHANGE_INCLUDE, application: true },
    });

    if (!change) {
      throw new NotFoundException('Roster change not found.');
    }

    await this.assertCanReview(change.tournamentId, user);

    if (change.status !== RosterChangeStatus.PENDING) {
      throw new BadRequestException(
        `This change was already ${change.status.toLowerCase()}.`,
      );
    }

    const reviewData = {
      reviewedById: user.id,
      reviewNote: dto.note?.trim() || null,
      reviewedAt: new Date(),
    };

    if (!dto.approve) {
      await this.prisma.rosterChangeRequest.update({
        where: { id: changeId },
        data: { ...reviewData, status: RosterChangeStatus.REJECTED },
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        // Re-check against the current lineup: other changes may have landed
        // since this one was filed.
        const application = await tx.tournamentApplication.findUnique({
          where: { id: change.applicationId },
        });
        const snapshot = snapshotOf(application?.rosterSnapshot ?? null);
        const outIndex = snapshot.findIndex(
          (s) => s.userId === change.outUserId,
        );

        if (
          !application ||
          outIndex === -1 ||
          snapshot.some((s) => s.userId === change.inUserId)
        ) {
          throw new ConflictException(
            'The submitted lineup has changed since this request was filed.',
          );
        }

        const incoming = await tx.teamMember.findFirst({
          where: {
            teamId: change.teamId,
            userId: change.inUserId,
            status: TeamMemberStatus.ACCEPTED,
          },
          include: { user: true },
        });

        if (!incoming) {
          throw new ConflictException(
            'The incoming player is no longer on the team roster.',
          );
        }

        const outgoing = snapshot[outIndex];
        const nextSnapshot = [...snapshot];
        nextSnapshot[outIndex] = {
          userId: incoming.userId,
          displayName: incoming.user.displayName,
          gameHandle: incoming.gameHandle,
          studentId: `ID-${incoming.userId.slice(0, 8).toUpperCase()}`,
          role: incoming.preferredRole || outgoing.role || 'Substitute',
          isCaptain: false,
          eligibilityStatus:
            incoming.user.status === 'ACTIVE' ? 'ELIGIBLE' : 'ACTIVE_ATHLETE',
          substitutedFor: change.outUserId,
          substitutionReason: change.reason,
        };

        await tx.tournamentApplication.update({
          where: { id: application.id },
          data: { rosterSnapshot: nextSnapshot as Prisma.InputJsonValue },
        });

        await tx.rosterChangeRequest.update({
          where: { id: changeId },
          data: { ...reviewData, status: RosterChangeStatus.APPROVED },
        });
      });
    }

    const verdict = dto.approve ? 'approved' : 'rejected';
    const recipients = dto.approve
      ? [change.requestedById, change.outUserId, change.inUserId]
      : [change.requestedById];

    await Promise.all(
      [...new Set(recipients)].map((userId) =>
        this.notificationsService.create({
          userId,
          category: NotificationCategory.TOURNAMENT,
          type: dto.approve
            ? NotificationType.ROSTER_CHANGE_APPROVED
            : NotificationType.ROSTER_CHANGE_REJECTED,
          title: dto.approve
            ? '✅ Roster Change Approved'
            : '🚫 Roster Change Rejected',
          message: `${change.inUser.displayName} replacing ${change.outUser.displayName} for ${change.team.name} in ${change.tournament.name} was ${verdict}.${reviewData.reviewNote ? ` Note: ${reviewData.reviewNote}` : ''}`,
          link: '/dashboard',
          refId: change.id,
        }),
      ),
    );

    await this.authority.record(
      user.id,
      change.teamId,
      dto.approve
        ? TeamAuditAction.ROSTER_CHANGE_APPROVED
        : TeamAuditAction.ROSTER_CHANGE_REJECTED,
      { changeId, note: reviewData.reviewNote },
    );

    return { success: true, status: dto.approve ? 'APPROVED' : 'REJECTED' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async findManagedTeam(teamId: string, user: User) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found.');
    }
    this.authority.assertCanManageRoster(team, user);
    return team;
  }

  private async findMember(teamId: string, memberId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
    });
    if (
      !member ||
      member.teamId !== teamId ||
      member.status !== TeamMemberStatus.ACCEPTED
    ) {
      throw new NotFoundException('Roster member not found.');
    }
    return member;
  }

  private activeEntries(teamId: string) {
    return this.prisma.tournamentApplication.findMany({
      where: { teamId, ...ACTIVE_ENTRY },
      include: { tournament: { select: { name: true, status: true } } },
    });
  }

  // The tournament's organizer reviews its changes; admins can review any.
  private async assertCanReview(tournamentId: string, user: User) {
    if (user.role === Role.ADMIN) return;

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { organizerId: true },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found.');
    }

    if (tournament.organizerId !== user.id) {
      throw new ForbiddenException(
        "Only this tournament's organizer or an admin can review roster changes.",
      );
    }
  }
}
