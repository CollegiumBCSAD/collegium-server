import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BracketFormat,
  BracketSide,
  DataSource,
  GameTitle,
  MatchMode,
  NotificationCategory,
  NotificationType,
  Prisma,
  Role,
  TournamentApplicationStatus,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { OcrService } from '../ocr/ocr.service';
import { RankingService } from '../ranking/ranking.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CloseMatchDto, ClosePlayerStatDto } from './dto/close-match.dto';
import { gamesNeededToWin, resolveSeriesWinner } from './series.util';
import {
  largestPowerOfTwoWithin,
  orderForStandardPairing,
} from './seeding.util';
import { StandingsService } from './standings.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

interface BracketMatchRow {
  id: string;
  round: number;
  bracketSide: BracketSide | null;
  winnerId: string | null;
  loserId: string | null;
  isVerified: boolean;
  slot: number | null;
}

type LosersBracketStep =
  | { type: 'seed'; consumesWbRound: number }
  | { type: 'pure' }
  | { type: 'merge'; consumesWbRound: number };

export interface TournamentApplication {
  id: string;
  tournamentId: string;
  universityId: string;
  universityName: string;
  userId: string;
  applicantName: string;
  status: TournamentApplicationStatus;
  appliedAt: Date;
  teamId?: string;
  teamName?: string;
  rosterSnapshot?: Prisma.JsonValue;
}

// Frozen copy of a squad's roster, stored on the application as JSON.
// A type alias (not an interface) so it stays assignable to Prisma's JSON input.
type RosterSnapshotEntry = {
  userId: string;
  displayName: string;
  gameHandle: string;
  studentId: string;
  role: string;
  isCaptain: boolean;
  eligibilityStatus: string;
};

type RosterTeam = Prisma.TeamGetPayload<{
  include: { captain: true; members: { include: { user: true } } };
}>;

type ApplicationRow = {
  id: string;
  tournamentId: string;
  universityId: string;
  userId: string;
  applicantName: string;
  status: TournamentApplicationStatus;
  teamId: string;
  teamName: string | null;
  rosterSnapshot?: Prisma.JsonValue;
  appliedAt: Date;
  university?: { name: string } | null;
  team?: { name: string } | null;
};

// Call of Duty: Mobile is played as a best of three - Hardpoint, then Search
// and Destroy, then Control. The other titles report a single result per match.
const SERIES_LENGTH: Record<GameTitle, number> = {
  [GameTitle.CODM]: 3,
  [GameTitle.LOL]: 1,
  [GameTitle.VALORANT]: 1,
  [GameTitle.MLBB]: 1,
};

@Injectable()
export class TournamentsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private cloudinaryService: CloudinaryService,
    private ocrService: OcrService,
    private rankingService: RankingService,
    private realtimeGateway: RealtimeGateway,
    private standingsService: StandingsService,
  ) {}

  async scanMatch(
    tournamentId: string,
    matchId: string,
    image?: Express.Multer.File,
  ) {
    if (!image) {
      throw new BadRequestException('A screenshot image is required');
    }

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    return this.ocrService.recognize(
      image.buffer,
      image.mimetype,
      image.originalname,
      match.title,
    );
  }

  private mapApplication(app: ApplicationRow): TournamentApplication {
    return {
      id: app.id,
      tournamentId: app.tournamentId,
      universityId: app.universityId,
      universityName: app.university?.name ?? 'Varsity Squad',
      userId: app.userId,
      applicantName: app.applicantName,
      status: app.status,
      appliedAt: app.appliedAt,
      teamId: app.teamId,
      teamName: app.teamName ?? app.team?.name ?? undefined,
      rosterSnapshot: app.rosterSnapshot ?? undefined,
    };
  }

  private async applicationsFor(tournamentId: string) {
    const rows = await this.prisma.tournamentApplication.findMany({
      where: { tournamentId },
      include: { university: { select: { name: true } } },
      orderBy: { appliedAt: 'asc' },
    });
    return rows.map((r) => this.mapApplication(r));
  }

  // FIND ALL — List tournaments, optionally filtered by status.
  // With no filter, hide PENDING_APPROVAL/REJECTED from the general public list.
  async findAll(status?: TournamentStatus) {
    const list = await this.prisma.tournament.findMany({
      where: status
        ? { status }
        : {
            status: {
              notIn: [
                TournamentStatus.PENDING_APPROVAL,
                TournamentStatus.REJECTED,
              ],
            },
          },
      orderBy: { createdAt: 'desc' },
      include: {
        universities: true,
        matches: true,
        applications: { include: { university: { select: { name: true } } } },
      },
    });

    return list.map((t) => ({
      ...t,
      applications: t.applications.map((a) => this.mapApplication(a)),
    }));
  }

  // FIND MINE — Organizer's own tournaments, any status (including
  // PENDING_APPROVAL/REJECTED, which findAll() hides from the public list)
  async findMine(organizerId: string) {
    const list = await this.prisma.tournament.findMany({
      where: { organizerId },
      orderBy: { createdAt: 'desc' },
      include: {
        universities: true,
        matches: true,
        applications: { include: { university: { select: { name: true } } } },
      },
    });

    return list.map((t) => ({
      ...t,
      applications: t.applications.map((a) => this.mapApplication(a)),
    }));
  }

  // FIND ONE — Tournament details including participating universities, teams, organizer, matches, and applications
  async findOne(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        universities: {
          include: {
            teams: {
              include: {
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        displayName: true,
                        role: true,
                        gameHandles: true,
                      },
                    },
                  },
                },
                captain: {
                  select: {
                    id: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        organizer: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
        matches: {
          include: {
            winner: true,
            loser: true,
          },
        },
        applications: { include: { university: { select: { name: true } } } },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return {
      ...tournament,
      applications: tournament.applications.map((a) => this.mapApplication(a)),
    };
  }

  // CREATE — Create a new tournament.
  // Organizer-created tournaments require Admin approval before going live.
  // An optional cover image is uploaded to Cloudinary server-side.
  async create(
    createTournamentDto: CreateTournamentDto,
    user: { id: string; role: Role },
    image?: Express.Multer.File,
  ) {
    const isOrganizer = user.role === Role.ORGANIZER;

    const uploaded = image
      ? await this.cloudinaryService.upload(
          image.buffer,
          'collegium/tournaments',
        )
      : null;

    return this.prisma.tournament.create({
      data: {
        name: createTournamentDto.name,
        gameTitle: createTournamentDto.gameTitle,
        bracketFormat: createTournamentDto.bracketFormat,
        playoffTeamCount: createTournamentDto.playoffTeamCount,
        teamQuota: createTournamentDto.teamQuota,
        rules: createTournamentDto.rules,
        startDate: createTournamentDto.startDate
          ? new Date(createTournamentDto.startDate)
          : undefined,
        image: uploaded?.url,
        imagePublicId: uploaded?.publicId,
        organizerId: isOrganizer ? user.id : undefined,
        status: isOrganizer
          ? TournamentStatus.PENDING_APPROVAL
          : TournamentStatus.UPCOMING,
      },
    });
  }

  // UPDATE — Organizer or Admin edits tournament details or re-applies rejected tournament
  async update(
    id: string,
    updateTournamentDto: UpdateTournamentDto,
    user: { id: string; role: Role },
    image?: Express.Multer.File,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOwner = tournament.organizerId === user.id;
    const isAdmin = user.role === Role.ADMIN;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to edit this tournament',
      );
    }

    const uploaded = image
      ? await this.cloudinaryService.upload(
          image.buffer,
          'collegium/tournaments',
        )
      : null;

    const isReapplying =
      tournament.status === TournamentStatus.REJECTED ||
      updateTournamentDto.reapply === 'true';

    const newStatus = isReapplying
      ? TournamentStatus.PENDING_APPROVAL
      : tournament.status;

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: {
        name: updateTournamentDto.name ?? tournament.name,
        gameTitle: updateTournamentDto.gameTitle ?? tournament.gameTitle,
        bracketFormat:
          updateTournamentDto.bracketFormat ?? tournament.bracketFormat,
        playoffTeamCount:
          updateTournamentDto.playoffTeamCount ?? tournament.playoffTeamCount,
        teamQuota: updateTournamentDto.teamQuota ?? tournament.teamQuota,
        rules: updateTournamentDto.rules ?? tournament.rules,
        startDate: updateTournamentDto.startDate
          ? new Date(updateTournamentDto.startDate)
          : tournament.startDate,
        image: uploaded?.url ?? tournament.image,
        imagePublicId: uploaded?.publicId ?? tournament.imagePublicId,
        status: newStatus,
        rejectionReason: isReapplying ? null : tournament.rejectionReason,
      },
    });

    if (isReapplying) {
      const admins = await this.prisma.user.findMany({
        where: { role: Role.ADMIN },
      });
      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin.id,
          category: NotificationCategory.TOURNAMENT,
          type: NotificationType.TOURNAMENT_APPROVED,
          title: '🔄 Tournament Resubmitted',
          message: `Organizer resubmitted "${updated.name}" for sanctioning review.`,
          link: '/admin/tournaments',
          refId: updated.id,
        });
      }
    }

    return updated;
  }

  // UPDATE STREAM — one official broadcast URL per tournament (not per match).
  // featuredMatchId optionally marks which match is currently on that stream.
  async updateStream(
    id: string,
    dto: UpdateStreamDto,
    user: { id: string; role: Role },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOwner = tournament.organizerId === user.id;
    const isAdmin = user.role === Role.ADMIN;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to edit this tournament stream',
      );
    }

    if (dto.featuredMatchId) {
      const match = await this.prisma.match.findFirst({
        where: { id: dto.featuredMatchId, tournamentId: id },
        select: { id: true },
      });
      if (!match) {
        throw new BadRequestException(
          'featuredMatchId must belong to this tournament',
        );
      }
    }

    return this.prisma.tournament.update({
      where: { id },
      data: {
        ...(dto.streamUrl !== undefined ? { streamUrl: dto.streamUrl } : {}),
        ...(dto.streamIsLive !== undefined
          ? { streamIsLive: dto.streamIsLive }
          : {}),
        ...(dto.featuredMatchId !== undefined
          ? { featuredMatchId: dto.featuredMatchId }
          : {}),
      },
    });
  }

  // START TOURNAMENT — Organizer or Admin starts an approved upcoming tournament
  async startTournament(id: string, user: { id: string; role: Role }) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: { universities: true, matches: true },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOwner = tournament.organizerId === user.id;
    const isAdmin = user.role === Role.ADMIN;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to start this tournament',
      );
    }

    // Only an approved (UPCOMING) tournament can start — allowing
    // PENDING_APPROVAL here bypassed admin approval via the fallback below.
    if (tournament.status !== TournamentStatus.UPCOMING) {
      throw new BadRequestException(
        `Cannot start tournament with status ${tournament.status}`,
      );
    }

    // Per-format eligibility (even count for Single/Double Elim, power-of-2
    // for Double Elim) is enforced inside generateBracket itself — don't
    // duplicate a stale even-only check here, it would silently skip bracket
    // generation for Round Robin + Playoffs, which has no such requirement.
    if (
      tournament.matches.length === 0 &&
      tournament.universities.length >= 2
    ) {
      return this.generateBracket(id);
    }

    return this.prisma.tournament.update({
      where: { id },
      data: { status: TournamentStatus.ONGOING },
    });
  }

  // UPDATE APPROVAL STATUS — Admin approves or rejects a pending tournament
  async updateApprovalStatus(
    id: string,
    status: TournamentStatus,
    reason?: string,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (
      status !== TournamentStatus.UPCOMING &&
      status !== TournamentStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Tournament status can only be set to UPCOMING (approve) or REJECTED (reject) here',
      );
    }

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === TournamentStatus.REJECTED ? reason : null,
      },
    });

    if (tournament.organizerId) {
      const approved = status === TournamentStatus.UPCOMING;
      await this.notificationsService.create({
        userId: tournament.organizerId,
        category: NotificationCategory.TOURNAMENT,
        type: approved
          ? NotificationType.TOURNAMENT_APPROVED
          : NotificationType.TOURNAMENT_REJECTED,
        title: approved ? '✅ Tournament Approved' : '🚫 Tournament Rejected',
        message: approved
          ? `Your tournament "${tournament.name}" was approved and is now live.`
          : `Your tournament "${tournament.name}" was rejected.${reason ? ` Reason: ${reason}` : ''}`,
        link: '/tournaments',
        refId: `${tournament.id}:${status}`,
      });
    }

    return updated;
  }

  // APPLY — Athlete / squad member submits application for their team.
  // "If 1 team member applies, the whole team is pending for application"
  // Strictly registers at squad/team entity level.
  async applyForTournament(
    tournamentId: string,
    user: { id: string; displayName?: string; universityId?: string },
    body?: { teamId?: string; teamName?: string },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { universities: true },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status === TournamentStatus.COMPLETED) {
      throw new BadRequestException(
        'Registration is closed for completed tournaments',
      );
    }

    if (!user.universityId) {
      throw new BadRequestException(
        'You must belong to a university to apply for a tournament',
      );
    }

    let resolvedTeamId = body?.teamId;
    let resolvedTeamName = body?.teamName;

    // If no teamId was explicitly passed, attempt to find a matching squad the user belongs to
    if (!resolvedTeamId) {
      const userTeam = await this.prisma.team.findFirst({
        where: {
          universityId: user.universityId,
          ...(tournament.gameTitle ? { gameTitle: tournament.gameTitle } : {}),
          OR: [
            { captainId: user.id },
            {
              members: {
                some: {
                  userId: user.id,
                  status: 'ACCEPTED',
                },
              },
            },
          ],
        },
        include: {
          members: {
            where: { status: 'ACCEPTED' },
            include: { user: true },
          },
          captain: true,
          university: true,
        },
      });

      if (userTeam) {
        resolvedTeamId = userTeam.id;
        resolvedTeamName = userTeam.name;
      }
    }

    if (!resolvedTeamId) {
      throw new BadRequestException(
        'No matching varsity squad found for your university and game title. Please register your squad first.',
      );
    }

    const team = await this.prisma.team.findUnique({
      where: { id: resolvedTeamId },
      include: {
        members: {
          where: { status: 'ACCEPTED' },
          include: { user: true },
        },
        captain: true,
        university: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    // Validate squad belongs to an officially recognized collegiate institution
    if (!team.universityId) {
      throw new BadRequestException(
        'Squad does not belong to an officially recognized collegiate institution',
      );
    }

    // Validate active roster slots
    const activeSlots = new Set([
      team.captainId,
      ...team.members.map((m) => m.userId),
    ]).size;

    if (activeSlots < team.min_roster_size) {
      throw new BadRequestException(
        `Squad "${team.name}" has ${activeSlots} active roster slot(s), but this tournament requires a minimum of ${team.min_roster_size} active slots.`,
      );
    }

    // Build immutable roster snapshot
    const rosterSnapshot = this.buildRosterSnapshot(team);

    // Upsert single team-level application
    const app = await this.prisma.tournamentApplication.upsert({
      where: {
        tournamentId_teamId: { tournamentId, teamId: team.id },
      },
      create: {
        tournamentId,
        universityId: team.universityId,
        userId: user.id,
        applicantName:
          user.displayName ||
          team.captain?.displayName ||
          'Athletic Representative',
        teamId: team.id,
        teamName: resolvedTeamName || team.name,
        status: TournamentApplicationStatus.PENDING,
        rosterSnapshot,
      },
      update: {
        userId: user.id,
        applicantName:
          user.displayName ||
          team.captain?.displayName ||
          'Athletic Representative',
        teamName: resolvedTeamName || team.name,
        status: TournamentApplicationStatus.PENDING,
        rosterSnapshot,
      },
      include: {
        university: { select: { name: true } },
        team: { select: { name: true } },
      },
    });

    return this.mapApplication(app);
  }

  private buildRosterSnapshot(team: RosterTeam): RosterSnapshotEntry[] {
    const members = team.members.map(
      (m, idx): RosterSnapshotEntry => ({
        userId: m.userId,
        displayName: m.user?.displayName || m.gameHandle,
        gameHandle: m.gameHandle,
        studentId: m.user?.id
          ? `ID-${m.user.id.slice(0, 8).toUpperCase()}`
          : `STU-${idx + 1}`,
        role: m.preferredRole || (idx < 5 ? 'Starter' : 'Substitute'),
        isCaptain: m.userId === team.captainId,
        eligibilityStatus:
          m.user?.status === 'ACTIVE' ? 'ELIGIBLE' : 'ACTIVE_ATHLETE',
      }),
    );

    if (!members.some((m) => m.userId === team.captainId) && team.captain) {
      members.unshift({
        userId: team.captainId,
        displayName: team.captain.displayName || 'Captain',
        gameHandle: team.captain.displayName || 'Captain',
        studentId: `ID-${team.captainId.slice(0, 8).toUpperCase()}`,
        role: 'Team Captain / Starter',
        isCaptain: true,
        eligibilityStatus: 'ELIGIBLE',
      });
    }

    return members;
  }

  // GET APPLICATION ROSTER — Standalone endpoint for viewing immutable roster snapshot
  async getApplicationRoster(tournamentId: string, applicationId: string) {
    const app = await this.findApplication(tournamentId, applicationId);
    if (!app) {
      throw new NotFoundException('Application not found');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: app.teamId },
      include: {
        captain: true,
        members: { include: { user: true } },
      },
    });

    const snapshot =
      app.rosterSnapshot &&
      Array.isArray(app.rosterSnapshot) &&
      app.rosterSnapshot.length > 0
        ? app.rosterSnapshot
        : team
          ? this.buildRosterSnapshot(team)
          : [];

    return {
      applicationId: app.id,
      tournamentId: app.tournamentId,
      teamId: app.teamId,
      teamName: app.teamName || team?.name || 'Varsity Squad',
      universityId: app.universityId,
      universityName: app.university?.name || 'Institution',
      status: app.status,
      appliedAt: app.appliedAt,
      applicantName: app.applicantName,
      roster: snapshot,
    };
  }

  // WITHDRAW / UNDO APPLICATION — Athlete cancels their squad application
  async withdrawApplication(tournamentId: string, userId: string) {
    const target = await this.prisma.tournamentApplication.findFirst({
      where: {
        tournamentId,
        OR: [
          { userId },
          {
            team: {
              OR: [{ captainId: userId }, { members: { some: { userId } } }],
            },
          },
        ],
      },
    });

    if (target) {
      await this.prisma.tournamentApplication.delete({
        where: { id: target.id },
      });

      const remainingApproved = await this.prisma.tournamentApplication.count({
        where: {
          tournamentId,
          universityId: target.universityId,
          status: TournamentApplicationStatus.APPROVED,
        },
      });

      if (remainingApproved === 0) {
        await this.prisma.tournament.update({
          where: { id: tournamentId },
          data: { universities: { disconnect: { id: target.universityId } } },
        });
      }
    }

    return { success: true, message: 'Application withdrawn successfully' };
  }

  // GET APPLICATIONS — List applications for a tournament
  getApplications(tournamentId: string) {
    return this.applicationsFor(tournamentId);
  }

  // GET ALL PENDING APPLICATIONS — Admin-wide view across every tournament
  async getAllPendingApplications() {
    const rows = await this.prisma.tournamentApplication.findMany({
      where: { status: TournamentApplicationStatus.PENDING },
      include: {
        university: { select: { name: true } },
        team: { select: { name: true } },
        tournament: { select: { name: true, gameTitle: true } },
      },
      orderBy: { appliedAt: 'asc' },
    });

    return rows.map((row) => ({
      ...this.mapApplication(row),
      tournamentName: row.tournament?.name ?? 'Unknown Tournament',
      gameTitle: row.tournament?.gameTitle ?? null,
    }));
  }

  private async findApplication(tournamentId: string, applicationId: string) {
    const byId = await this.prisma.tournamentApplication.findFirst({
      where: { id: applicationId, tournamentId },
      include: {
        university: { select: { name: true } },
        team: { select: { name: true } },
      },
    });
    if (byId) return byId;

    return this.prisma.tournamentApplication.findFirst({
      where: {
        tournamentId,
        OR: [{ universityId: applicationId }, { teamId: applicationId }],
      },
      include: {
        university: { select: { name: true } },
        team: { select: { name: true } },
      },
    });
  }

  // APPROVE APPLICATION — Organizer sanctions squad application
  async approveApplication(tournamentId: string, applicationId: string) {
    const target = await this.findApplication(tournamentId, applicationId);

    if (!target) {
      throw new NotFoundException('Application not found');
    }

    const rivalSquad = await this.prisma.tournamentApplication.findFirst({
      where: {
        tournamentId,
        universityId: target.universityId,
        status: TournamentApplicationStatus.APPROVED,
        id: { not: target.id },
      },
    });
    if (rivalSquad) {
      throw new BadRequestException(
        'This university already has an approved squad in this tournament',
      );
    }

    await this.prisma.tournamentApplication.update({
      where: { id: target.id },
      data: { status: TournamentApplicationStatus.APPROVED },
    });

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { universities: { connect: { id: target.universityId } } },
    });

    const updated = await this.findApplication(tournamentId, applicationId);
    return this.mapApplication(updated || target);
  }

  // REJECT APPLICATION — Organizer declines squad application
  async rejectApplication(tournamentId: string, applicationId: string) {
    const target = await this.findApplication(tournamentId, applicationId);

    if (!target) {
      throw new NotFoundException('Application not found');
    }

    await this.prisma.tournamentApplication.update({
      where: { id: target.id },
      data: { status: TournamentApplicationStatus.REJECTED },
    });

    const remainingApproved = await this.prisma.tournamentApplication.count({
      where: {
        tournamentId,
        universityId: target.universityId,
        status: TournamentApplicationStatus.APPROVED,
      },
    });

    if (remainingApproved === 0) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { universities: { disconnect: { id: target.universityId } } },
      });
    }

    const updated = await this.findApplication(tournamentId, applicationId);
    return this.mapApplication(updated || target);
  }

  // REGISTER — Register a university for a tournament directly (Legacy/Admin)
  async registerUniversity(tournamentId: string, universityId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { universities: true },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.UPCOMING) {
      throw new BadRequestException(
        'Registration is only allowed for UPCOMING tournaments',
      );
    }

    const alreadyConnected =
      tournament.universities?.some((u) => u.id === universityId) ?? false;

    if (!alreadyConnected && universityId) {
      return this.prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          universities: {
            connect: { id: universityId },
          },
        },
        include: {
          universities: true,
        },
      });
    }

    return tournament;
  }

  // GENERATE BRACKET — Seed the tournament's matches according to its bracketFormat.
  // "Single Elimination" is the default when bracketFormat is unset/unrecognized.
  async generateBracket(
    tournamentId: string,
    options: { randomize?: boolean } = {},
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { universities: true },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.UPCOMING) {
      throw new BadRequestException(
        'Bracket can only be generated for UPCOMING tournaments',
      );
    }

    const universities = tournament.universities;

    if (universities.length < 2) {
      throw new BadRequestException(
        'At least 2 universities must be registered before generating a bracket',
      );
    }

    await this.seedBracketMatches(
      tournament,
      universities,
      options.randomize === true,
    );

    // Move tournament to ONGOING now that the bracket is seeded
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.ONGOING },
    });

    return this.getBracket(tournamentId);
  }

  // RANDOMIZE BRACKET - Admin or the owning organizer redraws the round 1
  // pairings at random. Only legal while round 1 is still undecided: once a
  // real result has been reported the rest of the tree is partly determined,
  // and a redraw would silently throw that result away.
  async randomizeBracket(
    tournamentId: string,
    user: { id: string; role: Role },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        universities: true,
        matches: {
          select: {
            round: true,
            isVerified: true,
            winnerId: true,
            loserId: true,
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.organizerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'You do not have permission to randomize this bracket',
      );
    }

    if (tournament.matches.length === 0) {
      throw new BadRequestException(
        'Generate the bracket before randomizing it',
      );
    }

    if (
      tournament.bracketFormat === BracketFormat.ROUND_ROBIN ||
      tournament.bracketFormat === BracketFormat.TWO_STAGE
    ) {
      throw new BadRequestException(
        'Round robin formats have no random draw - every university plays every other university',
      );
    }

    // A bye is created already-verified and has no opponent, so it is not a
    // reported result and must not lock the draw. Anything filled in past
    // round 1 means round 1 has already resolved.
    const hasReportedResult = tournament.matches.some(
      (m) => m.isVerified && m.loserId !== null,
    );
    const hasAdvanced = tournament.matches.some(
      (m) => m.round > 1 && m.winnerId !== null,
    );

    if (hasReportedResult || hasAdvanced) {
      throw new BadRequestException(
        'The bracket can no longer be randomized - a round 1 result has already been reported',
      );
    }

    await this.prisma.playerStat.deleteMany({
      where: { match: { tournamentId } },
    });
    await this.prisma.match.deleteMany({ where: { tournamentId } });

    await this.seedBracketMatches(tournament, tournament.universities, true);

    return this.getBracket(tournamentId);
  }

  // Seeds a tournament's opening matches for its format. Shared by bracket
  // generation and the organizer's redraw so both produce the same shape.
  private async seedBracketMatches(
    tournament: {
      id: string;
      bracketFormat: BracketFormat | null;
      gameTitle: GameTitle | null;
    },
    universities: { id: string }[],
    randomize: boolean,
  ) {
    if (
      tournament.bracketFormat === BracketFormat.ROUND_ROBIN ||
      tournament.bracketFormat === BracketFormat.TWO_STAGE
    ) {
      await this.generateRoundRobinStage(
        tournament.id,
        tournament.gameTitle,
        universities,
      );
      return;
    }

    if (tournament.bracketFormat === BracketFormat.DOUBLE_ELIM) {
      await this.generateDoubleEliminationRound1(
        tournament.id,
        tournament.gameTitle,
        universities,
      );
      return;
    }

    // Single Elimination: rating-seeded by default, or a blind random draw
    // when the organizer asks for one.
    const seeded = randomize
      ? this.shuffle(universities).map((u) => u.id)
      : await this.seedByRating(universities, tournament.gameTitle);

    await this.prisma.match.createMany({
      data: this.buildEliminationSkeleton(
        tournament.id,
        tournament.gameTitle,
        seeded,
        null,
      ),
    });
  }

  // GET BRACKET — Fetch tournament with all matches, ordered so the frontend
  // can group them into rounds/bracket sides without re-deriving order itself.
  async getBracket(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            playerStats: true,
          },
          // slot is the authoritative left-to-right position inside a
          // round; playedAt only breaks ties for pre-slot legacy matches.
          orderBy: [{ round: 'asc' }, { slot: 'asc' }, { playedAt: 'asc' }],
        },
        universities: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return tournament;
  }

  // --- Bracket generation & advancement helpers -----------------------------

  private isPowerOfTwo(n: number) {
    return n >= 4 && (n & (n - 1)) === 0;
  }

  private nextPowerOfTwo(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  private shuffle<T>(list: T[]): T[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Seed strongest-first by Glicko-2 rating; unrated default to 1500, ties random.
  private async seedByRating(
    universities: { id: string }[],
    gameTitle: GameTitle | null,
  ): Promise<string[]> {
    const teams = gameTitle
      ? await this.prisma.team.findMany({
          where: {
            gameTitle,
            universityId: { in: universities.map((u) => u.id) },
          },
          select: { universityId: true, glicko2_rating: true },
        })
      : [];
    const byId = new Map(teams.map((t) => [t.universityId, t.glicko2_rating]));
    return universities
      .map((u) => ({
        id: u.id,
        rating: byId.get(u.id) ?? 1500,
        rand: Math.random(),
      }))
      .sort((a, b) => b.rating - a.rating || a.rand - b.rand)
      .map((u) => u.id);
  }

  // Builds the ENTIRE elimination tree in one go, not just round 1. Round 1
  // pads the field to the next power of 2 with byes (top seeds get a
  // pre-verified bye match - no opponent, no rating change) and pairs the rest
  // strongest-vs-weakest; every later round is created up front as empty
  // placeholder matches that advancement fills in positionally, slot N and
  // slot N+1 of a round feeding slot floor(N/2) of the next.
  //
  // Creating the whole tree is what makes an 8-team bracket render as
  // Round 1 -> Semifinals -> Grand Finals the moment it is generated, instead
  // of one lonely round that only sprouts the next once every result is in.
  private buildEliminationSkeleton(
    tournamentId: string,
    gameTitle: GameTitle | null,
    seeded: string[],
    bracketSide: BracketSide | null,
  ) {
    const bracketSize = this.nextPowerOfTwo(seeded.length);
    const byeCount = bracketSize - seeded.length;
    const byeTeams = seeded.slice(0, byeCount);
    const playing = seeded.slice(byeCount);

    const rows = byeTeams.map((t, i) =>
      this.matchRow(tournamentId, gameTitle, t, null, 1, bracketSide, i, true),
    );
    for (let i = 0; i < playing.length / 2; i++) {
      rows.push(
        this.matchRow(
          tournamentId,
          gameTitle,
          playing[i],
          playing[playing.length - 1 - i],
          1,
          bracketSide,
          byeCount + i,
          false,
        ),
      );
    }

    // Placeholder rounds - both sides stay null until the feeding round
    // resolves, so the bracket can be drawn in full with TBD slots.
    for (
      let round = 2, slots = bracketSize / 4;
      slots >= 1;
      round++, slots /= 2
    ) {
      for (let slot = 0; slot < slots; slot++) {
        rows.push(
          this.matchRow(
            tournamentId,
            gameTitle,
            null,
            null,
            round,
            bracketSide,
            slot,
          ),
        );
      }
    }

    return rows;
  }

  private pairUp<T>(list: T[]): [T, T][] {
    const pairs: [T, T][] = [];
    for (let i = 0; i < list.length; i += 2) {
      pairs.push([list[i], list[i + 1]]);
    }
    return pairs;
  }

  private matchRow(
    tournamentId: string,
    gameTitle: GameTitle | null,
    winnerId: string | null,
    loserId: string | null,
    round: number,
    bracketSide: BracketSide | null,
    slot: number,
    isVerified = false,
  ) {
    return {
      // The match's own title is what the OCR scan is parsed as, so a
      // VALORANT tournament must not stamp its matches LOL. Titleless
      // tournaments are legacy rows; LOL is their historical default.
      title: gameTitle ?? GameTitle.LOL,
      matchMode: MatchMode.TOURNAMENT,
      tournamentId,
      gameDuration: 0,
      gameMode: 'CLASSIC',
      platformId: 'PH',
      winnerId: winnerId ?? undefined,
      loserId: loserId ?? undefined,
      isVerified,
      round,
      bestOf: SERIES_LENGTH[gameTitle ?? GameTitle.LOL],
      bracketSide: bracketSide ?? undefined,
      slot,
    };
  }

  // Pairs up a flat contestant list (winnerId/loserId are placeholder pairing
  // slots, not a real result, exactly like the original generateBracket) into
  // matches for one round/bracket side.
  private async createRound(
    tournamentId: string,
    gameTitle: GameTitle | null,
    contestantIds: string[],
    round: number,
    bracketSide: BracketSide | null,
  ) {
    const pairs = this.pairUp(contestantIds);
    await this.prisma.match.createMany({
      data: pairs.map(([a, b], slot) =>
        this.matchRow(tournamentId, gameTitle, a, b, round, bracketSide, slot),
      ),
    });
  }

  // ROUND ROBIN — every university plays every other university once, all at round 0.
  private async generateRoundRobinStage(
    tournamentId: string,
    gameTitle: GameTitle | null,
    universities: { id: string }[],
  ) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < universities.length; i++) {
      for (let j = i + 1; j < universities.length; j++) {
        pairs.push([universities[i].id, universities[j].id]);
      }
    }

    await this.prisma.match.createMany({
      data: pairs.map(([a, b], slot) =>
        this.matchRow(tournamentId, gameTitle, a, b, 0, null, slot),
      ),
    });
  }

  // ROUND ROBIN ONLY — no elimination stage at all. The tournament ends when
  // every pairing has been played, and the top of the standings table takes
  // the title.
  private async advanceRoundRobin(
    tournamentId: string,
    matches: BracketMatchRow[],
  ) {
    if (!matches.every((m) => m.isVerified)) return;

    const standings = await this.standingsService.computeStandings(
      tournamentId,
    );
    await this.completeTournament(
      tournamentId,
      standings[0]?.universityId ?? null,
    );
  }

  // ROUND ROBIN + PLAYOFFS — a group stage at round 0 feeding a
  // double-elimination playoff bracket at rounds 1+.
  private async advanceTwoStage(
    tournamentId: string,
    gameTitle: GameTitle | null,
    playoffTeamCount: number | null,
    matches: BracketMatchRow[],
  ) {
    const group = matches.filter((m) => m.round === 0);
    if (group.length > 0 && !group.every((m) => m.isVerified)) return;

    const playoffs = matches.filter((m) => m.round > 0);
    if (playoffs.length === 0) {
      await this.seedPlayoffs(tournamentId, gameTitle, playoffTeamCount);
      return;
    }

    await this.advanceDoubleElimination(tournamentId, gameTitle, playoffs);
  }

  private async completeTournament(
    tournamentId: string,
    championUniversityId: string | null,
  ) {
    if (championUniversityId) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { championUniversityId },
      });
    }
    await this.rankingService.closeTournamentRatingPeriod(tournamentId);
  }

  // Once every round-0 match is verified, seed a double-elimination playoff
  // bracket from the group standings, paired 1v8/4v5/2v7/3v6 so the top seeds
  // can only meet late.
  private async seedPlayoffs(
    tournamentId: string,
    gameTitle: GameTitle | null,
    playoffTeamCount: number | null,
  ) {
    const standings = await this.standingsService.computeStandings(
      tournamentId,
    );
    const ranked = standings.map((row) => row.universityId);

    const requested = playoffTeamCount ?? ranked.length;
    const bracketSize = largestPowerOfTwoWithin(
      Math.min(requested, ranked.length),
    );

    if (bracketSize < 4) return;

    await this.createRound(
      tournamentId,
      gameTitle,
      orderForStandardPairing(ranked.slice(0, bracketSize)),
      1,
      BracketSide.WINNERS,
    );
  }

  // DOUBLE ELIMINATION — winners-bracket round 1. Requires a power-of-2 field
  // (>=4) so the losers-bracket schedule below divides evenly at every step.
  private async generateDoubleEliminationRound1(
    tournamentId: string,
    gameTitle: GameTitle | null,
    universities: { id: string }[],
  ) {
    if (!this.isPowerOfTwo(universities.length)) {
      throw new BadRequestException(
        'Double Elimination requires a number of registered universities that is a power of 2, 4 or more (4, 8, 16...)',
      );
    }

    await this.createRound(
      tournamentId,
      gameTitle,
      this.shuffle(universities).map((u) => u.id),
      1,
      BracketSide.WINNERS,
    );
  }

  // Standard double-elimination losers-bracket schedule for k winners-bracket
  // rounds: LB round 1 seeds directly from WB round 1's losers, then
  // alternates a "pure" survivor-vs-survivor round with a "merge" round that
  // pulls in each subsequent WB round's losers, ending with the LB final that
  // feeds the grand final.
  private losersBracketSchedule(wbRounds: number): LosersBracketStep[] {
    const schedule: LosersBracketStep[] = [
      { type: 'seed', consumesWbRound: 1 },
    ];
    for (let r = 2; r <= wbRounds; r++) {
      if (r > 2) schedule.push({ type: 'pure' });
      schedule.push({ type: 'merge', consumesWbRound: r });
    }
    return schedule;
  }

  // Called after every match close — advances whichever bracket(s) have just
  // had their current round/stage fully verified. Idempotent: every branch
  // only creates a round once its inputs are ready and it doesn't already exist.
  private async tryAdvanceBracket(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        status: true,
        bracketFormat: true,
        gameTitle: true,
        playoffTeamCount: true,
      },
    });

    if (!tournament || tournament.status !== TournamentStatus.ONGOING) return;

    const matches = await this.prisma.match.findMany({
      where: { tournamentId },
      select: {
        id: true,
        round: true,
        bracketSide: true,
        winnerId: true,
        loserId: true,
        isVerified: true,
        slot: true,
      },
    });

    if (matches.length === 0) return;

    if (tournament.bracketFormat === BracketFormat.DOUBLE_ELIM) {
      await this.advanceDoubleElimination(
        tournamentId,
        tournament.gameTitle,
        matches,
      );
    } else if (tournament.bracketFormat === BracketFormat.ROUND_ROBIN) {
      await this.advanceRoundRobin(tournamentId, matches);
    } else if (tournament.bracketFormat === BracketFormat.TWO_STAGE) {
      await this.advanceTwoStage(
        tournamentId,
        tournament.gameTitle,
        tournament.playoffTeamCount,
        matches,
      );
    } else {
      await this.advanceEliminationLike(
        tournamentId,
        tournament.gameTitle,
        matches,
      );
    }
  }

  // Drives both plain Single Elimination and the playoff portion of Round
  // Robin + Playoffs (round 0 is the round-robin group stage; once it's fully
  // verified this seeds the single-elim playoff bracket from standings).
  private async advanceEliminationLike(
    tournamentId: string,
    gameTitle: GameTitle | null,
    matches: BracketMatchRow[],
  ) {
    const bySlot = (a: BracketMatchRow, b: BracketMatchRow) =>
      (a.slot ?? 0) - (b.slot ?? 0);
    const rounds = [...new Set(matches.map((m) => m.round))].sort(
      (a, b) => a - b,
    );

    // Round 0 is the Round Robin + Playoffs group stage. Once every group
    // match is verified it seeds the playoff tree - but only once, or a later
    // close would re-seed playoffs that are already under way.

    // Walk the tree from the bottom up and act on the first unresolved round.
    for (const round of rounds.filter((r) => r > 0)) {
      const current = matches.filter((m) => m.round === round).sort(bySlot);
      if (!current.every((m) => m.isVerified)) return;

      const next = matches.filter((m) => m.round === round + 1).sort(bySlot);

      if (next.length === 0) {
        const winners = current
          .map((m) => m.winnerId)
          .filter((id): id is string => !!id);

        if (winners.length <= 1) {
          // Championship Guard: All matches in the active tournament bracket must be verified
          // before closing the rating period or crowning a champion.
          const unverified = matches.filter((m) => !m.isVerified);
          if (unverified.length > 0) {
            return;
          }
          await this.completeTournament(tournamentId, winners[0] ?? null);
          return;
        }

        // A bracket generated before the full tree was pre-created still has
        // to grow a round at a time - keep those tournaments advancing.
        await this.createRound(
          tournamentId,
          gameTitle,
          winners,
          round + 1,
          null,
        );
        return;
      }

      // The next round already exists as placeholders: fill it positionally,
      // slots 2i and 2i+1 of this round deciding slot i of the next. An
      // already-filled round means this one is old news - keep walking down.
      const pending = next.filter((m) => !m.winnerId && !m.loserId);
      if (pending.length === 0) continue;

      for (const target of pending) {
        const slot = target.slot ?? next.indexOf(target);
        const a = current[slot * 2];
        const b = current[slot * 2 + 1];
        if (!a?.winnerId || !b?.winnerId) continue;

        await this.prisma.match.update({
          where: { id: target.id },
          data: { winnerId: a.winnerId, loserId: b.winnerId },
        });
      }
      return;
    }
  }

  private async advanceDoubleElimination(
    tournamentId: string,
    gameTitle: GameTitle | null,
    matches: BracketMatchRow[],
  ) {
    const wb = matches.filter((m) => m.bracketSide === BracketSide.WINNERS);
    const lb = matches.filter((m) => m.bracketSide === BracketSide.LOSERS);
    const gf = matches.filter((m) => m.bracketSide === BracketSide.GRAND_FINAL);
    const wbByRound = (r: number) => wb.filter((m) => m.round === r);

    // 1. Advance the winners bracket; capture its champion once it's down to one.
    const wbRoundsCount = Math.max(...wb.map((m) => m.round));
    const currentWb = wbByRound(wbRoundsCount);
    let wbChampion: string | null = null;

    if (currentWb.every((m) => m.isVerified)) {
      const winners = currentWb
        .map((m) => m.winnerId)
        .filter((id): id is string => !!id);
      if (winners.length > 1) {
        await this.createRound(
          tournamentId,
          gameTitle,
          winners,
          wbRoundsCount + 1,
          BracketSide.WINNERS,
        );
      } else {
        wbChampion = winners[0] ?? null;
      }
    }

    // 2. Advance the losers bracket per the precomputed schedule.
    const schedule = this.losersBracketSchedule(wbRoundsCount);
    const lbRoundsDone = Math.max(0, ...lb.map((m) => m.round));
    let lbChampion: string | null = null;

    if (lbRoundsDone >= schedule.length) {
      const finalLb = lb.filter((m) => m.round === lbRoundsDone);
      if (finalLb.length === 1 && finalLb.every((m) => m.isVerified)) {
        lbChampion = finalLb[0].winnerId;
      }
    } else {
      const step = schedule[lbRoundsDone];
      const nextRound = lbRoundsDone + 1;

      if (step.type === 'seed') {
        const wbSource = wbByRound(step.consumesWbRound);
        if (wbSource.length > 0 && wbSource.every((m) => m.isVerified)) {
          const losers = wbSource
            .map((m) => m.loserId)
            .filter((id): id is string => !!id);
          if (losers.length > 1) {
            await this.createRound(
              tournamentId,
              gameTitle,
              losers,
              nextRound,
              BracketSide.LOSERS,
            );
          }
        }
      } else {
        const prevLb = lb.filter((m) => m.round === lbRoundsDone);
        if (prevLb.length > 0 && prevLb.every((m) => m.isVerified)) {
          const survivors = prevLb
            .map((m) => m.winnerId)
            .filter((id): id is string => !!id);

          if (step.type === 'pure') {
            if (survivors.length > 1) {
              await this.createRound(
                tournamentId,
                gameTitle,
                survivors,
                nextRound,
                BracketSide.LOSERS,
              );
            }
          } else {
            const wbSource = wbByRound(step.consumesWbRound);
            if (wbSource.length > 0 && wbSource.every((m) => m.isVerified)) {
              const newLosers = wbSource
                .map((m) => m.loserId)
                .filter((id): id is string => !!id);
              if (
                survivors.length === newLosers.length &&
                survivors.length > 0
              ) {
                const pairs = survivors.map(
                  (s, i) => [s, newLosers[i]] as [string, string],
                );
                await this.prisma.match.createMany({
                  data: pairs.map(([a, b], slot) =>
                    this.matchRow(
                      tournamentId,
                      gameTitle,
                      a,
                      b,
                      nextRound,
                      BracketSide.LOSERS,
                      slot,
                    ),
                  ),
                });
              }
            }
          }
        }
      }
    }

    // 3. Once both champions exist, create the grand final; once it's
    // verified, the tournament is over.
    if (wbChampion && lbChampion && gf.length === 0) {
      await this.createRound(
        tournamentId,
        gameTitle,
        [wbChampion, lbChampion],
        wbRoundsCount + 1,
        BracketSide.GRAND_FINAL,
      );
      return;
    }

    if (gf.length === 0 || !gf.every((m) => m.isVerified)) return;

    const decider = gf.reduce((a, b) => (a.round >= b.round ? a : b));

    // A grand final won by the losers-bracket side leaves both teams on one
    // loss, so it decides nothing - the bracket resets for a decider. Only a
    // winners-bracket-side win, or a second grand final, ends the tournament.
    if (gf.length === 1 && wbChampion && decider.winnerId !== wbChampion) {
      await this.createRound(
        tournamentId,
        gameTitle,
        [wbChampion, decider.winnerId!],
        decider.round + 1,
        BracketSide.GRAND_FINAL,
      );
      return;
    }

    await this.completeTournament(tournamentId, decider.winnerId);
  }

  // CLOSE MATCH — Admin/Organizer manually reports the winner and per-player
  // stats for a match (no Riot API involved), verifying it and running ratings.
  private playerStatRow(
    player: ClosePlayerStatDto,
    matchId: string,
    winningUniversityId: string,
    matchGameId?: string,
  ) {
    return {
      matchId,
      matchGameId,
      universityId: player.universityId,
      userId: player.userId,
      summonerName: player.name,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      win: player.universityId === winningUniversityId,
      dataSource: DataSource.PEER_VERIFIED,
      ...(player.extra !== undefined
        ? { extraStats: player.extra as Prisma.InputJsonValue }
        : {}),
    };
  }

  async closeMatch(tournamentId: string, matchId: string, dto: CloseMatchDto) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (match.isVerified) {
      throw new BadRequestException('This match is already closed');
    }

    // The two universities paired into this match at bracket-generation time
    // are the only valid winner/player sides — winnerId/loserId here are
    // still just the pairing slots until this call assigns the real result.
    const contestants = [match.winnerId, match.loserId].filter(
      (id): id is string => !!id,
    );

    const games = dto.games ?? [];
    const matchPlayers = dto.players ?? [];

    if (games.length === 0 && matchPlayers.length === 0) {
      throw new BadRequestException(
        'Report either per-map results or player stats for this match',
      );
    }

    if (new Set(games.map((game) => game.gameNumber)).size !== games.length) {
      throw new BadRequestException('Each map must have a distinct gameNumber');
    }

    if (games.length > match.bestOf) {
      throw new BadRequestException(
        `This match is a best of ${match.bestOf}, but ${games.length} maps were reported`,
      );
    }

    for (const game of games) {
      if (!contestants.includes(game.winnerId)) {
        throw new BadRequestException(
          `Map ${game.gameNumber} winner ${game.winnerId} is not one of the two universities in this match`,
        );
      }
    }

    const seriesWinnerId = games.length
      ? resolveSeriesWinner(games, match.bestOf)
      : (dto.winnerId ?? null);

    if (!seriesWinnerId) {
      throw new BadRequestException(
        games.length
          ? `This series is undecided - no university has won ${gamesNeededToWin(match.bestOf)} of ${match.bestOf} maps`
          : 'winnerId is required when no per-map results are reported',
      );
    }

    if (!contestants.includes(seriesWinnerId)) {
      throw new BadRequestException(
        'winnerId must be one of the two universities in this match',
      );
    }

    if (dto.winnerId && dto.winnerId !== seriesWinnerId) {
      throw new BadRequestException(
        'The reported winner does not match the per-map results',
      );
    }

    const loserId = contestants.find((id) => id !== seriesWinnerId)!;

    const allPlayers = [
      ...matchPlayers,
      ...games.flatMap((game) => game.players ?? []),
    ];
    for (const player of allPlayers) {
      if (!contestants.includes(player.universityId)) {
        throw new BadRequestException(
          `Player university ${player.universityId} is not one of the two universities in this match`,
        );
      }
    }

    // Claim and stat insert share one transaction: the claim flips isVerified
    // false->true so only one concurrent close can write stats, and rolling it
    // back on a failed insert is what stops a match getting stranded as
    // "already closed" with no box score to show for it.
    const closed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.match.updateMany({
        where: { id: matchId, tournamentId, isVerified: false },
        data: { isVerified: true },
      });
      if (claim.count === 0) {
        throw new BadRequestException('This match is already closed');
      }

      // Ratings are NOT updated here; the rating pipeline is an event-driven
      // batch update at tournament closure.
      for (const game of games) {
        const created = await tx.matchGame.create({
          data: {
            matchId,
            gameNumber: game.gameNumber,
            mode: game.mode,
            winnerId: game.winnerId,
            loserId: contestants.find((id) => id !== game.winnerId)!,
            winnerScore: game.winnerScore,
            loserScore: game.loserScore,
          },
        });

        if (game.players?.length) {
          await tx.playerStat.createMany({
            data: game.players.map((player) =>
              this.playerStatRow(player, matchId, game.winnerId, created.id),
            ),
          });
        }
      }

      if (matchPlayers.length) {
        await tx.playerStat.createMany({
          data: matchPlayers.map((player) =>
            this.playerStatRow(player, matchId, seriesWinnerId),
          ),
        });
      }

      return tx.match.update({
        where: { id: matchId },
        data: { winnerId: seriesWinnerId, loserId, isVerified: true },
      });
    });

    await this.tryAdvanceBracket(tournamentId);

    return closed;
  }

  // FORFEIT MATCH — Dedicated 2-step forfeit action
  // Advances the non-forfeiting opponent strictly to immediate next round.
  // Zero stat attribution (no PlayerStat rows written).
  // Championship guard ensures early/mid-bracket forfeit does not crown champion.
  async forfeitMatch(
    tournamentId: string,
    matchId: string,
    forfeitingUniversityId: string,
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (match.isVerified) {
      throw new BadRequestException('This match is already closed');
    }

    const contestants = [match.winnerId, match.loserId].filter(
      (id): id is string => !!id,
    );

    if (!contestants.includes(forfeitingUniversityId)) {
      throw new BadRequestException(
        'forfeitingUniversityId must be one of the two universities in this match',
      );
    }

    const advancingWinnerId = contestants.find(
      (id) => id !== forfeitingUniversityId,
    )!;

    const closed = await this.prisma.match.update({
      where: { id: matchId },
      data: {
        winnerId: advancingWinnerId,
        loserId: forfeitingUniversityId,
        isVerified: true,
        isForfeit: true,
        forfeitingTeamId: forfeitingUniversityId,
      },
    });

    // Advance non-forfeiting winner strictly to the immediate next round
    await this.tryAdvanceBracket(tournamentId);

    return closed;
  }

  // UPDATE MATCH STATS — Post-bracket retroactive correction
  // Organizers can reopen and edit OCR-parsed stats after bracket advancement.
  // Updates PlayerStat asynchronously without resetting bracket state.
  // Winner change is guarded if downstream bracket matches have started.
  async updateMatchStats(
    tournamentId: string,
    matchId: string,
    dto: {
      winnerId?: string;
      gameDuration?: number;
      players: Array<{
        userId?: string;
        universityId: string;
        name: string;
        kills: number;
        deaths: number;
        assists: number;
        combatScore?: number;
        headshotPct?: number;
        agentName?: string;
        extra?: Record<string, any>;
      }>;
    },
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
      include: { playerStats: true },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (!match.isVerified) {
      throw new BadRequestException(
        'Cannot edit stats on an unverified match. Please close the match first.',
      );
    }

    // Check if winner change is requested
    if (dto.winnerId && dto.winnerId !== match.winnerId) {
      const nextRound = match.round + 1;
      const nextSlot = match.slot !== null ? Math.floor(match.slot / 2) : null;
      const downstreamMatch = await this.prisma.match.findFirst({
        where: {
          tournamentId,
          round: nextRound,
          ...(nextSlot !== null ? { slot: nextSlot } : {}),
        },
      });

      if (downstreamMatch && downstreamMatch.isVerified) {
        throw new BadRequestException(
          'Cannot change match winner retroactively: the downstream bracket match has already been completed.',
        );
      }

      const contestants = [match.winnerId, match.loserId].filter(
        (id): id is string => !!id,
      );
      if (!contestants.includes(dto.winnerId)) {
        throw new BadRequestException(
          'winnerId must be one of the two universities in this match',
        );
      }
      const newLoserId = contestants.find((id) => id !== dto.winnerId)!;

      await this.prisma.match.update({
        where: { id: matchId },
        data: { winnerId: dto.winnerId, loserId: newLoserId },
      });

      // Update downstream slot if present and pending
      if (downstreamMatch) {
        await this.prisma.match.update({
          where: { id: downstreamMatch.id },
          data: {
            winnerId:
              downstreamMatch.winnerId === match.winnerId
                ? dto.winnerId
                : downstreamMatch.winnerId,
            loserId:
              downstreamMatch.loserId === match.winnerId
                ? dto.winnerId
                : downstreamMatch.loserId,
          },
        });
      }
    }

    if (dto.gameDuration !== undefined) {
      await this.prisma.match.update({
        where: { id: matchId },
        data: { gameDuration: dto.gameDuration },
      });
    }

    // Replace stats cleanly
    await this.prisma.$transaction(async (tx) => {
      await tx.valorantPlayerStat.deleteMany({
        where: { playerStat: { matchId } },
      });
      await tx.playerStat.deleteMany({
        where: { matchId },
      });

      const effectiveWinnerId = dto.winnerId || match.winnerId;

      for (const p of dto.players) {
        const created = await tx.playerStat.create({
          data: {
            matchId,
            universityId: p.universityId,
            userId: p.userId,
            summonerName: p.name,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            win: p.universityId === effectiveWinnerId,
            dataSource: DataSource.PEER_VERIFIED,
            ...(p.extra !== undefined
              ? { extraStats: p.extra as Prisma.InputJsonValue }
              : {}),
          },
        });

        if (
          p.combatScore !== undefined ||
          p.headshotPct !== undefined ||
          p.agentName
        ) {
          await tx.valorantPlayerStat.create({
            data: {
              playerStatId: created.id,
              agentName: p.agentName,
              combatScore: p.combatScore,
              headshotPct: p.headshotPct,
            },
          });
        }
      }
    });

    return this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        playerStats: {
          include: { valorantStat: true },
        },
      },
    });
  }

  // TOURNAMENT GLOBAL CHANNEL MESSAGES
  // Only athletes on a team APPROVED into this tournament, or the
  // organizer/an admin, may read or post in its global channel — the
  // channel is a per-tournament space for participants, not a public forum.
  private async findTournamentParticipation(
    tournamentId: string,
    userId: string,
  ) {
    return this.prisma.tournamentApplication.findFirst({
      where: {
        tournamentId,
        status: TournamentApplicationStatus.APPROVED,
        OR: [
          { userId },
          {
            team: {
              OR: [{ captainId: userId }, { members: { some: { userId } } }],
            },
          },
        ],
      },
    });
  }

  async getTournamentMessages(
    tournamentId: string,
    user: { id: string; role?: string },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOrganizer =
      tournament.organizerId === user.id ||
      user.role === Role.ORGANIZER ||
      user.role === Role.ADMIN;

    if (!isOrganizer) {
      const participation = await this.findTournamentParticipation(
        tournamentId,
        user.id,
      );
      if (!participation) {
        throw new ForbiddenException(
          'Only athletes on a team participating in this tournament can view its global channel.',
        );
      }
    }

    return this.prisma.tournamentChatMessage.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTournamentMessage(
    tournamentId: string,
    user: { id: string; displayName?: string; role?: string },
    dto: { text: string; isPinned?: boolean; isAnnouncement?: boolean },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOrganizer =
      tournament.organizerId === user.id ||
      user.role === Role.ORGANIZER ||
      user.role === Role.ADMIN;

    // Fetch team name for the user if they belong to a squad in this tournament
    const userApp = await this.findTournamentParticipation(
      tournamentId,
      user.id,
    );

    if (!isOrganizer && !userApp) {
      throw new ForbiddenException(
        'Only athletes on a team participating in this tournament can post in its global channel.',
      );
    }

    const msg = await this.prisma.tournamentChatMessage.create({
      data: {
        tournamentId,
        senderId: user.id,
        senderName: user.displayName || 'Participant',
        teamName: userApp?.teamName || null,
        text: dto.text,
        isPinned: isOrganizer ? (dto.isPinned ?? false) : false,
        isAnnouncement: isOrganizer ? (dto.isAnnouncement ?? false) : false,
      },
    });

    this.realtimeGateway.emitToTournament(
      tournamentId,
      'tournament:new_message',
      msg,
    );
    return msg;
  }

  async updateTournamentMessage(
    tournamentId: string,
    messageId: string,
    user: { id: string; role?: string },
    dto: { text?: string; isPinned?: boolean; isAnnouncement?: boolean },
  ) {
    const msg = await this.prisma.tournamentChatMessage.findFirst({
      where: { id: messageId, tournamentId },
      include: { tournament: true },
    });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }

    const isOrganizer =
      msg.tournament.organizerId === user.id ||
      user.role === Role.ORGANIZER ||
      user.role === Role.ADMIN;

    if (!isOrganizer && msg.senderId !== user.id) {
      throw new ForbiddenException(
        'You do not have permission to edit this message',
      );
    }

    const updated = await this.prisma.tournamentChatMessage.update({
      where: { id: messageId },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(isOrganizer && dto.isPinned !== undefined
          ? { isPinned: dto.isPinned }
          : {}),
        ...(isOrganizer && dto.isAnnouncement !== undefined
          ? { isAnnouncement: dto.isAnnouncement }
          : {}),
      },
    });

    this.realtimeGateway.emitToTournament(
      tournamentId,
      'tournament:message_updated',
      updated,
    );
    return updated;
  }

  async deleteTournamentMessage(
    tournamentId: string,
    messageId: string,
    user: { id: string; role?: string },
  ) {
    const msg = await this.prisma.tournamentChatMessage.findFirst({
      where: { id: messageId, tournamentId },
      include: { tournament: true },
    });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }

    const isOrganizer =
      msg.tournament.organizerId === user.id ||
      user.role === Role.ORGANIZER ||
      user.role === Role.ADMIN;

    if (!isOrganizer && msg.senderId !== user.id) {
      throw new ForbiddenException(
        'You do not have permission to delete this message',
      );
    }

    await this.prisma.tournamentChatMessage.delete({
      where: { id: messageId },
    });

    this.realtimeGateway.emitToTournament(
      tournamentId,
      'tournament:message_deleted',
      {
        messageId,
      },
    );
    return { success: true };
  }

  // DELETE — Delete or remove a tournament
  async deleteTournament(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // PlayerStat has no cascade on its match FK, so delete stats before matches
    // or the match delete hits a foreign-key violation.
    await this.prisma.playerStat.deleteMany({
      where: { match: { tournamentId: id } },
    });

    await this.prisma.match.deleteMany({
      where: { tournamentId: id },
    });

    const deleted = await this.prisma.tournament.delete({
      where: { id },
    });

    if (tournament.imagePublicId) {
      await this.cloudinaryService
        .destroy(tournament.imagePublicId)
        .catch(() => null);
    }

    return deleted;
  }

  // CLOSE TOURNAMENT — Admin or Organizer manually closes tournament and triggers batch rating update
  async closeTournament(id: string) {
    return this.rankingService.closeTournamentRatingPeriod(id);
  }
}
