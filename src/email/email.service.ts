import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    sgMail.setApiKey(this.configService.get<string>('SENDGRID_API_KEY') ?? '');
    this.from = this.configService.get<string>('EMAIL_FROM') ?? '';
  }

  async sendVerificationEmail(
    to: string,
    displayName: string,
    verifyUrl: string,
  ): Promise<void> {
    try {
      await sgMail.send({
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
    } catch (err) {
      this.logger.error(
        `Failed to send verification email to ${to}: ${(err as Error).message}`,
      );
      throw new Error('Failed to send verification email');
    }
  }
}
