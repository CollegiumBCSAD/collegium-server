import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchMode, TeamMemberStatus } from '@prisma/client';

@Injectable()
export class AthletesService {
  constructor(private readonly prisma: PrismaService) {}

  // PUBLIC ATHLETE PROFILE — the read-only counterpart to an athlete's own
  // /dashboard. Anyone (including non-athletes) can look up a player card:
  // display identity, verified game handles, current rosters, and a short
  // recent-match log, but none of the private account-management surface
  // (join requests, captain inbox, roster editing) that /dashboard exposes
  // to the account owner.
  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        role: true,
        createdAt: true,
        university: { select: { id: true, name: true, domain: true } },
        gameHandles: {
          select: { gameTitle: true, handle: true },
        },
        teamMemberships: {
          where: { status: TeamMemberStatus.ACCEPTED },
          select: {
            preferredRole: true,
            gameHandle: true,
            joinedAt: true,
            team: {
              select: {
                id: true,
                name: true,
                gameTitle: true,
                captainId: true,
                glicko2_rating: true,
                glicko2_rd: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Athlete not found.');
    }

    const recentStats = await this.prisma.playerStat.findMany({
      where: { userId },
      orderBy: { match: { playedAt: 'desc' } },
      take: 10,
      select: {
        kills: true,
        deaths: true,
        assists: true,
        win: true,
        match: {
          select: {
            id: true,
            playedAt: true,
            matchMode: true,
            title: true,
            tournament: { select: { id: true, name: true } },
            winner: { select: { id: true, name: true } },
            loser: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      memberSince: user.createdAt.toISOString(),
      university: user.university,
      gameHandles: user.gameHandles,
      teams: user.teamMemberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        gameTitle: m.team.gameTitle,
        preferredRole: m.preferredRole,
        gameHandle: m.gameHandle,
        isCaptain: m.team.captainId === userId,
        glicko2_rating: m.team.glicko2_rating,
        glicko2_rd: m.team.glicko2_rd,
        joinedAt: m.joinedAt.toISOString(),
      })),
      recentMatches: recentStats.map((s) => ({
        matchId: s.match.id,
        playedAt: s.match.playedAt.toISOString(),
        matchMode: s.match.matchMode,
        tournamentName:
          s.match.tournament?.name ??
          (s.match.matchMode === MatchMode.SCRIM ? 'Practice Scrimmage' : null),
        opponentName: s.win ? s.match.loser?.name : s.match.winner?.name,
        result: s.win ? 'WIN' : 'LOSS',
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
      })),
    };
  }
}
