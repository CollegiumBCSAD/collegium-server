import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, MatchMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchLoggingService } from './match-logging.service';
import { VcsCalculatorService } from './vcs-calculator.service';

const mockPrismaService = {
  match: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockVcsCalculatorService = {
  calculateMatchVcs: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

describe('MatchLoggingService', () => {
  let service: MatchLoggingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchLoggingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: VcsCalculatorService, useValue: mockVcsCalculatorService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MatchLoggingService>(MatchLoggingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logMatch()', () => {
    it('should skip if match already exists in the database', async () => {
      // Mocking private methods in Jest requires type assertion or bracket notation
      // But since loadFixture is private, we can just spy on it if we need, 
      // however it's easier to just mock the prisma findUnique to return true early
      
      // Override the loadFixture temporarily to avoid reading a real file in test
      service['loadFixture'] = jest.fn().mockReturnValue({ info: { participants: [] } });

      mockVcsCalculatorService.calculateMatchVcs.mockReturnValue(new Map());
      mockPrismaService.match.findUnique.mockResolvedValue({ id: 'existing' });

      await service.logMatch('riot-123', MatchMode.TOURNAMENT, true);

      expect(mockPrismaService.match.findUnique).toHaveBeenCalledWith({ where: { riotMatchId: 'riot-123' } });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should log a new match if it does not exist', async () => {
      const mockParticipants = [{ puuid: 'player-1', kills: 5 }];
      service['loadFixture'] = jest.fn().mockReturnValue({ info: { participants: mockParticipants, gameDuration: 1000, gameMode: 'CLASSIC', platformId: 'PH' } });

      mockVcsCalculatorService.calculateMatchVcs.mockReturnValue(new Map([['player-1', { finalVcs: 10.5 }]]));
      mockPrismaService.match.findUnique.mockResolvedValue(null);
      
      // Mock the transaction callback behavior
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          match: { create: jest.fn().mockResolvedValue({ id: 'new-match-id' }) },
          playerStat: { create: jest.fn() },
        };
        await callback(tx);
        return true;
      });

      await service.logMatch('riot-123', MatchMode.TOURNAMENT, true);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('getMatchStats()', () => {
    it('should return match stats including player stats', async () => {
      const mockStats = { id: 'match-1', playerStats: [] };
      mockPrismaService.match.findUnique.mockResolvedValue(mockStats);

      const result = await service.getMatchStats('riot-123');

      expect(mockPrismaService.match.findUnique).toHaveBeenCalledWith({
        where: { riotMatchId: 'riot-123' },
        include: { playerStats: true },
      });
      expect(result).toEqual(mockStats);
    });
  });
});
