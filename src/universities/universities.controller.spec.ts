import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UniversitiesController } from './universities.controller';
import { UniversitiesService } from './universities.service';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

describe('UniversitiesController', () => {
  let controller: UniversitiesController;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UniversitiesController],
      providers: [
        Reflector,
        {
          provide: UniversitiesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UniversitiesController>(UniversitiesController);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  /* eslint-disable @typescript-eslint/unbound-method */
  it('should mark findAll as @Public() for open leaderboard browsing', () => {
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.findAll);
    expect(isPublic).toBe(true);
  });

  it('should mark findOne as @Public() for open university profile browsing', () => {
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.findOne);
    expect(isPublic).toBe(true);
  });
  /* eslint-enable @typescript-eslint/unbound-method */
});
