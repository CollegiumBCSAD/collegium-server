import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamAuthorityService } from './team-authority.service';

describe('TeamAuthorityService.assertCanRegister()', () => {
  const service = new TeamAuthorityService({} as PrismaService);

  it('allows only the coach when the team has one', () => {
    const team = { captainId: 'cap', coachId: 'coach' };

    expect(() =>
      service.assertCanRegister(team, { id: 'coach' }),
    ).not.toThrow();
    expect(() => service.assertCanRegister(team, { id: 'cap' })).toThrow(
      ForbiddenException,
    );
  });

  it('falls back to the captain when the team has no coach', () => {
    const team = { captainId: 'cap', coachId: null };

    expect(() => service.assertCanRegister(team, { id: 'cap' })).not.toThrow();
    expect(() => service.assertCanRegister(team, { id: 'athlete' })).toThrow(
      ForbiddenException,
    );
  });

  it('lets an admin act for any team', () => {
    expect(() =>
      service.assertCanRegister(
        { captainId: 'cap', coachId: 'coach' },
        { id: 'admin', role: Role.ADMIN },
      ),
    ).not.toThrow();
  });
});
