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
        'rounded-[18px] border border-[#E5E7EB] bg-white p-8 text-center',
        className,
      )}
    >
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F2F4F7] text-[#98A2B3]">
        <Inbox size={22} />
      </div>

      <p className="mt-3 text-base font-bold text-[#475467]">{title}</p>

      {description ? (
        <p className="mt-1 text-sm text-[#667085]">{description}</p>
      ) : null}
    </div>
  );
}
