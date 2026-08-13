import { Test, TestingModule } from '@nestjs/testing';
import { GlickoService } from './glicko.service';

describe('GlickoService', () => {
  let service: GlickoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlickoService],
    }).compile();

    service = module.get<GlickoService>(GlickoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should increase rating of winner and decrease rating of loser', () => {
    const winner = { rating: 1500, rd: 350, sigma: 0.06 };
    const loser = { rating: 1500, rd: 350, sigma: 0.06 };

    const result = service.calculateMatch(winner, loser);

    expect(result.winner.rating).toBeGreaterThan(1500);
    expect(result.loser.rating).toBeLessThan(1500);
    expect(result.winner.rd).toBeLessThan(350);
    expect(result.loser.rd).toBeLessThan(350);
  });

  it('should handle opponent with lower rating', () => {
    const winner = { rating: 1500, rd: 350, sigma: 0.06 };
    const loser = { rating: 1000, rd: 200, sigma: 0.06 };

    const result = service.calculateMatch(winner, loser);

    expect(result.winner.rating).toBeGreaterThan(1500);
    expect(result.loser.rating).toBeLessThan(1000);
  });
});
