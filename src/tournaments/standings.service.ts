import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  HeadToHead,
  rankStandings,
  StandingInput,
  StandingRow,
} from './standings.util';

export interface TournamentStandingRow extends StandingRow {
  universityName: string;
}

@Injectable()
export class StandingsService {
  constructor(private readonly prisma: PrismaService) {}

  async computeStandings(
    tournamentId: string,
  ): Promise<TournamentStandingRow[]> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        universities: { select: { id: true, name: true } },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const matches = await this.prisma.match.findMany({
      where: { tournamentId, round: 0, isVerified: true },
      select: {
        winnerId: true,
        loserId: true,
        games: { select: { winnerId: true, loserId: true } },
      },
    });

    const totals = new Map<string, StandingInput>();
    const headToHead: HeadToHead = new Map();

    const rowFor = (universityId: string) => {
      let row = totals.get(universityId);
      if (!row) {
        row = {
          universityId,
          matchWins: 0,
          matchLosses: 0,
          mapsWon: 0,
          mapsLost: 0,
        };
        totals.set(universityId, row);
      }
      return row;
    };

    for (const university of tournament.universities) {
      rowFor(university.id);
    }

    for (const match of matches) {
      const { winnerId, loserId } = match;
      if (!winnerId || !loserId) continue;

      const winner = rowFor(winnerId);
      const loser = rowFor(loserId);
      winner.matchWins += 1;
      loser.matchLosses += 1;

      const beaten = headToHead.get(winnerId) ?? new Map<string, number>();
      beaten.set(loserId, (beaten.get(loserId) ?? 0) + 1);
      headToHead.set(winnerId, beaten);

      if (match.games.length === 0) {
        winner.mapsWon += 1;
        loser.mapsLost += 1;
        continue;
      }

      for (const game of match.games) {
        if (game.winnerId) rowFor(game.winnerId).mapsWon += 1;
        if (game.loserId) rowFor(game.loserId).mapsLost += 1;
      }
    }

    const names = new Map(
      tournament.universities.map((u) => [u.id, u.name] as const),
    );

    return rankStandings([...totals.values()], headToHead).map((row) => ({
      ...row,
      universityName: names.get(row.universityId) ?? 'Unknown',
    }));
  }
}
