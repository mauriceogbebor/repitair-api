import { BadRequestException, Body, Controller, Get, Patch, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, MinLength } from "class-validator";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
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

  @IsOptional()
  @IsString()
  country?: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
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
    const foundUser = await this.usersService.connectPlatform(user.sub, body.platform);
    if (!foundUser) {
      throw new UnauthorizedException("User not found");
    }

    return {
      id: foundUser.id,
      connectedPlatforms: foundUser.connectedPlatforms,
    };
  }
}
