import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameTitle, MatchMode, DataSource } from '@prisma/client';
import { ParserFactory } from './parsers/parser.factory';
import { NormalizedParticipant } from './interfaces/normalized-participant.interface';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { VcsCalculatorService } from './vcs-calculator.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class MatchLoggingService {
  private readonly logger = new Logger(MatchLoggingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vcsCalculator: VcsCalculatorService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  // Load match data from fixture file for LoL
  private loadFixture(): any {
    const fixturePath = path.join(
      process.cwd(),
      'src/match-logging/fixtures/sample-lol-match.json',
    );

    const raw = fs.readFileSync(fixturePath, 'utf-8');
    return JSON.parse(raw);
  }

  // Load match data from fixture file for Valorant
  private loadValorantFixture(): any {
    const fixturePath = path.join(
      process.cwd(),
      'src/match-logging/fixtures/sample-valorant-match.json',
    );

    const raw = fs.readFileSync(fixturePath, 'utf-8');
    return JSON.parse(raw);
  }

  private async fetchFromRiotApi(matchId: string): Promise<any> {
    const cacheKey = `match:lol:${matchId}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      this.logger.log(`Cache HIT for LoL match ${matchId}`);
      return cachedData;
    }

    const apiKey = this.configService.get<string>('RIOT_API_KEY');
    const url = `https://sea.api.riotgames.com/lol/match/v5/matches/${matchId}`;

    const response = await axios.get(url, {
      headers: {
        'X-Riot-Token': apiKey,
      },
    });

    await this.cacheManager.set(cacheKey, response.data, 86400000);
    this.logger.log(`Cache MISS for LoL match ${matchId}. Saved to Redis.`);

    return response.data;
  }

  private async fetchValorantFromRiotApi(matchId: string): Promise<any> {
    const cacheKey = `match:val:${matchId}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      this.logger.log(`Cache HIT for Valorant match ${matchId}`);
      return cachedData;
    }

    const apiKey = this.configService.get<string>('RIOT_API_KEY');
    const url = `https://ap.api.riotgames.com/val/match/v1/matches/${matchId}`;

    const response = await axios.get(url, {
      headers: {
        'X-Riot-Token': apiKey,
      },
    });

    await this.cacheManager.set(cacheKey, response.data, 86400000);
    this.logger.log(`Cache MISS for Valorant match ${matchId}. Saved to Redis.`);

    return response.data;
  }

  // Main method to log match data to database
  async logMatch(
    title: GameTitle,
    matchId: string,
    matchMode: MatchMode,
    useMock: boolean = true,
    existingMatchId?: string,
  ): Promise<void> {
    this.logger.log(
      `Logging ${title} match ${matchId} with mode ${matchMode} (useMock=${useMock})`,
    );

    // Get the raw match data either from the fixture file or from the Riot API
    const rawData = useMock
      ? (title === GameTitle.VALORANT ? this.loadValorantFixture() : this.loadFixture())
      : (title === GameTitle.VALORANT ? await this.fetchValorantFromRiotApi(matchId) : await this.fetchFromRiotApi(matchId));

    // Parse the raw data using the corresponding parser
    const parser = ParserFactory.getParser(title);
    const parsedMatch = parser.parse(rawData);

    // Calculate VCS scores
    const vcsResults = title === GameTitle.VALORANT
      ? this.vcsCalculator.calculateValorantMatchVcs(parsedMatch.participants, matchMode)
      : this.vcsCalculator.calculateMatchVcs(parsedMatch.participants, matchMode);

    // Check if the match already exists in the database
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

    // Create or update match record and log participant stats
    await this.prisma.$transaction(async (tx) => {
      let match;
      if (existingMatchId) {
        // Update the existing bracket match with Riot API data
        match = await tx.match.update({
          where: { id: existingMatchId },
          data: {
            riotMatchId: matchId,
            gameDuration: parsedMatch.gameDuration,
            gameMode: parsedMatch.gameMode,
            platformId: parsedMatch.platformId,
          },
        });
      } else {
        // Create a standalone match (e.g. for scrims)
        match = await tx.match.create({
          data: {
            riotMatchId: matchId,
            title,
            matchMode,
            gameDuration: parsedMatch.gameDuration,
            gameMode: parsedMatch.gameMode,
            platformId: parsedMatch.platformId,
          },
        });
      }

      this.logger.log(
        `Created match record with ID ${match.id} for riotMatchId ${matchId}`,
      );

      // Loop through all participants
      for (const participant of parsedMatch.participants) {
        const extras = participant.extras ?? {};

        const playerStat = await tx.playerStat.create({
          data: {
            matchId: match.id,
            puuid: participant.puuid,
            summonerName: participant.riotIdGameName,
            championName: (extras.championName as string) ?? null,
            role: (extras.role as string) ?? null,
            lane: (extras.lane as string) ?? null,
            totalDamageDealt: (extras.totalDamageDealt as number) ?? null,
            totalDamageDealtToChampions: (extras.totalDamageDealtToChampions as number) ?? null,
            visionScore: (extras.visionScore as number) ?? null,
            objectivesStolen: (extras.objectivesStolen as number) ?? null,
            turretKills: (extras.turretKills as number) ?? null,
            inhibitorKills: (extras.inhibitorKills as number) ?? null,
            
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            win: participant.win,
            teamId: participant.teamId,
            vcsScore: vcsResults.get(participant.puuid)?.finalVcs ?? 0,
            dataSource: DataSource.API,
          },
        });

        // Write Valorant specific player stats if it is a Valorant match
        if (title === GameTitle.VALORANT) {
          await tx.valorantPlayerStat.create({
            data: {
              playerStatId: playerStat.id,
              agentName: (extras.agentName as string) ?? null,
              combatScore: (extras.combatScore as number) ?? null,
              headshotPct: (extras.headshotPct as number) ?? null,
              plants: (extras.plants as number) ?? null,
              defuses: (extras.defuses as number) ?? null,
              firstBloods: (extras.firstBloods as number) ?? null,
              damageDealt: (extras.damageDealt as number) ?? null,
            },
          });
        }
      }
      this.logger.log(
        `Logged stats for all participants of match ${matchId} (ID: ${match.id})`,
      );

    });
  }

  // Get all player stats for a match
  async getMatchStats(matchId: string) {
    return this.prisma.match.findUnique({
      where: {
        riotMatchId: matchId,
      },
      include: {
        playerStats: {
          include: {
            valorantStat: true,
          },
        },
      },
    });
  }
}
