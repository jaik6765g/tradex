import React from 'react';
import { AlertCircle } from 'lucide-react';

import Button from './Button';
import { cx } from './utils';

type ErrorStateProps = {
  title?: string;
  description?: string;
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export default function ErrorState({
  title = 'Something went wrong',
  description,
  className,
  onRetry,
  retryLabel = 'Try again',
}: ErrorStateProps) {
  return (
    <div
      className={cx(
        'rounded-[18px] border border-[#4A2323] bg-[#281313] p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle size={20} className="mt-0.5 text-[#F87171]" />

        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[#991B1B]">{title}</p>

          {description ? (
            <p className="mt-1 text-xs text-[#7F1D1D]">{description}</p>
          ) : null}

          {onRetry ? (
            <div className="mt-3">
              <Button
                variant="secondary"
                className="h-9 border-[#4A2323] bg-[#15161C] text-xs text-[#F87171] hover:bg-[#281313]"
                onClick={onRetry}
              >
                {retryLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
