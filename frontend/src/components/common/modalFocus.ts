// frontend/src/components/common/modalFocus.ts
// Minimal modal focus management (audit F8): focus the dialog on open,
// return focus to the trigger on close, and close on Escape.

import { useEffect, useRef } from "react";

export function useModalFocus<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose?: () => void
) {
  const ref = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const el = ref.current;
    const focusTarget = el?.querySelector<HTMLElement>(
      "button, input, [tabindex]:not([tabindex='-1']), h3"
    );
    focusTarget?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}