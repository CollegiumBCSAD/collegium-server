import { GameTitle } from '@prisma/client';
import { MatchParser } from './parser.interface';
import { LolParser } from './lol.parser';
import { ValorantParser } from './valorant.parser';

// ponytail: direct map replaces switch factory (YAGNI)
const PARSERS: Record<string, MatchParser> = {
  [GameTitle.LOL]: new LolParser(),
  [GameTitle.VALORANT]: new ValorantParser(),
};

export class ParserFactory {
  static getParser(title: GameTitle): MatchParser {
    const parser = PARSERS[title];
    if (!parser) {
      throw new Error(`Unsupported game title: ${title}`);
    }
    return parser;
  }
}
