import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MailService } from "../../common/services/mail.service";
import { ContactDto } from "./dto/contact.dto";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async submit(dto: ContactDto): Promise<void> {
    const supportAddress = this.config.get<string>("SUPPORT_EMAIL") || "support@repitair.com";

    const safeName = escapeHtml(dto.name);
    const safeEmail = escapeHtml(dto.email);
    const safeSubject = escapeHtml(dto.subject);
    const safeMessage = escapeHtml(dto.message).replace(/\n/g, "<br />");

    const subject = `[Contact] ${dto.subject}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #111;">New contact-form submission</h2>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #888;">From</td><td style="padding: 8px;">${safeName} &lt;${safeEmail}&gt;</td></tr>
          <tr><td style="padding: 8px; color: #888;">Subject</td><td style="padding: 8px;">${safeSubject}</td></tr>
        </table>
        <h3 style="color: #333;">Message</h3>
        <div style="background: #f7f7f7; border-radius: 8px; padding: 16px; color: #222; line-height: 1.5;">
          ${safeMessage}
        </div>
      </div>
    `;

    try {
      await this.mailService.sendRaw({
        to: supportAddress,
        replyTo: dto.email,
        subject,
        html,
      });
      this.logger.log(`Contact submission forwarded to ${supportAddress} from ${dto.email}`);
    } catch (err) {
      // Don't leak the failure to the user — they filled out a form, the message
      // not arriving is our problem, not theirs. Surface it to ops via logs.
      this.logger.error(`Failed to forward contact form from ${dto.email}: ${(err as Error).message}`);
      throw err;
    }
  }
}
