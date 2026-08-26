import React from "react";
import { API_BASE_URL } from "../../config";

export type AvatarRole = "client" | "advocate" | "admin";

const ROLE_STYLES: Record<AvatarRole, { bg: string; ring: string; label: string }> = {
  client: { bg: "bg-[#004aad]", ring: "ring-[#004aad]/30", label: "Client" },
  advocate: { bg: "bg-emerald-600", ring: "ring-emerald-600/30", label: "Advocate" },
  admin: { bg: "bg-slate-700", ring: "ring-slate-700/30", label: "Admin" },
};

function initialsFrom(name?: string, fallbackLabel = "U") {
  const n = (name || "").trim();
  if (!n) return fallbackLabel;
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || fallbackLabel;
}

/**
 * UserAvatar — uploaded photo if `url` is present, otherwise a local
 * initials avatar with role-distinct colors (client = blue, advocate = green).
 * No external avatar services.
 */
export default function UserAvatar({
  name,
  role = "client",
  url,
  size = 40,
  className = "",
}: {
  name?: string;
  role?: AvatarRole;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.client;

  const trimmed = url?.trim() || "";
  const resolved = trimmed
    ? trimmed.startsWith("http")
      ? trimmed
      : `${API_BASE_URL}${trimmed}`
    : null;

  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name || style.label}
        width={size}
        height={size}
        className={`rounded-full object-cover ring-2 ${style.ring} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={`${style.label} avatar`}
      title={name || style.label}
      className={`inline-flex items-center justify-center rounded-full text-white font-bold select-none ring-2 ${style.bg} ${style.ring} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
    >
      {initialsFrom(name, style.label[0])}
    </span>
  );
}
