import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // disable auth true in env to disable jwt
    if (process.env.DISABLE_AUTH === 'true') return true;

    // Get required roles from the @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator, allow any authenticated user
    if (!requiredRoles) return true;

    // Get the user from req.user (set by JwtStrategy.validate())
    const user = context.switchToHttp().getRequest<{ user: JwtPayload }>().user;

    // Check if user's role is in the required roles list
    return requiredRoles.includes(user.role);
  }
}
