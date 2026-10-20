import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildVerificationEmailHtml,
  buildVerificationEmailText,
} from './templates/verification-email';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BREVO_API_KEY') ?? '';
    this.from = this.configService.get<string>('EMAIL_FROM') ?? '';
  }

  async sendVerificationEmail(
    to: string,
    displayName: string,
    verifyUrl: string,
  ): Promise<void> {
    try {
      const res = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'Collegium', email: this.from },
          to: [{ email: to }],
          subject: 'Verify your Collegium account',
          htmlContent: buildVerificationEmailHtml(displayName, verifyUrl),
          textContent: buildVerificationEmailText(displayName, verifyUrl),
        }),
      });
      if (!res.ok) {
        throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to send verification email to ${to}: ${(err as Error).message}`,
      );
      throw new Error('Failed to send verification email');
    }
  }
}
