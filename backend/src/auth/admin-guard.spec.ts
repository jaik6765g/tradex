import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AdminAccessPolicy } from './admin-access.policy';
import { AdminGuard } from './guards/admin.guard';

function makePolicy(users: Record<string, unknown>, adminWallet = '') {
  const userRepo = {
    findOne: async (q: { where: { id: string } }) => users[q.where.id] ?? null,
  } as never;
  const configService = { get: () => adminWallet } as never;
  return new AdminAccessPolicy(userRepo, configService);
}

/** Metadata reader stub: `exempt` mimics @AllowAdminMfaPending(). */
function makeReflector(exempt = false) {
  return { getAllAndOverride: () => exempt } as never;
}

function ctxFor(user: unknown) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('AdminGuard — backend-authoritative authorization + AAL2', () => {
  it('unauthenticated (no principal) -> 401', async () => {
    const guard = new AdminGuard(makePolicy({}), makeReflector());
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('normal authenticated user -> 403 (forged isAdmin + forged AAL2 ignored)', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'u-1': { id: 'u-1', role: 'user', status: 'active' } }),
      makeReflector(),
    );
    // Attacker forges role AND aal on the request principal — DB still says user.
    await expect(
      guard.canActivate(ctxFor({ id: 'u-1', role: 'admin', aal: 'aal2' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('active admin + AAL2 -> allowed (sensitive admin operation)', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-1': { id: 'a-1', role: 'admin', status: 'active' } }),
      makeReflector(),
    );
    await expect(
      guard.canActivate(ctxFor({ id: 'a-1', aal: 'aal2' })),
    ).resolves.toBe(true);
  });

  it('active admin + AAL1 -> 403 ADMIN_MFA_REQUIRED', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-1': { id: 'a-1', role: 'admin', status: 'active' } }),
      makeReflector(),
    );

    await expect(
      guard.canActivate(ctxFor({ id: 'a-1', aal: 'aal1' })),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'ADMIN_MFA_REQUIRED', aal: 'aal1' },
    });
  });

  it('active admin with NO aal claim (legacy token) -> treated as AAL1 -> 403', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-1': { id: 'a-1', role: 'admin', status: 'active' } }),
      makeReflector(),
    );
    await expect(guard.canActivate(ctxFor({ id: 'a-1' }))).rejects.toMatchObject({
      status: 403,
      response: { code: 'ADMIN_MFA_REQUIRED' },
    });
  });

  it('@AllowAdminMfaPending allows AAL1 but keeps the role check', async () => {
    const adminGuard = new AdminGuard(
      makePolicy({ 'a-1': { id: 'a-1', role: 'admin', status: 'active' } }),
      makeReflector(true),
    );
    await expect(
      adminGuard.canActivate(ctxFor({ id: 'a-1', aal: 'aal1' })),
    ).resolves.toBe(true);

    // The exemption relaxes ONLY the MFA layer — role/status still enforced.
    const userGuard = new AdminGuard(
      makePolicy({ 'u-1': { id: 'u-1', role: 'user', status: 'active' } }),
      makeReflector(true),
    );
    await expect(
      userGuard.canActivate(ctxFor({ id: 'u-1', aal: 'aal1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('demoted admin (role=user now) -> 403 even with stale admin JWT principal + AAL2', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-2': { id: 'a-2', role: 'user', status: 'active' } }),
      makeReflector(),
    );
    await expect(
      guard.canActivate(ctxFor({ id: 'a-2', role: 'admin', aal: 'aal2' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('suspended admin (status!=active) -> 403 even with AAL2', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-3': { id: 'a-3', role: 'admin', status: 'suspended' } }),
      makeReflector(),
    );
    await expect(
      guard.canActivate(ctxFor({ id: 'a-3', aal: 'aal2' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('unknown account -> 401', async () => {
    const guard = new AdminGuard(makePolicy({}), makeReflector());
    await expect(guard.canActivate(ctxFor({ id: 'ghost' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('legacy ADMIN_WALLET fallback still works when active + AAL2', async () => {
    const wallet = '0x4459968f2AAD867FBD6AEfaBb5898A5F17516A62';
    const guard = new AdminGuard(
      makePolicy(
        { 'w-1': { id: 'w-1', role: 'user', status: 'active', walletAddress: wallet } },
        wallet,
      ),
      makeReflector(),
    );
    await expect(
      guard.canActivate(ctxFor({ id: 'w-1', aal: 'aal2' })),
    ).resolves.toBe(true);
  });

  it('forged client MFA flags never satisfy AAL2 (query/body/custom headers)', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'a-4': { id: 'a-4', role: 'admin', status: 'active' } }),
      makeReflector(),
    );
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'a-4', aal: 'aal1' },
          query: { aal: 'aal2', mfa: 'verified', admin_mfa: 'true' },
          body: { aal: 'aal2', mfaVerified: true, totpVerified: true },
          headers: { 'x-aal': 'aal2', 'x-mfa': 'verified', 'x-admin-mfa': 'true' },
        }),
      }),
    } as never;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ADMIN_MFA_REQUIRED' },
    });
  });

  it('query/body/header admin flags are never consulted', async () => {
    const guard = new AdminGuard(
      makePolicy({ 'u-9': { id: 'u-9', role: 'user', status: 'active' } }),
      makeReflector(),
    );
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u-9' },
          query: { admin: 'true', role: 'admin', isAdmin: 'true' },
          body: { isAdmin: true, role: 'admin' },
          headers: { 'x-admin': 'true', 'x-role': 'admin' },
        }),
      }),
    } as never;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no credentials/tokens/TOTP secrets are logged by the guard', async () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    console.warn = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    try {
      const guard = new AdminGuard(
        makePolicy({ 'u-1': { id: 'u-1', role: 'user', status: 'active' } }),
        makeReflector(),
      );
      await expect(
        guard.canActivate(
          ctxFor({
            id: 'u-1',
            password: 's3cret',
            access_token: 'tok',
            refresh_token: 'r',
            totp_secret: 'JBSWY3DPEHPK3PXP',
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
    const dump = logged.join('\n').toLowerCase();
    expect(dump).not.toContain('s3cret');
    expect(dump).not.toContain('access_token');
    expect(dump).not.toContain('totp_secret');
    expect(dump).not.toContain('jbswy3dpehpk3pxp');
  });
});
