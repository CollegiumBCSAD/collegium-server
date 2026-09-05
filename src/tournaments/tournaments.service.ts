import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GameTitle,
  MatchMode,
  NotificationCategory,
  NotificationType,
  Role,
  TournamentStatus,
} from '@prisma/client';
import { MatchLoggingService } from '../match-logging/match-logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlickoService } from '../universities/glicko.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

export interface TournamentApplication {
  id: string;
  tournamentId: string;
  universityId: string;
  universityName: string;
  userId: string;
  applicantName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  appliedAt: Date;
  teamId?: string;
  teamName?: string;
}

@Injectable()
export class TournamentsService {
  private applications: Map<string, TournamentApplication[]> = new Map();

  constructor(
    private prisma: PrismaService,
    private matchLoggingService: MatchLoggingService,
    private glickoService: GlickoService,
    private notificationsService: NotificationsService,
    private cloudinaryService: CloudinaryService,
  ) {}

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
      },
    });

    return list.map((t) => ({
      ...t,
      applications: this.applications.get(t.id) || [],
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
      },
    });

    return list.map((t) => ({
      ...t,
      applications: this.applications.get(t.id) || [],
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
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return {
      ...tournament,
      applications: this.applications.get(tournament.id) || [],
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

    if (
      tournament.status !== TournamentStatus.UPCOMING &&
      tournament.status !== TournamentStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException(
        `Cannot start tournament with status ${tournament.status}`,
      );
    }

    if (
      tournament.matches.length === 0 &&
      tournament.universities.length >= 2 &&
      tournament.universities.length % 2 === 0
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

    const university = user.universityId
      ? await this.prisma.university.findUnique({
          where: { id: user.universityId },
        })
      : null;

    const uniName = university?.name || 'Varsity Squad';
    const uniId = user.universityId || user.id;

    const apps = this.applications.get(tournamentId) || [];
    const existing = apps.find(
      (a) =>
        a.userId === user.id ||
        (Boolean(body?.teamId) && a.teamId === body?.teamId),
    );

    let resolvedTeamName = body?.teamName;
    if (body?.teamId && !resolvedTeamName) {
      try {
        const team = await this.prisma.team.findUnique({
          where: { id: body.teamId },
          select: { name: true },
        });
        if (team?.name) resolvedTeamName = team.name;
      } catch {
        // Ignore team query error and fallback to applicant name
      }
    }

    if (existing) {
      existing.status = 'PENDING';
      if (body?.teamId) existing.teamId = body.teamId;
      if (resolvedTeamName) existing.teamName = resolvedTeamName;
      return existing;
    }

    const newApp: TournamentApplication = {
      id: `app-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      tournamentId,
      universityId: uniId,
      universityName: uniName,
      userId: user.id,
      applicantName: user.displayName || 'Athletic Captain',
      teamId: body?.teamId,
      teamName: resolvedTeamName,
      status: 'PENDING',
      appliedAt: new Date(),
    };

    apps.push(newApp);
    this.applications.set(tournamentId, apps);
    return newApp;
  }

  // WITHDRAW / UNDO APPLICATION — Athlete cancels their application
  async withdrawApplication(tournamentId: string, userId: string) {
    const apps = this.applications.get(tournamentId) || [];
    const target = apps.find((a) => a.userId === userId);

    if (target) {
      // Remove application
      this.applications.set(
        tournamentId,
        apps.filter((a) => a.userId !== userId),
      );

      // Also disconnect if was connected
      if (target.universityId) {
        try {
          await this.prisma.tournament.update({
            where: { id: tournamentId },
            data: {
              universities: {
                disconnect: { id: target.universityId },
              },
            },
          });
        } catch {
          // ignore if not connected
        }
      }
    }

    return { success: true, message: 'Application withdrawn successfully' };
  }

  // GET APPLICATIONS — List applications for a tournament
  getApplications(tournamentId: string) {
    return this.applications.get(tournamentId) || [];
  }

  // GET ALL PENDING APPLICATIONS — Admin-wide view across every tournament,
  // enriched with the real tournament name/game (not the applicant's own copy)
  async getAllPendingApplications() {
    const pending: Array<
      TournamentApplication & {
        tournamentName: string;
        gameTitle: string | null;
      }
    > = [];

    for (const [tournamentId, apps] of this.applications.entries()) {
      const pendingForTournament = apps.filter((a) => a.status === 'PENDING');
      if (pendingForTournament.length === 0) continue;

      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { name: true, gameTitle: true },
      });

      for (const app of pendingForTournament) {
        pending.push({
          ...app,
          tournamentName: tournament?.name ?? 'Unknown Tournament',
          gameTitle: tournament?.gameTitle ?? null,
        });
      }
    }

    return pending;
  }

  // APPROVE APPLICATION — Organizer sanctions squad application
  async approveApplication(tournamentId: string, applicationId: string) {
    const apps = this.applications.get(tournamentId) || [];
    const target = apps.find(
      (a) => a.id === applicationId || a.universityId === applicationId,
    );

    if (!target) {
      throw new NotFoundException('Application not found');
    }

    target.status = 'APPROVED';

    // Connect university to tournament roster
    if (target.universityId) {
      try {
        await this.prisma.tournament.update({
          where: { id: tournamentId },
          data: {
            universities: {
              connect: { id: target.universityId },
            },
          },
        });
      } catch {
        // ignore if already connected
      }
    }

    return target;
  }

  // REJECT APPLICATION — Organizer declines squad application
  async rejectApplication(tournamentId: string, applicationId: string) {
    const apps = this.applications.get(tournamentId) || [];
    const target = apps.find(
      (a) => a.id === applicationId || a.universityId === applicationId,
    );

    if (!target) {
      throw new NotFoundException('Application not found');
    }

    target.status = 'REJECTED';

    if (target.universityId) {
      try {
        await this.prisma.tournament.update({
          where: { id: tournamentId },
          data: {
            universities: {
              disconnect: { id: target.universityId },
            },
          },
        });
      } catch {
        // ignore
      }
    }

    return target;
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

  // GENERATE BRACKET — Pair registered universities into matches
  async generateBracket(tournamentId: string) {
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

    if (universities.length % 2 !== 0) {
      throw new BadRequestException(
        'An even number of universities is required to generate a bracket',
      );
    }

    // Shuffle universities randomly for fair seeding
    const shuffled = [...universities].sort(() => Math.random() - 0.5);

    // Pair them up into matches (university[0] vs university[1], etc.)
    const matchPairs: { winnerId: string; loserId: string }[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      matchPairs.push({
        winnerId: shuffled[i].id,
        loserId: shuffled[i + 1].id,
      });
    }

    // Create placeholder match records in a transaction
    // winner/loser are placeholders until the match is confirmed
    await this.prisma.$transaction(async (tx) => {
      for (const pair of matchPairs) {
        await tx.match.create({
          data: {
            title: GameTitle.LOL, // Defaulting to LOL; can be extended when other titles are active
            matchMode: MatchMode.TOURNAMENT,
            tournamentId: tournament.id,
            gameDuration: 0,
            gameMode: 'CLASSIC',
            platformId: 'PH',
            winnerId: pair.winnerId,
            loserId: pair.loserId,
            isVerified: false,
          },
        });
      }

      // Move tournament to ONGOING now that bracket is set
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: TournamentStatus.ONGOING },
      });
    });

    // Return the full bracket for the response
    return this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            playerStats: true,
          },
        },
        universities: true,
      },
    });
  }

  // GET BRACKET — Fetch tournament with all matches
  async getBracket(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            playerStats: true,
          },
        },
        universities: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return tournament;
  }

  // CONFIRM MATCH — Coach submits the Riot matchId, triggers LoL pipeline
  async confirmMatch(
    tournamentId: string,
    matchId: string,
    dto: ConfirmMatchDto,
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (match.isVerified) {
      throw new BadRequestException('This match has already been confirmed');
    }

    // Trigger the existing match-logging pipeline, passing the bracket's matchId
    await this.matchLoggingService.logMatch(
      match.title,
      dto.riotMatchId,
      MatchMode.TOURNAMENT,
      true, // CHANGED TO TRUE FOR MVP TESTING
      matchId, // Pass the existing database Match ID so it updates instead of creating!
    );

    // Return the updated match with its new player stats
    return this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        playerStats: true,
      },
    });
  }

  // CLOSE MATCH — Admin marks match as verified; ready for ranking
  async closeMatch(tournamentId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (!match.riotMatchId) {
      throw new BadRequestException(
        'Match cannot be closed before it is confirmed with a Riot match ID',
      );
    }

    if (match.isVerified) {
      throw new BadRequestException('This match is already closed');
    }

    if (match.winnerId && match.loserId) {
      const winnerRating = await this.prisma.universityGameRating.upsert({
        where: {
          universityId_gameTitle: {
            universityId: match.winnerId,
            gameTitle: match.title,
          },
        },
        create: {
          universityId: match.winnerId,
          gameTitle: match.title,
        },
        update: {},
      });

      const loserRating = await this.prisma.universityGameRating.upsert({
        where: {
          universityId_gameTitle: {
            universityId: match.loserId,
            gameTitle: match.title,
          },
        },
        create: {
          universityId: match.loserId,
          gameTitle: match.title,
        },
        update: {},
      });

      const result = this.glickoService.calculateMatch(
        {
          rating: winnerRating.glicko2_rating,
          rd: winnerRating.glicko2_rd,
          sigma: winnerRating.glicko2_sigma,
        },
        {
          rating: loserRating.glicko2_rating,
          rd: loserRating.glicko2_rd,
          sigma: loserRating.glicko2_sigma,
        },
      );

      await this.prisma.universityGameRating.update({
        where: { id: winnerRating.id },
        data: {
          glicko2_rating: result.winner.rating,
          glicko2_rd: result.winner.rd,
          glicko2_sigma: result.winner.sigma,
          wins: { increment: 1 },
        },
      });

      await this.prisma.universityGameRating.update({
        where: { id: loserRating.id },
        data: {
          glicko2_rating: result.loser.rating,
          glicko2_rd: result.loser.rd,
          glicko2_sigma: result.loser.sigma,
          losses: { increment: 1 },
        },
      });
    }

    return this.prisma.match.update({
      where: { id: matchId },
      data: { isVerified: true },
    });
  }

  // DELETE — Delete or remove a tournament
  async deleteTournament(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

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
}
