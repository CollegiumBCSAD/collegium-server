import {
  gamesNeededToWin,
  resolveSeriesWinner,
  tallySeriesWins,
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
