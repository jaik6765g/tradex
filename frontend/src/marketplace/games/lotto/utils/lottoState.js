export const ROUND_STATUS = {
  OPEN: 'OPEN',
  CUTOFF: 'CUTOFF',
  DRAWING: 'DRAWING',
  RESULTED: 'RESULTED',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};

export const TICKET_STATUS = {
  ACTIVE: 'ACTIVE',
  CUTOFF: 'CUTOFF',
  WIN: 'WIN',
  LOSS: 'LOSS',
  SETTLED: 'SETTLED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
};

const ROUND_PURCHASE_LOCKED_STATUSES = new Set([
  ROUND_STATUS.CUTOFF,
  ROUND_STATUS.DRAWING,
  ROUND_STATUS.RESULTED,
  ROUND_STATUS.SETTLED,
  ROUND_STATUS.FAILED,
  ROUND_STATUS.CANCELLED,
  ROUND_STATUS.REFUNDED,
]);

const ROUND_TERMINAL_STATUSES = new Set([
  ROUND_STATUS.RESULTED,
  ROUND_STATUS.SETTLED,
  ROUND_STATUS.FAILED,
  ROUND_STATUS.CANCELLED,
  ROUND_STATUS.REFUNDED,
]);

export const VALID_TICKET_STATUSES = new Set(Object.values(TICKET_STATUS));

export const TERMINAL_TICKET_STATUSES = new Set([
  TICKET_STATUS.WIN,
  TICKET_STATUS.LOSS,
  TICKET_STATUS.SETTLED,
  TICKET_STATUS.REFUNDED,
  TICKET_STATUS.CANCELLED,
]);

export const normalizeRoundStatus = (status) => {
  if (typeof status !== 'string') {
    return '';
  }

  return status.trim().toUpperCase();
};

export const normalizeTicketStatus = (status) => {
  if (typeof status !== 'string') {
    return TICKET_STATUS.ACTIVE;
  }

  const normalized = status.trim().toUpperCase();
  if (!normalized) {
    return TICKET_STATUS.ACTIVE;
  }

  return VALID_TICKET_STATUSES.has(normalized)
    ? normalized
    : TICKET_STATUS.ACTIVE;
};

export const isRoundTerminal = (status) => {
  const normalized = normalizeRoundStatus(status);
  return ROUND_TERMINAL_STATUSES.has(normalized);
};

export const isRoundLockedForPurchase = (status) => {
  const normalized = normalizeRoundStatus(status);
  return ROUND_PURCHASE_LOCKED_STATUSES.has(normalized);
};

export const isRoundOpenForPurchase = ({
  hasActiveRound,
  status,
  timerDuration,
}) => {
  if (!hasActiveRound) {
    return false;
  }

  const normalizedStatus = normalizeRoundStatus(status);
  if (normalizedStatus !== ROUND_STATUS.OPEN) {
    return false;
  }

  return Number.isFinite(timerDuration) ? timerDuration > 0 : false;
};

export const canInteractWithTicketPlacement = ({
  isBusy,
  isPaused,
  isAuthenticated,
  hasActiveRound,
  roundStatus,
  timerDuration,
}) => {
  if (isBusy || isPaused || !isAuthenticated) {
    return false;
  }

  return isRoundOpenForPurchase({
    hasActiveRound,
    status: roundStatus,
    timerDuration,
  });
};

export const deriveTicketOutcomeStatus = (status, winAmount) => {
  const normalizedStatus = normalizeTicketStatus(status);
  const numericWinAmount = Number(winAmount ?? 0);
  const effectiveWinAmount = Number.isFinite(numericWinAmount)
    ? numericWinAmount
    : 0;

  if (normalizedStatus === TICKET_STATUS.WIN) {
    return TICKET_STATUS.WIN;
  }

  if (normalizedStatus === TICKET_STATUS.LOSS) {
    return TICKET_STATUS.LOSS;
  }

  if (normalizedStatus === TICKET_STATUS.SETTLED) {
    return effectiveWinAmount > 0 ? TICKET_STATUS.WIN : TICKET_STATUS.LOSS;
  }

  if (normalizedStatus === TICKET_STATUS.REFUNDED) {
    return TICKET_STATUS.REFUNDED;
  }

  if (normalizedStatus === TICKET_STATUS.CANCELLED) {
    return TICKET_STATUS.CANCELLED;
  }

  return 'PENDING';
};

// Frozen LOTTO-1 selection shortcuts (backend Category-independent number groups).
export const COLOR_GROUPS = {
  GREEN: ['0', '1', '2', '3', '4', '5', '6', '7'],
  RED: ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F'],
  YELLOW: ['0', '1', '4', '5', '8', '9', 'C', 'D'],
  BLUE: ['2', '3', '6', '7', 'A', 'B', 'E', 'F'],
};

export const COLOR_GROUP_KEYS = ['GREEN', 'RED', 'YELLOW', 'BLUE'];

// Forbidden opposite pairs — selecting both would cover all 16 outcomes (100%).
export const FORBIDDEN_GROUP_PAIRS = [['GREEN', 'RED'], ['YELLOW', 'BLUE']];

/**
 * Unique numbers that would result from toggling a color group onto the current
 * selection. Overlapping numbers are counted once; the 16/16 case is blocked.
 */
export const resolveGroupToggle = (groupKey, selectedNumbers) => {
  const group = COLOR_GROUPS[groupKey];
  if (!Array.isArray(group)) {
    return null;
  }

  const merged = Array.from(new Set([...selectedNumbers, ...group]));

  if (merged.length > 15) {
    return null;
  }

  return merged;
};

/**
 * True when toggling the group is forbidden because it would complete a
 * forbidden opposite pair (GREEN+RED or YELLOW+BLUE = 16/16).
 */
export const isGroupToggleForbidden = (groupKey, selectedNumbers) => {
  const merged = resolveGroupToggle(groupKey, selectedNumbers);
  if (merged === null) {
    return true;
  }

  const activeGroups = COLOR_GROUP_KEYS.filter((key) =>
    COLOR_GROUPS[key].every((n) => merged.includes(n)),
  );

  return FORBIDDEN_GROUP_PAIRS.some(
    ([a, b]) => activeGroups.includes(a) && activeGroups.includes(b),
  );
};