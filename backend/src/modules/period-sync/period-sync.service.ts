// backend/src/modules/period-sync/period-sync.service.ts
import { Injectable, Logger, OnModuleInit, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WingoPeriod, WingoPeriodStatus, WingoSyncStatus } from './wingo-period.entity';

interface ReferenceIssue { issueNumber: string; startTime: number; endTime: number; }
interface ReferencePayload {
  gameCode: string; intervalMinute: number; state: number;
  previous?: ReferenceIssue; current: ReferenceIssue; next?: ReferenceIssue;
}
export interface PeriodSyncSnapshot {
  gameCode: string; periodNumber: string; startTime: number; endTime: number;
  previousPeriodNumber: string | null; nextPeriodNumber: string | null;
  serverTime: number; remainingMs: number; status: 'OPEN' | 'CLOSED';
  syncStatus: WingoSyncStatus; lastSyncedAt: number | null;
}
// ---------------------------------------------------------------------------
// AUTHORITATIVE WINGO REFERENCE REGISTRY (TPPLAY).
//
// One entry per supported WinGo duration. Every game is polled INDEPENDENTLY
// against its own reference JSON and keeps its own in-memory snapshot, using
// the exact same mechanism the 30-second game has always used.
//
// Durations are the reference's own: 30S=30000, 1M=60000, 3M=180000,
// 5M=300000. `syncIntervalMs` is that game's steady-state poll cadence; on top
// of it EVERY game is woken up just after its current period's endTime
// (boundary wake-up) so the next authoritative period is picked up right at
// its boundary instead of waiting for the next steady tick.
// ---------------------------------------------------------------------------
export interface WingoGameConfig {
  code: string; envKey: string; defaultUrl: string; durationMs: number; syncIntervalMs: number;
}
const REF_BASE = 'https://draw.ar-lottery01.com/WinGo';
export const WINGO_GAMES: WingoGameConfig[] = [
  { code: 'WinGo_30S', envKey: 'WINGO_SYNC_URL', defaultUrl: REF_BASE + '/WinGo_30S.json', durationMs: 30000, syncIntervalMs: 1000 },
  { code: 'WinGo_1M', envKey: 'WINGO_SYNC_URL_1M', defaultUrl: REF_BASE + '/WinGo_1M.json', durationMs: 60000, syncIntervalMs: 5000 },
  { code: 'WinGo_3M', envKey: 'WINGO_SYNC_URL_3M', defaultUrl: REF_BASE + '/WinGo_3M.json', durationMs: 180000, syncIntervalMs: 5000 },
  { code: 'WinGo_5M', envKey: 'WINGO_SYNC_URL_5M', defaultUrl: REF_BASE + '/WinGo_5M.json', durationMs: 300000, syncIntervalMs: 5000 },
];
/** Backwards-compatible primary game — `getSnapshot()` always resolves to it. */
export const PRIMARY_WINGO_GAME = 'WinGo_30S';
/**
 * Lotto category → authoritative WinGo game. Categories missing from this map
 * have no external reference and keep the legacy independent generator.
 */
export const CATEGORY_WINGO_GAME: Record<string, string> = {
  THIRTY_SEC: 'WinGo_30S', ONE_MIN: 'WinGo_1M', THREE_MIN: 'WinGo_3M', FIVE_MIN: 'WinGo_5M',
};
const GAMES_BY_CODE = new Map<string, WingoGameConfig>(WINGO_GAMES.map((g) => [g.code, g]));
const TOL = 5000; const MIN_BO = 1000; const MAX_BO = 30000;

interface GameState {
  current: { periodNumber: string; startTime: number; endTime: number; previousPeriodNumber: string | null; nextPeriodNumber: string | null; syncStatus: WingoSyncStatus; lastSyncedAt: number; } | null;
  timer: NodeJS.Timeout | null;
  backoffMs: number; consecutiveFailures: number;
}

@Injectable()
export class PeriodSyncService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(PeriodSyncService.name);
  /** One independent state + timer per game code (WinGo_30S / 1M / 3M / 5M). */
  private readonly states = new Map<string, GameState>();
  private closed = false;

  constructor(@InjectRepository(WingoPeriod) private readonly repo: Repository<WingoPeriod>, private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled()) return;
    // 30-second game first (unchanged bootstrap contract), then the longer
    // durations — independent, and their failure can never break boot or 30S.
    await this.syncGame(PRIMARY_WINGO_GAME);
    await Promise.all(WINGO_GAMES.filter((g) => g.code !== PRIMARY_WINGO_GAME).map((g) =>
      this.syncGame(g.code).catch((e) => this.logger.warn('[PeriodSync:' + g.code + '] initial sync failed: ' + String(e)))));
  }
  onApplicationBootstrap(): void { if (this.enabled()) { for (const g of WINGO_GAMES) this.startLoop(g); this.logger.log('[PeriodSync] loops started: ' + WINGO_GAMES.map((g) => g.code).join(', ')); } }
  onModuleDestroy(): void { this.closed = true; for (const s of this.states.values()) { if (s.timer) { clearTimeout(s.timer); s.timer = null; } } }

  /** Authoritative snapshot for the 30-second game (unchanged contract). */
  getSnapshot(): PeriodSyncSnapshot | null { return this.snapshotFor(PRIMARY_WINGO_GAME); }
  /** Authoritative snapshot for one specific WinGo game. */
  getSnapshotForGame(gameCode: string): PeriodSyncSnapshot | null { return this.snapshotFor(gameCode); }
  /** Authoritative snapshot for a lotto category (THIRTY_SEC → WinGo_30S). */
  getSnapshotForCategory(category: string): PeriodSyncSnapshot | null {
    const code = CATEGORY_WINGO_GAME[category];
    return code ? this.snapshotFor(code) : null;
  }
  /** True when this category is backed by an authoritative external reference. */
  hasReferenceForCategory(category: string): boolean { return Boolean(CATEGORY_WINGO_GAME[category]); }
  isSynced(gameCode: string = PRIMARY_WINGO_GAME): boolean { return this.stateOf(gameCode).current !== null; }

  private snapshotFor(gameCode: string): PeriodSyncSnapshot | null {
    const cur = this.stateOf(gameCode).current;
    if (!cur) return null;
    const now = Date.now(); const remaining = Math.max(0, cur.endTime - now);
    return { gameCode, periodNumber: cur.periodNumber, startTime: cur.startTime, endTime: cur.endTime, previousPeriodNumber: cur.previousPeriodNumber, nextPeriodNumber: cur.nextPeriodNumber, serverTime: now, remainingMs: remaining, status: now < cur.endTime ? 'OPEN' : 'CLOSED', syncStatus: cur.syncStatus, lastSyncedAt: cur.lastSyncedAt };
  }

  private stateOf(gameCode: string): GameState {
    let s = this.states.get(gameCode);
    if (!s) { s = { current: null, timer: null, backoffMs: MIN_BO, consecutiveFailures: 0 }; this.states.set(gameCode, s); }
    return s;
  }

  private startLoop(game: WingoGameConfig): void {
    if (this.closed) return;
    const state = this.stateOf(game.code);
    const next = () => {
      if (this.closed) return;
      // Steady cadence for THIS game, refined so we can never lag the
      // reference's own update latency:
      //   1. wake up just after the current period's endTime,
      //   2. inside the boundary window (last second, and up to a few seconds
      //      after the period ended) poll at the fast cadence, so a reference
      //      that publishes the next issue a few hundred ms late is still
      //      picked up immediately instead of a full steady interval later.
      // `backoffMs` always wins, so failures still back off.
      // (For 30S this is byte-for-byte the previous behaviour: 1000ms cadence,
      // boundary wake-up at endTime + 500ms.)
      let delay = Math.max(state.backoffMs, game.syncIntervalMs);
      if (state.current) {
        const remaining = state.current.endTime - Date.now();
        if (remaining <= 1000 && remaining >= -6000) {
          delay = Math.min(delay, Math.max(state.backoffMs, 1000));
        }
        const boundary = remaining + 500;
        if (boundary > 0 && boundary < delay) delay = boundary;
      }
      state.timer = setTimeout(() => { void this.syncGame(game.code).catch(e => this.logger.error('[PeriodSync:' + game.code + '] ' + String(e))).finally(() => next()); }, delay);
    };
    next();
  }

  async syncOnce(): Promise<void> { return this.syncGame(PRIMARY_WINGO_GAME); }

  /**
   * Fetch + validate + persist ONE game's reference payload. Never fabricates:
   * on any failure the previous snapshot for that game is kept (marked
   * degraded) so downstream consumers keep the last authoritative period
   * instead of inventing a new one.
   */
  async syncGame(gameCode: string): Promise<void> {
    if (!this.enabled()) return;
    const game = GAMES_BY_CODE.get(gameCode);
    if (!game) return;
    const state = this.stateOf(gameCode);
    let payload: ReferencePayload;
    try { payload = await this.fetch(game); }
    catch (e) { state.consecutiveFailures++; state.backoffMs = Math.min(state.backoffMs * 2, MAX_BO); this.degraded(gameCode, String(e)); this.logger.warn('[PeriodSync:' + gameCode + '] fetch failed (' + state.consecutiveFailures + '): ' + String(e)); return; }
    try { this.validate(payload, game); }
    catch (e) { state.consecutiveFailures++; state.backoffMs = Math.min(state.backoffMs * 2, MAX_BO); this.degraded(gameCode, 'invalid: ' + String(e)); this.logger.warn('[PeriodSync:' + gameCode + '] invalid: ' + String(e)); return; }
    state.consecutiveFailures = 0; state.backoffMs = MIN_BO;
    const now = Date.now(); const prev = payload.previous?.issueNumber ?? null; const nextPeriod = payload.next?.issueNumber ?? null;
    if (!state.current || state.current.periodNumber !== payload.current.issueNumber) {
      if (prev) this.logger.log('[PeriodSync:' + gameCode + '] Previous: ' + prev);
      this.logger.log('[PeriodSync:' + gameCode + '] Current: ' + payload.current.issueNumber);
      if (nextPeriod) this.logger.log('[PeriodSync:' + gameCode + '] Next: ' + nextPeriod);
      this.logger.log('[PeriodSync:' + gameCode + '] Start: ' + payload.current.startTime);
      this.logger.log('[PeriodSync:' + gameCode + '] End: ' + payload.current.endTime);
    }
    state.current = { periodNumber: payload.current.issueNumber, startTime: payload.current.startTime, endTime: payload.current.endTime, previousPeriodNumber: prev, nextPeriodNumber: nextPeriod, syncStatus: WingoSyncStatus.SYNCED, lastSyncedAt: now };
    this.logger.log('[PeriodSync:' + gameCode + '] Status: SYNCED');
    await this.persist(payload, game);
  }

  private async fetch(game: WingoGameConfig): Promise<ReferencePayload> {
    const url = this.config.get<string>(game.envKey, game.defaultUrl);
    const timeoutMs = this.config.get<number>('WINGO_SYNC_TIMEOUT_MS', 5000) ?? 5000;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()) as ReferencePayload;
    } finally { clearTimeout(t); }
  }

  private validate(p: ReferencePayload, game: WingoGameConfig): void {
    if (!p || typeof p !== 'object') throw new Error('not object');
    if (p.gameCode !== game.code) throw new Error('gameCode ' + String(p.gameCode));
    if (!p.current || typeof p.current !== 'object') throw new Error('no current');
    if (typeof p.current.issueNumber !== 'string' || !p.current.issueNumber.trim()) throw new Error('no issueNumber');
    if (typeof p.current.startTime !== 'number' || !Number.isFinite(p.current.startTime)) throw new Error('bad startTime');
    if (typeof p.current.endTime !== 'number' || !Number.isFinite(p.current.endTime)) throw new Error('bad endTime');
    if (p.current.endTime <= p.current.startTime) throw new Error('endTime<=startTime');
    if (Math.abs(p.current.endTime - p.current.startTime - game.durationMs) > TOL) throw new Error('bad duration');
    if (p.previous && (typeof p.previous.issueNumber !== 'string' || !p.previous.issueNumber.trim())) throw new Error('bad previous');
    if (p.next && (typeof p.next.issueNumber !== 'string' || !p.next.issueNumber.trim())) throw new Error('bad next');
  }

  private async persist(p: ReferencePayload, game: WingoGameConfig): Promise<void> {
    const now = Date.now(); const rows: WingoPeriod[] = [];
    if (p.previous) rows.push(this.row(p.previous.issueNumber, p.previous.startTime, p.previous.endTime, WingoPeriodStatus.CLOSED, now, game));
    rows.push(this.row(p.current.issueNumber, p.current.startTime, p.current.endTime, WingoPeriodStatus.OPEN, now, game));
    if (p.next) rows.push(this.row(p.next.issueNumber, p.next.startTime, p.next.endTime, WingoPeriodStatus.OPEN, now, game));
    await this.repo.manager.transaction(async (m) => {
      for (const r of rows) { await m.getRepository(WingoPeriod).createQueryBuilder().insert().into(WingoPeriod).values(r).orUpdate(['startTime','endTime','previousPeriodNumber','nextPeriodNumber','status','syncStatus','lastSyncedAt','updatedAt'],['periodNumber']).execute(); }
    });
  }

  private row(pn: string, s: number, e: number, st: WingoPeriodStatus, now: number, game: WingoGameConfig): WingoPeriod {
    const r = new WingoPeriod(); r.periodNumber = pn; r.gameCode = game.code; r.startTime = String(s); r.endTime = String(e); r.status = st; r.syncStatus = WingoSyncStatus.SYNCED; r.lastSyncedAt = String(now); return r;
  }

  private degraded(gameCode: string, reason: string): void {
    const state = this.stateOf(gameCode);
    if (!state.current) return;
    state.current.syncStatus = state.consecutiveFailures >= 3 ? WingoSyncStatus.SYNC_ERROR : WingoSyncStatus.SYNC_DEGRADED;
    this.logger.warn('[PeriodSync:' + gameCode + '] ' + state.current.syncStatus + ': ' + reason);
  }
  private enabled(): boolean { const r = (this.config.get<string>('WINGO_SYNC_ENABLED') ?? 'true').trim(); return !['0','false','off','no'].includes(r.toLowerCase()); }
}

