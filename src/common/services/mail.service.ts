import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly smtpConnectionTimeoutMs = 10000;
  private readonly smtpGreetingTimeoutMs = 10000;
  private readonly smtpSocketTimeoutMs = 15000;
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
        connectionTimeout: this.smtpConnectionTimeoutMs,
        greetingTimeout: this.smtpGreetingTimeoutMs,
        socketTimeout: this.smtpSocketTimeoutMs,
      });
      this.logger.log(`SMTP transport configured for ${host}:${port}`);
    } else {
      this.logger.warn("SMTP not configured — emails will be logged to console");
    }
  }

  async sendPasswordResetCode(to: string, code: string, fullName: string): Promise<void> {
    const subject = "Repitair — Your Password Reset Code";
    const safeFullName = this.escapeHtml(fullName);
    const safeCode = this.escapeHtml(code);
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #111; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #555; font-size: 15px;">Hi ${safeFullName},</p>
        <p style="color: #555; font-size: 15px;">You requested a password reset. Use the code below to verify your identity:</p>
        <div style="background: #f4f4f4; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111;">${safeCode}</span>
        </div>
        <p style="color: #888; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">Repitair — Share your music, your way.</p>
      </div>
    `;

    await this.send({ to, subject, html });
  }

  async sendPrivacyExportReady(
    to: string,
    fullName: string,
    downloadUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error("SMTP is required to deliver privacy data exports.");
    }

    const safeFullName = this.escapeHtml(fullName);
    const safeDownloadUrl = this.escapeHtml(downloadUrl);
    const safeExpiry = this.escapeHtml(expiresAt.toUTCString());
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #111; margin-bottom: 8px;">Your Repitair data export is ready</h2>
        <p style="color: #555; font-size: 15px;">Hi ${safeFullName},</p>
        <p style="color: #555; font-size: 15px;">Your requested data export is available from the secure link below.</p>
        <p style="margin: 24px 0;">
          <a href="${safeDownloadUrl}" style="display: inline-block; border-radius: 10px; background: #004f71; color: #fff; padding: 12px 18px; text-decoration: none; font-weight: 600;">Download your data</a>
        </p>
        <p style="color: #888; font-size: 13px;">This link expires on ${safeExpiry}. Do not forward it. If you did not request this export, contact Repitair Support.</p>
      </div>
    `;

    await this.send({
      to,
      subject: "Repitair — Your data export is ready",
      html,
      sensitive: true,
    });
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
    sensitive?: boolean;
  }): Promise<void> {
    await this.send(options);
  }

  private async send(options: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
    sensitive?: boolean;
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
        if (options.sensitive) {
          this.logger.log(`Sensitive email sent: ${options.subject}`);
        } else {
          this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
        }
      } catch (err) {
        const destination = options.sensitive ? "sensitive recipient" : options.to;
        this.logger.error(`Failed to send email to ${destination}: ${(err as Error).message}`);
        throw err;
      }
    } else {
      // Dev fallback: log to console
      this.logger.warn(`[DEV EMAIL] To: ${options.to} | Subject: ${options.subject}`);
      if (!options.sensitive) this.logger.debug(`[DEV EMAIL] Body:\n${options.html}`);
      else this.logger.debug("[DEV EMAIL] Sensitive body omitted from logs");
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
