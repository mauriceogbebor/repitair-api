import { HttpException } from "@nestjs/common";

export type MusicErrorCode =
  | "INVALID_LINK"
  | "UNSUPPORTED_PROVIDER_URL"
  | "PROVIDER_NOT_CONNECTED"
  | "PROVIDER_REAUTH_REQUIRED"
  | "PROVIDER_AUTH_FAILURE"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "NETWORK_FAILURE"
  | "NORMALIZATION_FAILURE"
  | "UNKNOWN_RESOLUTION_FAILURE";

export type MusicProvider = "spotify" | "apple-music" | "unknown";
export type MusicLinkType = "track" | "album" | "playlist" | "unknown";

export type MusicLookupContext = {
  requestId: string;
  endpoint: string;
  provider: MusicProvider;
  linkType: MusicLinkType;
  normalizedUrl: string;
  userId?: string;
};

export class MusicResolutionException extends HttpException {
  readonly code: MusicErrorCode;
  readonly requestId: string;
  readonly provider: MusicProvider;
  readonly linkType: MusicLinkType;
  readonly providerStatus: number | null;
  readonly retriable: boolean;

  constructor(args: {
    code: MusicErrorCode;
    message: string;
    status: number;
    context: MusicLookupContext;
    providerStatus?: number | null;
    retriable?: boolean;
  }) {
    super(
      {
        errorCode: args.code,
        linkType: args.context.linkType,
        message: args.message,
        provider: args.context.provider,
        requestId: args.context.requestId,
        retriable: args.retriable ?? false,
      },
      args.status,
    );

    this.code = args.code;
    this.requestId = args.context.requestId;
    this.provider = args.context.provider;
    this.linkType = args.context.linkType;
    this.providerStatus = args.providerStatus ?? null;
    this.retriable = args.retriable ?? false;
  }
}

export class UpstreamMusicError extends Error {
  readonly code: MusicErrorCode;
  readonly httpStatus: number;
  readonly providerStatus: number | null;
  readonly retriable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(args: {
    code: MusicErrorCode;
    message: string;
    httpStatus: number;
    providerStatus?: number | null;
    retriable?: boolean;
    retryAfterSeconds?: number | null;
  }) {
    super(args.message);
    this.name = "UpstreamMusicError";
    this.code = args.code;
    this.httpStatus = args.httpStatus;
    this.providerStatus = args.providerStatus ?? null;
    this.retriable = args.retriable ?? false;
    this.retryAfterSeconds = args.retryAfterSeconds ?? null;
  }
}
