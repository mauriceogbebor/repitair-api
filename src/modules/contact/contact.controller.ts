import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { ContactService } from "./contact.service";
import { ContactDto } from "./dto/contact.dto";

@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async submit(@Body() body: ContactDto) {
    await this.contactService.submit(body);
    return { ok: true, message: "Thanks — we'll be in touch." };
  }
}
