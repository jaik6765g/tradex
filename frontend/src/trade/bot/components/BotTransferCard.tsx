// src/bot/components/BotTransferCard.tsx

import React from 'react';
import { ArrowDownToLine, AlertCircle } from 'lucide-react';

import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

type Props = {
  amount: string;
  loading: boolean;
  error?: string | null;
  onAmountChange: (value: string) => void;
  onTransfer: () => void;
};

export default function BotTransferCard({
  amount,
  loading,
  error,
  onAmountChange,
  onTransfer,
}: Props) {
  return (
    <Card className="p-5 shadow-sm border border-[#E5E7EB] rounded-[20px]">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#EFF8FF]">
          <ArrowDownToLine size={19} className="text-[#175CD3]" />
        </div>

        <div>
          <h2 className="text-[16px] font-black text-[#101828]">
            Add Funds to Bot Wallet
          </h2>

          <p className="mt-1 text-sm font-medium text-[#667085]">
            Transfer TDX from your Main Balance into the Bot Wallet.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-[#B42318]" />
          <p className="text-xs font-medium text-[#B42318]">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Transfer Amount"
            value={amount}
            onChange={onAmountChange}
            placeholder="Enter amount in TDX"
            inputMode="decimal"
            min="0"
          />
          <p className="mt-1.5 text-[10px] font-medium text-[#667085]">
            Minimum transfer: 1 TDX
          </p>
        </div>

        <Button
          type="button"
          loading={loading}
          disabled={!amount.trim() || parseFloat(amount) <= 0}
          onClick={onTransfer}
          size="md"
          className="sm:min-w-[120px] bg-[#FBBF24] hover:bg-[#F59E0B] text-[#0D1B2A]"
        >
          Transfer
        </Button>
      </div>
    </Card>
  );
}