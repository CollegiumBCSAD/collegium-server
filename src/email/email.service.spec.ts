import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    sendMail: (...args: unknown[]) => mockSendMail(...args),
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
      mockSendMail.mockResolvedValue({});

      await service.sendVerificationEmail(
        'student@umak.edu.ph',
        'Juan',
        'https://collegium.app/verify-email?token=abc123',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const call = mockSendMail.mock.calls[0][0] as {
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

    it('throws when the SMTP transport rejects the send', async () => {
      mockSendMail.mockRejectedValue(new Error('invalid login'));

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
