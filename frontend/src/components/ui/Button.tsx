import React from 'react';
import { Loader2 } from 'lucide-react';

import { cx } from './utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'warning'
  | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#111827] text-white border border-[#111827] hover:bg-[#1F2937] active:bg-[#0F172A]',
  secondary:
    'bg-white text-[#111827] border border-[#D0D5DD] hover:bg-[#F9FAFB] active:bg-[#F2F4F7]',
  danger:
    'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B]',
  warning:
    'bg-[#F5B800] text-[#111827] border border-[#F5B800] hover:bg-[#FCD34D] active:bg-[#EAAA08]',
  ghost:
    'bg-transparent text-[#111827] border border-transparent hover:bg-[#F2F4F7] active:bg-[#EAECF0]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" />
      ) : null}
      <span>{children}</span>
    </button>
  );
}
