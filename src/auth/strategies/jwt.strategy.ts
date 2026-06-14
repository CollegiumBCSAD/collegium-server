import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service'
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AccountStatus } from '@prisma/client'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      // Extract JWT from auth: bearer <token> header
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate (payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });


    if (!user) {
      throw new UnauthorizedException('user no longer exists');
    }


    if (user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException (
          'Account is not active. Please wait for admin approval.',
      );
    }


    return user;
  }
}

