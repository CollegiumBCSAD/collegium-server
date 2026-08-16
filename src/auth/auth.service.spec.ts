import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
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
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
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

    it('should register a new user and return access_token', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

      const mockCreatedUser = {
        id: 'user-1',
        email: dto.email,
        role: dto.role,
        universityId: mockUniversity.id,
      };
      mockPrismaService.user.create.mockResolvedValue(mockCreatedUser);
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.register(dto);

      expect(result).toHaveProperty('access_token', 'mocked_access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalledTimes(1);
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
        role: dto.role,
        universityId: mockCreatedUni.id,
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.register(dto);
      expect(result).toHaveProperty('access_token', 'mocked_access_token');
      expect(mockPrismaService.university.create).toHaveBeenCalledWith({
        data: { domain: 'admu.edu.ph', name: 'Ateneo de Manila University' },
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
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
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
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
      mockPrismaService.refreshToken.delete.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new_access_token');

      const result = await service.refreshTokens('some_raw_token');

      expect(result).toHaveProperty('access_token', 'new_access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(mockPrismaService.refreshToken.delete).toHaveBeenCalledTimes(1);
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
      mockPrismaService.refreshToken.delete.mockResolvedValue({});
      await expect(service.refreshTokens('expired_token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrismaService.refreshToken.delete).toHaveBeenCalledTimes(1);
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
});
