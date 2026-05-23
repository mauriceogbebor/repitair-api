import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { ContactSubmission } from "../../entities";

@Module({
  imports: [TypeOrmModule.forFeature([ContactSubmission])],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
