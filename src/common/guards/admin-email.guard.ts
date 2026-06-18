import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type AuthenticatedRequest = {
  user?: {
    email?: string;
  };
};

@Injectable()
export class AdminEmailGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const email = request.user?.email?.trim().toLowerCase();

    if (!email) {
      throw new ForbiddenException("Admin access requires an authenticated email");
    }

    const allowedEmails = this.configService
      .get<string>("ADMIN_EMAILS", "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (allowedEmails.length === 0 || !allowedEmails.includes(email)) {
      throw new ForbiddenException("Admin access denied");
    }

    return true;
  }
}
