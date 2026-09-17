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
    'bg-[#FF7A18] text-white border border-[#FF7A18] hover:bg-[#FF8F3D] active:bg-[#EA580C]',
  secondary:
    'bg-[#15161C] text-[#F5F5F7] border border-[#34343E] hover:bg-[#15161C] active:bg-[#1B1917]',
  danger:
    'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#F87171] active:bg-[#991B1B]',
  warning:
    'bg-[#FF7A18] text-[#F5F5F7] border border-[#FF7A18] hover:bg-[#FF8F3D] active:bg-[#EA580C]',
  ghost:
    'bg-transparent text-[#F5F5F7] border border-transparent hover:bg-[#1B1917] active:bg-[#202229]',
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
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
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
