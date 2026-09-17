import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameTitle, MatchMode, Prisma } from '@prisma/client';

export interface GetMatchesQuery {
  page?: number;
  limit?: number;
  gameTitle?: GameTitle;
  status?: 'ALL' | 'LIVE' | 'UPCOMING' | 'COMPLETED';
  matchMode?: 'ALL' | 'TOURNAMENT' | 'SCRIM';
}

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMatches(query: GetMatchesQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where: Prisma.MatchWhereInput = {};

    if (query.gameTitle) {
      where.title = query.gameTitle;
    }

    if (query.matchMode && query.matchMode !== 'ALL') {
      where.matchMode =
        query.matchMode === 'SCRIM' ? MatchMode.SCRIM : MatchMode.TOURNAMENT;
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'COMPLETED') {
        where.isVerified = true;
      } else if (query.status === 'UPCOMING') {
        where.isVerified = false;
      }
    }

    const [total, rows] = await Promise.all([
      this.prisma.match.count({ where }),
      this.prisma.match.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        include: {
          winner: { select: { id: true, name: true } },
          loser: { select: { id: true, name: true } },
          tournament: { select: { id: true, name: true, gameTitle: true } },
          scrim: {
            select: {
              id: true,
              team: { select: { id: true, name: true, university: { select: { id: true, name: true } } } },
              opponent: { select: { id: true, name: true, university: { select: { id: true, name: true } } } },
            },
          },
          playerStats: {
            include: { valorantStat: true },
          },
        },
      }),
    ]);

    const formatted = rows.map((m) => this.formatMatchItem(m));

    return {
      matches: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  private formatMatchItem(m: any) {
    const isScrim = m.matchMode === MatchMode.SCRIM;
    let t1Name = 'TBD';
    let t1Code = 'TBD';
    let t1Id = m.winnerId || undefined;

    let t2Name = 'TBD';
    let t2Code = 'TBD';
    let t2Id = m.loserId || undefined;

    if (isScrim && m.scrim) {
      t1Name = m.scrim.team?.name || m.winner?.name || 'Host Squad';
      t1Code = m.scrim.team?.university?.name?.slice(0, 4).toUpperCase() || 'HOST';
      t1Id = m.scrim.team?.university?.id || m.winnerId;

      t2Name = m.scrim.opponent?.name || m.loser?.name || 'Challenger';
      t2Code = m.scrim.opponent?.university?.name?.slice(0, 4).toUpperCase() || 'OPP';
      t2Id = m.scrim.opponent?.university?.id || m.loserId;
    } else {
      t1Name = m.winner?.name || 'Contender 1';
      t1Code = m.winner?.name ? m.winner.name.slice(0, 4).toUpperCase() : 'TBD';
      t2Name = m.loser?.name || 'Contender 2';
      t2Code = m.loser?.name ? m.loser.name.slice(0, 4).toUpperCase() : 'TBD';
    }

    const t1Wins = m.isVerified && m.winnerId && m.winnerId === t1Id;
    const t2Wins = m.isVerified && m.winnerId && m.winnerId === t2Id;

    const gameTitleStr = (m.title || 'VALORANT').toLowerCase();
    const gameId =
      gameTitleStr.includes('lol') || gameTitleStr.includes('league')
        ? 'lol'
        : gameTitleStr.includes('cod')
        ? 'codm'
        : gameTitleStr.includes('ml')
        ? 'ml'
        : 'valo';

    return {
      id: m.id,
      tournamentId: m.tournamentId || undefined,
      tournamentTitle:
        m.tournament?.name ||
        (isScrim ? 'Official Scrimmage' : 'University Championship'),
      gameId,
      stageName: isScrim
        ? 'Practice Match'
        : m.round === 0
        ? 'Group Stage'
        : `Round ${m.round}`,
      status: m.isVerified ? 'COMPLETED' : 'UPCOMING',
      timeLabel: m.playedAt ? new Date(m.playedAt).toLocaleDateString() : 'Scheduled',
      matchMode: m.matchMode,
      isForfeit: m.isForfeit ?? false,
      team1: {
        name: t1Name,
        code: t1Code,
        universityId: t1Id,
        score: m.isVerified ? (t1Wins ? 2 : 0) : 0,
        isWinner: Boolean(t1Wins),
      },
      team2: {
        name: t2Name,
        code: t2Code,
        universityId: t2Id,
        score: m.isVerified ? (t2Wins ? 2 : 0) : 0,
        isWinner: Boolean(t2Wins),
      },
      playerStats: m.playerStats || [],
    };
  }
}
