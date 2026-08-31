// fetch() with a hard timeout via AbortController — the voice panel and other
// raw-fetch call sites otherwise hang forever on a dead service.
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  ms = 20000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}