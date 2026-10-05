import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  UseGuards,
  Param,
  Patch,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { UpdateGameHandleDto } from './dto/update-game-handle.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AccountStatus, Role } from '@prisma/client';

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    callback(
      file.mimetype.startsWith('image/')
        ? null
        : new Error('Only image files are allowed'),
      file.mimetype.startsWith('image/'),
    );
  },
};

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Frontend (Vercel) and backend (Render) are deployed on different
// registrable domains, so the auth cookies must be SameSite=None in
// production for the browser to send them on cross-site API calls —
// None requires Secure, which is already gated to production.
const CROSS_SITE_COOKIES = process.env.NODE_ENV === 'production';
const SAME_SITE: 'none' | 'lax' = CROSS_SITE_COOKIES ? 'none' : 'lax';

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: CROSS_SITE_COOKIES,
  sameSite: SAME_SITE,
  maxAge: 15 * 60 * 1000,
  path: '/',
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: CROSS_SITE_COOKIES,
  sameSite: SAME_SITE,
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new account (must be .edu.ph)' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email via the token sent at registration' })
  async verifyEmail(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token = req.query.token as string;
    const tokens = await this.authService.verifyEmail(token);
    if ('pendingApproval' in tokens) {
      return tokens;
    }
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.access_token, ACCESS_COOKIE_OPTIONS);
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refresh_token,
      REFRESH_COOKIE_OPTIONS,
    );
    return { access_token: tokens.access_token };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend the email verification link' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
    // The frontend's /auth/callback page reads this to establish the
    // session immediately via Authorization header, rather than depending
    // on the cookies above surviving a cross-site OAuth redirect bounce.
    res.redirect(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(result.access_token)}`,
    );
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

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'original', maxCount: 1 },
      ],
      IMAGE_UPLOAD_OPTIONS,
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload and update user profile avatar' })
  async uploadAvatar(
    @Req() req: express.Request,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      original?: Express.Multer.File[];
    },
    @Body()
    body?: {
      zoom?: string | number;
      offsetX?: string | number;
      offsetY?: string | number;
      rotation?: string | number;
    },
  ) {
    const reqWithUser = req as unknown as {
      user?: { id?: string; sub?: string };
    };
    const user = reqWithUser.user;
    const userId = user?.id || user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    const avatarFile = files?.avatar?.[0];
    const originalFile = files?.original?.[0];

    const transforms = body
      ? {
          zoom: body.zoom !== undefined ? Number(body.zoom) : undefined,
          offsetX:
            body.offsetX !== undefined ? Number(body.offsetX) : undefined,
          offsetY:
            body.offsetY !== undefined ? Number(body.offsetY) : undefined,
          rotation:
            body.rotation !== undefined ? Number(body.rotation) : undefined,
        }
      : undefined;

    return this.authService.uploadAvatar(
      userId,
      avatarFile,
      originalFile,
      transforms,
    );
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove user profile avatar' })
  async removeAvatar(@Req() req: express.Request) {
    const reqWithUser = req as unknown as {
      user?: { id?: string; sub?: string };
    };
    const user = reqWithUser.user;
    const userId = user?.id || user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.authService.removeAvatar(userId);
  }

  @Patch('me/avatar-preset')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set user profile avatar to a preset' })
  async setPresetAvatar(
    @Req() req: express.Request,
    @Body('avatarUrl') avatarUrl: string,
  ) {
    const reqWithUser = req as unknown as {
      user?: { id?: string; sub?: string };
    };
    const user = reqWithUser.user;
    const userId = user?.id || user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.authService.setPresetAvatar(userId, avatarUrl);
  }

  @Patch('me/game-handles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update or set in-game handle (IGN) for a game title',
  })
  async updateGameHandle(
    @Req() req: express.Request,
    @Body() dto: UpdateGameHandleDto,
  ) {
    const reqWithUser = req as unknown as {
      user?: { id?: string; sub?: string };
    };
    const user = reqWithUser.user;
    const userId = user?.id || user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.authService.updateGameHandle(userId, dto);
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
