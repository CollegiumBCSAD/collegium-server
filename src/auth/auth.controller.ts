import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  Param,
  Patch,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AccountStatus, Role } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register
  // @Public() means no JWT required — same as [AllowAnonymous]
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /auth/login
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // GET /auth/google
  // Redirects user to Google OAuth consent screen
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Guard handles the redirect — nothing needed here
  }

  // GET /auth/google/callback
  // Google redirects here after user approves
  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleCallback(@Req() req: any) {
    // req.user is set by GoogleStrategy.validate()
    return this.authService.googleLogin(req.user);
  }

  // PATCH /auth/users/:id/status
  // Admin only — approve or reject pending accounts
  @Patch('users/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: AccountStatus,
  ) {
    return this.authService.updateUserStatus(id, status);
  }
}
