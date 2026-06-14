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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // REGISTER — email + password
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    // Step 1 — Enforce .edu.ph domain
    if (!email.endsWith('.edu.ph')) {
      throw new ForbiddenException(
        'Registration is restricted to verified Philippine collegiate institutions (.edu.ph)',
      );
    }

    // Step 2 — Extract domain from email
    const domain = email.split('@')[1];

    // Step 3 — Find matching university
    const university = await this.prisma.university.findUnique({
      where: { domain },
    });

    if (!university) {
      throw new BadRequestException(
        `Your institution (${domain}) is not yet registered in Collegium. Please contact your university administrator.`,
      );
    }

    // Step 4 — Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Step 5 — Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Step 6 — Create user
    // Status is PENDING by default — admin must approve
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        displayName: dto.displayName,
        role: dto.role ?? Role.ATHLETE,
        universityId: university.id,
        status: AccountStatus.ACTIVE, // auto active if .edu.ph passes
      },
    });

    return this.signToken(user.id, user.email, user.role, user.universityId);
  }

  // LOGIN — email + password
  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    // Step 1 — Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 2 — Compare password
    const isMatch = await bcrypt.compare(dto.password, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 3 — Check account status
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

    // Step 4 — Issue JWT
    return this.signToken(user.id, user.email, user.role, user.universityId);
  }

  // GOOGLE LOGIN — OAuth flow
  async googleLogin(googleUser: {
    email: string;
    displayName: string;
  }) {
    const email = googleUser.email.toLowerCase().trim();

    // Step 1 — Enforce .edu.ph even for Google accounts
    if (!email.endsWith('.edu.ph')) {
      throw new ForbiddenException(
        'Registration is restricted to verified Philippine collegiate institutions (.edu.ph)',
      );
    }

    // Step 2 — Extract domain and find university
    const domain = email.split('@')[1];
    const university = await this.prisma.university.findUnique({
      where: { domain },
    });

    if (!university) {
      throw new BadRequestException(
        `Your institution (${domain}) is not yet registered in Collegium.`,
      );
    }

    // Step 3 — Check if user already exists
    let user = await this.prisma.user.findUnique({ where: { email } });

    // Step 4 — Auto-register if first time Google login
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: googleUser.displayName,
          role: Role.ATHLETE,
          universityId: university.id,
          status: AccountStatus.ACTIVE, // auto active if edu.ph
          // No password for Google users
        },
      });

      return {
        message:
          'Account created via Google. Your account is pending admin approval.',
        userId: user.id,
      };
    }

    // Step 5 — Check account status
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        'Your account is not yet active. Please wait for admin approval.',
      );
    }

    // Step 6 — Issue JWT
    return this.signToken(user.id, user.email, user.role, user.universityId);
  }

  // ─────────────────────────────────────────
  // ADMIN — Approve or reject a pending user
  // ─────────────────────────────────────────
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

  // ─────────────────────────────────────────
  // HELPER — Generate JWT token
  // ─────────────────────────────────────────
  private signToken(
    userId: string,
    email: string,
    role: any,
    universityId: string,
  ) {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      universityId,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
