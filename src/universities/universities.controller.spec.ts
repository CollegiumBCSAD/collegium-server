import { Test, TestingModule } from '@nestjs/testing';
import { UniversitiesController } from './universities.controller';
import { UniversitiesService } from './universities.service';

describe('UniversitiesController', () => {
  let controller: UniversitiesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UniversitiesController],
      providers: [
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
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
