import { Injectable } from '@nestjs/common';

export interface AthleteCandidate {
  userId: string;
  displayName: string;
  gameHandle: string;
  teamId: string;
  teamName: string;
  role?: string | null;
  studentId?: string | null;
  aliases?: string[];
}

export interface MatchResolutionResult {
  rawIgn: string;
  matchedCandidate: AthleteCandidate | null;
  confidence: number;
  isHighConfidence: boolean;
  suggestedCandidates: Array<{
    candidate: AthleteCandidate;
    confidence: number;
  }>;
}

@Injectable()
export class FuzzyMatcherService {
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.85;

  /**
   * Cleans and canonicalizes strings by stripping clan tags, special symbols,
   * and applying OCR glyph substitutions (e.g., 0->o, 1->l, 5->s).
   */
  canonicalize(input: string): string {
    if (!input) return '';

    let text = input.trim();

    // Strip common bracketed clan/team tags: [TAG], <TAG>, (TAG), {TAG}
    text = text.replace(/^\[[^\]]+\]\s*/i, '');
    text = text.replace(/^<[^>]+>\s*/i, '');
    text = text.replace(/^\([^)]+\)\s*/i, '');
    text = text.replace(/^\{[^}]+\}\s*/i, '');

    // Lowercase
    text = text.toLowerCase();

    // Canonicalize common OCR visual confusions BEFORE removing punctuation
    text = text
      .replace(/0/g, 'o')
      .replace(/[1|!]/g, 'l')
      .replace(/[5$]/g, 's')
      .replace(/8/g, 'b')
      .replace(/3/g, 'e')
      .replace(/[4@]/g, 'a')
      .replace(/7/g, 't')
      .replace(/vv/g, 'w');

    // Remove non-alphanumeric characters except basic spaces
    return text.replace(/[^a-z0-9]/g, '');
  }

  /**
   * Computes standard Levenshtein distance between two strings.
   */
  levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const matrix: number[][] = [];
    for (let i = 0; i <= m; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= n; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost, // substitution
        );
      }
    }

    return matrix[m][n];
  }

  /**
   * Computes normalized similarity between 0 and 1.
   */
  similarity(strA: string, strB: string): number {
    if (!strA && !strB) return 1.0;
    if (!strA || !strB) return 0.0;

    const canonA = this.canonicalize(strA);
    const canonB = this.canonicalize(strB);

    if (canonA === canonB) return 1.0;

    // Substring bonus: if one is exact prefix or substring of another
    if (canonA.length >= 3 && canonB.length >= 3) {
      if (canonA.includes(canonB) || canonB.includes(canonA)) {
        const lenRatio =
          Math.min(canonA.length, canonB.length) /
          Math.max(canonA.length, canonB.length);
        return Math.max(0.85, 0.7 + 0.3 * lenRatio);
      }
    }

    const dist = this.levenshtein(canonA, canonB);
    const maxLen = Math.max(canonA.length, canonB.length);
    if (maxLen === 0) return 1.0;

    const rawScore = 1.0 - dist / maxLen;
    return Math.max(0, Math.min(1.0, rawScore));
  }

  /**
   * Maps an OCR-extracted IGN against a list of verified athlete candidates.
   */
  resolvePlayer(
    rawIgn: string,
    candidates: AthleteCandidate[],
  ): MatchResolutionResult {
    if (!candidates || candidates.length === 0) {
      return {
        rawIgn,
        matchedCandidate: null,
        confidence: 0,
        isHighConfidence: false,
        suggestedCandidates: [],
      };
    }

    const scored = candidates
      .map((c) => {
        const handleScore = this.similarity(rawIgn, c.gameHandle);
        const nameScore = this.similarity(rawIgn, c.displayName);
        let aliasScore = 0;
        if (c.aliases && c.aliases.length > 0) {
          aliasScore = Math.max(...c.aliases.map((a) => this.similarity(rawIgn, a)));
        }

        const maxScore = Math.max(handleScore, nameScore, aliasScore);
        return {
          candidate: c,
          confidence: Number(maxScore.toFixed(3)),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const top = scored[0];
    const isHigh = top ? top.confidence >= this.HIGH_CONFIDENCE_THRESHOLD : false;

    return {
      rawIgn,
      matchedCandidate: top && top.confidence > 0.4 ? top.candidate : null,
      confidence: top ? top.confidence : 0,
      isHighConfidence: isHigh,
      suggestedCandidates: scored.slice(0, 5),
    };
  }

  /**
   * Resolves multiple extracted players against the active candidates.
   */
  resolveBatch(
    extractedPlayers: Array<{ ign: string; [key: string]: any }>,
    candidates: AthleteCandidate[],
  ): Array<{
    extracted: any;
    resolution: MatchResolutionResult;
  }> {
    return extractedPlayers.map((player) => ({
      extracted: player,
      resolution: this.resolvePlayer(player.ign, candidates),
    }));
  }
}
