import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ScrimsController } from './scrims.controller';
import { ScrimsService } from './scrims.service';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { GameTitle, ScrimStatus, User } from '@prisma/client';

describe('ScrimsController', () => {
  let controller: ScrimsController;
  let service: jest.Mocked<Partial<ScrimsService>>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = {
      createScrim: jest.fn(),
      getScrims: jest.fn(),
      acceptScrim: jest.fn(),
      confirmScrim: jest.fn(),
      cancelScrim: jest.fn(),
      deleteScrim: jest.fn(),
      getScrimChat: jest.fn(),
      sendScrimChat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScrimsController],
      providers: [
        {
          provide: ScrimsService,
          useValue: service,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<ScrimsController>(ScrimsController);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Authentication Restrictions (Public vs Protected routes)', () => {
    it('should NOT mark createScrim as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.createScrim,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should NOT mark acceptScrim as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.acceptScrim,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should NOT mark confirmScrim as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.confirmScrim,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should NOT mark cancelScrim as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.cancelScrim,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should NOT mark deleteScrim as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.deleteScrim,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should NOT mark sendScrimChat as @Public()', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.sendScrimChat,
      );
      expect(isPublic).toBeUndefined();
    });

    it('should mark getScrims as @Public() for open browsing', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.getScrims,
      );
      expect(isPublic).toBe(true);
    });

    it('should mark getScrimChat as @Public() for viewing chat', () => {
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        controller.getScrimChat,
      );
      expect(isPublic).toBe(true);
    });
  });

  describe('createScrim', () => {
    it('should delegate to scrimsService.createScrim with user context', async () => {
      const mockUser = { id: 'user-1', email: 'test@umak.edu.ph' } as User;
      const dto = {
        teamId: 'team-1',
        gameTitle: GameTitle.VALORANT,
        scheduledAt: new Date().toISOString(),
        format: 'BO3',
      };
      (service.createScrim as jest.Mock).mockResolvedValue({ id: 'scrim-1', ...dto });

      const result = await controller.createScrim({ user: mockUser }, dto);

      expect(service.createScrim).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toEqual({ id: 'scrim-1', ...dto });
    });
  });
});
