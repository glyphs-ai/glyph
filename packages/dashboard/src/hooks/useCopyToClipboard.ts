import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../utils/clipboard";

export interface UseCopyToClipboard {
  /** True for `resetMs` after a successful copy; otherwise false. */
  copied: boolean;
  /** Copy `text`, flipping `copied` true on success. */
  copy: (text: string) => Promise<void>;
}

/**
 * Clipboard copy with a self-clearing "copied" flag.
 *
 * Wraps the shared {@link copyToClipboard} write primitive and adds the
 * transient UI state every copy affordance needs: `copied` flips true
 * on a successful write and resets after `resetMs`. The reset timer is
 * cleared on unmount so a copy fired just before navigation cannot
 * setState on an unmounted component.
 */
export function useCopyToClipboard(resetMs = 1500): UseCopyToClipboard {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyToClipboard(text);
      if (!ok) return;
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, resetMs);
    },
    [resetMs],
  );
  return { copied, copy };
}
