import { NormalizedParticipant } from '../interfaces/normalized-participant.interface';

export interface ParsedMatch {
  gameDuration: number;
  gameMode: string;
  platformId: string;
  participants: NormalizedParticipant[];
}

export interface MatchParser {
  parse(rawData: unknown): ParsedMatch;
}
