import {
  INestApplication,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as supertest from 'supertest';
const request = supertest.default ?? (supertest as unknown as typeof supertest.default);

import { AdminAccessPolicy } from '../auth/admin-access.policy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WageringAdminController } from './wagering-admin.controller';
import { WageringService } from './wagering.service';

const USER = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';

const USERS: Record<string, { id: string; role: string; status: string }> = {
  [USER]: { id: USER, role: 'user', status: 'active' },
  [ADMIN]: { id: ADMIN, role: 'admin', status: 'active' },
};

const fakeUserRepo = {
  findOne: async ({ where }: { where: { id: string } }) =>
    USERS[where.id] ?? null,
};
const fakeConfig = { get: () => '' };

/**
 * JWT-auth guard stand-in with the same HTTP contract as the real
 * JwtAuthGuard: no bearer identity -> 401; otherwise populates request.user
 * from the test identity header so the REAL AdminAccessPolicy + AdminGuard
 * run their DB-authoritative role check and MFA/AAL2 decision unchanged.
 */
class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers?.['x-test-user'];
    if (!raw) {
      throw new UnauthorizedException('Missing bearer token');
    }
    req.user = JSON.parse(String(raw));
    return true;
  }
}

describe('WageringAdminController — HTTP auth contract (Fix C1)', () => {
  let app: INestApplication;
  const settingsStub = {
    getSettings: async () => ({ singletonKey: 1, defaultMultiplier: 2 }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WageringAdminController],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .useMocker((token) => {
        if (token === WageringService) return settingsStub;
        if (token === AdminAccessPolicy) {
          return new AdminAccessPolicy(
            fakeUserRepo as never,
            fakeConfig as never,
          );
        }
        return undefined;
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get(
      '/admin/wagering/settings',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for an authenticated non-admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/wagering/settings')
      .set('x-test-user', JSON.stringify({ id: USER, aal: 'aal2' }));
    expect(res.status).toBe(403);
  });

  it('rejects an admin without MFA (AAL1) with ADMIN_MFA_REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/wagering/settings')
      .set('x-test-user', JSON.stringify({ id: ADMIN, aal: 'aal1' }));
    expect(res.status).toBe(403);
    expect(res.body?.code ?? res.body?.message?.code).toBe(
      'ADMIN_MFA_REQUIRED',
    );
  });

  it('allows an active admin with AAL2 to reach the endpoint', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/wagering/settings')
      .set('x-test-user', JSON.stringify({ id: ADMIN, aal: 'aal2' }));
    expect(res.status).toBe(200);
    expect(res.body?.defaultMultiplier).toBe(2);
  });
});
