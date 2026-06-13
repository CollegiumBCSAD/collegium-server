export interface LolParticipant {
  puuid: string;
  riotIdGameName: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  role: string;
  lane: string;
  totalDamageDealt: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  objectivesStolen: number;
  turretKills: number;
  inhibitorKills: number;
  win: boolean;
  teamId: number;
}
