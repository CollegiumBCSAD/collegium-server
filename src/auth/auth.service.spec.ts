import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

const mockPrismaService = {
  university: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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
    const dto = { email: 'student@admu.edu.ph', password: 'password', displayName: 'Student', role: Role.ATHLETE };
    const mockUniversity = { id: 'uni-1', domain: 'admu.edu.ph' };

    it('should register a new user successfully', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      
      const mockCreatedUser = { id: 'user-1', email: dto.email, role: dto.role, universityId: mockUniversity.id };
      mockPrismaService.user.create.mockResolvedValue(mockCreatedUser);
      mockJwtService.sign.mockReturnValue('mocked_jwt_token');

      const result = await service.register(dto);

      expect(result).toEqual({ access_token: 'mocked_jwt_token' });
    });

    it('should throw ForbiddenException if email is not .edu.ph', async () => {
      const invalidDto = { ...dto, email: 'student@gmail.com' };
      await expect(service.register(invalidDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if university domain is not registered', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(null);
      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.university.findUnique.mockResolvedValue(mockUniversity);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('login()', () => {
    const dto = { email: 'student@admu.edu.ph', password: 'password' };

    it('should login and return a token if credentials are valid and account is ACTIVE', async () => {
      const mockUser = { id: 'user-1', email: dto.email, password: 'hashed_password', status: AccountStatus.ACTIVE, role: Role.ATHLETE, universityId: 'uni-1' };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('mocked_jwt_token');

      const result = await service.login(dto);

      expect(result).toEqual({ access_token: 'mocked_jwt_token' });
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
      mockPrismaService.user.findUnique.mockResolvedValue({ password: 'hash', status: AccountStatus.PENDING });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateUserStatus()', () => {
    it('should update user status', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockPrismaService.user.update.mockResolvedValue({ id: 'user-1', status: AccountStatus.ACTIVE });

      const result = await service.updateUserStatus('user-1', AccountStatus.ACTIVE);
      expect(result.status).toEqual(AccountStatus.ACTIVE);
    });

    it('should throw BadRequestException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.updateUserStatus('invalid', AccountStatus.ACTIVE)).rejects.toThrow(BadRequestException);
    });
  });
});
