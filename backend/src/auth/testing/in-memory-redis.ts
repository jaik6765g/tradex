/**
 * Minimal in-memory ioredis stand-in for unit tests.
 *
 * Implements ONLY the commands the admin MFA throttle uses
 * (eval with the throttle Lua scripts, del) with Redis-equivalent semantics
 * at second granularity (lazy expiry like Redis). Records every command so
 * tests can assert that no secret-like value is ever written to Redis.
 * No real Redis connection is required.
 */
export class InMemoryRedis {
  private readonly values = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();

  /** Logical clock in seconds — tests advance it to simulate TTL expiry. */
  private nowSeconds = 0;

  /** Every command invoked against this client (command + args). */
  readonly calls: Array<{ command: string; args: string[] }> = [];

  /** Flip to simulate a Redis outage per command. */
  failOn: { eval?: boolean; del?: boolean } = {};

  tick(seconds: number): void {
    this.nowSeconds += seconds;
  }

  private alive(
    key: string,
  ): { value: string; expiresAt: number | null } | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && this.nowSeconds >= entry.expiresAt) {
      this.values.delete(key);
      return null;
    }
    return entry;
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number[]> {
    this.calls.push({ command: 'eval', args: [script, String(numKeys), ...args] });
    if (this.failOn.eval) {
      throw new Error('ECONNREFUSED (simulated Redis outage)');
    }

    const key = args[0];

    if (script.includes('INCR')) {
      // FAILURE_SCRIPT: INCR + EXPIRE-once + TTL.
      const windowSeconds = Number(args[1]);
      const existing = this.alive(key);
      if (existing) {
        existing.value = String(Number(existing.value) + 1);
        const ttl = Math.max(1, (existing.expiresAt ?? 0) - this.nowSeconds);
        return [Number(existing.value), ttl];
      }
      this.values.set(key, {
        value: '1',
        expiresAt: this.nowSeconds + windowSeconds,
      });
      return [1, windowSeconds];
    }

    // READ_SCRIPT: GET + TTL.
    const entry = this.alive(key);
    if (!entry) return [0, -2];
    return [Number(entry.value), Math.max(1, (entry.expiresAt ?? 0) - this.nowSeconds)];
  }

  async del(...keys: string[]): Promise<number> {
    this.calls.push({ command: 'del', args: keys });
    if (this.failOn.del) {
      throw new Error('ECONNREFUSED (simulated Redis outage)');
    }
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1;
    }
    return removed;
  }

  /** Everything currently stored — used to assert only integer counters exist. */
  dumpValues(): Array<{ key: string; value: string }> {
    return [...this.values.entries()].map(([key, entry]) => ({
      key,
      value: entry.value,
    }));
  }

  /** Raw TTL for a key in seconds (-2 when missing), for TTL assertions. */
  rawTtl(key: string): number {
    const entry = this.alive(key);
    if (!entry || entry.expiresAt === null) return -2;
    return Math.max(1, entry.expiresAt - this.nowSeconds);
  }
}