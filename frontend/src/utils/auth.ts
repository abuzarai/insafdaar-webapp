export type AuthRole = "CLIENT" | "ADVOCATE" | "ADMIN";

export function normalizeRole(value: unknown): AuthRole | null {
  const role = String(value || "").toUpperCase();
  return role === "CLIENT" || role === "ADVOCATE" || role === "ADMIN" ? role : null;
}

export function dashboardForRole(role: AuthRole): string {
  if (role === "ADMIN") return "/admin";
  if (role === "ADVOCATE") return "/advocate-dashboard";
  return "/client-dashboard";
}

// UX check only: decoding does not verify a signature. The server authorizes requests.
export function sessionRole(token: unknown, user: { role?: unknown } | null): AuthRole | null {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload));
    const role = normalizeRole(claims.role);
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
    return role && role === normalizeRole(user?.role) ? role : null;
  } catch {
    return null;
  }
}

export function getSessionRole(): AuthRole | null {
  try {
    return sessionRole(localStorage.getItem("token"), JSON.parse(localStorage.getItem("user") || "null"));
  } catch {
    return null;
  }
}

export const isLoggedIn = () => getSessionRole() !== null;
