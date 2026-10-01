import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, EventTeamStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { gamesNeededToWin } from '../tournaments/series.util';
import { EventsService, RequestingUser } from './events.service';
import { EventDocumentsService } from './event-documents.service';
import { buildSingleEliminationBracket, nextSlotFor } from './bracket.util';
import { ReportEventResultDto } from './dto/event-match.dto';

@Injectable()
export class EventBracketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly eventDocumentsService: EventDocumentsService,
  ) {}

  async generate(eventId: string, user: RequestingUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        teams: { where: { status: EventTeamStatus.APPROVED } },
        matches: { select: { id: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    await this.eventsService.findOneForOrganizer(eventId, user);

    if (event.matches.length > 0) {
      throw new BadRequestException(
        'This event already has a bracket. Delete it before generating a new one.',
      );
    }

    if (event.teams.length < 2) {
      throw new BadRequestException(
        'Approve at least 2 squads before generating the bracket',
      );
    }

    const seeded = this.seed(event.teams);

    const rows = buildSingleEliminationBracket(seeded, event.gameTitle, {
      bestOfEarly: null,
      bestOfLate: null,
      bestOfFinal: null,
    });

    await this.prisma.$transaction([
      this.prisma.eventMatch.createMany({
        data: rows.map((row) => ({ ...row, eventId })),
      }),
      this.prisma.event.update({
        where: { id: eventId },
        data: { status: EventStatus.LOCKED },
      }),
    ]);

    return this.getBracket(eventId);
  }

  async getBracket(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        gameTitle: true,
        bracketFormat: true,
        status: true,
        teams: {
          where: { status: EventTeamStatus.APPROVED },
          select: { id: true, name: true, logo: true, seed: true },
        },
        matches: {
          orderBy: [{ round: 'asc' }, { slot: 'asc' }],
          select: {
            id: true,
            round: true,
            slot: true,
            bestOf: true,
            teamAId: true,
            teamBId: true,
            winnerId: true,
            scoreA: true,
            scoreB: true,
            isBye: true,
            playedAt: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async reportResult(
    eventId: string,
    matchId: string,
    user: RequestingUser,
    dto: ReportEventResultDto,
  ) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    const match = await this.prisma.eventMatch.findFirst({
      where: { id: matchId, eventId },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (match.isBye) {
      throw new BadRequestException('A bye has no result to report');
    }

    if (!match.teamAId || !match.teamBId) {
      throw new BadRequestException(
        'Both squads must be decided before reporting this result',
      );
    }

    if (dto.winnerId !== match.teamAId && dto.winnerId !== match.teamBId) {
      throw new BadRequestException('The winner must be one of the two squads');
    }

    this.assertScoreline(dto, match.bestOf, match.teamAId);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.eventMatch.updateMany({
        where: { id: match.id, winnerId: null },
        data: {
          winnerId: dto.winnerId,
          scoreA: dto.scoreA ?? null,
          scoreB: dto.scoreB ?? null,
          playedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        throw new BadRequestException(
          'This match already has a result. Clear it before reporting again.',
        );
      }

      const { round, slot, isTeamA } = nextSlotFor(match.round, match.slot);
      const next = await tx.eventMatch.findUnique({
        where: { eventId_round_slot: { eventId, round, slot } },
      });

      if (!next) {
        await tx.event.update({
          where: { id: eventId },
          data: { status: EventStatus.COMPLETED },
        });
        return;
      }

      await tx.eventMatch.update({
        where: { id: next.id },
        data: isTeamA ? { teamAId: dto.winnerId } : { teamBId: dto.winnerId },
      });

      await tx.event.update({
        where: { id: eventId },
        data: { status: EventStatus.ONGOING },
      });
    });

    return this.getBracket(eventId);
  }

  /**
   * Undo a reported result: clears the score and pulls the winner back out of
   * the next round. Only allowed while that next match is still unplayed, so
   * mistakes are unwound one round at a time and nothing downstream is lost.
   */
  async clearResult(eventId: string, matchId: string, user: RequestingUser) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    const match = await this.prisma.eventMatch.findFirst({
      where: { id: matchId, eventId },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (match.isBye) {
      throw new BadRequestException('A bye advances automatically');
    }

    if (!match.winnerId) {
      throw new BadRequestException('This match has no result to undo');
    }

    const { round, slot, isTeamA } = nextSlotFor(match.round, match.slot);
    const next = await this.prisma.eventMatch.findUnique({
      where: { eventId_round_slot: { eventId, round, slot } },
    });

    if (next?.winnerId) {
      throw new BadRequestException(
        'The next match already has a result. Undo that one first.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const cleared = await tx.eventMatch.updateMany({
        where: { id: match.id, winnerId: match.winnerId },
        data: { winnerId: null, scoreA: null, scoreB: null, playedAt: null },
      });

      if (cleared.count === 0) {
        throw new BadRequestException(
          'This result changed while you were undoing it. Refresh and try again.',
        );
      }

      if (next) {
        await tx.eventMatch.update({
          where: { id: next.id },
          data: isTeamA ? { teamAId: null } : { teamBId: null },
        });
      }

      // Back to LOCKED when no real result is left, otherwise still ONGOING
      // (this also reopens an event whose final was just undone).
      const remaining = await tx.eventMatch.count({
        where: { eventId, isBye: false, winnerId: { not: null } },
      });

      await tx.event.update({
        where: { id: eventId },
        data: {
          status: remaining > 0 ? EventStatus.ONGOING : EventStatus.LOCKED,
        },
      });
    });

    return this.getBracket(eventId);
  }

  async close(eventId: string, user: RequestingUser) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    const purged = await this.eventDocumentsService.purgeForEvent(eventId);

    await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.COMPLETED },
    });

    return { status: EventStatus.COMPLETED, documentsPurged: purged };
  }

  private seed(teams: { id: string; seed: number | null }[]): string[] {
    if (teams.every((team) => team.seed !== null)) {
      return [...teams]
        .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
        .map((team) => team.id);
    }

    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.map((team) => team.id);
  }

  private assertScoreline(
    dto: ReportEventResultDto,
    bestOf: number,
    teamAId: string,
  ) {
    if (dto.scoreA === undefined || dto.scoreB === undefined) {
      if (bestOf === 1) return;
      throw new BadRequestException(
        `Report the series score for this best of ${bestOf}`,
      );
    }

    const needed = gamesNeededToWin(bestOf);
    const high = Math.max(dto.scoreA, dto.scoreB);
    const low = Math.min(dto.scoreA, dto.scoreB);

    if (high !== needed || high + low > bestOf) {
      throw new BadRequestException(
        `A best of ${bestOf} ends at ${needed} games won, received ${dto.scoreA}-${dto.scoreB}`,
      );
    }

    const impliedWinner = dto.scoreA > dto.scoreB ? teamAId : null;
    if (impliedWinner !== null && dto.winnerId !== impliedWinner) {
      throw new BadRequestException(
        'The reported winner does not match the score',
      );
    }
    if (impliedWinner === null && dto.winnerId === teamAId) {
      throw new BadRequestException(
        'The reported winner does not match the score',
      );
    }
  }
}
