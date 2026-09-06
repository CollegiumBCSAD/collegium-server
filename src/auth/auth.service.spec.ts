import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');
jest.mock('crypto', () => ({
  ...jest.requireActual<typeof import('crypto')>('crypto'),
  randomBytes: jest.fn(() => Buffer.from('a'.repeat(40))),
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn((): string => 'mocked_token_hash'),
  })),
}));

const mockPrismaService = {
  university: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  emailVerificationToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
  },
  userGameHandle: {
    upsert: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('http://localhost:3000'),
};

const mockEmailService = {
  sendVerificationEmail: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register()', () => {
    const dto = {
      email: 'student@admu.edu.ph',
      password: 'password',
      displayName: 'Student',
      role: Role.ATHLETE,
    };
    const mockUniversity = { id: 'uni-1', domain: 'admu.edu.ph' };

    it('creates an unverified user, emails a verification link, and does not log them in', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

      const mockCreatedUser = {
        id: 'user-1',
        email: dto.email,
        displayName: dto.displayName,
        role: dto.role,
        universityId: mockUniversity.id,
      };
      mockPrismaService.user.create.mockResolvedValue(mockCreatedUser);
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.register(dto);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = mockPrismaService.user.create.mock.calls[0][0] as {
        data: { emailVerified: boolean };
      };
      expect(createCall.data.emailVerified).toBe(false);
      expect(
        mockPrismaService.emailVerificationToken.create,
      ).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        dto.displayName,
        expect.stringContaining('/verify-email?token='),
      );
      expect(result).not.toHaveProperty('access_token');
      expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
    });

    it('still succeeds even if the verification email fails to send', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        displayName: dto.displayName,
      });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockEmailService.sendVerificationEmail.mockRejectedValue(
        new Error('Resend is down'),
      );

      await expect(service.register(dto)).resolves.toHaveProperty('message');
    });

    it('should throw ForbiddenException if email is not .edu.ph', async () => {
      const invalidDto = { ...dto, email: 'student@gmail.com' };
      await expect(service.register(invalidDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should auto-create university if domain is not registered yet and register successfully', async () => {
      const mockCreatedUni = {
        id: 'uni-auto',
        domain: 'admu.edu.ph',
        name: 'Ateneo de Manila University',
      };
      mockPrismaService.university.findUnique.mockResolvedValue(null);
      mockPrismaService.university.create = jest
        .fn()
        .mockResolvedValue(mockCreatedUni);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-auto',
        email: dto.email,
        displayName: dto.displayName,
        role: dto.role,
        universityId: mockCreatedUni.id,
      });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.register(dto);
      expect(result).toHaveProperty('message');
      expect(mockPrismaService.university.create).toHaveBeenCalledWith({
        data: { domain: 'admu.edu.ph', name: 'Ateneo de Manila University' },
      });
    });

    it('should throw ConflictException if a verified account with this email already exists', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'existing',
        emailVerified: true,
      });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('resends a verification email instead of erroring if the existing account was never verified', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'existing',
        email: dto.email,
        displayName: 'Student',
        emailVerified: false,
      });
      mockPrismaService.emailVerificationToken.findFirst.mockResolvedValue(
        null,
      );
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.register(dto);

      expect(result).toHaveProperty('message');
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login()', () => {
    const dto = { email: 'student@admu.edu.ph', password: 'password' };

    it('should login and return access_token + refresh_token if credentials are valid and account is ACTIVE', async () => {
      const mockUser = {
        id: 'user-1',
        email: dto.email,
        password: 'hashed_password',
        status: AccountStatus.ACTIVE,
        emailVerified: true,
        role: Role.ATHLETE,
        universityId: 'uni-1',
      };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.login(dto);

      expect(result).toHaveProperty('access_token', 'mocked_access_token');
      expect(result).toHaveProperty('refresh_token');
    });

    it('should throw ForbiddenException if email is not verified yet', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        password: 'hash',
        status: AccountStatus.ACTIVE,
        emailVerified: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ password: 'hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException if account is PENDING', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        password: 'hash',
        status: AccountStatus.PENDING,
        emailVerified: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('googleLogin()', () => {
    const googleUser = { email: 'student@admu.edu.ph', displayName: 'Student' };
    const mockUniversity = { id: 'uni-1', domain: 'admu.edu.ph' };

    it('creates a new user already marked as verified', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        email: googleUser.email,
        role: Role.NON_ATHLETE,
        universityId: 'uni-1',
        status: AccountStatus.ACTIVE,
        emailVerified: true,
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.googleLogin(googleUser);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = mockPrismaService.user.create.mock.calls[0][0] as {
        data: { emailVerified: boolean };
      };
      expect(createCall.data.emailVerified).toBe(true);
    });

    it('logs in an existing already-verified user without touching verification state', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: googleUser.email,
        role: Role.NON_ATHLETE,
        universityId: 'uni-1',
        status: AccountStatus.ACTIVE,
        emailVerified: true,
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.googleLogin(googleUser);

      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('auto-verifies and clears pending tokens for an existing unverified email+password account', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: googleUser.email,
        role: Role.NON_ATHLETE,
        universityId: 'uni-1',
        status: AccountStatus.ACTIVE,
        emailVerified: false,
      });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        email: googleUser.email,
        role: Role.NON_ATHLETE,
        universityId: 'uni-1',
        status: AccountStatus.ACTIVE,
        emailVerified: true,
      });
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(googleUser);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(
        mockPrismaService.emailVerificationToken.deleteMany,
      ).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(result).toHaveProperty('access_token', 'mocked_access_token');
    });
  });

  describe('verifyEmail()', () => {
    it('marks the user verified, clears tokens, and logs them in', async () => {
      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue({
        tokenHash: 'mocked_token_hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: {
          id: 'user-1',
          email: 'student@admu.edu.ph',
          role: Role.ATHLETE,
          universityId: 'uni-1',
        },
      });
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyEmail('raw_token');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(result).toHaveProperty('access_token', 'mocked_access_token');
      expect(result).toHaveProperty('refresh_token');
    });

    it('throws BadRequestException if the token does not exist', async () => {
      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue(
        null,
      );
      await expect(service.verifyEmail('bad_token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException and cleans up an expired token', async () => {
      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue({
        tokenHash: 'mocked_token_hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        user: { id: 'user-1' },
      });
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({
        count: 1,
      });

      await expect(service.verifyEmail('expired_token')).rejects.toThrow(
        BadRequestException,
      );
      expect(
        mockPrismaService.emailVerificationToken.deleteMany,
      ).toHaveBeenCalled();
    });
  });

  describe('resendVerification()', () => {
    it('issues a new token for an unverified account', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'student@admu.edu.ph',
        displayName: 'Student',
        emailVerified: false,
      });
      mockPrismaService.emailVerificationToken.findFirst.mockResolvedValue(
        null,
      );
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await service.resendVerification('student@admu.edu.ph');

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });

    it('does not resend while the last token is still within the cooldown window', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'student@admu.edu.ph',
        displayName: 'Student',
        emailVerified: false,
      });
      mockPrismaService.emailVerificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        createdAt: new Date(Date.now() - 10 * 1000),
      });

      const result = await service.resendVerification('student@admu.edu.ph');

      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
      expect(
        mockPrismaService.emailVerificationToken.create,
      ).not.toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });

    it('returns the same generic message for an already-verified or unknown account', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        emailVerified: true,
      });

      const result = await service.resendVerification('verified@admu.edu.ph');

      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('refreshTokens()', () => {
    it('should rotate refresh token and return new access_token + refresh_token', async () => {
      const mockStoredToken = {
        tokenHash: 'mocked_token_hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: {
          id: 'user-1',
          email: 'student@admu.edu.ph',
          role: Role.ATHLETE,
          universityId: 'uni-1',
          status: AccountStatus.ACTIVE,
        },
      };
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(
        mockStoredToken,
      );
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.refreshToken.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new_access_token');

      const result = await service.refreshTokens('some_raw_token');

      expect(result).toHaveProperty('access_token', 'new_access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledTimes(
        1,
      );
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException if token not found', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('invalid_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException and delete token if it has expired', async () => {
      const expiredToken = {
        tokenHash: 'mocked_token_hash',
        expiresAt: new Date(Date.now() - 1000),
        user: { status: AccountStatus.ACTIVE },
      };
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(expiredToken);
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({
        count: 1,
      });
      await expect(service.refreshTokens('expired_token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe('logout()', () => {
    it('should delete the refresh token record', async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      await service.logout('some_raw_token');
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe('listUsers()', () => {
    it('should return all users ordered by createdAt desc', async () => {
      const mockUsers = [
        {
          id: 'user-2',
          email: 'newer@admu.edu.ph',
          displayName: 'Newer',
          role: Role.ATHLETE,
          status: AccountStatus.PENDING,
          createdAt: new Date(),
          university: { id: 'uni-1', name: 'Ateneo de Manila University' },
        },
      ];
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.listUsers();

      expect(result).toEqual(mockUsers);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  describe('updateUserStatus()', () => {
    it('should update user status', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        status: AccountStatus.ACTIVE,
      });

      const result = await service.updateUserStatus(
        'user-1',
        AccountStatus.ACTIVE,
      );
      expect(result.status).toEqual(AccountStatus.ACTIVE);
    });

    it('should throw BadRequestException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(
        service.updateUserStatus('invalid', AccountStatus.ACTIVE),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateGameHandle()', () => {
    it('upserts user game handle successfully', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockPrismaService.userGameHandle.upsert.mockResolvedValue({
        id: 'ugh-1',
        userId: 'user-1',
        gameTitle: 'VALORANT',
        handle: 'TenZ#NA1',
      });

      const result = await service.updateGameHandle('user-1', {
        gameTitle: 'VALORANT' as any,
        handle: 'TenZ#NA1',
      });

      expect(result.handle).toBe('TenZ#NA1');
      expect(mockPrismaService.userGameHandle.upsert).toHaveBeenCalledWith({
        where: {
          userId_gameTitle: {
            userId: 'user-1',
            gameTitle: 'VALORANT',
          },
        },
        update: { handle: 'TenZ#NA1' },
        create: { userId: 'user-1', gameTitle: 'VALORANT', handle: 'TenZ#NA1' },
      });
    });

    it('throws UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(
        service.updateGameHandle('invalid', {
          gameTitle: 'VALORANT' as any,
          handle: 'TenZ#NA1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
