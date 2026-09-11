import React from 'react';

import { cx } from './utils';

type SkeletonProps = {
  className?: string;
};

export default function Skeleton({
  className,
}: SkeletonProps) {
  return (
    <div
      className={cx(
        'animate-pulse rounded-[10px] bg-[#EAECF0]',
        className,
      )}
    />
  );
}
