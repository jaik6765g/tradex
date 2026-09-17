// frontend/src/admin/components/AdminMetricCard.tsx

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  LucideIcon,
  Info,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Card, Skeleton } from '../../components/ui';

// ============ TYPES ============

export type MetricCardStatus = 'loading' | 'success' | 'error' | 'empty' | 'warning';
export type MetricCardTone = 'default' | 'warning' | 'danger' | 'success' | 'info';

type StatusConfigKey = MetricCardStatus | 'danger' | 'info';

export type AdminMetricCardProps = {
  title: string;
  value: string | number | boolean | null;
  subtitle?: string;
  tone?: MetricCardTone;
  status?: MetricCardStatus;
  onRetry?: () => void;
  formatValue?: (value: string | number | boolean | null) => string;
  className?: string;
  showStatusBadge?: boolean;
  loadingPlaceholder?: React.ReactNode;
  errorMessage?: string;
  emptyMessage?: string;
};

// ============ CONSTANTS ============

type StatusConfig = {
  label: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
  icon: LucideIcon;
  iconClass: string;
  animate?: boolean;
};

const STATUS_CONFIG: Record<StatusConfigKey, StatusConfig> = {
  loading: {
    label: 'Loading',
    borderClass: 'border-[#34343E]',
    bgClass: 'bg-[#15161C]',
    textClass: 'text-[#A1A4AE]',
    icon: RefreshCw,
    iconClass: 'text-[#A1A4AE]',
    animate: true,
  },
  success: {
    label: 'Normal',
    borderClass: 'border-[#123A24]',
    bgClass: 'bg-[#10251A]',
    textClass: 'text-[#6EE7B7]',
    icon: CheckCircle2,
    iconClass: 'text-[#6EE7B7]',
  },
  error: {
    label: 'Error',
    borderClass: 'border-[#4A2323]',
    bgClass: 'bg-[#281313]',
    textClass: 'text-[#F87171]',
    icon: XCircle,
    iconClass: 'text-[#F87171]',
  },
  empty: {
    label: 'N/A',
    borderClass: 'border-[#292B33]',
    bgClass: 'bg-[#111217]',
    textClass: 'text-[#A1A4AE]',
    icon: Info,
    iconClass: 'text-[#A1A4AE]',
  },
  warning: {
    label: 'Warning',
    borderClass: 'border-[#FF7A18]/50',
    bgClass: 'bg-[#2A190D]',
    textClass: 'text-[#FF8F3D]',
    icon: AlertTriangle,
    iconClass: 'text-[#FF8F3D]',
  },
  danger: {
    label: 'Critical',
    borderClass: 'border-[#4A2323]',
    bgClass: 'bg-[#281313]',
    textClass: 'text-[#F87171]',
    icon: XCircle,
    iconClass: 'text-[#F87171]',
  },
  info: {
    label: 'Info',
    borderClass: 'border-[#1E3A5F]',
    bgClass: 'bg-[#0F1B2E]',
    textClass: 'text-[#60A5FA]',
    icon: Info,
    iconClass: 'text-[#60A5FA]',
  },
} as const;

const TONE_CLASSES = {
  default: 'border-[#292B33] bg-[#15161C]',
  warning: 'border-[#FF7A18]/50 bg-[#2A190D]/30',
  danger: 'border-[#4A2323] bg-[#281313]/30',
  success: 'border-[#123A24] bg-[#10251A]/30',
  info: 'border-[#1E3A5F] bg-[#0F1B2E]/30',
} as const;

// ============ HELPER FUNCTIONS ============

function getStatusKey(
  status: MetricCardStatus,
  tone: AdminMetricCardProps['tone']
): StatusConfigKey {
  // Status takes priority over tone
  if (status === 'loading' || status === 'error' || status === 'empty' || status === 'warning') {
    return status;
  }
  
  // If status is 'success', check tone for warning/danger/info
  if (status === 'success') {
    if (tone === 'warning') return 'warning';
    if (tone === 'danger') return 'danger';
    if (tone === 'info') return 'info';
    return 'success';
  }
  
  return 'success';
}

function formatMetricValue(
  value: string | number | boolean | null,
  status: MetricCardStatus,
  customFormatter?: (value: string | number | boolean | null) => string,
  emptyMessage?: string
): string {
  // Use custom formatter if provided
  if (customFormatter) {
    return customFormatter(value);
  }

  // Handle status-specific cases
  if (status === 'loading') return 'Loading...';
  if (status === 'error') return 'Error';
  if (status === 'empty') return emptyMessage || 'N/A';

  // Handle null/undefined
  if (value === null || value === undefined) return 'N/A';

  // Handle boolean
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  // Handle number
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'N/A';
    return value.toLocaleString();
  }

  // Handle string
  return value.trim() || 'N/A';
}

function getCardToneClass(tone: AdminMetricCardProps['tone'], status: MetricCardStatus): string {
  // If status is error or empty, use default tone
  if (status === 'error' || status === 'empty') {
    return TONE_CLASSES.default;
  }
  
  // If tone is specified, use it
  if (tone && tone in TONE_CLASSES) {
    return TONE_CLASSES[tone];
  }
  
  return TONE_CLASSES.default;
}

function getDescription(
  subtitle?: string,
  status?: MetricCardStatus,
  errorMessage?: string,
  emptyMessage?: string
): string {
  if (subtitle) return subtitle;
  if (status === 'loading') return 'Fetching latest value...';
  if (status === 'error') return errorMessage || 'Failed to load data';
  if (status === 'empty') return emptyMessage || 'No data available';
  return '';
}

// ============ SUB-COMPONENTS ============

const StatusBadge: React.FC<{
  status: MetricCardStatus;
  tone: AdminMetricCardProps['tone'];
}> = ({ status, tone }) => {
  const configKey = getStatusKey(status, tone);
  const config = STATUS_CONFIG[configKey];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${config.borderClass} ${config.bgClass} ${config.textClass}`}
      aria-label={`Status ${config.label}`}
    >
      <Icon
        size={12}
        className={`${config.iconClass}${config.animate ? ' animate-spin' : ''}`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
};

const LoadingState: React.FC<{
  loadingPlaceholder?: React.ReactNode;
  subtitle?: string;
}> = ({ loadingPlaceholder, subtitle }) => {
  if (loadingPlaceholder) {
    return <>{loadingPlaceholder}</>;
  }

  return (
    <div className="mt-2 space-y-2">
      <Skeleton className="h-7 w-28" />
      {subtitle && <Skeleton className="h-3 w-36" />}
    </div>
  );
};

const ErrorState: React.FC<{
  errorMessage?: string;
  onRetry?: () => void;
}> = ({ errorMessage, onRetry }) => (
  <div className="mt-1 space-y-2">
    <p className="text-sm text-[#F87171] break-words">
      {errorMessage || 'Failed to load data'}
    </p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#4A2323] bg-[#15161C] px-3 py-1.5 text-xs font-semibold text-[#F87171] transition-colors hover:bg-[#281313] hover:border-[#5C2B2B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F87171] focus-visible:ring-offset-2 active:scale-[0.98]"
        aria-label="Retry loading data"
      >
        <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
        Retry
      </button>
    )}
  </div>
);

// ============ MAIN COMPONENT ============

export default function AdminMetricCard({
  title,
  value,
  subtitle,
  tone = 'default',
  status = 'success',
  onRetry,
  formatValue,
  className = '',
  showStatusBadge = true,
  loadingPlaceholder,
  errorMessage,
  emptyMessage,
}: AdminMetricCardProps) {
  // Determine card tone class
  const cardToneClass = getCardToneClass(tone, status);

  // Format the value
  const displayValue = formatMetricValue(value, status, formatValue, emptyMessage);

  // Get description
  const description = getDescription(subtitle, status, errorMessage, emptyMessage);

  // Determine if we should show the value
  const showValue = status !== 'loading' && status !== 'error';

  return (
    <Card
      className={`h-full min-h-[128px] p-4 transition-all duration-200 ${cardToneClass} ${className}`}
      role="article"
      aria-label={`${title} metric card`}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">
            {title}
          </h3>
          {showStatusBadge && (
            <StatusBadge status={status} tone={tone} />
          )}
        </div>

        {/* Value / Loading / Error */}
        <div className="mt-2">
          {status === 'loading' ? (
            <LoadingState loadingPlaceholder={loadingPlaceholder} subtitle={subtitle} />
          ) : status === 'error' ? (
            <ErrorState errorMessage={errorMessage || subtitle} onRetry={onRetry} />
          ) : (
            <p className="text-xl font-black leading-tight text-[#F5F5F7] break-words">
              {displayValue}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-1">
          {status !== 'error' && status !== 'loading' && (
            <p className="text-xs text-[#A1A4AE] break-words">
              {description || <span className="text-[#70737E]">&nbsp;</span>}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}