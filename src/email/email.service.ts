import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const user = this.configService.get<string>('SMTP_USER') ?? '';
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
    this.from = this.configService.get<string>('EMAIL_FROM') ?? user;
  }

  async sendVerificationEmail(
    to: string,
    displayName: string,
    verifyUrl: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
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
