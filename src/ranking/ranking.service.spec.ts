/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { GameTitle, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RankingService } from './ranking.service';

describe('RankingService', () => {
  let service: RankingService;

  const mockPrismaService = {
    tournament: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    match: {
      findMany: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    tournamentApplication: {
      findFirst: jest.fn(),
    },
    ratingHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<RankingService>(RankingService);
    jest.clearAllMocks();
  });

  describe('closeTournamentRatingPeriod()', () => {
    it('throws NotFoundException if tournament does not exist', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue(null);

      await expect(
        service.closeTournamentRatingPeriod('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if rating period is already closed (double-closure prevention)', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Finished Tourney',
        rating_period_closed_at: new Date('2026-09-01'),
      });

      await expect(service.closeTournamentRatingPeriod('t-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('closes cleanly without rating mutations when tournament has 0 verified matches', async () => {
      mockPrismaService.tournament.findUnique.mockResolvedValue({
        id: 't-empty',
        name: 'Empty Tournament',
        rating_period_closed_at: null,
        event_weight: 1.0,
      });
      mockPrismaService.match.findMany.mockResolvedValue([]);
      mockPrismaService.tournament.update.mockResolvedValue({});

      const result = await service.closeTournamentRatingPeriod('t-empty');

      expect(result.tournamentId).toBe('t-empty');
      expect(result.teamsUpdated).toHaveLength(0);
      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't-empty' },
          data: expect.objectContaining({
            status: TournamentStatus.COMPLETED,
          }),
        }),
      );
    });

    it('processes batch Glicko-2 updates, applies event weight, and persists to Team and RatingHistory', async () => {
      const tournament = {
        id: 't-1',
        name: 'Metro Open',
        gameTitle: GameTitle.VALORANT,
        rating_period_closed_at: null,
        event_weight: 1.25,
      };

      const teamUst = {
        id: 'team-ust',
        name: 'UST Teletigers',
        gameTitle: GameTitle.VALORANT,
        glicko2_rating: 1500,
        glicko2_rd: 350,
        glicko2_sigma: 0.06,
      };

      const teamDlsu = {
        id: 'team-dlsu',
        name: 'DLSU Viridis Arcus',
        gameTitle: GameTitle.VALORANT,
        glicko2_rating: 1500,
        glicko2_rd: 350,
        glicko2_sigma: 0.06,
      };

      const matches = [
        {
          id: 'm-1',
          tournamentId: 't-1',
          winnerId: 'team-ust',
          loserId: 'team-dlsu',
          isVerified: true,
        },
      ];

      mockPrismaService.tournament.findUnique.mockResolvedValue(tournament);
      mockPrismaService.match.findMany.mockResolvedValue(matches);
      mockPrismaService.team.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'team-ust') return Promise.resolve(teamUst);
        if (where.id === 'team-dlsu') return Promise.resolve(teamDlsu);
        return Promise.resolve(null);
      });

      const result = await service.closeTournamentRatingPeriod('t-1');

      expect(result.tournamentId).toBe('t-1');
      expect(result.eventWeight).toBe(1.25);
      expect(result.teamsUpdated).toHaveLength(2);

      const ustUpdate = result.teamsUpdated.find(
        (t) => t.teamId === 'team-ust',
      )!;
      const dlsuUpdate = result.teamsUpdated.find(
        (t) => t.teamId === 'team-dlsu',
      )!;

      // UST won -> rating increased
      expect(ustUpdate.ratingAfter).toBeGreaterThan(1500);
      expect(ustUpdate.rawDelta).toBeGreaterThan(0);

      // DLSU lost -> rating decreased
      expect(dlsuUpdate.ratingAfter).toBeLessThan(1500);
      expect(dlsuUpdate.rawDelta).toBeLessThan(0);

      // Verify transaction calls
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.ratingHistory.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.team.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTeamRatingHistory()', () => {
    it('returns rating history list for existing team', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue({ id: 'team-1' });
      mockPrismaService.ratingHistory.findMany.mockResolvedValue([
        { id: 'rh-1', team_id: 'team-1', rating_after: 1560 },
      ]);

      const result = await service.getTeamRatingHistory('team-1');
      expect(result).toHaveLength(1);
      expect(result[0].rating_after).toBe(1560);
    });

    it('throws NotFoundException if team does not exist', async () => {
      mockPrismaService.team.findUnique.mockResolvedValue(null);

      await expect(
        service.getTeamRatingHistory('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
