import React, { useEffect } from 'react';
import { X } from 'lucide-react';

import { cx } from './utils';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close modal overlay"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Modal'}
        className={cx(
          'relative w-full max-w-xl rounded-[24px] border border-[#292B33] bg-[#15161C] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.2)] sm:p-5',
          className,
        )}
      >
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-base font-black text-[#F5F5F7]">
              {title}
            </h2>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#292B33] text-[#A1A4AE] hover:bg-[#15161C]"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </header>

        <div>{children}</div>
      </section>
    </div>
  );
}
