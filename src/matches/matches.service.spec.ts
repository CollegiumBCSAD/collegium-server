import { Test, TestingModule } from '@nestjs/testing';
import { MatchesService } from './matches.service';
import { PrismaService } from '../prisma/prisma.service';
import { GameTitle, MatchMode } from '@prisma/client';

const mockPrisma = {
  match: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('MatchesService', () => {
  let service: MatchesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
    jest.clearAllMocks();
  });

  it('should paginate with default limit of 10 and page 1', async () => {
    mockPrisma.match.count.mockResolvedValue(25);
    mockPrisma.match.findMany.mockResolvedValue([
      {
        id: 'm1',
        title: GameTitle.VALORANT,
        matchMode: MatchMode.TOURNAMENT,
        isVerified: true,
        playedAt: new Date(),
        round: 1,
        slot: 0,
        winnerId: 'u1',
        loserId: 'u2',
        winner: { id: 'u1', name: 'University of the Philippines' },
        loser: { id: 'u2', name: 'Ateneo de Manila University' },
        tournament: { id: 't1', name: 'UAAP Esports' },
        playerStats: [],
      },
    ]);

    const result = await service.getMatches({ page: 1, limit: 10 });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].id).toBe('m1');
    expect(result.matches[0].team1.name).toBe('University of the Philippines');
    expect(result.matches[0].team1.isWinner).toBe(true);
    expect(mockPrisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
      }),
    );
  });

  it('filters by matchMode and status', async () => {
    mockPrisma.match.count.mockResolvedValue(5);
    mockPrisma.match.findMany.mockResolvedValue([]);

    await service.getMatches({
      page: 2,
      limit: 10,
      matchMode: 'SCRIM',
      status: 'COMPLETED',
      gameTitle: GameTitle.VALORANT,
    });

    expect(mockPrisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          title: GameTitle.VALORANT,
          matchMode: MatchMode.SCRIM,
          isVerified: true,
        },
        skip: 10,
        take: 10,
      }),
    );
  });
});
