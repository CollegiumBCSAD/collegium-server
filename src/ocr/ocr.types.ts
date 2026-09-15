import { GameTitle } from '@prisma/client';

export interface ScannedPlayer {
  ign: string;
  team: string | null;
  kills: number;
  deaths: number;
  assists: number;
  extra: Record<string, unknown>;
}

export interface ScanResult {
  game: GameTitle;
  players: ScannedPlayer[];
}
