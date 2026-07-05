export interface NormalizedParticipant {
  puuid: string;
  riotIdGameName: string;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  teamId: number;
  // Game-specific raw/parsed stats
  extras?: Record<string, any>;
}
