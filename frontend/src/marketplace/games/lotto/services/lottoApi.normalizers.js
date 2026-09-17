import { AxiosError } from 'axios';

export const LOTTO_RESULT_PATTERN = /^[0-9A-F]$/i;

export const LOTTO_ERROR_MESSAGES = {
  LOTTO_PAUSED: 'Lotto is currently paused. Please try again shortly.',
  INSUFFICIENT_BALANCE: 'Insufficient balance to place this ticket.',
  INSUFFICIENT_LIQUIDITY:
    'Lotto liquidity is currently insufficient for this ticket. Try a lower amount or fewer numbers.',
  INSUFFICIENT_LOTTO_LIQUIDITY:
    'Lotto liquidity is currently insufficient for this ticket. Try a lower amount or fewer numbers.',
  INSUFFICIENT_REMOVABLE_LIQUIDITY:
    'Cannot remove that much liquidity — part of it is reserved for pending payouts.',
  INVALID_IDEMPOTENCY_KEY: 'Invalid request key. Please retry ticket purchase.',
  PERIOD_NOT_OPEN: 'This round is no longer open for ticket placement.',
  CUTOFF_PASSED: 'Ticket cutoff has passed for this round.',
  ROUND_CANCELLED: 'This round has been cancelled. Please wait for the next round.',
  ROUND_NOT_FOUND: 'Round not found. Please refresh and try again.',
  PERIOD_NOT_FOUND: 'Round not found. Please refresh and try again.',
  INVALID_SELECTION: 'Invalid number selection. Please recheck your numbers.',
  DUPLICATE_SELECTION: 'Duplicate numbers are not allowed in a ticket.',
  DUPLICATE_REQUEST: 'Duplicate request detected. Existing ticket was reused.',
  ROUND_RESULT_NOT_AVAILABLE: 'Round result is not available yet. Please retry shortly.',
  ROUND_RESULT_INVALID:
    'Round result is currently invalid. Please retry shortly or contact support if it persists.',
  ROUND_RESULT_NOT_FOUND: 'Round result is not available yet. Please retry shortly.',
  ROUND_NOT_READY_FOR_SETTLEMENT:
    'Round is not ready for settlement yet. Please retry shortly.',
  ROUND_NOT_DRAWN: 'Round draw time has not been reached yet.',
  ROUND_NOT_DRAWABLE: 'This round cannot be drawn in its current state.',
  ADMIN_ID_REQUIRED: 'Admin authorization is required for this action.',
  INVALID_RESULT_MODE: 'The selected result mode is not supported.',
  INVALID_RESULT_VALUE: 'Invalid result value. Choose 0–9 or A–F.',
  INVALID_LIQUIDITY_AMOUNT: 'Enter a valid liquidity amount (up to 2 decimal places).',
  INSUFFICIENT_AVAILABLE_LIQUIDITY: 'Not enough available liquidity for this operation.',
  TICKET_NOT_FOUND: 'Ticket not found. Please refresh and try again.',
  ROUND_NOT_CANCELLED: 'Round is not cancelled and cannot be refunded.',
  NETWORK_ERROR: 'Network error while contacting Lotto service. Please retry.',
  REQUEST_TIMEOUT: 'Lotto request timed out. Please retry.',
};

const toTrimmedString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toCanonicalId = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const trimmed = toTrimmedString(value);
  return trimmed ?? null;
};

const pickFirstDefined = (...values) => values.find((value) => value !== undefined);

const normalizeIsoString = (value) => {
  const trimmed = toTrimmedString(value);
  return trimmed ?? null;
};

export const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toNullableFiniteNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const normalizeResultSymbol = (value) => {
  const normalized = toTrimmedString(value)?.toUpperCase() ?? null;
  return normalized && LOTTO_RESULT_PATTERN.test(normalized) ? normalized : null;
};

const normalizeResultSymbols = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeResultSymbol(item))
    .filter(Boolean);
};

const normalizeRoundId = (round) =>
  toCanonicalId(pickFirstDefined(round?.id, round?.roundId, round?._id));

const normalizeRoundNumber = (round) =>
  toTrimmedString(
    pickFirstDefined(
      round?.roundNumber,
      round?.roundNo,
      round?.period,
      round?.periodNumber,
    ),
  );

const normalizeAmountField = (primaryValue, ...aliases) => {
  const numeric = toNullableFiniteNumber(pickFirstDefined(primaryValue, ...aliases));
  return numeric ?? 0;
};

export const normalizeRound = (round) => {
  if (!round || typeof round !== 'object') {
    return null;
  }

  return {
    id: normalizeRoundId(round),
    roundNumber: normalizeRoundNumber(round) ?? '-',
    category: toTrimmedString(round.category) ?? 'THIRTY_SEC',
    status: toTrimmedString(round.status) ?? 'OPEN',
    startAt: normalizeIsoString(
      pickFirstDefined(round.startAt, round.startTime, round.startedAt, round.createdAt),
    ),
    cutoffAt: normalizeIsoString(
      pickFirstDefined(round.cutoffAt, round.cutoffTime, round.closeAt, round.closesAt),
    ),
    drawAt: normalizeIsoString(pickFirstDefined(round.drawAt, round.drawTime, round.drawnAt)),
    result: normalizeResultSymbol(pickFirstDefined(round.result, round.winningNumber, round.winner)),
    resultSource: toTrimmedString(pickFirstDefined(round.resultSource, round.source)),
    resultGeneratedAt: normalizeIsoString(
      pickFirstDefined(round.resultGeneratedAt, round.generatedAt, round.resultAt),
    ),
    settledAt: normalizeIsoString(round.settledAt),
    refundedAt: normalizeIsoString(round.refundedAt),
    failedAt: normalizeIsoString(round.failedAt),
    totalTickets: normalizeAmountField(round.totalTickets, round.ticketCount),
    totalAmount: normalizeAmountField(round.totalAmount, round.amount, round.totalStake),
  };
};

const normalizeTicketId = (ticket) =>
  toCanonicalId(pickFirstDefined(ticket?.id, ticket?.ticketId, ticket?._id));

const normalizeTicketRoundId = (ticket) =>
  toCanonicalId(pickFirstDefined(ticket?.roundId, ticket?.round?.id, ticket?.periodId));

const normalizeTicketRoundNumber = (ticket) =>
  toTrimmedString(
    pickFirstDefined(
      ticket?.roundNumber,
      ticket?.round?.roundNumber,
      ticket?.period,
      ticket?.periodNumber,
    ),
  );

const normalizeTicketUserId = (ticket) =>
  toTrimmedString(
    pickFirstDefined(
      ticket?.userId,
      ticket?.user?.id,
      ticket?.walletAddress,
      ticket?.address,
    ),
  );

const normalizeTicketStatus = (ticket) =>
  toTrimmedString(
    pickFirstDefined(ticket?.status, ticket?.ticketStatus, ticket?.state),
  ) ?? 'ACTIVE';

const normalizeTicketNumbers = (ticket) => {
  const candidate = pickFirstDefined(
    ticket?.selectedNumbers,
    ticket?.numbers,
    ticket?.selection,
  );

  if (Array.isArray(candidate)) {
    return normalizeResultSymbols(candidate);
  }

  if (typeof candidate === 'string') {
    return normalizeResultSymbols(candidate.split(','));
  }

  return [];
};

const normalizeSelectionCount = (ticket, selectedNumbers) => {
  const numeric = toNullableFiniteNumber(
    pickFirstDefined(ticket?.selectionCount, ticket?.numbersCount, ticket?.count),
  );

  return numeric ?? selectedNumbers.length;
};

const normalizeTicketAmount = (ticket) =>
  normalizeAmountField(ticket.amount, ticket.betAmount, ticket.stake, ticket.value);

const normalizeTicketWinAmount = (ticket) => {
  const raw = pickFirstDefined(ticket.winAmount, ticket.win, ticket.payout, ticket.payoutAmount);
  return toNullableFiniteNumber(raw);
};

export const normalizeTicket = (ticket) => {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }

  const selectedNumbers = normalizeTicketNumbers(ticket);

  return {
    id: normalizeTicketId(ticket),
    ticketNumber: toTrimmedString(pickFirstDefined(ticket.ticketNumber, ticket.reference, ticket.number)) ?? '-',
    userId: normalizeTicketUserId(ticket),
    roundId: normalizeTicketRoundId(ticket),
    category:
      toTrimmedString(pickFirstDefined(ticket.category, ticket.round?.category)) ?? 'THIRTY_SEC',
    roundNumber: normalizeTicketRoundNumber(ticket),
    amount: normalizeTicketAmount(ticket),
    betAmount: normalizeTicketAmount(ticket),
    deductionAmount: normalizeAmountField(ticket.deductionAmount, ticket.deduction),
    referralAmount: normalizeAmountField(ticket.referralAmount, ticket.referral),
    adminAmount: normalizeAmountField(ticket.adminAmount, ticket.feeAmount, ticket.fee),
    netAmount: normalizeAmountField(ticket.netAmount, ticket.netStake),
    selectedNumbers,
    numbers: selectedNumbers,
    selectionCount: normalizeSelectionCount(ticket, selectedNumbers),
    multiplier: toFiniteNumber(pickFirstDefined(ticket.multiplier, ticket.payoutMultiplier), 1),
    maxPayoutLiability: normalizeAmountField(
      ticket.maxPayoutLiability,
      ticket.maxPayout,
      ticket.maxLiability,
    ),
    reservedAmount: normalizeAmountField(ticket.reservedAmount, ticket.reservationAmount),
    reservationStatus: toTrimmedString(ticket.reservationStatus) ?? 'NONE',
    idempotencyKey: toTrimmedString(ticket.idempotencyKey),
    status: normalizeTicketStatus(ticket),
    winAmount: normalizeTicketWinAmount(ticket),
    purchaseTxId: toTrimmedString(ticket.purchaseTxId),
    settlementTxId: toTrimmedString(ticket.settlementTxId),
    refundTxId: toTrimmedString(ticket.refundTxId),
    settledAt: normalizeIsoString(ticket.settledAt),
    refundedAt: normalizeIsoString(ticket.refundedAt),
    createdAt: normalizeIsoString(ticket.createdAt),
    updatedAt: normalizeIsoString(ticket.updatedAt),
  };
};

const normalizeResultId = (item) =>
  toCanonicalId(pickFirstDefined(item?.id, item?.resultId, item?._id));

const normalizeResultRoundId = (item) =>
  toCanonicalId(
    pickFirstDefined(item?.roundId, item?.round?.id, item?.periodId, item?.round_id),
  );

export const normalizeResultItem = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const roundNumber = toTrimmedString(
    pickFirstDefined(
      item.roundNumber,
      item.round?.roundNumber,
      item.period,
      item.periodNumber,
    ),
  );

  return {
    id: normalizeResultId(item),
    roundId: normalizeResultRoundId(item),
    roundNumber,
    category: toTrimmedString(pickFirstDefined(item.category, item.round?.category)),
    status: toTrimmedString(pickFirstDefined(item.status, item.round?.status)),
    result: normalizeResultSymbol(
      pickFirstDefined(item.result, item.winningNumber, item.winner, item.drawResult),
    ),
    winningNumbers: normalizeResultSymbols(
      pickFirstDefined(item.winningNumbers, item.numbers, item.drawnNumbers),
    ),
    resultSource: toTrimmedString(pickFirstDefined(item.resultSource, item.source)),
    generatedAt: normalizeIsoString(
      pickFirstDefined(item.generatedAt, item.resultGeneratedAt, item.createdAt),
    ),
    finalizedAt: normalizeIsoString(
      pickFirstDefined(item.finalizedAt, item.settledAt, item.updatedAt),
    ),
    drawAt: normalizeIsoString(pickFirstDefined(item.drawAt, item.round?.drawAt, item.drawTime)),
    // Earliest instant a pre-computed value may be shown (= the round's draw
    // time). Falls back to drawAt for the normal results payload.
    revealAt: normalizeIsoString(
      pickFirstDefined(item.revealAt, item.drawAt, item.round?.drawAt, item.drawTime),
    ),
  };
};

export const normalizeSelectedNumbers = (selectedNumbers = []) => {
  if (!Array.isArray(selectedNumbers)) {
    return [];
  }

  return normalizeResultSymbols(selectedNumbers);
};

const normalizeRoundIdValue = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  return value;
};

export const normalizeRoundQueryId = (value) => normalizeRoundIdValue(value);

export const normalizePagination = ({ total, limit, offset }, defaults = {}) => ({
  total: toFiniteNumber(total),
  limit: toFiniteNumber(limit, toFiniteNumber(defaults.limit, 0)),
  offset: toFiniteNumber(offset, toFiniteNumber(defaults.offset, 0)),
});

export const normalizeErrorCode = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const codeCandidate = trimmed.split(':', 1)[0].trim().toUpperCase();
  return /^[A-Z0-9_]+$/.test(codeCandidate) ? codeCandidate : null;
};

export const mapKnownLottoError = (value) => {
  const normalizedMessage =
    typeof value === 'string' ? value.trim().toUpperCase() : '';

  if (normalizedMessage.includes('ROUND IS NOT OPEN FOR TICKETS')) {
    return LOTTO_ERROR_MESSAGES.PERIOD_NOT_OPEN;
  }

  if (normalizedMessage.includes('CUTOFF TIME PASSED')) {
    return LOTTO_ERROR_MESSAGES.CUTOFF_PASSED;
  }

  if (normalizedMessage.includes('ROUND NOT FOUND')) {
    return LOTTO_ERROR_MESSAGES.ROUND_NOT_FOUND;
  }

  const code = normalizeErrorCode(value);
  if (!code) {
    return null;
  }

  if (code.startsWith('INSUFFICIENT_BALANCE')) {
    return LOTTO_ERROR_MESSAGES.INSUFFICIENT_BALANCE;
  }

  return LOTTO_ERROR_MESSAGES[code] ?? null;
};

const toTrimmedMessage = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
};

const toMessageList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => toTrimmedMessage(item)).filter(Boolean);
  }

  const message = toTrimmedMessage(value);
  return message ? [message] : [];
};

const extractPayloadErrorCode = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = [
    payload.code,
    payload.errorCode,
    payload.error_code,
    payload?.response?.code,
  ];

  return candidates
    .map((candidate) => normalizeErrorCode(candidate))
    .find(Boolean);
};

export const toApiErrorMessage = (
  error,
  fallback = 'Lotto request failed',
) => {
  if (!(error instanceof AxiosError)) {
    return error instanceof Error ? error.message : fallback;
  }

  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return LOTTO_ERROR_MESSAGES.REQUEST_TIMEOUT;
    }

    return LOTTO_ERROR_MESSAGES.NETWORK_ERROR;
  }

  const payload = error.response?.data;
  const payloadCode = extractPayloadErrorCode(payload);

  const mappedFromPayloadCode = mapKnownLottoError(payloadCode);
  if (mappedFromPayloadCode) {
    return mappedFromPayloadCode;
  }

  const payloadMessages = toMessageList(payload?.message);
  const firstMappedMessage = payloadMessages
    .map((item) => mapKnownLottoError(item))
    .find(Boolean);

  if (firstMappedMessage) {
    return firstMappedMessage;
  }

  if (payloadMessages.length > 0) {
    return payloadMessages.join(', ');
  }

  const payloadError = toTrimmedMessage(payload?.error);
  if (payloadError) {
    const mapped = mapKnownLottoError(payloadError);
    return mapped ?? payloadError;
  }

  const axiosMessage = toTrimmedMessage(error.message);
  if (axiosMessage) {
    const mapped = mapKnownLottoError(axiosMessage);
    return mapped ?? axiosMessage;
  }

  if (payloadCode) {
    return payloadCode;
  }

  return fallback;
};
