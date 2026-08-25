import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    this.from =
      this.configService.get<string>('EMAIL_FROM') ??
      'Collegium <onboarding@resend.dev>';
  }

  async sendVerificationEmail(
    to: string,
    displayName: string,
    verifyUrl: string,
  ): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Verify your Collegium account',
      html: `
        <p>Hi ${displayName},</p>
        <p>Confirm this is your institutional email to activate your Collegium account:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Failed to send verification email to ${to}: ${error.message}`,
      );
      throw new Error('Failed to send verification email');
    }
  }
}
