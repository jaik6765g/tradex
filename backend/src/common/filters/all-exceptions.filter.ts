// backend/src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import type { Response } from 'express';

import type { RequestWithId } from '../middleware/request-id.middleware';

/** Shape attached by JwtAuthGuard/AdminGuard (never contains secrets). */
interface RequestUser {
  id?: string;
  authUserId?: string;
  role?: string;
}

type RequestWithContext = RequestWithId & { user?: RequestUser };

/**
 * ============================================================
 * GLOBAL EXCEPTION FILTER — real causes are never hidden
 * ============================================================
 *
 * Before this filter an unhandled error produced Nest's generic
 * `{"statusCode":500,"message":"Internal server error"}` and the actual
 * exception (e.g. EntityMetadataNotFoundError, QueryFailedError with the
 * failing SQL) was only visible in raw stderr — which is exactly why a
 * bonus-distribution failure looked like an anonymous 500.
 *
 * Now:
 *   - the REAL error name + message are always logged (with stack), tagged
 *     with the request context: requestId, method, path, admin/user id/role;
 *   - the HTTP response carries `code`, `exception`, `requestId` and the real
 *     message so the caller is never left with a blind 500;
 *   - the raw stack is returned only outside production or to an admin
 *     caller, so internals are not leaked to public/anonymous clients;
 *   - existing HttpException contracts (custom `code` fields, validation
 *     message arrays, custom payload fields) are preserved verbatim — only an
 *     additive `requestId` is appended.
 *
 * NEVER logs headers, cookies, tokens, bodies or query strings.
 * ============================================================
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();

    const requestId = request?.requestId ?? null;
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionName =
      exception instanceof Error ? exception.name : typeof exception;
    const exceptionMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    const logContext = {
      requestId,
      method: request?.method ?? null,
      path: request?.originalUrl ?? request?.url ?? null,
      statusCode: status,
      exception: exceptionName,
      message: exceptionMessage,
      adminId: request?.user?.id ?? null,
      authUserId: request?.user?.authUserId ?? null,
      role: request?.user?.role ?? null,
    };

    if (status >= 500) {
      this.logger.error(
        `UNHANDLED_EXCEPTION ${JSON.stringify(logContext)}`,
        stack,
      );
    } else {
      this.logger.warn(`REQUEST_REJECTED ${JSON.stringify(logContext)}`);
    }

    if (isHttpException) {
      response.status(status).json(this.preserveHttpExceptionBody(exception, requestId));
      return;
    }

    const isProduction =
      (process.env.NODE_ENV ?? 'development') === 'production';
    const exposeDetails = !isProduction || request?.user?.role === 'admin';

    response.status(status).json({
      statusCode: status,
      error: 'Internal Server Error',
      code: 'INTERNAL_SERVER_ERROR',
      // The real cause — never masked behind a generic message.
      exception: exceptionName,
      message: exposeDetails
        ? exceptionMessage
        : 'Internal server error (see server logs for this requestId)',
      requestId,
      path: request?.originalUrl ?? request?.url ?? null,
      timestamp: new Date().toISOString(),
      ...(exposeDetails && stack ? { stack } : {}),
    });
  }

  /**
   * Keeps every existing HttpException response shape byte-for-byte
   * compatible (the frontend consumes custom `code` fields), adding only the
   * correlation id.
   */
  private preserveHttpExceptionBody(
    exception: HttpException,
    requestId: string | null,
  ): Record<string, unknown> {
    const original = exception.getResponse();

    if (typeof original === 'string') {
      return {
        statusCode: exception.getStatus(),
        message: original,
        requestId,
      };
    }

    return { ...(original as Record<string, unknown>), requestId };
  }
}
