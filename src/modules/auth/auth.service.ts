import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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
    // In production, send the code via email.
    // For dev/MVP we return it in the response.
    return {
      message: code
        ? "Verification code sent to your email"
        : "If that email exists, a code has been sent",
      // DEV ONLY — remove in production
      ...(code ? { devCode: code } : {}),
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

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
