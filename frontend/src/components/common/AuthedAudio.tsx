// frontend/src/components/common/AuthedAudio.tsx
// <audio> wrapper that loads its src through the authenticated /uploads guard.
import { useEffect, useState } from "react";
import { authedBlobUrl } from "../../utils/authedFile";

export default function AuthedAudio({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setObjectUrl(null);
    if (!src) return;
    authedBlobUrl(src)
      .then((u) => {
        if (!cancelled) setObjectUrl(u);
      })
      .catch(() => {
        /* silent: missing access just won't play */
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!objectUrl) {
    return (
      <div className={`${className || ""} flex items-center gap-2 text-xs text-slate-400`}>
        <span>Loading audio…</span>
      </div>
    );
  }

  return <audio className={className} controls src={objectUrl} />;
}