import { GameTitle } from '@prisma/client';
import { MatchParser } from './parser.interface';
import { LolParser } from './lol.parser';
import { ValorantParser } from './valorant.parser';

// ponytail: direct map replaces switch factory (YAGNI)
export class ParserFactory {
  static getParser(title: GameTitle): MatchParser {
    switch (title) {
      case GameTitle.LOL:
        return new LolParser();
      case GameTitle.VALORANT:
        return new ValorantParser();
      default:
        throw new Error(`Unsupported game title: ${title}`);
    }
  }
}
