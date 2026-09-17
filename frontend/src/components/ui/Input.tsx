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
          className="mb-2 block text-sm font-bold text-[#E4E5E8]"
        >
          {label}
        </label>
      ) : null}

      <input
        id={inputId}
        disabled={disabled}
        className={cx(
          'h-10 w-full rounded-[10px] border bg-[#15161C] px-3 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18] focus-visible:ring-offset-1',
          error
            ? 'border-[#F04438]'
            : 'border-[#34343E]',
          disabled
            ? 'cursor-not-allowed bg-[#15161C] text-[#70737E]'
            : '',
          className,
        )}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
        {...props}
      />

      {error ? (
        <p className="mt-2 text-xs font-semibold text-[#F87171]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
