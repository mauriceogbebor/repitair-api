import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { NextFunction, Response } from "express";
import type { AdminRequest } from "../admin.types";

@Injectable()
export class AdminRequestContextMiddleware implements NestMiddleware {
  use(request: AdminRequest, response: Response, next: NextFunction) {
    request.adminRequestContext = {
      requestId: randomUUID(),
      ipAddress: request.ip ?? null,
      userAgent: request.get("user-agent") ?? null,
      method: request.method,
      path: request.originalUrl,
    };

    response.setHeader("x-admin-request-id", request.adminRequestContext.requestId);
    next();
  }
}
