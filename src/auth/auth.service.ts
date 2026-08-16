import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private async resolveUniversity(domain: string) {
    let university = await this.prisma.university.findUnique({
      where: { domain },
    });

    if (!university) {
      const knownNames: Record<string, string> = {
        'umak.edu.ph': 'University of Makati',
        'admu.edu.ph': 'Ateneo de Manila University',
        'dlsu.edu.ph': 'De La Salle University',
        'ust.edu.ph': 'University of Santo Tomas',
        'up.edu.ph': 'University of the Philippines',
        'feu.edu.ph': 'Far Eastern University',
        'nu.edu.ph': 'National University',
        'adamson.edu.ph': 'Adamson University',
        'adu.edu.ph': 'Adamson University',
        'mapua.edu.ph': 'Mapúa University',
      };

      const name = knownNames[domain] || `Unregistered Institution (${domain})`;

      university = await this.prisma.university.create({
        data: {
          domain,
          name,
        },
      });
    }

    return university;
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    if (!email.endsWith('.edu.ph')) {
      throw new ForbiddenException(
        'Registration is restricted to verified Philippine collegiate institutions (.edu.ph)',
      );
    }

    const domain = email.split('@')[1];
    const university = await this.resolveUniversity(domain);

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        displayName: dto.displayName,
        role: dto.role ?? Role.ATHLETE,
        universityId: university.id,
        status: AccountStatus.ACTIVE,
      },
    });

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.universityId,
    );
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === AccountStatus.PENDING) {
      throw new ForbiddenException(
        'Your account is pending admin approval. Please check back later.',
      );
    }

    if (user.status === AccountStatus.REJECTED) {
      throw new ForbiddenException(
        'Your account registration was rejected. Please contact your university administrator.',
      );
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support.',
      );
    }

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.universityId,
    );
  }

  async googleLogin(googleUser: { email: string; displayName: string }) {
    const email = googleUser.email.toLowerCase().trim();

    if (!email.endsWith('.edu.ph')) {
      throw new ForbiddenException(
        'Registration is restricted to verified Philippine collegiate institutions (.edu.ph)',
      );
    }

    const domain = email.split('@')[1];
    const university = await this.resolveUniversity(domain);

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: googleUser.displayName,
          role: Role.ATHLETE,
          universityId: university.id,
          status: AccountStatus.ACTIVE,
        },
      });
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        'Your account is not yet active. Please contact your university administrator.',
      );
    }

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.universityId,
    );
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        universityId: true,
        university: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async refreshTokens(incomingToken: string) {
    const tokenHash = this.hashToken(incomingToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { tokenHash } });
      throw new UnauthorizedException(
        'Refresh token has expired. Please log in again.',
      );
    }

    if (stored.user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active.');
    }

    await this.prisma.refreshToken.delete({ where: { tokenHash } });

    return this.generateTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
      stored.user.universityId,
    );
  }

  async logout(incomingToken: string) {
    const tokenHash = this.hashToken(incomingToken);

    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  async updateUserStatus(userId: string, status: AccountStatus) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
      },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async generateTokens(
    userId: string,
    email: string,
    role: Role,
    universityId: string,
  ) {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      universityId,
    };

    const access_token = this.jwtService.sign(payload);

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    return {
      access_token,
      refresh_token: rawRefreshToken,
    };
  }
}
