import { MatchParser, ParsedMatch } from './parser.interface';
import { NormalizedParticipant } from '../interfaces/normalized-participant.interface';

export class ValorantParser implements MatchParser {
  parse(rawData: any): ParsedMatch {
    const matchInfo = rawData.matchInfo;
    if (!matchInfo) {
      throw new Error('Invalid Valorant match data: rawData.matchInfo is missing');
    }

    // Determine winning team
    let winningTeamId = '';
    if (Array.isArray(rawData.teams)) {
      const winner = rawData.teams.find((t: any) => t.won === true);
      if (winner) {
        winningTeamId = winner.teamId;
      }
    }

    // Process round results to calculate plants, defuses, and first bloods per puuid
    const plants = new Map<string, number>();
    const defuses = new Map<string, number>();
    const firstBloods = new Map<string, number>();

    if (Array.isArray(rawData.roundResults)) {
      for (const round of rawData.roundResults) {
        if (round.bombPlanter) {
          plants.set(round.bombPlanter, (plants.get(round.bombPlanter) ?? 0) + 1);
        }
        if (round.bombDefuser) {
          defuses.set(round.bombDefuser, (defuses.get(round.bombDefuser) ?? 0) + 1);
        }

        // First blood calculation in round
        let earliestKill: any = null;
        if (Array.isArray(round.playerStats)) {
          for (const pStat of round.playerStats) {
            if (Array.isArray(pStat.kills)) {
              for (const kill of pStat.kills) {
                if (
                  kill.killer &&
                  (!earliestKill || kill.timeSinceRoundStartMillis < earliestKill.time)
                ) {
                  earliestKill = {
                    killer: kill.killer,
                    time: kill.timeSinceRoundStartMillis,
                  };
                }
              }
            }
          }
        }
        if (earliestKill) {
          firstBloods.set(earliestKill.killer, (firstBloods.get(earliestKill.killer) ?? 0) + 1);
        }
      }
    }

    const participants: NormalizedParticipant[] = (rawData.players ?? []).map((p: any) => {
      const stats = p.stats ?? { kills: 0, deaths: 0, assists: 0, score: 0, damageDealt: 0, headshots: 0, bodyshots: 0, legshots: 0 };
      
      const totalHits = (stats.headshots ?? 0) + (stats.bodyshots ?? 0) + (stats.legshots ?? 0);
      const headshotPct = totalHits > 0 ? (stats.headshots ?? 0) / totalHits : 0;

      // Map team string to int (Red = 1, Blue = 2, others = 0)
      let teamIdInt = 0;
      if (p.teamId === 'Red') teamIdInt = 1;
      else if (p.teamId === 'Blue') teamIdInt = 2;

      const normalized: NormalizedParticipant = {
        puuid: p.puuid,
        riotIdGameName: p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : 'Unknown',
        kills: stats.kills ?? 0,
        deaths: stats.deaths ?? 0,
        assists: stats.assists ?? 0,
        win: p.teamId === winningTeamId,
        teamId: teamIdInt,
        extras: {
          agentName: p.characterId ?? 'Unknown',
          combatScore: stats.score ?? 0,
          headshotPct,
          plants: plants.get(p.puuid) ?? 0,
          defuses: defuses.get(p.puuid) ?? 0,
          firstBloods: firstBloods.get(p.puuid) ?? 0,
          damageDealt: stats.damageDealt ?? 0,
        },
      };

      return normalized;
    });

    const durationSeconds = Math.round((matchInfo.gameLengthMillis ?? 0) / 1000);

    return {
      gameDuration: durationSeconds,
      gameMode: matchInfo.gameMode ?? 'Unknown',
      platformId: matchInfo.provisioningFlowId ?? 'Unknown',
      participants,
    };
  }
}
