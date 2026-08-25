import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  Param,
  Patch,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCookieAuth,
} from '@nestjs/swagger';
import type * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AccountStatus, Role } from '@prisma/client';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 15 * 60 * 1000,
  path: '/',
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new account (must be .edu.ph)' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const tokens = await this.authService.register(dto);
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.access_token, ACCESS_COOKIE_OPTIONS);
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refresh_token,
      REFRESH_COOKIE_OPTIONS,
    );
    return { access_token: tokens.access_token };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const tokens = await this.authService.login(dto);
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.access_token, ACCESS_COOKIE_OPTIONS);
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refresh_token,
      REFRESH_COOKIE_OPTIONS,
    );
    return { access_token: tokens.access_token };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Redirects to Google OAuth consent screen' })
  googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Callback URL for Google OAuth' })
  async googleCallback(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const result = await this.authService.googleLogin(
      req.user as { email: string; displayName: string },
    );
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    res.cookie(ACCESS_TOKEN_COOKIE, result.access_token, ACCESS_COOKIE_OPTIONS);
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      result.refresh_token,
      REFRESH_COOKIE_OPTIONS,
    );
    res.redirect(`${frontendUrl}/auth/callback`);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({
    summary: 'Use refresh token cookie to get a new access token',
  })
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token: string | undefined = (req.cookies as Record<string, string>)[
      REFRESH_TOKEN_COOKIE
    ];

    if (!token) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const tokens = await this.authService.refreshTokens(token);

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.access_token, ACCESS_COOKIE_OPTIONS);
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refresh_token,
      REFRESH_COOKIE_OPTIONS,
    );
    return { access_token: tokens.access_token };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiBearerAuth()
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Logout and revoke the current refresh token' })
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token: string | undefined = (req.cookies as Record<string, string>)[
      REFRESH_TOKEN_COOKIE
    ];

    if (token) {
      await this.authService.logout(token);
    }

    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async getMe(@Req() req: express.Request) {
    const reqWithUser = req as unknown as {
      user?: { id?: string; sub?: string };
    };
    const user = reqWithUser.user;
    const userId = user?.id || user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.authService.getMe(userId);
  }

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all users (Admin only)' })
  listUsers() {
    return this.authService.listUsers();
  }

  @Patch('users/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update user account status (Admin only)' })
  updateStatus(@Param('id') id: string, @Body('status') status: AccountStatus) {
    return this.authService.updateUserStatus(id, status);
  }
}
