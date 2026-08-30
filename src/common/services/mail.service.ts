import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

type MailOptions = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  sensitive?: boolean;
};

type SenderIdentity = {
  email: string;
  name?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly smtpConnectionTimeoutMs = 10000;
  private readonly smtpGreetingTimeoutMs = 10000;
  private readonly smtpSocketTimeoutMs = 15000;
  private readonly sendGridApiKey: string | null;
  private readonly sendGridApiUrl: string;
  private readonly httpTimeoutMs: number;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    this.sendGridApiKey = this.config.get<string>("SENDGRID_API_KEY")?.trim() || null;
    this.sendGridApiUrl =
      this.config.get<string>("SENDGRID_API_URL")?.trim() ||
      "https://api.sendgrid.com/v3/mail/send";
    this.httpTimeoutMs = this.normalizeTimeout(
      this.config.get<string | number>("MAIL_HTTP_TIMEOUT_MS"),
      8000,
    );

    if (this.sendGridApiKey) {
      this.logger.log("SendGrid HTTPS email transport configured");
      return;
    }

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
      this.logger.warn("Email delivery not configured — emails will be logged to console");
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
    if (!this.hasDeliveryTransport()) {
      throw new Error("Email delivery is required to deliver privacy data exports.");
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
  async sendRaw(options: MailOptions): Promise<void> {
    await this.send(options);
  }

  private async send(options: MailOptions): Promise<void> {
    const from = this.config.get<string>("SMTP_FROM") || "Repitair <noreply@repitair.com>";

    if (this.sendGridApiKey) {
      try {
        await this.sendViaSendGrid(options, from);
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
      return;
    }

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

  private hasDeliveryTransport(): boolean {
    return Boolean(this.sendGridApiKey || this.transporter);
  }

  private async sendViaSendGrid(options: MailOptions, from: string): Promise<void> {
    const apiKey = this.sendGridApiKey;
    if (!apiKey) throw new Error("SendGrid API key is not configured.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.httpTimeoutMs);

    try {
      const response = await fetch(this.sendGridApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: this.parseSender(from),
          subject: options.subject,
          content: [{ type: "text/html", value: options.html }],
          ...(options.replyTo ? { reply_to: { email: options.replyTo } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.text().catch(() => "");
        throw new Error(`SendGrid rejected email delivery (HTTP ${response.status})`);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`SendGrid email delivery timed out after ${this.httpTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseSender(value: string): SenderIdentity {
    const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    if (!match) return { email: value.trim() };

    const name = match[1].trim().replace(/^["']|["']$/g, "");
    return {
      email: match[2].trim(),
      ...(name ? { name } : {}),
    };
  }

  private normalizeTimeout(
    value: string | number | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(30000, Math.max(1000, Math.trunc(parsed)));
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
