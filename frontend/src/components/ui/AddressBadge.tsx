import React from 'react';

import CopyButton from './CopyButton';
import { cx } from './utils';
import { formatAddress } from './utils';

type AddressBadgeProps = {
  address: string;
  className?: string;
};

export default function AddressBadge({
  address,
  className,
}: AddressBadgeProps) {
  return (
    <div
      className={cx(
        'inline-flex items-center gap-2 rounded-[10px] border border-[#292B33] bg-[#111217] px-3 py-1.5',
        className,
      )}
    >
      <span className="text-xs font-bold text-[#A1A4AE]">
        {formatAddress(address)}
      </span>

      <CopyButton
        text={address}
        className="h-8 gap-0 px-2 text-xs"
        defaultLabel=""
        copiedLabel=""
      />
    </div>
  );
}
