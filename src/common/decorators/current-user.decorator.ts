import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface CurrentUserPayload {
  sub: string;
  email: string;
  token: string;
  /** Unix seconds when this session completed primary authentication. */
  authTime?: number;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as CurrentUserPayload;
  },
);
