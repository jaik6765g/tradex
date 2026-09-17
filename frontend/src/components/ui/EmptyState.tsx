import React from 'react';
import { Inbox } from 'lucide-react';

import { cx } from './utils';

type EmptyStateProps = {
  title?: string;
  description?: string;
  className?: string;
};

export default function EmptyState({
  title = 'No data yet',
  description,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'rounded-[18px] border border-[#292B33] bg-[#15161C] p-8 text-center',
        className,
      )}
    >
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#1B1917] text-[#70737E]">
        <Inbox size={22} />
      </div>

      <p className="mt-3 text-base font-bold text-[#A1A4AE]">{title}</p>

      {description ? (
        <p className="mt-1 text-sm text-[#A1A4AE]">{description}</p>
      ) : null}
    </div>
  );
}
