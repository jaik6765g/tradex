import { Injectable } from '@nestjs/common';

import {
  type DepositTransactionSigner,
  type SignedDepositTransfer,
  type SignTokenTransferRequest,
} from './deposit-transaction-signer.interface';

/** Signer used when no custodial signing capability is configured. */
@Injectable()
export class NoopDepositTransactionSigner implements DepositTransactionSigner {
  readonly name = 'noop';

  canSign(): boolean {
    return false;
  }

  async signTokenTransfer(): Promise<SignedDepositTransfer> {
    throw new Error('Deposit sweep signing is not configured');
  }
}
