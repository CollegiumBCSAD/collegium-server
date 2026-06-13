import { Injectable, Logger } from '@nestjs/common';
import { MatchMode } from '@prisma/client';
import { LolParticipant } from './interfaces/lol-participant.interface';
import { VcsResult } from './interfaces/vcs-result.interface';

@Injectable()
export class VcsCalculatorService {
  private readonly logger = new Logger(VcsCalculatorService.name);

  private readonly TOURNAMENT_MULTIPLIER = 1.5;
  private readonly SCRIM_MULTIPLIER = 1.0;

  calculateMatchVcs(
    participants: LolParticipant[],
    matchMode: MatchMode,
  ): Map<string, VcsResult> {

    const teamTotals = this.computeTeamTotals(participants);

    const multiplier =
      matchMode === MatchMode.TOURNAMENT
        ? this.TOURNAMENT_MULTIPLIER
        : this.SCRIM_MULTIPLIER;

    const results = new Map<string, VcsResult>();

    for (const participant of participants) {
      const totals = teamTotals.get(participant.teamId);

      if (!totals) {
        this.logger.warn(`No team totals found for teamId ${participant.teamId}`);
        continue;
      }

      const vcs = this.calculatePlayerVcs(participant, totals, multiplier);
      results.set(participant.puuid, vcs);

      this.logger.log(
        `VCS for ${participant.riotIdGameName}: ${vcs.finalVcs.toFixed(3)}`,
      );
    }

    return results;
  }

  private computeTeamTotals(
    participants: LolParticipant[],
  ): Map<number, { totalDamage: number; totalVision: number }> {

    const totals = new Map<number, { totalDamage: number; totalVision: number }>();

    for (const p of participants) {
      const existing = totals.get(p.teamId) ?? {
        totalDamage: 0,
        totalVision: 0,
      };

      totals.set(p.teamId, {
        totalDamage: existing.totalDamage + p.totalDamageDealtToChampions,
        totalVision: existing.totalVision + p.visionScore,
      });
    }

    return totals;
  }

  private calculatePlayerVcs(
    participant: LolParticipant,
    teamTotals: { totalDamage: number; totalVision: number },
    multiplier: number,
  ): VcsResult {

    const kdaScore =
      (participant.kills + participant.assists) /
      Math.max(participant.deaths, 1);

    const damageScore =
      teamTotals.totalDamage > 0
        ? participant.totalDamageDealtToChampions / teamTotals.totalDamage
        : 0;

    const visionScoreNormalized =
      teamTotals.totalVision > 0
        ? participant.visionScore / teamTotals.totalVision
        : 0;

    const objectiveScore =
      participant.turretKills +
      participant.inhibitorKills +
      participant.objectivesStolen;

    const rawScore =
      kdaScore + damageScore + visionScoreNormalized + objectiveScore;

    const finalVcs = rawScore * multiplier;

    return {
      puuid: participant.puuid,
      kdaScore: parseFloat(kdaScore.toFixed(4)),
      damageScore: parseFloat(damageScore.toFixed(4)),
      visionScore: parseFloat(visionScoreNormalized.toFixed(4)),
      objectiveScore,
      rawScore: parseFloat(rawScore.toFixed(4)),
      tournamentMultiplier: multiplier,
      finalVcs: parseFloat(finalVcs.toFixed(4)),
    };
  }
}
