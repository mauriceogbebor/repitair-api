import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";

import { CreateRepitDto } from "./dto/create-repit.dto";
import { UpdateRepitDto } from "./dto/update-repit.dto";
import { RepitsService } from "./repits.service";

@Controller("repits")
export class RepitsController {
  constructor(private readonly repitsService: RepitsService) {}

  @Get()
  listRepits() {
    return this.repitsService.listRepits();
  }

  @Post()
  createRepit(@Body() body: CreateRepitDto) {
    return this.repitsService.createRepit(body);
  }

  @Patch(":id")
  async updateRepit(@Param("id") id: string, @Body() body: UpdateRepitDto) {
    const repit = await this.repitsService.updateRepit(id, body);

    if (!repit) {
      throw new NotFoundException("Repit not found");
    }

    return repit;
  }

  @Delete(":id")
  async deleteRepit(@Param("id") id: string) {
    const deleted = await this.repitsService.deleteRepit(id);

    if (!deleted) {
      throw new NotFoundException("Repit not found");
    }

    return { ok: true };
  }
}
