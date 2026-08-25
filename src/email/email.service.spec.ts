import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-value'),
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendVerificationEmail()', () => {
    it('sends a verification email with the given link', async () => {
      mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });

      await service.sendVerificationEmail(
        'student@umak.edu.ph',
        'Juan',
        'https://collegium.app/verify-email?token=abc123',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const call = mockSend.mock.calls[0][0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('student@umak.edu.ph');
      expect(call.subject).toContain('Verify');
      expect(call.html).toContain(
        'https://collegium.app/verify-email?token=abc123',
      );
    });

    it('throws when Resend returns an error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'invalid API key' },
      });

      await expect(
        service.sendVerificationEmail(
          'student@umak.edu.ph',
          'Juan',
          'https://x',
        ),
      ).rejects.toThrow('Failed to send verification email');
    });
  });
});
