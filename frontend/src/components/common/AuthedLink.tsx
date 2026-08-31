// frontend/src/components/common/AuthedLink.tsx
// Anchor that opens/downloads a protected /uploads/* file through the
// authenticated fetch helper (audit #17-2), instead of a direct href.
import React from "react";
import { openAuthedFile, downloadAuthedFile } from "../../utils/authedFile";

export default function AuthedLink({
  url,
  className = "",
  style,
  children,
  downloadName,
}: {
  url: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  downloadName?: string;
}) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        if (!url) return;
        if (downloadName) void downloadAuthedFile(url, downloadName);
        else void openAuthedFile(url);
      }}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}