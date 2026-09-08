import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

describe('TournamentsController', () => {
  let controller: TournamentsController;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TournamentsController],
      providers: [
        Reflector,
        {
          provide: TournamentsService,
          useValue: {
            create: jest.fn(),
            registerUniversity: jest.fn(),
            generateBracket: jest.fn(),
            getBracket: jest.fn(),
            closeMatch: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TournamentsController>(TournamentsController);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  /* eslint-disable @typescript-eslint/unbound-method */
  it('should mark findAll as @Public() for open tournament browsing', () => {
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.findAll);
    expect(isPublic).toBe(true);
  });

  it('should mark findOne as @Public() for open tournament detail browsing', () => {
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.findOne);
    expect(isPublic).toBe(true);
  });

  it('should mark getBracket as @Public() for open tournament bracket inspection', () => {
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.getBracket);
    expect(isPublic).toBe(true);
  });
  /* eslint-enable @typescript-eslint/unbound-method */
});

