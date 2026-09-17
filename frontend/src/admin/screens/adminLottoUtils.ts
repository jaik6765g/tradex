// Shared presentation helpers for the Admin Lotto Game Manager.
export const RESULT_SYMBOLS = ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'];
export const CATEGORIES = ['THIRTY_SEC', 'ONE_MIN', 'THREE_MIN', 'FIVE_MIN', 'TEN_MIN'];

const STATUS_TONES: Record<string, string> = {
  OPEN: 'bg-[#10251A] text-[#4ADE80]',
  CUTOFF: 'bg-[#2A190D] text-[#FF8F3D]',
  DRAWING: 'bg-[#0F1C30] text-[#818CF8]',
  RESULTED: 'bg-[#1B1917] text-[#E4E5E8]',
  SETTLED: 'bg-[#1B1917] text-[#E4E5E8]',
  FAILED: 'bg-[#281313] text-[#F87171]',
  CANCELLED: 'bg-[#281313] text-[#F87171]',
  REFUNDED: 'bg-[#2A1608] text-[#FDBA74]',
};

export const statusTone = (status: string): string =>
  STATUS_TONES[status] ?? 'bg-[#1B1917] text-[#E4E5E8] border-[#34343E]';

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