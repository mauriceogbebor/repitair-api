import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CreateRepitDto } from "./dto/create-repit.dto";
import { UpdateRepitDto } from "./dto/update-repit.dto";
import { RepitsService } from "./repits.service";

@Controller("repits")
@UseGuards(JwtAuthGuard)
export class RepitsController {
  constructor(private readonly repitsService: RepitsService) {}

  @Get()
  listRepits(
    @CurrentUser() user: CurrentUserPayload,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
    @Query("offset", new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    return this.repitsService.listRepits(user.sub, { limit, offset });
  }

  @Post()
  createRepit(@CurrentUser() user: CurrentUserPayload, @Body() body: CreateRepitDto) {
    return this.repitsService.createRepit(user.sub, body);
  }

  @Patch(":id")
  async updateRepit(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id") id: string,
    @Body() body: UpdateRepitDto,
  ) {
    const repit = await this.repitsService.updateRepit(user.sub, id, body);

    if (!repit) {
      throw new NotFoundException("Repit not found");
    }

    return repit;
  }

  @Delete(":id")
  async deleteRepit(@CurrentUser() user: CurrentUserPayload, @Param("id") id: string) {
    const deleted = await this.repitsService.deleteRepit(user.sub, id);

    if (!deleted) {
      throw new NotFoundException("Repit not found");
    }

    return { ok: true };
  }
}
