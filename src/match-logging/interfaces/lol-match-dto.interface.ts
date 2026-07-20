export interface LolMatchParticipantDto {
  puuid: string;
  riotIdGameName: string;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  teamId: number;
  championName: string;
  role: string;
  lane: string;
  totalDamageDealt: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  objectivesStolen: number;
  turretKills: number;
  inhibitorKills: number;
}

export interface LolMatchInfoDto {
  participants: LolMatchParticipantDto[];
  gameDuration: number;
  gameMode: string;
  platformId: string;
}

export interface LolMatchDto {
  info: LolMatchInfoDto;
}
