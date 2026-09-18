import { LottoRound, RoundStatus, Category } from './entities/lotto-round.entity';
import {
  LottoResult,
  ResultSource,
  ResultStatus,
} from './entities/lotto-result.entity';
import { LottoService } from './lotto.service';

/**
 * Guards the integrity of the 00:00 instant-reveal pipeline:
 *
 *   1. the value prepared at cutoff (GENERATED + SERVER) must be PROMOTED at
 *      draw time, never re-drawn — otherwise the value the client already
 *      cached would differ from the stored result;
 *   2. an admin pre-lock still wins over the server draw;
 *   3. a fresh draw happens only when nothing was prepared;
 *   4. nothing is ever prepared while the round is still accepting tickets
 *      (cutoffAt in the future) — the draw must see the final ticket set;
 *   5. preparing twice is idempotent (exactly one value per round).
 */
describe('LottoService result pre-computation (00:00 reveal integrity)', () => {
  const CATEGORY = Category.THIRTY_SEC;

  const buildRound = (overrides: Partial<LottoRound> = {}) =>
    ({
      id: 11,
      roundNumber: '000011',
      category: CATEGORY,
      status: RoundStatus.DRAWING,
      startAt: new Date(Date.now() - 30_000),
      cutoffAt: new Date(Date.now() - 5_000),
      drawAt: new Date(Date.now() - 1_000),
      resultId: null,
      ...overrides,
    }) as LottoRound;

  const buildService = (round: LottoRound, existingResults: LottoResult[] = []) => {
    const resultRows: LottoResult[] = [...existingResults];
    const savedRounds: LottoRound[] = [];

    const roundRepo = {
      findOne: jest.fn(async () => round),
      save: jest.fn(async (row: LottoRound) => {
        savedRounds.push({ ...row });
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

    const dataSource = {
      transaction: jest.fn(async (callback: (m: unknown) => unknown) =>
        callback(manager),
      ),
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
      // adminAuditLogRepo — only used when an explicit ADMIN draw is audited.
      { create: () => ({}), save: jest.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
      {
        recordWageredVolume: jest.fn(async () => ({ status: 'COUNTED' })),
      } as never,
    );

    const drawSpy = jest
      .spyOn(
        service as unknown as { generateServerResult: () => Promise<string> },
        'generateServerResult',
      )
      .mockResolvedValue('7');

    return { service, drawSpy, resultRows, savedRounds };
  };

  const preparedRow = (overrides: Partial<LottoResult> = {}): LottoResult =>
    ({
      id: 501,
      roundId: 11,
      result: 'A',
      source: ResultSource.SERVER,
      status: ResultStatus.GENERATED,
      adminId: null,
      generatedAt: new Date(),
      finalizedAt: null,
      ...overrides,
    }) as LottoResult;

  it('promotes the prepared SERVER value at draw time instead of re-drawing', async () => {
    const { service, drawSpy, resultRows } = buildService(buildRound(), [preparedRow()]);

    const outcome = await service.finalizeRoundResult(11, null, 'SERVER');

    expect(outcome.finalized).toBe(true);
    expect(outcome.result).toBe('A');
    expect(drawSpy).not.toHaveBeenCalled();
    expect(resultRows[0].status).toBe(ResultStatus.FINALIZED);
    expect(resultRows[0].source).toBe(ResultSource.SERVER);
    // finalizedAt is stamped at promotion time (publication instant).
    expect(resultRows[0].finalizedAt).toBeInstanceOf(Date);
  });

  it('honours an admin pre-lock over the server draw and keeps the admin id', async () => {
    const { service, drawSpy, resultRows } = buildService(buildRound(), [
      preparedRow({
        result: 'B',
        source: ResultSource.ADMIN,
        adminId: '11111111-1111-1111-1111-111111111111',
      }),
    ]);

    const outcome = await service.finalizeRoundResult(11, null, 'SERVER');

    expect(outcome.result).toBe('B');
    expect(drawSpy).not.toHaveBeenCalled();
    expect(resultRows[0].source).toBe(ResultSource.ADMIN);
    expect(resultRows[0].adminId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('draws fresh only when nothing was prepared', async () => {
    const { service, drawSpy, resultRows } = buildService(buildRound(), []);

    const outcome = await service.finalizeRoundResult(11, null, 'SERVER');

    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBe('7');
    expect(resultRows[0].status).toBe(ResultStatus.FINALIZED);
  });

  it('lets an explicit admin draw win over a prepared SERVER value', async () => {
    const { service, drawSpy, resultRows } = buildService(buildRound(), [preparedRow()]);

    const outcome = await service.finalizeRoundResult(
      11,
      'D',
      'ADMIN',
      '11111111-1111-1111-1111-111111111111',
    );

    expect(outcome.result).toBe('D');
    expect(drawSpy).not.toHaveBeenCalled();
    expect(resultRows[0].source).toBe(ResultSource.ADMIN);
  });

  it('never prepares a result while the round still accepts tickets', async () => {
    const openRound = buildRound({
      status: RoundStatus.OPEN,
      cutoffAt: new Date(Date.now() + 4_000),
      drawAt: new Date(Date.now() + 9_000),
    });
    const { service, drawSpy, resultRows } = buildService(openRound, []);

    const prepared = await (
      service as unknown as {
        precomputeResultForRound: (id: number) => Promise<unknown>;
      }
    ).precomputeResultForRound(11);

    expect(prepared).toBeNull();
    expect(drawSpy).not.toHaveBeenCalled();
    expect(resultRows).toHaveLength(0);
  });

  it('prepares once after cutoff and is idempotent on repeat calls', async () => {
    const cutoffRound = buildRound({
      status: RoundStatus.CUTOFF,
      cutoffAt: new Date(Date.now() - 1_000),
      drawAt: new Date(Date.now() + 4_000),
    });
    const { service, drawSpy, resultRows } = buildService(cutoffRound, []);

    const precompute = (
      service as unknown as {
        precomputeResultForRound: (id: number) => Promise<{ result: string } | null>;
      }
    ).precomputeResultForRound.bind(service);

    const first = await precompute(11);
    const second = await precompute(11);

    expect(first?.result).toBe('7');
    expect(second?.result).toBe('7');
    // Exactly one draw for the whole round — a repeat never re-draws.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0].status).toBe(ResultStatus.GENERATED);
    expect(resultRows[0].source).toBe(ResultSource.SERVER);
  });
});
