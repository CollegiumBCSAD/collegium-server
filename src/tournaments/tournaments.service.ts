import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameTitle, MatchMode, TournamentStatus } from '@prisma/client';
import { MatchLoggingService } from '../match-logging/match-logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';

@Injectable()
export class TournamentsService {
  constructor(
    private prisma: PrismaService,
    private matchLoggingService: MatchLoggingService,
  ) {}

  // CREATE — Create a new tournament
  async create(createTournamentDto: CreateTournamentDto) {
    return this.prisma.tournament.create({
      data: {
        name: createTournamentDto.name,
      },
    });
  }

  // REGISTER — Register a university for a tournament
  async registerUniversity(tournamentId: string, universityId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.UPCOMING) {
      throw new BadRequestException(
        'Registration is only allowed for UPCOMING tournaments',
      );
    }

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

    return this.prisma.match.update({
      where: { id: matchId },
      data: { isVerified: true },
    });
  }
}
