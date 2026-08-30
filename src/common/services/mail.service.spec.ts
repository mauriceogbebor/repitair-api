import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

import { MailService } from "./mail.service";

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

describe("MailService", () => {
  const originalFetch = global.fetch;
  const createTransportMock =
    nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  function config(values: Record<string, string | number | undefined>): ConfigService {
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  it("uses SendGrid HTTPS without initializing SMTP when an API key is configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: jest.fn().mockResolvedValue(""),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new MailService(
      config({
        SENDGRID_API_KEY: "test-key",
        SENDGRID_API_URL: "https://sendgrid.test/v3/mail/send",
        SMTP_HOST: "smtp.sendgrid.net",
        SMTP_USER: "apikey",
        SMTP_PASS: "smtp-key",
        SMTP_FROM: "Repitair <support@repitair.com>",
      }),
    );

    await service.sendRaw({
      to: "admin@example.com",
      subject: "Invite",
      html: "<p>Hello</p>",
      replyTo: "support@example.com",
    });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://sendgrid.test/v3/mail/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(init.body))).toEqual({
      personalizations: [{ to: [{ email: "admin@example.com" }] }],
      from: { email: "support@repitair.com", name: "Repitair" },
      subject: "Invite",
      content: [{ type: "text/html", value: "<p>Hello</p>" }],
      reply_to: { email: "support@example.com" },
    });
  });

  it("does not fall back to SMTP after a SendGrid rejection", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('{"errors":[{"message":"denied"}]}'),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new MailService(
      config({
        SENDGRID_API_KEY: "test-key",
        SMTP_HOST: "smtp.sendgrid.net",
        SMTP_USER: "apikey",
        SMTP_PASS: "smtp-key",
      }),
    );

    await expect(
      service.sendRaw({
        to: "admin@example.com",
        subject: "Invite",
        html: "<p>Hello</p>",
      }),
    ).rejects.toThrow("SendGrid rejected email delivery (HTTP 401)");

    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("uses SMTP when no SendGrid API key is configured", async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: "id" });
    createTransportMock.mockReturnValue({
      sendMail,
    } as unknown as nodemailer.Transporter);

    const service = new MailService(
      config({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: 587,
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "Repitair <support@repitair.com>",
      }),
    );

    await service.sendRaw({
      to: "admin@example.com",
      subject: "Invite",
      html: "<p>Hello</p>",
    });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
