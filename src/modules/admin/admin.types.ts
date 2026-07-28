import type { Request } from "express";

export type AdminRequestActor = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roleKeys: string[];
  permissionKeys: string[];
  breakGlass?: {
    grantId: string;
    expiresAt: string;
  } | null;
};

export type AdminRequestContext = {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  method: string;
  path: string;
};

export type AdminRequest = Request & {
  adminUser?: AdminRequestActor;
  adminRequestContext?: AdminRequestContext;
  adminSessionToken?: string;
  adminSessionExpiresAt?: number;
  adminSessionId?: string;
};
