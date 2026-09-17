import type { RedisOptions } from 'ioredis';

/**
 * Parses REDIS_URL into the connection options ioredis (and therefore
 * BullMQ) expects.
 *
 * Extracted from the original inline `BullModule.forRootAsync` factory in
 * AppModule so the BullMQ connection and the app-level throttle client share
 * ONE parser — same server, same parsing, no duplicated configuration logic.
 */
export function parseRedisUrl(redisUrl: string): RedisOptions {
  try {
    const parsed = new URL(redisUrl);
    const connection: RedisOptions = {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? Number(parsed.port) : 6379,
    };
    if (parsed.username) connection.username = parsed.username;
    if (parsed.password) connection.password = parsed.password;
    const db = parsed.pathname.replace(/^\//, '');
    if (db) connection.db = Number(db);
    return connection;
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}