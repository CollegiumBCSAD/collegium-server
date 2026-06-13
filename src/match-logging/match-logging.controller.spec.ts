import { Test, TestingModule } from '@nestjs/testing';
import { MatchLoggingController } from './match-logging.controller';

describe('MatchLoggingController', () => {
  let controller: MatchLoggingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatchLoggingController],
    }).compile();

    controller = module.get<MatchLoggingController>(MatchLoggingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
