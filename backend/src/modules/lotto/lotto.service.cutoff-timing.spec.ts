import {
  LottoRound,
  RoundStatus,
  Category,
} from './entities/lotto-round.entity';
import {
  LottoResult,
  ResultSource,
  ResultStatus,
} from './entities/lotto-result.entity';
import { LottoService } from './lotto.service';

/**
 * Cutoff-first result timing (targeted fix verification).
 * No financial logic touched here.
 */
describe('LottoService cutoff-first result timing', () => {
  const buildRound = (overrides: Partial<LottoRound> = {}) =>
    ({
      id: 21,
      roundNumber: '000021',
      category: Category.THIRTY_SEC,
      status: RoundStatus.OPEN,
      startAt: new Date(Date.now() - 30_000),
      cutoffAt: new Date(Date.now() + 4_000),
      drawAt: new Date(Date.now() + 9_000),
      resultId: null,
      ...overrides,
    }) as LottoRound;

  const buildHarness = (round: LottoRound, existingResults: LottoResult[] = []) => {
    const resultRows: LottoResult[] = [...existingResults];
    const savedRounds: LottoRound[] = [];

    const roundRepo = {
      findOne: jest.fn(async () => round),
      save: jest.fn(async (row: LottoRound) => {
        savedRounds.push({ ...row });
        Object.assign(round, row);
        return row;
      }),
    };

    const resultRepo = {
      findOne: jest.fn(async () =>
        resultRows.length > 0 ? resultRows[resultRows.length - 1] : null,
      ),
      create: jest.fn((payload: Partial<LottoResult>) => ({ ...payload }) as LottoResult),
      save: jest.fn(async (row: LottoResult) => {
        if (row.id === undefined) {
          row.id = 900 + resultRows.length;
        }
        const index = resultRows.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          resultRows[index] = row;
        } else {
          resultRows.push(row);
        }
        return row;
      }),
    };

    const manager = {
      getRepository: (entity: unknown) =>
        entity === LottoRound ? roundRepo : resultRepo,
    };

    // Serializes concurrent transactions like a real Postgres row lock
    // (pessimistic_write): the second tx waits for the first to commit, so
    // it observes the winner's row instead of racing it. Without this the
    // in-memory mock would interleave the two tx bodies, which a real DB
    // row lock forbids.
    let txChain: Promise<unknown> = Promise.resolve();
    const dataSource = {
      transaction: jest.fn(async (callback: (m: unknown) => unknown) => {
        const previous = txChain;
        let release!: () => void;
        txChain = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(manager);
        } finally {
          release();
        }
      }),
    };

    const service = new LottoService(
      roundRepo as never,
      {} as never,
      resultRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { create: () => ({}), save: jest.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
    );

    const drawSpy = jest
      .spyOn(
        service as unknown as { generateServerResult: () => Promise<string> },
        'generateServerResult',
      )
      .mockResolvedValue('7');

    const precompute = (
      service as unknown as {
        precomputeResultForRound: (id: number) => Promise<{ result: string } | null>;
      }
    ).precomputeResultForRound.bind(service);

    return { service, drawSpy, resultRows, savedRounds, round, precompute };
  };

  it('1. rejects generation before cutoff: null, no draw, no persist, status untouched', async () => {
    const round = buildRound({
      status: RoundStatus.OPEN,
      cutoffAt: new Date(Date.now() + 4_000),
      drawAt: new Date(Date.now() + 9_000),
    });
    const { drawSpy, resultRows, savedRounds, precompute } = buildHarness(round);

    expect(await precompute(21)).toBeNull();
    expect(drawSpy).not.toHaveBeenCalled();
    expect(resultRows).toHaveLength(0);
    expect(savedRounds).toHaveLength(0);
    expect(round.status).toBe(RoundStatus.OPEN);
  });

  it.each([
    [Category.THIRTY_SEC],
    [Category.ONE_MIN],
    [Category.THREE_MIN],
    [Category.FIVE_MIN],
    [Category.TEN_MIN],
  ])(
    '2/9. at cutoff succeeds for %s and flips OPEN → CUTOFF atomically',
    async (category) => {
      const round = buildRound({
        category,
        status: RoundStatus.OPEN,
        cutoffAt: new Date(Date.now() - 1_000),
        drawAt: new Date(Date.now() + 4_000),
      });
      const { drawSpy, resultRows, savedRounds, precompute } = buildHarness(round);

      const first = await precompute(21);

      expect(first?.result).toBe('7');
      expect(drawSpy).toHaveBeenCalledTimes(1);
      expect(resultRows).toHaveLength(1);
      expect(savedRounds.length).toBeGreaterThanOrEqual(1);
      expect(savedRounds[0].status).toBe(RoundStatus.CUTOFF);
      expect(round.status).toBe(RoundStatus.CUTOFF);
    },
  );

  it('3. already-CUTOFF rounds draw without re-closing', async () => {
    const round = buildRound({
      status: RoundStatus.CUTOFF,
      cutoffAt: new Date(Date.now() - 1_000),
      drawAt: new Date(Date.now() + 4_000),
    });
    const { drawSpy, resultRows, savedRounds, precompute } = buildHarness(round);

    const outcome = await precompute(21);

    expect(outcome?.result).toBe('7');
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(resultRows).toHaveLength(1);
    expect(savedRounds).toHaveLength(0);
    expect(round.status).toBe(RoundStatus.CUTOFF);
  });
  it('5/6/7. pending metadata never leaks the value for SERVER or ADMIN', async () => {
    for (const source of [ResultSource.SERVER, ResultSource.ADMIN]) {
      const round = buildRound({
        status: RoundStatus.CUTOFF,
        cutoffAt: new Date(Date.now() - 1_000),
        drawAt: new Date(Date.now() + 4_000),
      });
      const stored = {
        id: 901,
        roundId: 21,
        result: 'B',
        source,
        adminId:
          source === ResultSource.ADMIN
            ? '11111111-1111-1111-1111-111111111111'
            : null,
        status: ResultStatus.GENERATED,
        generatedAt: new Date(),
      } as LottoResult;
      const { service } = buildHarness(round, [stored]);

      (service as unknown as { roundRepo: { findOne: jest.Mock } }).roundRepo.findOne =
        jest.fn(async () => round);

      const out = await service.getPendingResult(Category.THIRTY_SEC);

      expect(out.pendingResult).not.toBeNull();
      const payload = out.pendingResult as unknown as Record<string, unknown>;
      expect(payload.roundId).toBe(21);
      expect(payload.revealAt).toBeDefined();
      expect(payload.cutoffAt).toBeDefined();
      expect(payload).not.toHaveProperty('result');
      expect(payload).not.toHaveProperty('resultSource');
      expect(payload).not.toHaveProperty('generatedAt');
      expect(payload).not.toHaveProperty('id');
      expect(JSON.stringify(out)).not.toContain('"B"');
    }
  });

  it('8. concurrent cutoff workers generate exactly one result', async () => {
    const round = buildRound({
      status: RoundStatus.OPEN,
      cutoffAt: new Date(Date.now() - 1_000),
      drawAt: new Date(Date.now() + 4_000),
    });
    const { drawSpy, resultRows, precompute } = buildHarness(round);

    const [first, second] = await Promise.all([precompute(21), precompute(21)]);

    expect(first?.result).toBe('7');
    expect(second?.result).toBe('7');
    // Serialized by the row lock (mocked as a tx mutex above): the loser
    // replays the winner's row instead of drawing again.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(resultRows).toHaveLength(1);
  });
});
