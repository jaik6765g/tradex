import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Minimal in-memory per-user order creation rate limiter. Prevents unlimited
 * order spam. Local-development grade: resets on restart; replace with a
 * Redis/Throttler implementation for multi-instance production.
 */
@Injectable()
export class OrderRateLimiterService {
  private readonly maxPerWindow = 5;
  private readonly windowMs = 60_000;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(userId: string): void {
    const now = Date.now();
    const entry = this.hits.get(userId);

    if (!entry || now >= entry.resetAt) {
      this.hits.set(userId, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    entry.count += 1;

    if (entry.count > this.maxPerWindow) {
      throw new HttpException(
        'Too many deposit orders. Please wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

