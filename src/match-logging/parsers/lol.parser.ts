import { MatchParser, ParsedMatch } from './parser.interface';
import { NormalizedParticipant } from '../interfaces/normalized-participant.interface';
import { LolMatchDto } from '../interfaces/lol-match-dto.interface';

export class LolParser implements MatchParser {
  parse(rawData: LolMatchDto): ParsedMatch {
    const info = rawData.info;
    if (!info) {
      throw new Error(
        'Invalid League of Legends match data: rawData.info is missing',
      );
    }

    const participants: NormalizedParticipant[] = info.participants.map(
      (p) => {
        const normalized: NormalizedParticipant = {
          puuid: p.puuid,
          riotIdGameName: p.riotIdGameName ?? 'Unknown',
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          win: p.win,
          teamId: p.teamId,
          extras: {
            championName: p.championName,
            role: p.role,
            lane: p.lane,
            totalDamageDealt: p.totalDamageDealt,
            totalDamageDealtToChampions: p.totalDamageDealtToChampions,
            visionScore: p.visionScore,
            objectivesStolen: p.objectivesStolen,
            turretKills: p.turretKills,
            inhibitorKills: p.inhibitorKills,
          },
        };
        return normalized;
      },
    );

    return {
      gameDuration: info.gameDuration,
      gameMode: info.gameMode,
      platformId: info.platformId,
      participants,
    };
  }
}
