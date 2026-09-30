import { GameTitle } from '@prisma/client';
import {
  gamesNeededToWin,
  resolveSeriesWinner,
  seriesLengthFor,
  tallySeriesWins,
  tierForEliminationRound,
} from './series.util';

const games = (...winners: string[]) => winners.map((winnerId) => ({ winnerId }));

describe('gamesNeededToWin', () => {
  it('is a majority of the series length', () => {
    expect(gamesNeededToWin(1)).toBe(1);
    expect(gamesNeededToWin(3)).toBe(2);
    expect(gamesNeededToWin(5)).toBe(3);
    expect(gamesNeededToWin(7)).toBe(4);
  });

  it('treats a non-positive series length as best of one', () => {
    expect(gamesNeededToWin(0)).toBe(1);
  });
});

describe('resolveSeriesWinner', () => {
  it('resolves a best of three sweep', () => {
    expect(resolveSeriesWinner(games('umak', 'umak'), 3)).toBe('umak');
  });

  it('resolves a best of three that went the distance', () => {
    expect(resolveSeriesWinner(games('umak', 'ateneo', 'umak'), 3)).toBe('umak');
  });

  it('leaves a best of three open at one map each', () => {
    expect(resolveSeriesWinner(games('umak', 'ateneo'), 3)).toBeNull();
  });

  it('leaves an empty series open', () => {
    expect(resolveSeriesWinner([], 3)).toBeNull();
  });

  it('resolves a best of one', () => {
    expect(resolveSeriesWinner(games('ateneo'), 1)).toBe('ateneo');
  });

  it('resolves a best of five that went the distance', () => {
    const played = games('umak', 'ateneo', 'ateneo', 'umak', 'umak');
    expect(resolveSeriesWinner(played, 5)).toBe('umak');
  });

  it('leaves a best of five open at two maps each', () => {
    expect(
      resolveSeriesWinner(games('umak', 'ateneo', 'ateneo', 'umak'), 5),
    ).toBeNull();
  });
});

describe('tallySeriesWins', () => {
  it('counts maps won per university', () => {
    const tally = tallySeriesWins(games('umak', 'ateneo', 'umak'));
    expect(tally.get('umak')).toBe(2);
    expect(tally.get('ateneo')).toBe(1);
  });
});

describe('tierForEliminationRound', () => {
  it('tiers an eight-team tree as early, late, then final', () => {
    expect(tierForEliminationRound(1, 3)).toBe('EARLY');
    expect(tierForEliminationRound(2, 3)).toBe('LATE');
    expect(tierForEliminationRound(3, 3)).toBe('FINAL');
  });

  it('tiers a sixteen-team tree with two early rounds', () => {
    expect(tierForEliminationRound(1, 4)).toBe('EARLY');
    expect(tierForEliminationRound(2, 4)).toBe('EARLY');
    expect(tierForEliminationRound(3, 4)).toBe('LATE');
    expect(tierForEliminationRound(4, 4)).toBe('FINAL');
  });

  it('treats a four-team tree as semifinals then final', () => {
    expect(tierForEliminationRound(1, 2)).toBe('LATE');
    expect(tierForEliminationRound(2, 2)).toBe('FINAL');
  });

  it('treats a lone match as the final', () => {
    expect(tierForEliminationRound(1, 1)).toBe('FINAL');
  });

  it('treats a round past the tree depth as the final', () => {
    expect(tierForEliminationRound(4, 3)).toBe('FINAL');
  });
});

describe('seriesLengthFor', () => {
  it('escalates mobile legends from best of three to best of seven', () => {
    expect(seriesLengthFor('EARLY', GameTitle.MLBB)).toBe(3);
    expect(seriesLengthFor('LATE', GameTitle.MLBB)).toBe(5);
    expect(seriesLengthFor('FINAL', GameTitle.MLBB)).toBe(7);
  });

  it('keeps call of duty mobile at a flat best of three', () => {
    expect(seriesLengthFor('EARLY', GameTitle.CODM)).toBe(3);
    expect(seriesLengthFor('LATE', GameTitle.CODM)).toBe(3);
    expect(seriesLengthFor('FINAL', GameTitle.CODM)).toBe(3);
  });

  it('keeps valorant and league at a single game per match', () => {
    expect(seriesLengthFor('FINAL', GameTitle.VALORANT)).toBe(1);
    expect(seriesLengthFor('FINAL', GameTitle.LOL)).toBe(1);
  });

  it('falls back to league defaults for a titleless tournament', () => {
    expect(seriesLengthFor('EARLY', null)).toBe(1);
  });

  it('prefers an organizer override over the default', () => {
    const overrides = { bestOfEarly: 5, bestOfLate: 7, bestOfFinal: 7 };
    expect(seriesLengthFor('EARLY', GameTitle.MLBB, overrides)).toBe(5);
    expect(seriesLengthFor('FINAL', GameTitle.CODM, overrides)).toBe(7);
  });

  it('ignores a null or zero override and uses the default', () => {
    expect(
      seriesLengthFor('LATE', GameTitle.MLBB, { bestOfLate: null }),
    ).toBe(5);
    expect(seriesLengthFor('LATE', GameTitle.MLBB, { bestOfLate: 0 })).toBe(5);
    expect(seriesLengthFor('LATE', GameTitle.MLBB, {})).toBe(5);
  });
});

describe('resolveSeriesWinner at best of seven', () => {
  it('resolves a seven game series', () => {
    const played = games('a', 'b', 'a', 'b', 'a', 'b', 'a');
    expect(resolveSeriesWinner(played, 7)).toBe('a');
    expect(gamesNeededToWin(7)).toBe(4);
  });

  it('leaves a best of seven open at three games each', () => {
    expect(
      resolveSeriesWinner(games('a', 'b', 'a', 'b', 'a', 'b'), 7),
    ).toBeNull();
  });
});
