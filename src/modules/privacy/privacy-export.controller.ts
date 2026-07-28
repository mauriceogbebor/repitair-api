import { Controller, Get, Header, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrivacyExecutionService } from "./privacy-execution.service";

/**
 * Data-subject download endpoint. The high-entropy, short-lived token is the
 * authority; no Admin session or permission is required or accepted here.
 */
@Controller("privacy")
export class PrivacyExportController {
  constructor(private readonly execution: PrivacyExecutionService) {}

  @Get("export/:token")
  @Header("Cache-Control", "private, no-store, max-age=0")
  async download(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.execution.downloadExport(token);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="repitair-data-export.json"',
    );
    return result.package;
  }
}
