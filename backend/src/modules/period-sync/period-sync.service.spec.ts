// backend/src/modules/period-sync/period-sync.service.spec.ts
//
// WinGo period synchronization contract (TPPLAY is the reference).
//
// Pinned behaviour for 30S / 1M / 3M / 5M:
//   - each game is polled from its OWN reference URL,
//   - period number / startTime / endTime are used VERBATIM (never generated),
//   - TPPlay contiguity holds (previous.endTime === current.startTime,
//     current.endTime === next.startTime, issue + 1),
//   - 30S keeps its exact previous snapshot contract,
//   - a bad payload for one game can never damage another game's snapshot.
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import {
  CATEGORY_WINGO_GAME,
  PeriodSyncService,
  PRIMARY_WINGO_GAME,
  WINGO_GAMES,
} from './period-sync.service';
import { WingoPeriod, WingoSyncStatus } from './wingo-period.entity';

const URL_30S = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S.json';
const URL_1M = 'https://draw.ar-lottery01.com/WinGo/WinGo_1M.json';
const URL_3M = 'https://draw.ar-lottery01.com/WinGo/WinGo_3M.json';
const URL_5M = 'https://draw.ar-lottery01.com/WinGo/WinGo_5M.json';

interface Issue { issueNumber: string; startTime: number; endTime: number }
const payload = (
  gameCode: string,
  intervalMinute: number,
  previous: Issue,
  current: Issue,
  next: Issue,
) => ({ gameCode, intervalMinute, state: 1, previous, current, next });

// ── Reference payloads as captured from TPPlay ────────────────────────────
const REF_30S = payload(
  'WinGo_30S',
  0.5,
  { issueNumber: '202609151000050001', startTime: 1789454700000, endTime: 1789454730000 },
  { issueNumber: '202609151000050002', startTime: 1789454730000, endTime: 1789454760000 },
  { issueNumber: '202609151000050003', startTime: 1789454760000, endTime: 1789454790000 },
);
const REF_1M = payload(
  'WinGo_1M',
  1.0,
  { issueNumber: '202609151000010405', startTime: 1789454640000, endTime: 1789454700000 },
  { issueNumber: '202609151000010406', startTime: 1789454700000, endTime: 1789454760000 },
  { issueNumber: '202609151000010407', startTime: 1789454760000, endTime: 1789454820000 },
);
const REF_3M = payload(
  'WinGo_3M',
  3.0,
  { issueNumber: '202609151000020135', startTime: 1789454520000, endTime: 1789454700000 },
  { issueNumber: '202609151000020136', startTime: 1789454700000, endTime: 1789454880000 },
  { issueNumber: '202609151000020137', startTime: 1789454880000, endTime: 1789455060000 },
);
const REF_5M = payload(
  'WinGo_5M',
  5.0,
  { issueNumber: '202609151000030081', startTime: 1789454400000, endTime: 1789454700000 },
  { issueNumber: '202609151000030082', startTime: 1789454700000, endTime: 1789455000000 },
  { issueNumber: '202609151000030083', startTime: 1789455000000, endTime: 1789455300000 },
);
const ALL_REFS = [REF_30S, REF_1M, REF_3M, REF_5M];
const REFERENCES: Record<string, ReturnType<typeof payload>> = {
  [URL_30S]: REF_30S,
  [URL_1M]: REF_1M,
  [URL_3M]: REF_3M,
  [URL_5M]: REF_5M,
};

// ── Fakes ─────────────────────────────────────────────────────────────────
const makeRepo = (): Repository<WingoPeriod> => {
  const execute = jest.fn().mockResolvedValue(undefined);
  const orUpdate = jest.fn(() => ({ execute }));
  const values = jest.fn(() => ({ orUpdate }));
  const into = jest.fn(() => ({ values }));
  const insert = jest.fn(() => ({ into }));
  const createQueryBuilder = jest.fn(() => ({ insert }));
  const getRepository = jest.fn(() => ({ createQueryBuilder }));
  const transaction = jest.fn(
    async (cb: (manager: unknown) => Promise<void>) => cb({ getRepository }),
  );
  return { manager: { transaction } } as unknown as Repository<WingoPeriod>;
};

const makeService = (): PeriodSyncService =>
  new PeriodSyncService(makeRepo(), {
    get: (key: string, fallback?: unknown) =>
      key === 'WINGO_SYNC_ENABLED' ? 'true' : fallback,
  } as never);

const fetchMock = (overrides: Record<string, unknown> = {}) =>
  jest.fn(async (url: string) => {
    const body = url in overrides ? overrides[url] : REFERENCES[url];
    if (!body || typeof body !== 'object') {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if ((body as { ok?: boolean }).ok === false) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => body };
  });

describe('PeriodSyncService — WinGo period sync (TPPLAY reference)', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // Pin "now" INSIDE the current period of every game in the captured
    // reference payloads (30S: …473000–…476000, 1M/3M/5M: …470000–…476000+),
    // so status/remaining assertions are deterministic rather than clock-dependent.
    jest.useFakeTimers();
    jest.setSystemTime(1789454740000);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('exposes the four reference-backed games with TPPlay durations', () => {
    expect(WINGO_GAMES.map((g) => [g.code, g.durationMs])).toEqual([
      ['WinGo_30S', 30000],
      ['WinGo_1M', 60000],
      ['WinGo_3M', 180000],
      ['WinGo_5M', 300000],
    ]);
    expect(CATEGORY_WINGO_GAME).toEqual({
      THIRTY_SEC: 'WinGo_30S',
      ONE_MIN: 'WinGo_1M',
      THREE_MIN: 'WinGo_3M',
      FIVE_MIN: 'WinGo_5M',
    });
  });

  it('keeps the 30-second snapshot contract (getSnapshot + syncOnce)', async () => {
    const service = makeService();
    fetchSpy.mockImplementation(fetchMock() as never);

    await service.syncGame(PRIMARY_WINGO_GAME);

    const snapshot = service.getSnapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        gameCode: 'WinGo_30S',
        periodNumber: '202609151000050002',
        startTime: 1789454730000,
        endTime: 1789454760000,
        previousPeriodNumber: '202609151000050001',
        nextPeriodNumber: '202609151000050003',
        status: 'OPEN',
        syncStatus: WingoSyncStatus.SYNCED,
      }),
    );
    expect(snapshot?.remainingMs).toBeGreaterThan(0);
    expect(snapshot?.remainingMs).toBeLessThanOrEqual(30000);

    // Backwards-compatible alias still resolves to the 30-second game.
    await service.syncOnce();
    expect(service.getSnapshot()?.gameCode).toBe('WinGo_30S');
  });

  it('syncs 1M, 3M and 5M from their own reference, verbatim', async () => {
    const service = makeService();
    fetchSpy.mockImplementation(fetchMock() as never);

    await service.syncGame('WinGo_1M');
    await service.syncGame('WinGo_3M');
    await service.syncGame('WinGo_5M');

    expect(service.getSnapshotForCategory('ONE_MIN')).toEqual(
      expect.objectContaining({
        gameCode: 'WinGo_1M',
        periodNumber: '202609151000010406',
        startTime: 1789454700000,
        endTime: 1789454760000,
        previousPeriodNumber: '202609151000010405',
        nextPeriodNumber: '202609151000010407',
        status: 'OPEN',
        syncStatus: WingoSyncStatus.SYNCED,
      }),
    );
    expect(service.getSnapshotForCategory('THREE_MIN')).toEqual(
      expect.objectContaining({
        gameCode: 'WinGo_3M',
        periodNumber: '202609151000020136',
        startTime: 1789454700000,
        endTime: 1789454880000,
        previousPeriodNumber: '202609151000020135',
        nextPeriodNumber: '202609151000020137',
        status: 'OPEN',
      }),
    );
    expect(service.getSnapshotForCategory('FIVE_MIN')).toEqual(
      expect.objectContaining({
        gameCode: 'WinGo_5M',
        periodNumber: '202609151000030082',
        startTime: 1789454700000,
        endTime: 1789455000000,
        previousPeriodNumber: '202609151000030081',
        nextPeriodNumber: '202609151000030083',
        status: 'OPEN',
      }),
    );

    // Each game was polled from its OWN reference URL.
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      URL_1M,
      URL_3M,
      URL_5M,
    ]);

    // 30S untouched here; TEN_MIN has no reference at all.
    expect(service.getSnapshot()).toBeNull();
    expect(service.getSnapshotForCategory('TEN_MIN')).toBeNull();
  });

  it("satisfies TPPlay's contiguity + sequential issue rules for every game", () => {
    for (const ref of ALL_REFS) {
      const { previous, current, next } = ref;

      // No gap, no overlap: the next period starts when the previous ends.
      expect(previous.endTime).toBe(current.startTime);
      expect(current.endTime).toBe(next.startTime);

      // Exact duration per game (30s / 60s / 180s / 300s).
      const duration =
        WINGO_GAMES.find((g) => g.code === ref.gameCode)?.durationMs ?? 0;
      expect(current.endTime - current.startTime).toBe(duration);
      expect(next.endTime - next.startTime).toBe(duration);

      // Issue increments by exactly +1, same fixed-width format.
      expect((BigInt(previous.issueNumber) + 1n).toString()).toBe(
        current.issueNumber,
      );
      expect((BigInt(current.issueNumber) + 1n).toString()).toBe(
        next.issueNumber,
      );
      expect(current.issueNumber).toHaveLength(next.issueNumber.length);
    }
  });

  it('never overwrites a good snapshot with an invalid payload', async () => {
    const service = makeService();
    fetchSpy.mockImplementation(fetchMock() as never);

    await service.syncGame('WinGo_1M');
    expect(service.getSnapshotForCategory('ONE_MIN')?.periodNumber).toBe(
      '202609151000010406',
    );

    // 1M reference suddenly reports a 30-second period → rejected.
    fetchSpy.mockImplementation(fetchMock({ [URL_1M]: REF_30S }) as never);
    await service.syncGame('WinGo_1M');

    const afterBadDuration = service.getSnapshotForCategory('ONE_MIN');
    expect(afterBadDuration?.periodNumber).toBe('202609151000010406');
    expect(afterBadDuration?.syncStatus).toBe(WingoSyncStatus.SYNC_DEGRADED);

    // A wrong gameCode is rejected as well (nothing fabricated).
    fetchSpy.mockImplementation(
      fetchMock({ [URL_3M]: { ...REF_3M, gameCode: 'WinGo_30S' } }) as never,
    );
    await service.syncGame('WinGo_3M');
    expect(service.getSnapshotForCategory('THREE_MIN')).toBeNull();
  });

  it('a failing 1M/3M/5M fetch never affects the 30-second snapshot', async () => {
    const service = makeService();
    fetchSpy.mockImplementation(fetchMock() as never);
    await service.syncGame('WinGo_30S');

    fetchSpy.mockImplementation(
      fetchMock({
        [URL_1M]: { ok: false },
        [URL_3M]: { ok: false },
        [URL_5M]: { ok: false },
      }) as never,
    );
    await service.syncGame('WinGo_1M');
    await service.syncGame('WinGo_3M');
    await service.syncGame('WinGo_5M');

    const thirtySec = service.getSnapshot();
    expect(thirtySec?.periodNumber).toBe('202609151000050002');
    expect(thirtySec?.syncStatus).toBe(WingoSyncStatus.SYNCED);
    expect(service.getSnapshotForCategory('ONE_MIN')).toBeNull();
    expect(service.getSnapshotForGame('WinGo_5M')).toBeNull();
  });

  it('tracks `isSynced` per game', async () => {
    const service = makeService();
    fetchSpy.mockImplementation(fetchMock() as never);

    await service.syncGame('WinGo_5M');
    expect(service.isSynced('WinGo_5M')).toBe(true);
    expect(service.isSynced('WinGo_1M')).toBe(false);
    expect(service.isSynced()).toBe(false); // default → 30S
  });

  it('flags which categories are reference-backed', () => {
    const service = makeService();
    for (const category of ['THIRTY_SEC', 'ONE_MIN', 'THREE_MIN', 'FIVE_MIN']) {
      expect(service.hasReferenceForCategory(category)).toBe(true);
    }
    // TEN_MIN has no external reference → legacy generator.
    expect(service.hasReferenceForCategory('TEN_MIN')).toBe(false);
  });
});

