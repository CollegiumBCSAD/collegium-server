import { Test, TestingModule } from '@nestjs/testing';
import { MatchLoggingController } from './match-logging.controller';
import { MatchLoggingService } from './match-logging.service';
import { GameTitle, MatchMode } from '@prisma/client';

describe('MatchLoggingController', () => {
  let controller: MatchLoggingController;
  let service: MatchLoggingService;

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
    service = module.get<MatchLoggingService>(MatchLoggingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('logMatch()', () => {
    it('should call logMatch service method and return success message', async () => {
      const title = GameTitle.VALORANT;
      const matchId = 'val-match-123';
      const mode = MatchMode.TOURNAMENT;
      const useMock = 'true';

      await controller.logMatch(title, matchId, mode, useMock);

      expect(service.logMatch).toHaveBeenCalledWith(title, matchId, mode, true);
    });
  });
});
