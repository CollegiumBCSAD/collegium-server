import { Injectable, Logger } from '@nestjs/common';
import { MatchMode } from '@prisma/client';
import { NormalizedParticipant } from './interfaces/normalized-participant.interface';
import { VcsResult } from './interfaces/vcs-result.interface';

@Injectable()
export class VcsCalculatorService {
  private readonly logger = new Logger(VcsCalculatorService.name);

  private readonly TOURNAMENT_MULTIPLIER = 1.5;
  private readonly SCRIM_MULTIPLIER = 1.0;

  calculateMatchVcs(
    participants: NormalizedParticipant[],
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
    participants: NormalizedParticipant[],
  ): Map<number, { totalDamage: number; totalVision: number }> {

    const totals = new Map<number, { totalDamage: number; totalVision: number }>();

    for (const p of participants) {
      const extras = p.extras ?? {};
      const totalDamageDealtToChampions = (extras.totalDamageDealtToChampions as number) ?? 0;
      const visionScore = (extras.visionScore as number) ?? 0;

      const existing = totals.get(p.teamId) ?? {
        totalDamage: 0,
        totalVision: 0,
      };

      totals.set(p.teamId, {
        totalDamage: existing.totalDamage + totalDamageDealtToChampions,
        totalVision: existing.totalVision + visionScore,
      });
    }

    return totals;
  }

  private calculatePlayerVcs(
    participant: NormalizedParticipant,
    teamTotals: { totalDamage: number; totalVision: number },
    multiplier: number,
  ): VcsResult {
    const extras = participant.extras ?? {};
    const totalDamageDealtToChampions = (extras.totalDamageDealtToChampions as number) ?? 0;
    const visionScore = (extras.visionScore as number) ?? 0;
    const turretKills = (extras.turretKills as number) ?? 0;
    const inhibitorKills = (extras.inhibitorKills as number) ?? 0;
    const objectivesStolen = (extras.objectivesStolen as number) ?? 0;

    const kdaScore =
      (participant.kills + participant.assists) /
      Math.max(participant.deaths, 1);

    const damageScore =
      teamTotals.totalDamage > 0
        ? totalDamageDealtToChampions / teamTotals.totalDamage
        : 0;

    const visionScoreNormalized =
      teamTotals.totalVision > 0
        ? visionScore / teamTotals.totalVision
        : 0;

    const objectiveScore =
      turretKills +
      inhibitorKills +
      objectivesStolen;

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

  calculateValorantMatchVcs(
    participants: NormalizedParticipant[],
    matchMode: MatchMode,
  ): Map<string, VcsResult> {
    const teamTotals = this.computeValorantTeamTotals(participants);

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

      const vcs = this.calculateValorantPlayerVcs(participant, totals, multiplier);
      results.set(participant.puuid, vcs);

      this.logger.log(
        `VCS for ${participant.riotIdGameName}: ${vcs.finalVcs.toFixed(3)}`,
      );
    }

    return results;
  }

  private computeValorantTeamTotals(
    participants: NormalizedParticipant[],
  ): Map<number, { totalCombatScore: number; count: number }> {
    const totals = new Map<number, { totalCombatScore: number; count: number }>();

    for (const p of participants) {
      const extras = p.extras ?? {};
      const score = (extras.combatScore as number) ?? 0;

      const existing = totals.get(p.teamId) ?? {
        totalCombatScore: 0,
        count: 0,
      };

      totals.set(p.teamId, {
        totalCombatScore: existing.totalCombatScore + score,
        count: existing.count + 1,
      });
    }

    return totals;
  }

  private calculateValorantPlayerVcs(
    participant: NormalizedParticipant,
    teamTotals: { totalCombatScore: number; count: number },
    multiplier: number,
  ): VcsResult {
    const extras = participant.extras ?? {};
    const combatScore = (extras.combatScore as number) ?? 0;
    const headshotPct = (extras.headshotPct as number) ?? 0;
    const plants = (extras.plants as number) ?? 0;
    const defuses = (extras.defuses as number) ?? 0;
    const firstBloods = (extras.firstBloods as number) ?? 0;

    const kdaScore =
      (participant.kills + participant.assists) /
      Math.max(participant.deaths, 1);

    const teamAvgScore = teamTotals.count > 0 ? teamTotals.totalCombatScore / teamTotals.count : 0;
    const combatScoreShare = teamAvgScore > 0 ? combatScore / teamAvgScore : 0;

    const headshotBonus = headshotPct;

    const objectiveScore = plants + defuses + firstBloods;

    const rawScore = kdaScore + combatScoreShare + headshotBonus + objectiveScore;

    const finalVcs = rawScore * multiplier;

    return {
      puuid: participant.puuid,
      kdaScore: parseFloat(kdaScore.toFixed(4)),
      damageScore: parseFloat(combatScoreShare.toFixed(4)), // Reusing damageScore for ACS share
      visionScore: parseFloat(headshotBonus.toFixed(4)), // Reusing visionScore for HS%
      objectiveScore,
      rawScore: parseFloat(rawScore.toFixed(4)),
      tournamentMultiplier: multiplier,
      finalVcs: parseFloat(finalVcs.toFixed(4)),
    };
  }
}
