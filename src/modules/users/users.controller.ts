import { BadRequestException, Body, Controller, Get, Headers, Patch, Post, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsOptional, IsString, MinLength } from "class-validator";

import { UsersService } from "./users.service";

class ConnectPlatformDto {
  @IsString()
  platform!: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller("me")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  private extractUserId(authHeader?: string): string {
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing token");
    }

    const token = authHeader.slice(7);

    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    return payload.sub;
  }

  @Get()
  async getProfile(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      country: user.country,
      connectedPlatforms: user.connectedPlatforms,
    };
  }

  @Patch()
  async updateProfile(
    @Headers("authorization") authHeader: string,
    @Body() body: UpdateProfileDto,
  ) {
    const userId = this.extractUserId(authHeader);
    const user = await this.usersService.updateProfile(userId, body);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      country: user.country,
      connectedPlatforms: user.connectedPlatforms,
    };
  }

  @Post("change-password")
  async changePassword(
    @Headers("authorization") authHeader: string,
    @Body() body: ChangePasswordDto,
  ) {
    const userId = this.extractUserId(authHeader);
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const valid = await this.usersService.validatePassword(user, body.currentPassword);
    if (!valid) {
      throw new BadRequestException("Current password is incorrect");
    }

    await this.usersService.changePassword(userId, body.newPassword);
    return { message: "Password updated successfully" };
  }

  @Post("connect-platform")
  async connectPlatform(
    @Headers("authorization") authHeader: string,
    @Body() body: ConnectPlatformDto,
  ) {
    const userId = this.extractUserId(authHeader);
    const user = await this.usersService.connectPlatform(userId, body.platform);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: user.id,
      connectedPlatforms: user.connectedPlatforms,
    };
  }
}
