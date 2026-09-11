import React from 'react';

import { cx } from './utils';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export default function Card({
  children,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cx(
        'rounded-[18px] border border-[#E5E7EB] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.04)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
