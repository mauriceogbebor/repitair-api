import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { UsersService } from "./users.service";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

enum ConnectablePlatform {
  SPOTIFY = "spotify",
  APPLE_MUSIC = "apple-music",
}

class ConnectPlatformDto {
  @IsEnum(ConnectablePlatform)
  platform!: string;
}

class DisconnectPlatformDto {
  @IsEnum(ConnectablePlatform)
  platform!: string;
}

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    const foundUser = await this.usersService.findById(user.sub);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: foundUser.id,
      fullName: foundUser.fullName,
      email: foundUser.email,
      country: foundUser.country,
      connectedPlatforms: foundUser.connectedPlatforms,
      avatarUrl: foundUser.avatarUrl ?? null,
    };
  }

  @Patch()
  async updateProfile(@CurrentUser() user: CurrentUserPayload, @Body() body: UpdateProfileDto) {
    const foundUser = await this.usersService.updateProfile(user.sub, body);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: foundUser.id,
      fullName: foundUser.fullName,
      email: foundUser.email,
      country: foundUser.country,
      connectedPlatforms: foundUser.connectedPlatforms,
      avatarUrl: foundUser.avatarUrl ?? null,
    };
  }

  @Post("change-password")
  async changePassword(@CurrentUser() user: CurrentUserPayload, @Body() body: ChangePasswordDto) {
    const foundUser = await this.usersService.findById(user.sub);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    const valid = await this.usersService.validatePassword(foundUser, body.currentPassword);
    if (!valid) {
      throw new BadRequestException("Current password is incorrect");
    }

    await this.usersService.changePassword(user.sub, body.newPassword);
    return { message: "Password updated successfully" };
  }

  @Post("connect-platform")
  async connectPlatform(@CurrentUser() user: CurrentUserPayload, @Body() body: ConnectPlatformDto) {
    const foundUser = await this.usersService.findById(user.sub);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    throw new BadRequestException(
      body.platform === ConnectablePlatform.SPOTIFY
        ? "Use the Spotify OAuth flow to connect Spotify."
        : "Use the Apple Music authorization flow to connect Apple Music.",
    );
  }

  @Post("disconnect-platform")
  async disconnectPlatform(@CurrentUser() user: CurrentUserPayload, @Body() body: DisconnectPlatformDto) {
    const updatedUser = await this.usersService.disconnectPlatform(user.sub, body.platform);

    return {
      id: updatedUser.id,
      connectedPlatforms: updatedUser.connectedPlatforms,
    };
  }

  @Delete()
  async deleteAccount(@CurrentUser() user: CurrentUserPayload) {
    const deleted = await this.usersService.deleteUser(user.sub);
    if (!deleted) {
      throw new UnauthorizedException("User not found");
    }

    return { ok: true, message: "Account deleted successfully" };
  }
}
