import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorCode: string | null = null;
    let requestId: string | null =
      request.header('x-client-request-id') ?? null;
    let retriable: boolean | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const typedResponse = exceptionResponse as {
          errorCode?: string;
          message: string | string[];
          requestId?: string;
          retriable?: boolean;
        };
        const raw = typedResponse.message;
        // Preserve the array so clients can show per-field validation errors.
        message = raw;
        errorCode = typedResponse.errorCode ?? null;
        requestId = typedResponse.requestId ?? requestId;
        retriable =
          typeof typedResponse.retriable === 'boolean'
            ? typedResponse.retriable
            : retriable;
      }
    }

    // Detect upstream timeout / network errors that escaped local catch blocks
    if (!(exception instanceof HttpException) && exception instanceof Error) {
      if (
        exception.name === 'TimeoutError' ||
        exception.name === 'AbortError'
      ) {
        status = HttpStatus.GATEWAY_TIMEOUT;
        message =
          'An upstream service did not respond in time. Please try again.';
      } else if (
        exception.message?.includes('fetch failed') ||
        exception.message?.includes('ECONNREFUSED')
      ) {
        status = HttpStatus.BAD_GATEWAY;
        message =
          'An upstream service is temporarily unavailable. Please try again.';
      }
    }

    // Log error details server-side (never expose to client)
    if (status >= 500) {
      this.logger.error(
        `[${request.method} ${request.url}] ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Never send internal error details to the client (unless we already set a user-facing message above )
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        message = 'Internal server error';
      }
    }

    if (requestId) {
      response.setHeader('x-request-id', requestId);
    }

    response.status(status).json({
      ...(errorCode ? { errorCode } : {}),
      statusCode: status,
      message,
      ...(requestId ? { requestId } : {}),
      ...(retriable !== null ? { retriable } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
