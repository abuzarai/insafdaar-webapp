export const VOICE_ENTRY_PATH = "/client-dashboard?section=Start%20Case";

// Only this intent is carried through authentication, never a user-supplied redirect.
export function hasVoiceIntent(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("intent") === "voice" || params.get("next") === "/voice";
}

export function withVoiceIntent(path: string, voice: boolean): string {
  return voice ? `${path}${path.includes("?") ? "&" : "?"}intent=voice` : path;
}

export function isVoiceEntry(pathname: string, search: string): boolean {
  return pathname === "/client-dashboard" && new URLSearchParams(search).get("section") === "Start Case";
}
