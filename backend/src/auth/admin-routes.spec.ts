/**
 * Route-level authorization audit (no DB, no network).
 * Asserts EVERY admin surface is registered behind JwtAuthGuard + AdminGuard,
 * and that no public privilege-elevation endpoint exists.
 */
describe('admin route protection audit', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  function read(rel: string): string {
    return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  }

  it('all 8 BSC admin endpoints require AdminGuard (class-level guard)', () => {
    const src = read('deposit-gateway/admin-bsc-gas/admin-bsc-gas.controller.ts');
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*AdminGuard\)/);
    for (const route of [
      "gas'",
      'gas/export',
      'gas/batch-preview',
      'gas/batch-send',
      'gas/batches/:id',
      'sweeps/address/:depositAddressId/execute',
      'sweeps/:sweepId/execute',
      'sweeps/bulk-execute',
    ]) {
      expect(src).toContain(route);
    }
  });

  it('admin + gateway + users + withdrawals + lotto + pulse controllers are guard-protected', () => {
    for (const f of [
      'admin/admin.controller.ts',
      'deposit-gateway/gateway.controller.ts',
      'users/users.controller.ts',
      'withdrawals/withdrawals.controller.ts',
      'modules/lotto/admin-lotto.controller.ts',
      'pulse-trade/controllers/pulse-portfolio.controller.ts',
      'bot/bot.controller.ts',
    ]) {
      const src = read(f);
      expect(src).toContain('AdminGuard');
    }
  });

  it('bot settings routes require BOTH JwtAuthGuard and AdminGuard', () => {
    const src = read('bot/bot.controller.ts');
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*AdminGuard\)/);
  });

  it('no public make-admin / promote endpoint exists', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const out = execSync(
      'grep -rni \"make-admin\\|makeAdmin\\|promote\\|set-role\\|setRole\" src --include=\"*.controller.ts\" || true',
      { cwd: __dirname + '/..' },
    ).toString();
    expect(out.trim()).toBe('');
  });

  it('admin role is never assigned from signup input', () => {
    const svc = read('users/users.service.ts');
    // createWithMobileReferral hardcodes role user; role param (if any) is internal only.
    expect(svc).toContain("role: role ?? 'user'");
    const dto = read('auth/dto/mobile-auth.dto.ts');
    expect(dto.toLowerCase()).not.toContain('admin');
  });

  it('no wallet-signature admin login path exists', () => {
    const ctrl = read('auth/mobile-auth.controller.ts');
    expect(ctrl).not.toMatch(/admin.*wallet|wallet.*admin/i);
  });

  it('only the admin-auth bootstrap routes are exempted from the AAL2 (MFA) layer', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const srcRoot = path.join(__dirname, '..');
    const out = execSync(
      'grep -rl "AllowAdminMfaPending" . --include="*.controller.ts" || true',
      { cwd: srcRoot },
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^\.\//, ''));

    // Exactly ONE controller may relax the MFA requirement: the admin MFA
    // bootstrap surface. Everything else must require AAL2.
    expect(out).toEqual(['auth/admin-auth.controller.ts']);
  });

  it('admin-auth bootstrap routes still require JwtAuthGuard + AdminGuard', () => {
    const src = read('auth/admin-auth.controller.ts');
    const guardUses = src.match(/@UseGuards\(JwtAuthGuard,\s*AdminGuard\)/g) ?? [];
    expect(guardUses.length).toBe(3);
    for (const route of ["'verify'", "'mfa/status'", "'mfa/events'"]) {
      expect(src).toContain(route);
    }
    // Every exempt handler is individually marked — never a class-level exemption.
    const exempts = src.match(/@AllowAdminMfaPending\(\)/g) ?? [];
    expect(exempts.length).toBe(3);
  });

  it('AdminGuard enforces AAL2 by default (secure default, metadata opt-out)', () => {
    const src = read('auth/guards/admin.guard.ts');
    expect(src).toContain('assertAdminMfa');
    expect(src).toContain('ADMIN_MFA_EXEMPT_KEY');
    // The AAL value must come from req.user (verified JWT), not from the request.
    expect(src).toContain('request?.user?.aal');
    expect(src).not.toMatch(/req\.(query|body|headers).*aal/i);
  });

  it('no public admin MFA reset / disable / recovery endpoint exists', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const srcRoot = path.join(__dirname, '..');
    const out = execSync(
      'grep -rniE "@(Post|Put|Patch|Delete)\\(.*(mfa|totp|2fa|factor)" . --include="*.controller.ts" || true',
      { cwd: srcRoot },
    ).toString();

    // The only public MFA mutation is the self-scoped audit event recorder.
    for (const line of out.trim().split('\n').filter(Boolean)) {
      expect(line).toContain('mfa/events');
    }
    expect(out).not.toMatch(/reset|recover|forgot|disable/i);
  });

  it('the MFA event DTO cannot carry a TOTP code, secret or token', () => {
    // Strip comments so only real declarations are inspected.
    const dto = read('auth/dto/admin-mfa.dto.ts')
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n')
      .toLowerCase();

    expect(dto).not.toContain('secret');
    expect(dto).not.toContain('code');
    expect(dto).not.toContain('token');
    expect(dto).not.toContain('password');
    expect(dto).not.toContain('recovery');
    // Only the safe, allow-listed metadata fields exist.
    expect(dto).toContain('event!');
    expect(dto).toContain('factorid');
  });

  it('ADMIN_MFA_RECOVERY is not reachable through the client event allow-list', () => {
    const svc = read('auth/admin-mfa.service.ts');
    const allowList = svc.slice(
      svc.indexOf('ADMIN_MFA_CLIENT_EVENTS = ['),
      svc.indexOf('] as const;'),
    );
    expect(allowList).not.toContain('ADMIN_MFA_RECOVERY');
    for (const event of [
      'ADMIN_MFA_ENROLL_STARTED',
      'ADMIN_MFA_ENROLL_SUCCESS',
      'ADMIN_MFA_VERIFY_SUCCESS',
      'ADMIN_MFA_VERIFY_FAILED',
      'ADMIN_MFA_CHANGED',
      'ADMIN_MFA_DISABLE',
    ]) {
      expect(allowList).toContain(event);
    }
  });
});
