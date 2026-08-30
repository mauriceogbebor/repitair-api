import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { UsersService } from "./users.service";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  // NOTE: email is deliberately NOT accepted here. Changing the primary email
  // goes through the verified pending-email workflow below.

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

class RequestEmailChangeDto {
  @IsEmail()
  newEmail!: string;

  /** Required for password accounts; social-only accounts prove recency via a fresh login. */
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

class ConfirmEmailChangeDto {
  @IsString()
  code!: string;
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

class DeleteAccountDto {
  @IsString()
  password!: string;
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
      emailVerified: foundUser.emailVerified,
      pendingEmail: foundUser.pendingEmail ?? null,
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
      emailVerified: foundUser.emailVerified,
      pendingEmail: foundUser.pendingEmail ?? null,
      country: foundUser.country,
      connectedPlatforms: foundUser.connectedPlatforms,
      avatarUrl: foundUser.avatarUrl ?? null,
    };
  }

  /**
   * Request an email change. Requires a recent-authentication proof and sends a
   * single-use confirmation code to the NEW address. The response never reveals
   * whether the address already belongs to another account.
   */
  @Post("email/change-request")
  async requestEmailChange(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: RequestEmailChangeDto,
  ) {
    await this.usersService.requestEmailChange(user.sub, body.newEmail, body.currentPassword);
    return {
      message:
        "If that address is available, we've sent a confirmation code to it. Enter the code to finish changing your email.",
    };
  }

  /** Confirm a pending email change with the code sent to the new address. */
  @Post("email/change-confirm")
  async confirmEmailChange(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: ConfirmEmailChangeDto,
  ) {
    const updated = await this.usersService.confirmEmailChange(user.sub, body.code);
    return {
      id: updated.id,
      email: updated.email,
      emailVerified: updated.emailVerified,
      pendingEmail: updated.pendingEmail ?? null,
      message: "Your email address has been updated. Please sign in again.",
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
  async deleteAccount(@CurrentUser() user: CurrentUserPayload, @Body() body: DeleteAccountDto) {
    const foundUser = await this.usersService.findById(user.sub);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    const valid = await this.usersService.validatePassword(foundUser, body.password);
    if (!valid) {
      throw new BadRequestException("Password is incorrect");
    }

    await this.usersService.deleteUser(user.sub);
    return { ok: true, message: "Account deleted successfully" };
  }
}
