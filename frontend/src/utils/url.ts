// frontend/src/utils/url.ts
// Scheme guard for server-supplied URLs rendered into hrefs (audit F13).

/** Only allow http(s) links; anything else renders as a dead link. */
export function safeExternalHref(url: string | null | undefined): string {
  const v = String(url || "").trim();
  return /^https?:\/\//i.test(v) ? v : "#";
}