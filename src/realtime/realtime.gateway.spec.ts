import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { AccountStatus } from '@prisma/client';

const mockJwtService = {
  verifyAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
  },
};

function createMockSocket(cookie?: string) {
  return {
    handshake: { headers: { cookie } },
    data: {} as Record<string, unknown>,
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection()', () => {
    it('disconnects a socket with no access_token cookie', async () => {
      const socket = createMockSocket(undefined);

      await gateway.handleConnection(socket as never);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('disconnects a socket with an invalid token', async () => {
      const socket = createMockSocket('access_token=bad-token');
      mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await gateway.handleConnection(socket as never);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('disconnects when the user is not active', async () => {
      const socket = createMockSocket('access_token=good-token');
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: AccountStatus.PENDING,
      });

      await gateway.handleConnection(socket as never);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('joins the per-user room for a valid, active user', async () => {
      const socket = createMockSocket('access_token=good-token; other=1');
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: AccountStatus.ACTIVE,
      });

      await gateway.handleConnection(socket as never);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.data.userId).toBe('user-1');
    });
  });

  describe('emitToUser()', () => {
    it('emits the event to the user-scoped room', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      gateway.emitToUser('user-1', 'notification:new', { id: 'notif-1' });

      expect(to).toHaveBeenCalledWith('user:user-1');
      expect(emit).toHaveBeenCalledWith('notification:new', { id: 'notif-1' });
    });
  });
});
