import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminAccessPolicy } from './admin-access.policy';
import { AdminGuard } from './guards/admin.guard';
import { ADMIN_MFA_EXEMPT_KEY } from './guards/admin-mfa-exempt.decorator';
import { AdminAuthController } from './admin-auth.controller';
import { AdminBscGasController } from '../deposit-gateway/admin-bsc-gas/admin-bsc-gas.controller';
import { AdminController } from '../admin/admin.controller';

/**
 * AAL2 (TOTP MFA) enforcement matrix.
 *
 * Runs the REAL AdminGuard against the REAL controller classes so the Nest
 * route metadata (which handlers are exempt) is what is actually exercised —
 * not a hand-written list that could drift from the code.
 */

const ADMIN = 'a-1';
const NORMAL = 'u-1';

function makePolicy() {
  const users: Record<string, unknown> = {
    [ADMIN]: { id: ADMIN, role: 'admin', status: 'active' },
    [NORMAL]: { id: NORMAL, role: 'user', status: 'active' },
  };
  const userRepo = {
    findOne: async (q: { where: { id: string } }) => users[q.where.id] ?? null,
  } as never;
  const configService = { get: () => '' } as never;
  return new AdminAccessPolicy(userRepo, configService);
}

const reflector = new Reflector();

function buildContext(
  handler: unknown,
  cls: unknown,
  user: Record<string, unknown> | undefined,
) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

/** Real HTTP route handlers of a controller (path metadata present). */
function routeHandlers(cls: abstract new (...args: never[]) => object) {
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({
      name,
      handler: (cls.prototype as unknown as Record<string, unknown>)[name],
    }))
    .filter(
      (entry) =>
        typeof entry.handler === 'function' &&
        Reflect.getMetadata('path', entry.handler as object) !== undefined,
    );
}

describe('AAL2 enforcement matrix — real controllers, real route metadata', () => {
  const guard = new AdminGuard(makePolicy(), reflector);

  it('the BSC gas/sweep controller exposes exactly the 8 hardened admin routes', () => {
    const paths = routeHandlers(AdminBscGasController)
      .map((r) => Reflect.getMetadata('path', r.handler as object))
      .sort();

    expect(paths).toEqual(
      [
        'gas',
        'gas/batch-preview',
        'gas/batch-send',
        'gas/batches/:id',
        'gas/export',
        'sweeps/:sweepId/execute',
        'sweeps/address/:depositAddressId/execute',
        'sweeps/bulk-execute',
      ].sort(),
    );
  });

  it('EVERY BSC gas/sweep route rejects an AAL1 admin with 403 ADMIN_MFA_REQUIRED', async () => {
    const routes = routeHandlers(AdminBscGasController);
    expect(routes.length).toBe(8);

    for (const route of routes) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminBscGasController, {
            id: ADMIN,
            aal: 'aal1',
          }),
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ADMIN_MFA_REQUIRED', aal: 'aal1' },
      });
    }
  });

  it('EVERY BSC gas/sweep route allows an AAL2 admin (sweep + batch-send included)', async () => {
    for (const route of routeHandlers(AdminBscGasController)) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminBscGasController, {
            id: ADMIN,
            aal: 'aal2',
          }),
        ),
      ).resolves.toBe(true);
    }
  });

  it('EVERY general admin route rejects an AAL1 admin (audit, settings, bonus)', async () => {
    const routes = routeHandlers(AdminController);
    expect(routes.length).toBeGreaterThanOrEqual(5);

    for (const route of routes) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminController, { id: ADMIN, aal: 'aal1' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'ADMIN_MFA_REQUIRED' } });
    }
  });

  it('a normal user with a forked AAL2 principal still gets 403 Admin access denied', async () => {
    for (const route of routeHandlers(AdminBscGasController)) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminBscGasController, {
            id: NORMAL,
            role: 'admin',
            aal: 'aal2',
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('no JWT -> 401 even for the MFA bootstrap routes', async () => {
    for (const route of routeHandlers(AdminAuthController)) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminAuthController, undefined),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('ONLY the 3 MFA bootstrap routes are exempt; AAL1 admin is allowed there', async () => {
    const routes = routeHandlers(AdminAuthController);
    const exempt = routes.filter(
      (route) =>
        Reflect.getMetadata(ADMIN_MFA_EXEMPT_KEY, route.handler as object) === true,
    );

    expect(exempt.map((r) => r.name).sort()).toEqual([
      'mfaEvent',
      'mfaStatus',
      'verify',
    ]);

    for (const route of exempt) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminAuthController, {
            id: ADMIN,
            aal: 'aal1',
          }),
        ),
      ).resolves.toBe(true);
    }
  });

  it('a normal user cannot reach the MFA bootstrap routes either (403)', async () => {
    for (const route of routeHandlers(AdminAuthController)) {
      await expect(
        guard.canActivate(
          buildContext(route.handler, AdminAuthController, {
            id: NORMAL,
            role: 'admin',
            aal: 'aal2',
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('no BSC route can be exempted through request-controlled metadata', async () => {
    for (const route of routeHandlers(AdminBscGasController)) {
      const ctx = {
        getHandler: () => route.handler,
        getClass: () => AdminBscGasController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: ADMIN, aal: 'aal1' },
            query: { aal: 'aal2', mfaVerified: 'true' },
            body: { aal: 'aal2', mfaVerified: true, skipMfa: true },
            headers: { 'x-admin-mfa': 'true', 'x-aal': 'aal2' },
          }),
        }),
      } as never;

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'ADMIN_MFA_REQUIRED' },
      });
    }
  });
});