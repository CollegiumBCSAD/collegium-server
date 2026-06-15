import { Test, TestingModule } from '@nestjs/testing';
import { MatchLoggingController } from './match-logging.controller';
import { MatchLoggingService } from './match-logging.service';

describe('MatchLoggingController', () => {
  let controller: MatchLoggingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatchLoggingController],
      providers: [
        {
          provide: MatchLoggingService,
          useValue: {
            logMatch: jest.fn(),
            getMatchStats: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<MatchLoggingController>(MatchLoggingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
