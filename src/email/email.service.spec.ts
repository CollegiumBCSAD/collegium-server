import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

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
      mockFetch.mockResolvedValue({ ok: true });

      await service.sendVerificationEmail(
        'student@umak.edu.ph',
        'Juan',
        'https://collegium.app/verify-email?token=abc123',
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        to: { email: string }[];
        subject: string;
        htmlContent: string;
      };
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(init.headers).toMatchObject({ 'api-key': 'test-value' });
      expect(body.to).toEqual([{ email: 'student@umak.edu.ph' }]);
      expect(body.subject).toContain('Verify');
      expect(body.htmlContent).toContain(
        'https://collegium.app/verify-email?token=abc123',
      );
    });

    it('throws when Brevo rejects the send', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
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
