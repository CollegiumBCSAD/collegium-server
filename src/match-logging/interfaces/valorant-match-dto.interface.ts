export interface ValorantMatchInfoDto {
  gameLengthMillis: number;
  gameMode: string;
  provisioningFlowId: string;
}

export interface ValorantTeamDto {
  teamId: string;
  won: boolean;
}

export interface ValorantDamageDto {
  headshots: number;
  bodyshots: number;
  legshots: number;
}

export interface ValorantKillDto {
  killer: string;
  timeSinceRoundStartMillis: number;
}

export interface ValorantPlayerRoundStatDto {
  puuid: string;
  damage: ValorantDamageDto[];
  kills: ValorantKillDto[];
}

export interface ValorantRoundResultDto {
  bombPlanter: string | null;
  bombDefuser: string | null;
  playerStats: ValorantPlayerRoundStatDto[];
}

export interface ValorantPlayerStatsDto {
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  damageDealt: number;
}

export interface ValorantPlayerDto {
  puuid: string;
  gameName: string;
  tagLine: string;
  teamId: string;
  characterId: string;
  stats: ValorantPlayerStatsDto;
}

export interface ValorantMatchDto {
  matchInfo: ValorantMatchInfoDto;
  teams: ValorantTeamDto[];
  roundResults: ValorantRoundResultDto[];
  players: ValorantPlayerDto[];
}
