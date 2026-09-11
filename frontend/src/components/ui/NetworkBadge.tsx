import React from 'react';

import Badge from './Badge';

import {
  CHAIN_IDS,
  getWalletNetworkLabel,
} from '../../wallet/config/networks';

type NetworkBadgeProps = {
  chainId: number | null | undefined;
};

export default function NetworkBadge({
  chainId,
}: NetworkBadgeProps) {
  if (!chainId) {
    return (
      <Badge variant="neutral">
        Not connected
      </Badge>
    );
  }

  const label =
    getWalletNetworkLabel(chainId);

  const variant =
    chainId === CHAIN_IDS.BSC_MAINNET
      ? 'success'
      : 'info';

  return (
    <Badge variant={variant}>
      {label}
    </Badge>
  );
}