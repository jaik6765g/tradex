import * as crypto from 'crypto';

import { UnauthorizedException } from '@nestjs/common';

import { SupabaseJwtStrategy } from './supabase-jwt.strategy';

// ============================================================
// SUPABASE JWT STRATEGY — BOUNDED JWKS FETCH (cold-start hardening)
// ============================================================
// The JWKS fetch used to have NO timeout: a hung/slow Supabase endpoint
// could stall every authenticated request. These tests prove:
//   - the fetch is bounded by AbortSignal and fails CLOSED (401)
//   - transient failures are never cached (next request retries)
//   - successful keys are cached (unchanged secure caching)
//   - verification strength is unchanged (unknown kid, non-ok body,
//     malformed body, and unlinked users all still 401)
//   - the legacy HS256 path still uses the configured secret
// ============================================================

const base64UrlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const tokenWithHeader = (header: Record<string, unknown>): string =>
  `${base64UrlJson(header)}.${base64UrlJson({ sub: 'user-1' })}.${Buffer.from('signature').toString('base64url')}`;

function makeStrategy(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_JWT_SECRET: 'legacy-hs256-secret',
    SUPABASE_JWKS_TIMEOUT_MS: 25,
    ...overrides,
  };
  const configService = {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  };
  const usersService = { findByAuthUserId: jest.fn().mockResolvedValue(null) };
  const strategy = new SupabaseJwtStrategy(
    configService as never,
    usersService as never,
  );
  return { strategy, usersService };
}

const resolveKey = (strategy: SupabaseJwtStrategy, token: string) =>
  (
    strategy as unknown as {
      resolveKey: (t: string) => Promise<string | Buffer>;
    }
  ).resolveKey(token);

const originalFetch = globalThis.fetch;

/**
 * Minimal global stubbing helpers — this Jest setup does not expose
 * jest.stubGlobal / jest.unstubAllGlobals.
 */
const stubGlobal = (name: string, value: unknown): void => {
  (globalThis as unknown as Record<string, unknown>)[name] = value;
};
const unstubAllGlobals = (): void => {
  (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
};

describe('SupabaseJwtStrategy bounded JWKS fetch', () => {
  afterEach(() => {
    unstubAllGlobals();
    jest.restoreAllMocks();
  });

  it('aborts a hung JWKS fetch at the configured timeout and fails closed (401)', async () => {
    const fetchMock = jest.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          // Never resolves on its own: ONLY the AbortSignal can settle it.
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('The operation was aborted')),
          );
        }),
    );
    stubGlobal('fetch', fetchMock);

    const { strategy } = makeStrategy();

    await expect(
      resolveKey(strategy, tokenWithHeader({ alg: 'ES256', kid: 'key-1' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a transient JWKS failure — the next request retries', async () => {
    const fetchMock = jest.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      }),
    );
    stubGlobal('fetch', fetchMock);

    const { strategy } = makeStrategy();
    const token = tokenWithHeader({ alg: 'ES256', kid: 'key-1' });

    await expect(resolveKey(strategy, token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(resolveKey(strategy, token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches successfully fetched signing keys (unchanged caching behavior)', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'key-1',
      alg: 'ES256',
      use: 'sig',
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [jwk] }),
    });
    stubGlobal('fetch', fetchMock);

    const { strategy } = makeStrategy();
    const token = tokenWithHeader({ alg: 'ES256', kid: 'key-1' });

    const first = await resolveKey(strategy, token);
    const second = await resolveKey(strategy, token);

    expect(String(first)).toContain('BEGIN PUBLIC KEY');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown signing key id (verification not weakened)', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'published-key',
      alg: 'ES256',
      use: 'sig',
    };

    stubGlobal(
      'fetch',
      jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ keys: [jwk] }) }),
    );

    const { strategy } = makeStrategy();

    await expect(
      resolveKey(strategy, tokenWithHeader({ alg: 'ES256', kid: 'other' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed on a non-OK JWKS response or a malformed body', async () => {
    stubGlobal(
      'fetch',
      jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    const first = makeStrategy();
    await expect(
      resolveKey(first.strategy, tokenWithHeader({ alg: 'ES256', kid: 'k' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    stubGlobal(
      'fetch',
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );
    const second = makeStrategy();
    await expect(
      resolveKey(second.strategy, tokenWithHeader({ alg: 'ES256', kid: 'k' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the legacy HS256 path working without any JWKS fetch', async () => {
    const fetchMock = jest.fn();
    stubGlobal('fetch', fetchMock);

    const { strategy } = makeStrategy();
    const secret = await resolveKey(strategy, tokenWithHeader({ alg: 'HS256' }));

    expect(secret).toBe('legacy-hs256-secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still rejects tokens for unlinked accounts (auth mapping unchanged)', async () => {
    const { strategy, usersService } = makeStrategy();

    await expect(
      (
        strategy as unknown as {
          validate: (p: unknown) => Promise<unknown>;
        }
      ).validate({ sub: 'missing-user' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(usersService.findByAuthUserId).toHaveBeenCalledWith('missing-user');
  });
});
