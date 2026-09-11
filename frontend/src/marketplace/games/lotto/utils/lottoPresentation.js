import { normalizeRoundStatus, normalizeTicketStatus } from './lottoState.js';

const SYMBOL_PATTERN = /^[0-9A-F]$/;

const toNullableTrimmedString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSymbol = (value) => {
  const normalized = toNullableTrimmedString(value)?.toUpperCase();
  return normalized && SYMBOL_PATTERN.test(normalized) ? normalized : null;
};

const normalizeSymbolList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeSymbol(item)).filter(Boolean);
};

export const formatTdx = (value, fractionDigits = 2) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return numeric.toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

export const formatDateTime = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

export const toRoundStatusTone = (status) => {
  const normalized = normalizeRoundStatus(status);

  const toneMap = {
    OPEN: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]',
    CUTOFF: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]',
    DRAWING: 'bg-[#EEF4FF] text-[#3538CD] border-[#C7D7FE]',
    RESULTED: 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]',
    SETTLED: 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]',
    FAILED: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]',
    CANCELLED: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]',
    REFUNDED: 'bg-[#FFF6ED] text-[#C4320A] border-[#FDDCAB]',
  };

  return toneMap[normalized] ?? 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]';
};

export const toTicketStatusTone = (status) => {
  const normalized = normalizeTicketStatus(status);

  const toneMap = {
    ACTIVE: 'bg-[#EEF4FF] text-[#3538CD] border-[#C7D7FE]',
    CUTOFF: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]',
    WIN: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]',
    LOSS: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]',
    SETTLED: 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]',
    REFUNDED: 'bg-[#FFF6ED] text-[#C4320A] border-[#FDDCAB]',
    CANCELLED: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]',
  };

  return toneMap[normalized] ?? 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]';
};

export const formatRemainingSeconds = (seconds) => {
  const safeSeconds = Number.isFinite(Number(seconds))
    ? Math.max(0, Math.floor(Number(seconds)))
    : 0;

  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export const toCanonicalTicketHistoryRow = (ticket) => {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }

  const selectedNumbers = normalizeSymbolList(ticket.selectedNumbers);

  const amount = Number(ticket.amount ?? 0);
  const winAmount = Number(ticket.winAmount ?? 0);
  const roundNumber = toNullableTrimmedString(ticket.roundNumber) ?? '-';

  return {
    id: ticket.id ?? `${ticket.roundId ?? 'round'}-${ticket.createdAt ?? 'na'}`,
    roundNumber,
    selectedNumbers,
    amount: Number.isFinite(amount) ? amount : 0,
    winAmount: Number.isFinite(winAmount) ? winAmount : 0,
    status: normalizeTicketStatus(ticket.status),
    createdAt: toNullableTrimmedString(ticket.createdAt),
    settledAt: toNullableTrimmedString(ticket.settledAt),
  };
};

export const toCanonicalResultView = (result) => {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const normalizedResult =
    typeof result.result === 'string' && result.result.trim().length > 0
      ? result.result.trim().toUpperCase()
      : null;

  return {
    id: result.id ?? null,
    roundId: result.roundId ?? null,
    roundNumber: toNullableTrimmedString(result.roundNumber) ?? '-',
    status: normalizeRoundStatus(result.status),
    category: toNullableTrimmedString(result.category),
    result: normalizedResult,
    drawAt: toNullableTrimmedString(result.drawAt),
    generatedAt: toNullableTrimmedString(result.generatedAt),
    resultSource: toNullableTrimmedString(result.resultSource),
  };
};