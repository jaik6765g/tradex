import React from 'react';

import { cx } from './utils';

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

const variantClasses: Record<BadgeVariant, string> = {
  success: 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]',
  warning: 'border-[#3A281C] bg-[#2A190D] text-[#FF8F3D]',
  error: 'border-[#4A2323] bg-[#281313] text-[#F87171]',
  info: 'border-[#1E3A5F] bg-[#0F1B2E] text-[#60A5FA]',
  neutral: 'border-[#292B33] bg-[#15161C] text-[#A1A4AE]',
};

export default function Badge({
  children,
  variant = 'neutral',
  className,
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-extrabold',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
