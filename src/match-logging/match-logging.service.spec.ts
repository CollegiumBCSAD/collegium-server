import { Test, TestingModule } from '@nestjs/testing';
import { MatchLoggingService } from './match-logging.service';

describe('MatchLoggingService', () => {
  let service: MatchLoggingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchLoggingService],
    }).compile();

    service = module.get<MatchLoggingService>(MatchLoggingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
