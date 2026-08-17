import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UniversitiesService } from './universities.service';

const mockPrismaService = {
  university: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

describe('UniversitiesService', () => {
  let service: UniversitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UniversitiesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UniversitiesService>(UniversitiesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll()', () => {
    it('should return an array of universities ordered by glicko2_rating descending', async () => {
      const mockUniversities = [
        { id: '1', name: 'Uni A', glicko2_rating: 1600 },
        { id: '2', name: 'Uni B', glicko2_rating: 1500 },
      ];
      mockPrismaService.university.findMany.mockResolvedValue(mockUniversities);

      const result = await service.findAll();

      expect(mockPrismaService.university.findMany).toHaveBeenCalledWith({
        orderBy: { glicko2_rating: 'desc' },
        include: { gameRatings: true },
      });
      expect(result).toEqual(mockUniversities);
    });
  });

  describe('findOne()', () => {
    it('should return a university if found', async () => {
      const mockUniversity = { id: '1', name: 'Uni A' };
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);

      const result = await service.findOne('1');

      expect(mockPrismaService.university.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: { gameRatings: true },
      });
      expect(result).toEqual(mockUniversity);
    });

    it('should throw NotFoundException if university is not found', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create()', () => {
    const dto = { name: 'Ateneo de Manila', domain: 'admu.edu.ph' };

    it('should create and return a new university', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null); // domain not taken

      const mockCreated = { id: 'uuid', ...dto };
      mockPrismaService.university.create.mockResolvedValue(mockCreated);

      const result = await service.create(dto);

      expect(mockPrismaService.university.create).toHaveBeenCalledWith({
        data: { name: dto.name, domain: dto.domain },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should throw ConflictException if domain already exists', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue({
        id: 'existing',
      });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });
});
