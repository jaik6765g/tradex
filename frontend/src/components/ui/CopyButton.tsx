import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import Button from './Button';

type CopyButtonProps = {
  text: string;
  className?: string;
  copiedLabel?: string;
  defaultLabel?: string;
};

export default function CopyButton({
  text,
  className,
  copiedLabel = 'Copied',
  defaultLabel = 'Copy',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const handleCopy = async () => {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable in some contexts.
    }
  };

  return (
    <Button
      variant="secondary"
      className={className}
      onClick={() => {
        void handleCopy();
      }}
      aria-label="Copy value"
      title="Copy value"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? copiedLabel : defaultLabel}
    </Button>
  );
}
