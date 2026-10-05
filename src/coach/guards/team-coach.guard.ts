import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Guard 2 of the coach flow: the account-tier check (@Roles(Role.COACH))
// runs globally first; this one confirms the caller is the coach of the
// team named by the :teamId route param.
@Injectable()
export class TeamCoachGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.DISABLE_AUTH === 'true') return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: User; params: { teamId?: string } }>();
    const teamId = req.params.teamId;
    if (!teamId) return true;

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { coachId: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (!req.user || team.coachId !== req.user.id) {
      throw new ForbiddenException("You are not this team's coach.");
    }

    return true;
  }
}
