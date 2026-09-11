import React from 'react';

import { cx } from './utils';

type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange'
> & {
  label?: string;
  error?: string;
  onChange?: (value: string) => void;
};

export default function Input({
  label,
  error,
  disabled,
  className,
  id,
  onChange,
  ...props
}: InputProps) {
  const inputId =
    id ||
    (label
      ? label
          .toLowerCase()
          .replace(/\s+/g, '-')
      : undefined);

  return (
    <div className="w-full">
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-2 block text-sm font-bold text-[#344054]"
        >
          {label}
        </label>
      ) : null}

      <input
        id={inputId}
        disabled={disabled}
        className={cx(
          'h-10 w-full rounded-[10px] border bg-white px-3 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800] focus-visible:ring-offset-1',
          error
            ? 'border-[#F04438]'
            : 'border-[#D0D5DD]',
          disabled
            ? 'cursor-not-allowed bg-[#F9FAFB] text-[#98A2B3]'
            : '',
          className,
        )}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
        {...props}
      />

      {error ? (
        <p className="mt-2 text-xs font-semibold text-[#B42318]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
