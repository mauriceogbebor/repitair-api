import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

export type AdminAccessTokenPayload = {
  sub: string;
  email: string;
  sid?: string;
  tokenType: "admin-access";
  exp?: number;
  iat?: number;
};

export type AdminMfaTicketPayload = {
  sub: string;
  email: string;
  tokenType: "admin-mfa-ticket";
};

@Injectable()
export class AdminTokenService {
  private readonly accessJwt: JwtService;
  private readonly mfaTicketJwt: JwtService;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>("ADMIN_JWT_SECRET") ?? "admin-dev-secret-change-me";
    const accessExpiresIn = this.configService.get<string>("ADMIN_JWT_EXPIRES_IN") ?? "8h";
    const ticketExpiresIn = this.configService.get<string>("ADMIN_MFA_TICKET_EXPIRES_IN") ?? "10m";

    this.accessJwt = new JwtService({ secret, signOptions: { expiresIn: accessExpiresIn as any } });
    this.mfaTicketJwt = new JwtService({ secret, signOptions: { expiresIn: ticketExpiresIn as any } });
  }

  signAccessToken(payload: Omit<AdminAccessTokenPayload, "tokenType">): string {
    return this.accessJwt.sign({ ...payload, tokenType: "admin-access" });
  }

  verifyAccessToken(token: string): AdminAccessTokenPayload {
    try {
      const payload = this.accessJwt.verify<AdminAccessTokenPayload>(token);
      if (payload.tokenType !== "admin-access") {
        throw new UnauthorizedException("Invalid admin token type");
      }
      return payload;
    } catch {
      throw new UnauthorizedException("Invalid or expired admin access token");
    }
  }

  signMfaTicket(payload: Omit<AdminMfaTicketPayload, "tokenType">): string {
    return this.mfaTicketJwt.sign({ ...payload, tokenType: "admin-mfa-ticket" });
  }

  verifyMfaTicket(ticket: string): AdminMfaTicketPayload {
    try {
      const payload = this.mfaTicketJwt.verify<AdminMfaTicketPayload>(ticket);
      if (payload.tokenType !== "admin-mfa-ticket") {
        throw new UnauthorizedException("Invalid MFA ticket type");
      }
      return payload;
    } catch {
      throw new UnauthorizedException("Invalid or expired MFA ticket");
    }
  }
}
