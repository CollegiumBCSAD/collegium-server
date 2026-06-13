import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameTitle, MatchMode, DataSource } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { VcsCalculatorService } from './vcs-calculator.service';

@Injectable()
export class MatchLoggingService {
  private readonly logger = new Logger(MatchLoggingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vcsCalculator: VcsCalculatorService,
  ) { }

  // Load match data from fixure file
  // This is just used for development instead of hitting the real API
  //

  private loadFixture(): any {
    const fixturePath = path.join(
      process.cwd(),
      'src/match-logging/fixtures/sample-lol-match.json',
    );

    const raw = fs.readFileSync(fixturePath, 'utf-8');
    return JSON.parse(raw);
  }

  // This will be the real method to fetch match data from the Riot API
  // This is what we'll use when we have a proper production key
  // We can use development key for LoL only but for valorant we would need the production key

  private async fetchFromRiotApi(matchId: string): Promise<any> {
    const apiKey = process.env.RIOT_API_KEY;

    // currently, it is hardcoded to LoL but we can extend this for valorant
    const url = `https://sea.api.riotgames.com/lol/match/v5/matches/${matchId}`;

    const response = await axios.get(url, {
      headers: {
        'X-Riot-Token': apiKey,
      },
    });

    return response.data;
  }

  // Main method to log match data to database
  // matchId - the ID of the match to log
  // matchMode - TOURNAMENT or SCRIM
  // useMock - true = use fixture file, false = call real API

  async logMatch(
    matchId: string,
    matchMode: MatchMode,
    useMock: boolean = true,
  ): Promise<void> {
    this.logger.log(
      `Logging match ${matchId} with mode ${matchMode} (useMock=${useMock})`,
    );

    // we get the raw match data either from the fixture file or from the Riot API

    const rawData = useMock
      ? this.loadFixture()
      : await this.fetchFromRiotApi(matchId);

    const info = rawData.info;

    const vcsResults = this.vcsCalculator.calculateMatchVcs(info.participants, matchMode);

    // check if the match already exists in the database
    const existing = await this.prisma.match.findUnique({
      where: {
        riotMatchId: matchId,
      },
    });

    if (existing) {
      this.logger.warn(
        `Match with riotMatchId ${matchId} already exists in the database. Skipping.`,
      );
      return;
    }

    // if not, we create a new match record in the database
    await this.prisma.$transaction(async (tx) => {
      // parent match record first
      const match = await tx.match.create({
        data: {
          riotMatchId: matchId,
          title: GameTitle.LOL,
          matchMode,
          gameDuration: info.gameDuration,
          gameMode: info.gameMode,
          platformId: info.platformId,
        },
      });

      this.logger.log(
        `Created match record with ID ${match.id} for riotMatchId ${matchId}`,
      );

      // we loop through all 10 participants

      for (const participant of info.participants) {
        await tx.playerStat.create({
          data: {
            matchId: match.id,
            puuid: participant.puuid,
            summonerName: participant.riotIdGameName ?? 'Unknown',
            championName: participant.championName,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            role: participant.role,
            lane: participant.lane,
            totalDamageDealt: participant.totalDamageDealt,
            totalDamageDealtToChampions:
              participant.totalDamageDealtToChampions,
            visionScore: participant.visionScore,
            objectivesStolen: participant.objectivesStolen,
            turretKills: participant.turretKills,
            inhibitorKills: participant.inhibitorKills,
            win: participant.win,
            teamId: participant.teamId,
            vcsScore: vcsResults.get(participant.puuid)?.finalVcs ?? 0,
            dataSource: DataSource.API,
          },
        });
      }
      this.logger.log(
        `Logged stats for all participants of match ${matchId} (ID: ${match.id})`,
      );

    });
  }

  // get all player stat for a match
  async getMatchStats(matchId: string) {
    return this.prisma.match.findUnique({
      where: {
        riotMatchId: matchId,
      },
      include: {
        playerStats: true,
      },
    });
  }
}
