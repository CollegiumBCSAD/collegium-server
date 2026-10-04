import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role, TeamAuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ManagedTeam {
  captainId: string | null;
  coachId: string | null;
}

// Who may act for a team on coach-tier actions, and the audit trail those
// actions leave. Shared with TournamentsService for squad registration.
@Injectable()
export class TeamAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  // Tournament registration belongs to the coach; a team without one falls
  // back to its captain.
  assertCanRegister(team: ManagedTeam, user: { id: string; role?: Role }) {
    if (user.role === Role.ADMIN) return;

    if (team.coachId) {
      if (team.coachId !== user.id) {
        throw new ForbiddenException(
          "Only this team's coach can manage its tournament registrations.",
        );
      }
      return;
    }

    if (team.captainId !== user.id) {
      throw new ForbiddenException(
        'Only the team captain can manage tournament registrations while the team has no coach.',
      );
    }
  }

  // Roster edits and last-minute changes belong to the captain and the coach.
  assertCanManageRoster(team: ManagedTeam, user: { id: string; role?: Role }) {
    if (
      user.role === Role.ADMIN ||
      team.captainId === user.id ||
      team.coachId === user.id
    ) {
      return;
    }
    throw new ForbiddenException(
      "Only this team's captain or coach can manage its roster.",
    );
  }

  async record(
    actorId: string,
    teamId: string | null,
    action: TeamAuditAction,
    details?: Prisma.InputJsonValue,
  ) {
    await this.prisma.teamAuditLog.create({
      data: { actorId, teamId, action, details },
    });
  }
}
