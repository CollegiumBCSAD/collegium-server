export interface ValorantParticipant {
  puuid: string;
  gameName: string;
  tagLine: string;
  teamId: string;
  characterId: string;
  stats: {
    score: number;
    kills: number;
    deaths: number;
    assists: number;
    damageDealt: number;
    headshots: number;
    bodyshots: number;
    legshots: number;
  };
}
