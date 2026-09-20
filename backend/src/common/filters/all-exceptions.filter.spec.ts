import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

// ============================================================
// GLOBAL EXCEPTION FILTER — real causes are never hidden
// ============================================================

function makeHost(
  options: {
    requestId?: string;
    role?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = {
    method: 'POST',
    originalUrl: '/admin/bonus/distribute',
    url: '/admin/bonus/distribute',
    headers: options.headers ?? {},
    requestId: options.requestId ?? 'req-abc',
    user: {
      id: 'admin-1',
      authUserId: 'auth-1',
      role: options.role ?? 'admin',
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader: jest.fn() }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('surfaces an unknown error with its REAL name and message (no blind 500)', () => {
    const { host, status, json } = makeHost();
    const filter = new AllExceptionsFilter();
    const realError = new Error('No metadata for "WalletSourceAllocation" was found.');
    realError.name = 'EntityMetadataNotFoundError';

    filter.catch(realError, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.exception).toBe('EntityMetadataNotFoundError');
    expect(body.message).toContain('WalletSourceAllocation');
    expect(body.requestId).toBe('req-abc');
    expect(body.path).toBe('/admin/bonus/distribute');
  });

  it('logs the real exception with request context and stack', () => {
    const { host } = makeHost({ requestId: 'req-xyz' });
    const filter = new AllExceptionsFilter();
    const realError = new Error('column "metadata" does not exist');
    realError.name = 'QueryFailedError';

    filter.catch(realError, host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, stack] = errorSpy.mock.calls[0];
    expect(String(message)).toContain('UNHANDLED_EXCEPTION');
    expect(String(message)).toContain('req-xyz');
    expect(String(message)).toContain('/admin/bonus/distribute');
    expect(String(message)).toContain('QueryFailedError');
    expect(String(message)).toContain('admin-1');
    expect(String(stack)).toContain('QueryFailedError');
  });

  it('never logs tokens/headers and preserves HttpException bodies verbatim', () => {
    const { host, status, json } = makeHost({
      headers: { authorization: 'Bearer super-secret-token' },
    });
    const filter = new AllExceptionsFilter();
    const conflict = new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'WAGERING_OBLIGATION_NOT_CREATED',
      message: 'Wagering obligation could not be created — bonus distribution rolled back',
    });

    filter.catch(conflict, host);

    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0][0];
    // Existing contract preserved...
    expect(body.code).toBe('WAGERING_OBLIGATION_NOT_CREATED');
    expect(body.error).toBe('Conflict');
    // ...with only the correlation id added.
    expect(body.requestId).toBe('req-abc');

    const logged = warnSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('super-secret-token');
    expect(logged).not.toContain('Bearer');
    expect(logged).not.toContain('authorization');
  });

  it('preserves ValidationPipe-style array messages', () => {
    const { host, status, json } = makeHost();
    const filter = new AllExceptionsFilter();
    const invalid = new BadRequestException({
      statusCode: 400,
      message: ['userId must be a valid UUID'],
      error: 'Bad Request',
    });

    filter.catch(invalid, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].message).toEqual([
      'userId must be a valid UUID',
    ]);
    expect(json.mock.calls[0][0].requestId).toBe('req-abc');
  });

  it('handles a thrown non-Error value without crashing', () => {
    const { host, status, json } = makeHost();
    const filter = new AllExceptionsFilter();

    filter.catch('boom', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].exception).toBe('string');
    expect(json.mock.calls[0][0].message).toBe('boom');
  });
});
