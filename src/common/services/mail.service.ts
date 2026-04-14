import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>("SMTP_HOST");
    const port = this.config.get<number>("SMTP_PORT") || 587;
    const user = this.config.get<string>("SMTP_USER");
    const pass = this.config.get<string>("SMTP_PASS");

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log("SMTP transport configured");
    } else {
      this.logger.warn("SMTP not configured — emails will be logged to console");
    }
  }

  async sendPasswordResetCode(to: string, code: string, fullName: string): Promise<void> {
    const subject = "Repitair — Your Password Reset Code";
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #111; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #555; font-size: 15px;">Hi ${fullName},</p>
        <p style="color: #555; font-size: 15px;">You requested a password reset. Use the code below to verify your identity:</p>
        <div style="background: #f4f4f4; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111;">${code}</span>
        </div>
        <p style="color: #888; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">Repitair — Share your music, your way.</p>
      </div>
    `;

    await this.send({ to, subject, html });
  }

  /**
   * Generic send method for callers that need to customize sender/reply-to
   * (e.g. contact form forwarding where replyTo should be the visitor).
   */
  async sendRaw(options: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<void> {
    await this.send(options);
  }

  private async send(options: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<void> {
    const from = this.config.get<string>("SMTP_FROM") || "Repitair <noreply@repitair.com>";

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          replyTo: options.replyTo,
        });
        this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
      } catch (err) {
        this.logger.error(`Failed to send email to ${options.to}: ${(err as Error).message}`);
        throw err;
      }
    } else {
      // Dev fallback: log to console
      this.logger.warn(`[DEV EMAIL] To: ${options.to} | Subject: ${options.subject}`);
      this.logger.debug(`[DEV EMAIL] Body:\n${options.html}`);
    }
  }
}
