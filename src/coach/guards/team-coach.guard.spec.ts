import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamCoachGuard } from './team-coach.guard';

const contextFor = (userId: string | undefined, teamId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId ? { id: userId } : undefined,
        params: { teamId },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('TeamCoachGuard', () => {
  const findUnique = jest.fn();
  const guard = new TeamCoachGuard({
    team: { findUnique },
  } as unknown as PrismaService);

  beforeEach(() => findUnique.mockReset());

  it("admits the team's coach", async () => {
    findUnique.mockResolvedValue({ coachId: 'coach-1' });
    await expect(
      guard.canActivate(contextFor('coach-1', 'team-1')),
    ).resolves.toBe(true);
  });

  it('blocks a coach of a different team', async () => {
    findUnique.mockResolvedValue({ coachId: 'coach-1' });
    await expect(
      guard.canActivate(contextFor('coach-2', 'team-1')),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reports a missing team', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contextFor('coach-1', 'nope')),
    ).rejects.toThrow(NotFoundException);
  });

  it('ignores routes without a teamId', async () => {
    await expect(guard.canActivate(contextFor('coach-1'))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
