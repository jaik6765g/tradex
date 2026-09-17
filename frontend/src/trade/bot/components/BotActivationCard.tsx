import React from 'react';
import { Power } from 'lucide-react';

import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

type Props = {
  amount: string;
  loading: boolean;
  onAmountChange: (value: string) => void;
  onActivate: () => void;
};

export default function BotActivationCard({
  amount,
  loading,
  onAmountChange,
  onActivate,
}: Props) {
  return (
    <Card className="p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#2A190D]">
          <Power size={19} className="text-[#FF8F3D]" />
        </div>

        <div>
          <h2 className="text-[16px] font-black text-[#F5F5F7]">
            Activate Bot
          </h2>

          <p className="mt-1 text-sm font-medium text-[#A1A4AE]">
            Activation uses funds already available in your Bot Wallet.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Activation Amount"
            value={amount}
            onChange={onAmountChange}
            placeholder="Enter activation amount"
            inputMode="decimal"
            min="0"
          />
        </div>

        <Button
          type="button"
          variant="warning"
          loading={loading}
          disabled={!amount.trim()}
          onClick={onActivate}
          size="md"
          className="sm:min-w-[140px]"
        >
          Activate Bot
        </Button>
      </div>

      <p className="mt-3 text-xs font-medium text-[#A1A4AE]">
        Minimum and maximum activation limits are validated by the backend.
      </p>
    </Card>
  );
}
