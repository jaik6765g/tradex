// backend/src/common/middleware/request-id.middleware.ts
import { randomUUID } from 'crypto';

import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  /** Correlation id assigned per request (also echoed in the response). */
  requestId?: string;
}

/**
 * Assigns a correlation id to every request — reusing an inbound
 * `x-request-id` when provided, otherwise generating a UUID — and echoes it
 * back in the response.
 *
 * Why: a production 500 must be traceable end-to-end. The id appears on the
 * response body/header AND on every log line for that request, so a Render
 * log search by requestId shows the exact exception.
 *
 * Never inspects or logs headers, cookies, tokens or bodies.
 */
export function requestIdMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const headerValue = Array.isArray(inbound) ? inbound[0] : inbound;
  const candidate = typeof headerValue === 'string' ? headerValue.trim() : '';

  req.requestId =
    candidate.length > 0 && candidate.length <= 128
      ? candidate
      : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}
