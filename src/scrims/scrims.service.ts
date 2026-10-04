import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DataSource,
  GameTitle,
  MatchMode,
  NotificationCategory,
  NotificationType,
  Role,
  ScrimStatus,
  TeamMemberStatus,
  User,
} from '@prisma/client';
import {
  CreateScrimDto,
  AcceptScrimDto,
  FinalizeScrimDto,
} from './dto/scrims.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { OcrService } from '../ocr/ocr.service';
import {
  FuzzyMatcherService,
  AthleteCandidate,
} from '../ocr/fuzzy-matcher.service';

export interface PendingScrimRequest {
  teamId: string;
  teamName: string;
  universityName?: string;
}

@Injectable()
export class ScrimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly ocrService: OcrService,
    private readonly fuzzyMatcherService: FuzzyMatcherService,
  ) {}

  async createScrim(dto: CreateScrimDto, user?: User) {
    let team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      team = await this.prisma.team.findFirst({
        where: { captainId: dto.teamId, gameTitle: dto.gameTitle },
      });
    }

    if (!team && user?.id) {
      team = await this.prisma.team.findFirst({
        where: {
          OR: [
            { captainId: user.id, gameTitle: dto.gameTitle },
            {
              members: { some: { userId: user.id, status: 'ACCEPTED' } },
              gameTitle: dto.gameTitle,
            },
          ],
        },
      });
    }

    if (!team && user?.universityId) {
      team = await this.prisma.team.findFirst({
        where: { universityId: user.universityId, gameTitle: dto.gameTitle },
      });
    }

    if (!team && user?.id) {
      team = await this.prisma.team.findFirst({
        where: { captainId: user.id },
      });
    }

    if (!team) {
      team = await this.prisma.team.findFirst({
        where: { gameTitle: dto.gameTitle },
      });
    }

    if (!team) {
      team = await this.prisma.team.findFirst();
    }

    if (!team) {
      throw new BadRequestException(
        'Host team not found in database. Please register your squad first.',
      );
    }

    return this.prisma.scrim.create({
      data: {
        teamId: team.id,
        gameTitle: dto.gameTitle,
        scheduledAt: new Date(dto.scheduledAt),
        format: dto.format,
        rankRange: dto.rankRange,
        mapPreference: dto.mapPreference,
        notes: dto.notes,
        status: ScrimStatus.OPEN,
      },
      include: {
        team: {
          include: {
            university: true,
          },
        },
      },
    });
  }

  async getScrims(gameTitle?: GameTitle, status?: ScrimStatus) {
    const list = await this.prisma.scrim.findMany({
      where: {
        ...(gameTitle ? { gameTitle } : {}),
        ...(status
          ? { status }
          : {
              status: {
                in: [
                  ScrimStatus.OPEN,
                  ScrimStatus.PENDING,
                  ScrimStatus.CONFIRMED,
                  ScrimStatus.CANCELLED,
                ],
              },
            }),
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        team: {
          include: {
            university: true,
          },
        },
        opponent: {
          include: {
            university: true,
          },
        },
      },
    });

    return list.map((scrim) => {
      let pendingRequests: PendingScrimRequest[] = [];
      if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
        try {
          const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
          pendingRequests = JSON.parse(jsonStr) as PendingScrimRequest[];
        } catch {
          pendingRequests = [];
        }
      }

      if (pendingRequests.length === 0 && scrim.opponent) {
        pendingRequests = [
          {
            teamId: scrim.opponent.id,
            teamName: scrim.opponent.name,
            universityName: scrim.opponent.university?.name,
          },
        ];
      }

      const cleanedNotes = scrim.notes
        ? scrim.notes.split('__SCRIM_REQS__')[0]
        : '';

      return {
        ...scrim,
        notes: cleanedNotes,
        pendingRequests,
      };
    });
  }

  async acceptScrim(scrimId: string, dto: AcceptScrimDto) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: { team: true },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (scrim.status === ScrimStatus.CONFIRMED) {
      throw new BadRequestException(
        'This scrim match has already been booked by an opponent.',
      );
    }

    let opponentTeam = await this.prisma.team.findUnique({
      where: { id: dto.opponentId },
      include: { university: true },
    });

    if (!opponentTeam) {
      const userMember = await this.prisma.teamMember.findFirst({
        where: { userId: dto.opponentId, status: 'ACCEPTED' },
        include: { team: { include: { university: true } } },
      });
      if (userMember) {
        opponentTeam = userMember.team;
      }
    }

    if (!opponentTeam) {
      opponentTeam = await this.prisma.team.findFirst({
        where: { captainId: dto.opponentId },
        include: { university: true },
      });
    }

    if (!opponentTeam) {
      throw new BadRequestException('Opponent team not found.');
    }

    if (scrim.teamId === opponentTeam.id) {
      throw new BadRequestException(
        'A team cannot accept its own scrim offer.',
      );
    }

    let currentReqs: PendingScrimRequest[] = [];
    if (scrim.notes && scrim.notes.includes('__SCRIM_REQS__')) {
      try {
        const jsonStr = scrim.notes.split('__SCRIM_REQS__')[1];
        currentReqs = JSON.parse(jsonStr) as PendingScrimRequest[];
      } catch {
        currentReqs = [];
      }
    }

    if (!currentReqs.some((r) => r.teamId === opponentTeam.id)) {
      currentReqs.push({
        teamId: opponentTeam.id,
        teamName: opponentTeam.name,
        universityName: opponentTeam.university?.name,
      });
    }

    const baseNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';
    const updatedNotes = `${baseNotes}__SCRIM_REQS__${JSON.stringify(currentReqs)}`;

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        opponentId: opponentTeam.id,
        status: ScrimStatus.PENDING,
        notes: updatedNotes,
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });

    const hostContactId = updated.team.captainId ?? updated.team.coachId;
    if (hostContactId) {
      await this.notificationsService.create({
        userId: hostContactId,
        category: NotificationCategory.SCRIM,
        type: NotificationType.SCRIM_REQUEST_RECEIVED,
        title: '⏳ Incoming Scrim Request!',
        message: `${opponentTeam.name} requested to book your scrim offer!`,
        link: '/scrims',
        refId: `${updated.id}:${opponentTeam.id}`,
      });
    }

    return {
      ...updated,
      notes: baseNotes,
      pendingRequests: currentReqs,
    };
  }

  async confirmScrim(scrimId: string, selectedOpponentId?: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const opponentIdToSet = selectedOpponentId || scrim.opponentId;
    const baseNotes = scrim.notes ? scrim.notes.split('__SCRIM_REQS__')[0] : '';

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: {
        status: ScrimStatus.CONFIRMED,
        notes: baseNotes,
        ...(opponentIdToSet ? { opponentId: opponentIdToSet } : {}),
      },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });

    const opponentContactId =
      updated.opponent?.captainId ?? updated.opponent?.coachId;
    if (opponentContactId) {
      await this.notificationsService.create({
        userId: opponentContactId,
        category: NotificationCategory.SCRIM,
        type: NotificationType.SCRIM_REQUEST_ACCEPTED,
        title: '🎉 Scrim Match Request Accepted!',
        message: `${updated.team.name} accepted your practice match request!`,
        link: '/scrims',
        refId: updated.id,
      });
    }

    return updated;
  }

  async cancelScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (
      scrim.status === ScrimStatus.CONFIRMED ||
      scrim.status === ScrimStatus.PENDING
    ) {
      const wasConfirmed = scrim.status === ScrimStatus.CONFIRMED;

      const updated = await this.prisma.scrim.update({
        where: { id: scrimId },
        data: {
          status: ScrimStatus.OPEN,
          opponentId: null,
        },
        include: {
          team: { include: { university: true } },
          opponent: { include: { university: true } },
        },
      });

      const opponentContactId =
        scrim.opponent?.captainId ?? scrim.opponent?.coachId;
      if (scrim.opponent && opponentContactId) {
        await this.notificationsService.create({
          userId: opponentContactId,
          category: NotificationCategory.SCRIM,
          type: wasConfirmed
            ? NotificationType.SCRIM_UNBOOKED
            : NotificationType.SCRIM_REQUEST_DECLINED,
          title: wasConfirmed
            ? '⚠️ Scrim Match Cancelled'
            : '✕ Scrim Request Declined',
          message: wasConfirmed
            ? `${scrim.team.name} unbooked the scheduled practice match.`
            : `${scrim.team.name} declined your practice match request. The offer is re-opened on the board.`,
          link: '/scrims',
          refId: `${scrim.id}:${scrim.status}`,
        });
      }

      return updated;
    }

    return this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.CANCELLED },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
      },
    });
  }

  // SCAN SCRIM — Pre-close mandatory OCR ingestion
  // Extracts player stats from scoreboard screenshot and fuzzy-resolves against team rosters
  async scanScrim(scrimId: string, image?: Express.Multer.File) {
    if (!image) {
      throw new BadRequestException('A screenshot image is required');
    }

    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: {
          include: {
            university: true,
            captain: true,
            members: {
              where: { status: 'ACCEPTED' },
              include: { user: true },
            },
          },
        },
        opponent: {
          include: {
            university: true,
            captain: true,
            members: {
              where: { status: 'ACCEPTED' },
              include: { user: true },
            },
          },
        },
      },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim not found');
    }

    // Call Python RapidOCR microservice
    const scanResult = await this.ocrService.recognize(
      image.buffer,
      image.mimetype,
      image.originalname,
      scrim.gameTitle,
    );

    // Build candidate list from both host squad and opponent squad
    const candidates: AthleteCandidate[] = [];
    for (const t of [scrim.team, scrim.opponent].filter(Boolean)) {
      if (!t) continue;
      if (t.captain) {
        candidates.push({
          userId: t.captain.id,
          displayName: t.captain.displayName,
          gameHandle: t.captain.displayName,
          teamId: t.id,
          teamName: t.name,
        });
      }
      for (const m of t.members) {
        candidates.push({
          userId: m.userId,
          displayName: m.user?.displayName || m.gameHandle,
          gameHandle: m.gameHandle,
          teamId: t.id,
          teamName: t.name,
          role: m.preferredRole,
        });
      }
    }

    // Run fuzzy resolution
    const resolvedBatch = this.fuzzyMatcherService.resolveBatch(
      scanResult.players,
      candidates,
    );

    return {
      scrimId: scrim.id,
      gameTitle: scrim.gameTitle,
      players: resolvedBatch,
      hostTeam: {
        id: scrim.team.id,
        name: scrim.team.name,
        universityId: scrim.team.universityId,
        universityName: scrim.team.university?.name,
      },
      opponentTeam: scrim.opponent
        ? {
            id: scrim.opponent.id,
            name: scrim.opponent.name,
            universityId: scrim.opponent.universityId,
            universityName: scrim.opponent.university?.name,
          }
        : null,
    };
  }

  // FINALIZE SCRIM — Commit parsed match log directly into dedicated scrim history ledger
  async finalizeScrim(scrimId: string, user: User, dto: FinalizeScrimDto) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: {
          include: {
            university: true,
            members: { where: { status: TeamMemberStatus.ACCEPTED } },
          },
        },
        opponent: {
          include: {
            university: true,
            members: { where: { status: TeamMemberStatus.ACCEPTED } },
          },
        },
        match: true,
      },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim not found');
    }

    // Validation: any rostered athlete on either participating squad, or an
    // Admin/Organizer. Match logging isn't limited to captains - any athlete
    // who played the scrim can log it, and the resulting Match is visible to
    // both universities' ledgers regardless of who submitted it.
    const isHostAthlete = scrim.team.members.some((m) => m.userId === user.id);
    const isOpponentAthlete =
      !!scrim.opponent &&
      scrim.opponent.members.some((m) => m.userId === user.id);
    const isAdmin = user.role === Role.ADMIN || user.role === Role.ORGANIZER;

    if (!isHostAthlete && !isOpponentAthlete && !isAdmin) {
      throw new ForbiddenException(
        'Only athletes on the participating squads or platform administrators can finalize scrim match logs.',
      );
    }

    // Determine winner/loser universities for ledger. `dto.winnerId` and
    // `dto.loserId` both arrive as Team ids from the OCR ingest modal
    // (winnerTeamId/loserTeamId), so both need remapping to University ids -
    // Match.winnerId/loserId are foreign keys onto University, not Team.
    let winnerUniversityId = dto.winnerId;
    let loserUniversityId = dto.loserId;

    if (winnerUniversityId === scrim.team.id) {
      winnerUniversityId = scrim.team.universityId;
    } else if (scrim.opponent && winnerUniversityId === scrim.opponent.id) {
      winnerUniversityId = scrim.opponent.universityId;
    }

    if (loserUniversityId === scrim.team.id) {
      loserUniversityId = scrim.team.universityId;
    } else if (scrim.opponent && loserUniversityId === scrim.opponent.id) {
      loserUniversityId = scrim.opponent.universityId;
    } else if (!loserUniversityId && scrim.opponent) {
      // No loserId supplied at all: derive it as "whichever university
      // didn't win."
      loserUniversityId =
        winnerUniversityId === scrim.team.universityId
          ? scrim.opponent.universityId
          : scrim.team.universityId;
    }

    // Execute in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Upsert or create Match record with matchMode: SCRIM
      let match = await tx.match.findUnique({
        where: { scrimId },
      });

      if (!match) {
        match = await tx.match.create({
          data: {
            scrimId,
            title: scrim.gameTitle,
            matchMode: MatchMode.SCRIM,
            winnerId: winnerUniversityId,
            loserId: loserUniversityId,
            isVerified: true,
            gameDuration: dto.gameDuration || 1800,
            gameMode: 'Scrim Practice',
            platformId: 'SCRIM',
          },
        });
      } else {
        match = await tx.match.update({
          where: { id: match.id },
          data: {
            winnerId: winnerUniversityId,
            loserId: loserUniversityId,
            isVerified: true,
            gameDuration: dto.gameDuration || match.gameDuration,
          },
        });

        // Clean existing stats if any
        await tx.valorantPlayerStat.deleteMany({
          where: { playerStat: { matchId: match.id } },
        });
        await tx.playerStat.deleteMany({
          where: { matchId: match.id },
        });
      }

      // Write verified PlayerStat records
      for (const p of dto.players) {
        let playerUniId = p.universityId;
        if (!playerUniId && p.userId) {
          const u = await tx.user.findUnique({ where: { id: p.userId } });
          playerUniId = u?.universityId || undefined;
        }

        const stat = await tx.playerStat.create({
          data: {
            matchId: match.id,
            universityId: playerUniId,
            userId: p.userId,
            summonerName: p.name,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            win: playerUniId === winnerUniversityId,
            dataSource: DataSource.PEER_VERIFIED,
          },
        });

        if (
          p.combatScore !== undefined ||
          p.headshotPct !== undefined ||
          p.agentName
        ) {
          await tx.valorantPlayerStat.create({
            data: {
              playerStatId: stat.id,
              agentName: p.agentName,
              combatScore: p.combatScore,
              headshotPct: p.headshotPct,
            },
          });
        }
      }

      // Transition scrim to COMPLETED
      const updatedScrim = await tx.scrim.update({
        where: { id: scrimId },
        data: { status: ScrimStatus.COMPLETED },
        include: {
          team: { include: { university: true } },
          opponent: { include: { university: true } },
          match: {
            include: {
              playerStats: {
                include: { valorantStat: true },
              },
            },
          },
        },
      });

      return updatedScrim;
    });

    const opponentContactId =
      scrim.opponent?.captainId ?? scrim.opponent?.coachId;
    if (scrim.opponent && opponentContactId) {
      await this.notificationsService
        .create({
          userId: opponentContactId,
          category: NotificationCategory.SCRIM,
          type: NotificationType.SCRIM_REQUEST_ACCEPTED,
          title: '🏆 Scrim Match Log Finalized',
          message: `Match stats between ${scrim.team.name} and ${scrim.opponent.name} have been verified and logged into your scrim history!`,
          link: '/scrims',
          refId: `${scrim.id}:FINALIZED`,
        })
        .catch(() => null);
    }

    return result;
  }

  async completeScrim(scrimId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
        match: true,
      },
    });
    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    if (!scrim.match) {
      throw new BadRequestException(
        'Mandatory OCR ingestion required before finalizing scrim. Please upload post-match scoreboard screenshot via /scrims/:id/scan and finalize match stats.',
      );
    }

    const updated = await this.prisma.scrim.update({
      where: { id: scrimId },
      data: { status: ScrimStatus.COMPLETED },
      include: {
        team: { include: { university: true } },
        opponent: { include: { university: true } },
        match: true,
      },
    });

    return updated;
  }

  async deleteScrim(scrimId: string) {
    await this.prisma.scrimChatMessage
      .deleteMany({
        where: { scrimId },
      })
      .catch(() => null);

    return this.prisma.scrim
      .delete({
        where: { id: scrimId },
      })
      .catch(() => null);
  }

  async getScrimChat(scrimId: string) {
    return this.prisma.scrimChatMessage.findMany({
      where: { scrimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveChatParticipant(scrimId: string, userId: string) {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      include: { team: true, opponent: true },
    });

    if (!scrim) {
      throw new NotFoundException('Scrim offer not found.');
    }

    const teamIds = [scrim.teamId, scrim.opponentId].filter(
      (id): id is string => Boolean(id),
    );

    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        teamId: { in: teamIds },
        status: TeamMemberStatus.ACCEPTED,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'Only participants of this scrim can post in the War Room chat.',
      );
    }

    const team =
      membership.teamId === scrim.teamId ? scrim.team : scrim.opponent;
    return team!;
  }

  async sendScrimChat(scrimId: string, userId: string, text: string) {
    const [team, sender] = await Promise.all([
      this.resolveChatParticipant(scrimId, userId),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    const message = await this.prisma.scrimChatMessage.create({
      data: {
        scrimId,
        senderId: userId,
        senderName: sender?.displayName || 'Athlete',
        teamName: team.name,
        text,
      },
    });

    this.realtimeGateway.emitToScrim(scrimId, 'scrim:message', message);
    return message;
  }
}
