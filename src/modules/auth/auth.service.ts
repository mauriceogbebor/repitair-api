import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  async signup(dto: SignupDto) {
    const user = await this.usersService.createUser({
      fullName: dto.fullName,
      email: dto.email,
      password: dto.password,
      country: dto.country ?? "",
    });

    const token = this.signToken(user.id, user.email);

    return {
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        country: user.country,
        connectedPlatforms: user.connectedPlatforms,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await this.usersService.validatePassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const token = this.signToken(user.id, user.email);

    return {
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        country: user.country,
        connectedPlatforms: user.connectedPlatforms,
      },
    };
  }

  async forgotPassword(email: string) {
    const code = await this.usersService.setResetCode(email);
    const user = await this.usersService.findByEmail(email);
    if (code && user) {
      try {
        await this.mailService.sendPasswordResetCode(email, code, user.fullName);
      } catch (err) {
        this.logger.error(`Failed to send reset email to ${email}: ${(err as Error).message}`);
        // Don't leak email failure to the caller — preserve enumeration resistance.
      }
    }
    // Always return the same response whether or not the email exists,
    // to prevent account enumeration.
    return {
      message: "If that email exists, a verification code has been sent",
    };
  }

  async verifyCode(email: string, code: string) {
    const valid = await this.usersService.verifyResetCode(email, code);
    if (!valid) {
      throw new UnauthorizedException("Invalid or expired code");
    }
    return { verified: true };
  }

  async resetPassword(email: string, newPassword: string) {
    const success = await this.usersService.resetPassword(email, newPassword);
    if (!success) {
      throw new UnauthorizedException("Could not reset password");
    }
    return { message: "Password has been reset successfully" };
  }

  async logout(token: string) {
    // Decode (not verify — already verified by the guard) to pull the exp claim
    // so we only keep the token blacklisted until its natural expiry.
    try {
      const decoded = this.jwtService.decode(token) as { exp?: number } | null;
      this.tokenBlacklist.add(token, decoded?.exp);
    } catch {
      // If decode fails for any reason, blacklist with default expiry.
      this.tokenBlacklist.add(token);
    }
    return { message: "Logged out successfully" };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
