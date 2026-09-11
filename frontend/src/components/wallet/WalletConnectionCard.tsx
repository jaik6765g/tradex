import React from 'react';

import { Card, cx } from '../ui';

import WalletStatusPanel from './WalletStatusPanel';

type WalletConnectionCardProps = React.ComponentProps<typeof WalletStatusPanel> & {
  title?: string;
  description?: string;
  className?: string;
};

export default function WalletConnectionCard({
  title = 'Wallet Status',
  description,
  className,
  ...statusPanelProps
}: WalletConnectionCardProps) {
  return (
    <Card className={cx('p-4', className)}>
      <div>
        <p className="text-sm font-extrabold text-[#111827]">{title}</p>

        {description ? (
          <p className="mt-1 text-xs text-[#667085]">{description}</p>
        ) : null}
      </div>

      <WalletStatusPanel
        {...statusPanelProps}
        className="mt-3"
      />
    </Card>
  );
}