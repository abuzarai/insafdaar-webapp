// frontend/src/utils/authedFile.ts
// Fetch /uploads/* files with the JWT so the backend's authenticated serving
// guard (audit #17-2) can authorize them, then hand back blob object URLs.
import { API_BASE_URL } from "../config";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const h: Record<string, string> = { Accept: "*/*" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function toRequestUrl(url: string): string {
  return url.startsWith(API_BASE_URL) ? url.slice(API_BASE_URL.length) : url;
}

const blobUrlCache = new Map<string, string>();

async function authedBlobUrl(pathOrUrl: string): Promise<string> {
  const path = toRequestUrl(pathOrUrl);
  const cached = blobUrlCache.get(path);
  if (cached) return cached;

  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(res.status === 403 ? "You don't have access to this file." : `Failed to load file (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(path, url);
  return url;
}

/** Open a protected file in a new tab (docs, proofs, vouchers, audio). */
export async function openAuthedFile(pathOrUrl: string): Promise<void> {
  try {
    const url = await authedBlobUrl(pathOrUrl);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e: any) {
    window.alert(e?.message || "Failed to open file.");
  }
}

/** Trigger a download of a protected file. */
export async function downloadAuthedFile(pathOrUrl: string, name: string): Promise<void> {
  try {
    const url = await authedBlobUrl(pathOrUrl);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e: any) {
    window.alert(e?.message || "Failed to download file.");
  }
}

export { authedBlobUrl };