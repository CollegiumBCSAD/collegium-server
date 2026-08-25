import {
  BadRequestException,
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
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';

export interface TournamentApplication {
  id: string;
  tournamentId: string;
  universityId: string;
  universityName: string;
  userId: string;
  applicantName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  appliedAt: Date;
}

@Injectable()
export class TournamentsService {
  private applications: Map<string, TournamentApplication[]> = new Map();

  constructor(
    private prisma: PrismaService,
    private matchLoggingService: MatchLoggingService,
    private glickoService: GlickoService,
    private notificationsService: NotificationsService,
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

  // CREATE — Create a new tournament.
  // Organizer-created tournaments require Admin approval before going live.
  async create(
    createTournamentDto: CreateTournamentDto,
    user: { id: string; role: Role },
  ) {
    const isOrganizer = user.role === Role.ORGANIZER;

    return this.prisma.tournament.create({
      data: {
        name: createTournamentDto.name,
        image: createTournamentDto.image,
        organizerId: isOrganizer ? user.id : undefined,
        status: isOrganizer
          ? TournamentStatus.PENDING_APPROVAL
          : TournamentStatus.UPCOMING,
      },
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
      (a) => a.userId === user.id || a.universityId === uniId,
    );

    if (existing) {
      existing.status = 'PENDING';
      return existing;
    }

    const newApp: TournamentApplication = {
      id: `app-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      tournamentId,
      universityId: uniId,
      universityName: uniName,
      userId: user.id,
      applicantName: user.displayName || 'Athletic Captain',
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

    return this.prisma.tournament.delete({
      where: { id },
    });
  }
}
