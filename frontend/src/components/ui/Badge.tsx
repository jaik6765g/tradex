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
  success: 'border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]',
  warning: 'border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]',
  error: 'border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]',
  info: 'border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]',
  neutral: 'border-[#E4E7EC] bg-[#F9FAFB] text-[#475467]',
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
