export const normalizeIdempotencyKey = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const withOptionalIdempotencyKey = (payload, idempotencyKey) => {
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  return normalizedIdempotencyKey
    ? {
        ...payload,
        idempotencyKey: normalizedIdempotencyKey,
      }
    : payload;
};