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
    OPEN: 'bg-[#0C2417] text-[#4ADE80] border-[#1E4A32]',
    CUTOFF: 'bg-[#291A0B] text-[#FB923C] border-[#3A2410]',
    DRAWING: 'bg-[#0F1C30] text-[#818CF8] border-[#26315C]',
    RESULTED: 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]',
    SETTLED: 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]',
    FAILED: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]',
    CANCELLED: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]',
    REFUNDED: 'bg-[#2A1608] text-[#FDBA74] border-[#3A2410]',
  };

  return toneMap[normalized] ?? 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]';
};

export const toTicketStatusTone = (status) => {
  const normalized = normalizeTicketStatus(status);

  const toneMap = {
    ACTIVE: 'bg-[#0F1C30] text-[#818CF8] border-[#26315C]',
    CUTOFF: 'bg-[#291A0B] text-[#FB923C] border-[#3A2410]',
    WIN: 'bg-[#0C2417] text-[#4ADE80] border-[#1E4A32]',
    LOSS: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]',
    SETTLED: 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]',
    REFUNDED: 'bg-[#2A1608] text-[#FDBA74] border-[#3A2410]',
    CANCELLED: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]',
  };

  return toneMap[normalized] ?? 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]';
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