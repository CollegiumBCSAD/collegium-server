import { FuzzyMatcherService, AthleteCandidate } from './fuzzy-matcher.service';

describe('FuzzyMatcherService', () => {
  let service: FuzzyMatcherService;

  beforeEach(() => {
    service = new FuzzyMatcherService();
  });

  it('canonicalizes clan tags and OCR glyphs correctly', () => {
    expect(service.canonicalize('[UP] Shroud')).toBe('shroud');
    expect(service.canonicalize('<T1> F4k3r')).toBe('faker');
    expect(service.canonicalize('0men_K1ng')).toBe('omenklng');
    expect(service.canonicalize('B1g$hot')).toBe('blgshot');
  });

  it('matches exact name with 1.0 confidence', () => {
    const candidates: AthleteCandidate[] = [
      {
        userId: 'u1',
        displayName: 'Justine',
        gameHandle: 'TenZ',
        teamId: 't1',
        teamName: 'Sentinels',
      },
    ];

    const res = service.resolvePlayer('TenZ', candidates);
    expect(res.matchedCandidate?.userId).toBe('u1');
    expect(res.confidence).toBe(1.0);
    expect(res.isHighConfidence).toBe(true);
  });

  it('resolves OCR artifacts (e.g. 0 for O, clan tags) with high confidence', () => {
    const candidates: AthleteCandidate[] = [
      {
        userId: 'u2',
        displayName: 'Omen King',
        gameHandle: 'OmenKing',
        teamId: 't1',
        teamName: 'Sentinels',
      },
      {
        userId: 'u3',
        displayName: 'Breeze',
        gameHandle: 'Breeze',
        teamId: 't1',
        teamName: 'Sentinels',
      },
    ];

    // Raw OCR has clan tag and '0' instead of 'O'
    const res = service.resolvePlayer('[SEN] 0menKing', candidates);
    expect(res.matchedCandidate?.userId).toBe('u2');
    expect(res.isHighConfidence).toBe(true);
  });

  it('flags low confidence match when string is substantially different', () => {
    const candidates: AthleteCandidate[] = [
      {
        userId: 'u1',
        displayName: 'John',
        gameHandle: 'ViperMain',
        teamId: 't1',
        teamName: 'Team A',
      },
    ];

    const res = service.resolvePlayer('RandomPlayer', candidates);
    expect(res.isHighConfidence).toBe(false);
  });
});
