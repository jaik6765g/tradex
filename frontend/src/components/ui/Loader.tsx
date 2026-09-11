import React from 'react';
import { Loader2 } from 'lucide-react';

import { cx } from './utils';

type LoaderProps = {
  label?: string;
  className?: string;
  size?: number;
};

export default function Loader({
  label = 'Loading...',
  className,
  size = 20,
}: LoaderProps) {
  return (
    <div
      className={cx(
        'flex items-center justify-center gap-2 text-sm font-bold text-[#475467]',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 size={size} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}
