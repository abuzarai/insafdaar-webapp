/**
 * Heuristic: does this user-facing message describe a failure?
 * Used by message banners to pick success vs error styling.
 */
export function isErrorMessage(msg?: string | null): boolean {
  if (!msg) return false;
  return /\b(fail|failed|invalid|required|missing|unable|could not|not found|exceeded|unsupported|too small|reject)\b/i.test(
    msg
  );
}
