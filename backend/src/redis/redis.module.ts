import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { parseRedisUrl } from './redis-connection';

/** Injection token for the shared application-level Redis client. */
export const REDIS_CLIENT = 'TRADEX_REDIS_CLIENT';

/**
 * Gracefully closes the shared Redis client when the app shuts down.
 * (Separate provider so the raw client token stays a plain factory.)
 */
@Injectable()
export class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

/**
 * Single application-level Redis client reusing the EXISTING TradeX Redis
 * infrastructure: same REDIS_URL, same parsing as the BullMQ connection
 * (`parseRedisUrl`), same library (ioredis, already a direct dependency).
 * No new Redis library, no second Redis server, no global config change.
 *
 * Client options are chosen for the admin MFA throttle's fail-closed policy:
 * - `lazyConnect`      — no connection is opened until the first command, so
 *                        booting the app never depends on Redis being up.
 * - `maxRetriesPerRequest: 1` + `enableOfflineQueue: false` — commands fail
 *                        fast instead of queueing forever while disconnected,
 *                        letting the throttle surface a safe 503.
 */
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (!redisUrl) {
          throw new Error('REDIS_URL is not configured');
        }

        return new Redis({
          ...parseRedisUrl(redisUrl),
          lazyConnect: true,
          connectTimeout: 3_000,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: (times: number) => Math.min(times * 500, 5_000),
        });
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}