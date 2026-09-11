// Shared presentation helpers for the Admin Lotto Game Manager.
export const RESULT_SYMBOLS = ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'];
export const CATEGORIES = ['THIRTY_SEC', 'ONE_MIN', 'THREE_MIN', 'FIVE_MIN'];

const STATUS_TONES: Record<string, string> = {
  OPEN: 'bg-[#ECFDF3] text-[#067647]',
  CUTOFF: 'bg-[#FFFAEB] text-[#B54708]',
  DRAWING: 'bg-[#EEF4FF] text-[#3538CD]',
  RESULTED: 'bg-[#F2F4F7] text-[#344054]',
  SETTLED: 'bg-[#F2F4F7] text-[#344054]',
  FAILED: 'bg-[#FEF3F2] text-[#B42318]',
  CANCELLED: 'bg-[#FEF3F2] text-[#B42318]',
  REFUNDED: 'bg-[#FFF6ED] text-[#C4320A]',
};

export const statusTone = (status: string): string =>
  STATUS_TONES[status] ?? 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]';

export const formatTdx = (value: unknown, fractionDigits = 2): string =>
  Number(value ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};