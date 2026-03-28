import { Module } from "@nestjs/common";

import { RepitsController } from "./repits.controller";
import { RepitsService } from "./repits.service";

@Module({
  controllers: [RepitsController],
  providers: [RepitsService]
})
export class RepitsModule {}
