import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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
import { CloseMatchDto } from './dto/close-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
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
}

type ApplicationRow = {
  id: string;
  tournamentId: string;
  universityId: string;
  userId: string;
  applicantName: string;
  status: TournamentApplicationStatus;
  teamId: string | null;
  teamName: string | null;
  appliedAt: Date;
  university?: { name: string } | null;
};

@Injectable()
export class TournamentsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private cloudinaryService: CloudinaryService,
    private ocrService: OcrService,
    private rankingService: RankingService,
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
      teamId: app.teamId ?? undefined,
      teamName: app.teamName ?? undefined,
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

  // APPLY — Athlete / squad submits application (goes to Organizer for approval)
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
                  status: { not: 'DECLINED' },
                },
              },
            },
          ],
        },
        include: {
          members: {
            where: { status: { not: 'DECLINED' } },
            include: { user: true },
          },
          captain: true,
        },
      });

      if (userTeam) {
        resolvedTeamId = userTeam.id;
        resolvedTeamName = userTeam.name;
      }
    }

    const team = resolvedTeamId
      ? await this.prisma.team.findUnique({
          where: { id: resolvedTeamId },
          include: {
            members: {
              where: { status: { not: 'DECLINED' } },
              include: { user: true },
            },
            captain: true,
          },
        })
      : null;

    if (team?.name && !resolvedTeamName) {
      resolvedTeamName = team.name;
    }

    // Collect all squad members so every member's application state is synchronized
    const squadEntries = new Map<string, string>();
    if (team) {
      if (team.captainId) {
        squadEntries.set(
          team.captainId,
          team.captain?.displayName || user.displayName || 'Athletic Captain',
        );
      }
      for (const m of team.members) {
        if (m.userId) {
          squadEntries.set(
            m.userId,
            m.user?.displayName || m.gameHandle || 'Squad Athlete',
          );
        }
      }
    }
    // Always include the applying user
    squadEntries.set(user.id, user.displayName || 'Athletic Captain');

    let primaryApp: ApplicationRow | null = null;
    for (const [memberUserId, memberName] of squadEntries.entries()) {
      const app = await this.prisma.tournamentApplication.upsert({
        where: {
          tournamentId_userId: { tournamentId, userId: memberUserId },
        },
        create: {
          tournamentId,
          universityId: user.universityId,
          userId: memberUserId,
          applicantName: memberName,
          teamId: team?.id || resolvedTeamId,
          teamName: resolvedTeamName,
          status: TournamentApplicationStatus.PENDING,
        },
        update: {
          status: TournamentApplicationStatus.PENDING,
          teamId: team?.id || resolvedTeamId,
          teamName: resolvedTeamName,
          universityId: user.universityId,
        },
        include: { university: { select: { name: true } } },
      });

      if (memberUserId === user.id) {
        primaryApp = app;
      }
    }

    return this.mapApplication(primaryApp!);
  }

  // WITHDRAW / UNDO APPLICATION — Athlete cancels their squad application
  async withdrawApplication(tournamentId: string, userId: string) {
    const target = await this.prisma.tournamentApplication.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });

    if (target) {
      if (target.teamId) {
        // Withdraw entire squad application
        await this.prisma.tournamentApplication.deleteMany({
          where: { tournamentId, teamId: target.teamId },
        });
      } else {
        await this.prisma.tournamentApplication.delete({
          where: { id: target.id },
        });
      }

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

  // GET ALL PENDING APPLICATIONS — Admin-wide view across every tournament,
  // enriched with the real tournament name/game (not the applicant's own copy)
  async getAllPendingApplications() {
    const rows = await this.prisma.tournamentApplication.findMany({
      where: { status: TournamentApplicationStatus.PENDING },
      include: {
        university: { select: { name: true } },
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
    });
    if (byId) return byId;

    return this.prisma.tournamentApplication.findFirst({
      where: { tournamentId, universityId: applicationId },
    });
  }

  // APPROVE APPLICATION — Organizer sanctions squad application
  async approveApplication(tournamentId: string, applicationId: string) {
    const target = await this.findApplication(tournamentId, applicationId);

    if (!target) {
      throw new NotFoundException('Application not found');
    }

    // The bracket is keyed on University — a second approved squad from the
    // same university would silently vanish (connect is a no-op). Reject it.
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

    if (target.teamId) {
      await this.prisma.tournamentApplication.updateMany({
        where: { tournamentId, teamId: target.teamId },
        data: { status: TournamentApplicationStatus.APPROVED },
      });
    } else {
      await this.prisma.tournamentApplication.update({
        where: { id: target.id },
        data: { status: TournamentApplicationStatus.APPROVED },
      });
    }

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

    if (target.teamId) {
      await this.prisma.tournamentApplication.updateMany({
        where: { tournamentId, teamId: target.teamId },
        data: { status: TournamentApplicationStatus.REJECTED },
      });
    } else {
      await this.prisma.tournamentApplication.update({
        where: { id: target.id },
        data: { status: TournamentApplicationStatus.REJECTED },
      });
    }

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

    if (tournament.bracketFormat === 'Round Robin + Playoffs') {
      throw new BadRequestException(
        'Round Robin + Playoffs has no random draw - every university plays every other university',
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
      bracketFormat: string | null;
      gameTitle: GameTitle | null;
    },
    universities: { id: string }[],
    randomize: boolean,
  ) {
    if (tournament.bracketFormat === 'Round Robin + Playoffs') {
      await this.generateRoundRobinStage(
        tournament.id,
        tournament.gameTitle,
        universities,
      );
      return;
    }

    if (tournament.bracketFormat === 'Double Elimination') {
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

  // Once every round-0 match is verified, seed a single-elim playoff bracket
  // from the group standings (most wins first), seeded best-vs-worst.
  private async seedPlayoffs(
    tournamentId: string,
    gameTitle: GameTitle | null,
    groupMatches: BracketMatchRow[],
  ) {
    const wins = new Map<string, number>();
    for (const m of groupMatches) {
      if (m.winnerId) wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
      if (m.loserId && !wins.has(m.loserId)) wins.set(m.loserId, 0);
    }

    const ranked = [...wins.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    if (ranked.length < 2) return;

    // Playoffs need a power-of-2 field; drop the lowest seeds that don't fit.
    let bracketSize = 2;
    while (bracketSize * 2 <= ranked.length) bracketSize *= 2;

    // Same best-vs-worst pairing as before, but the whole playoff tree is
    // created at once (the field is already a power of 2, so there are no byes).
    await this.prisma.match.createMany({
      data: this.buildEliminationSkeleton(
        tournamentId,
        gameTitle,
        ranked.slice(0, bracketSize),
        null,
      ),
    });
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
  // ponytail: no bracket-reset if the losers-bracket champion beats the
  // winners-bracket champion in the grand final (real double-elim would force
  // a second match, since the WB champion still has zero losses) — add a
  // second grand-final match on that outcome if this needs to be
  // tournament-official rather than casual.
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
      select: { status: true, bracketFormat: true, gameTitle: true },
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

    if (tournament.bracketFormat === 'Double Elimination') {
      await this.advanceDoubleElimination(
        tournamentId,
        tournament.gameTitle,
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
    if (rounds[0] === 0) {
      const group = matches.filter((m) => m.round === 0);
      if (!group.every((m) => m.isVerified)) return;
      if (!matches.some((m) => m.round > 0)) {
        await this.seedPlayoffs(tournamentId, gameTitle, group);
        return;
      }
    }

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
          await this.rankingService.closeTournamentRatingPeriod(tournamentId);
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
    } else if (gf.length === 1 && gf[0].isVerified) {
      await this.rankingService.closeTournamentRatingPeriod(tournamentId);
    }
  }

  // CLOSE MATCH — Admin/Organizer manually reports the winner and per-player
  // stats for a match (no Riot API involved), verifying it and running ratings.
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

    if (!contestants.includes(dto.winnerId)) {
      throw new BadRequestException(
        'winnerId must be one of the two universities in this match',
      );
    }

    const loserId = contestants.find((id) => id !== dto.winnerId)!;

    for (const player of dto.players) {
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
      await tx.playerStat.createMany({
        data: dto.players.map((player) => ({
          matchId,
          universityId: player.universityId,
          userId: player.userId,
          summonerName: player.name,
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          win: player.universityId === dto.winnerId,
          dataSource: DataSource.PEER_VERIFIED,
          ...(player.extra !== undefined
            ? { extraStats: player.extra as Prisma.InputJsonValue }
            : {}),
        })),
      });

      return tx.match.update({
        where: { id: matchId },
        data: { winnerId: dto.winnerId, loserId, isVerified: true },
      });
    });

    await this.tryAdvanceBracket(tournamentId);

    return closed;
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
