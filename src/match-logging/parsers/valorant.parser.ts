import { MatchParser, ParsedMatch } from './parser.interface';
import { NormalizedParticipant } from '../interfaces/normalized-participant.interface';
import { ValorantMatchDto } from '../interfaces/valorant-match-dto.interface';

export class ValorantParser implements MatchParser {
  parse(rawData: ValorantMatchDto): ParsedMatch {
    const matchInfo = rawData.matchInfo;
    if (!matchInfo) {
      throw new Error(
        'Invalid Valorant match data: rawData.matchInfo is missing',
      );
    }

    // Determine winning team
    let winningTeamId = '';
    if (Array.isArray(rawData.teams)) {
      const winner = rawData.teams.find((t) => t.won === true);
      if (winner) {
        winningTeamId = winner.teamId;
      }
    }

    // Process round results to calculate plants, defuses, first bloods, and hit stats per puuid
    const plants = new Map<string, number>();
    const defuses = new Map<string, number>();
    const firstBloods = new Map<string, number>();
    const headshots = new Map<string, number>();
    const bodyshots = new Map<string, number>();
    const legshots = new Map<string, number>();

    if (Array.isArray(rawData.roundResults)) {
      for (const round of rawData.roundResults) {
        if (round.bombPlanter) {
          plants.set(
            round.bombPlanter,
            (plants.get(round.bombPlanter) ?? 0) + 1,
          );
        }
        if (round.bombDefuser) {
          defuses.set(
            round.bombDefuser,
            (defuses.get(round.bombDefuser) ?? 0) + 1,
          );
        }

        // First blood and hit stats calculation in round
        let earliestKill: { killer: string; time: number } | null = null;
        if (Array.isArray(round.playerStats)) {
          for (const pStat of round.playerStats) {
            const playerPuuid = pStat.puuid;

            // Accumulate hit stats
            if (playerPuuid && Array.isArray(pStat.damage)) {
              for (const dmg of pStat.damage) {
                headshots.set(
                  playerPuuid,
                  (headshots.get(playerPuuid) ?? 0) + (dmg.headshots ?? 0),
                );
                bodyshots.set(
                  playerPuuid,
                  (bodyshots.get(playerPuuid) ?? 0) + (dmg.bodyshots ?? 0),
                );
                legshots.set(
                  playerPuuid,
                  (legshots.get(playerPuuid) ?? 0) + (dmg.legshots ?? 0),
                );
              }
            }

            if (Array.isArray(pStat.kills)) {
              for (const kill of pStat.kills) {
                if (
                  kill.killer &&
                  (!earliestKill ||
                    kill.timeSinceRoundStartMillis < earliestKill.time)
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
          firstBloods.set(
            earliestKill.killer,
            (firstBloods.get(earliestKill.killer) ?? 0) + 1,
          );
        }
      }
    }

    const participants: NormalizedParticipant[] = (rawData.players ?? []).map(
      (p) => {
        const stats = p.stats ?? {
          kills: 0,
          deaths: 0,
          assists: 0,
          score: 0,
          damageDealt: 0,
        };

        const hs = headshots.get(p.puuid) ?? 0;
        const bs = bodyshots.get(p.puuid) ?? 0;
        const ls = legshots.get(p.puuid) ?? 0;
        const totalHits = hs + bs + ls;
        const headshotPct = totalHits > 0 ? hs / totalHits : 0;

        // Map team string to int (Red = 1, Blue = 2, others = 0)
        let teamIdInt = 0;
        if (p.teamId === 'Red') teamIdInt = 1;
        else if (p.teamId === 'Blue') teamIdInt = 2;

        const normalized: NormalizedParticipant = {
          puuid: p.puuid,
          riotIdGameName:
            p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : 'Unknown',
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
      },
    );

    const durationSeconds = Math.round(
      (matchInfo.gameLengthMillis ?? 0) / 1000,
    );

    return {
      gameDuration: durationSeconds,
      gameMode: matchInfo.gameMode ?? 'Unknown',
      platformId: matchInfo.provisioningFlowId ?? 'Unknown',
      participants,
    };
  }
}
