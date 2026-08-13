import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const hasAuthHeader = !!req.headers.authorization;

    if (process.env.DISABLE_AUTH === 'true' && !hasAuthHeader) {
      req.user = {
        id: 'dev-user-id',
        email: 'dev@umak.edu.ph',
        displayName: 'Dev Athlete',
        role: 'ATHLETE',
        status: 'ACTIVE',
        universityId: 'umak',
      };
      return true;
    }

    return super.canActivate(context);
  }
}
