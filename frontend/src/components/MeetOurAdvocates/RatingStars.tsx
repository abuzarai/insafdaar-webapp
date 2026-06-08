import React from "react";

export default function RatingStars({
  rating,
  count,
}: {
  rating?: number | null;
  count?: number | null;
}) {
  const safeRating =
    typeof rating === "number" && isFinite(rating) ? Math.max(0, Math.min(5, rating)) : null;

  const full = safeRating == null ? 0 : Math.floor(safeRating);
  const half = safeRating == null ? 0 : safeRating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {Array.from({ length: full }).map((_, i) => (
          <span key={`f-${i}`} className="text-yellow-500 text-sm">★</span>
        ))}
        {half ? <span className="text-yellow-500 text-sm">⯪</span> : null}
        {Array.from({ length: empty }).map((_, i) => (
          <span key={`e-${i}`} className="text-slate-300 text-sm">★</span>
        ))}
      </div>

      {safeRating == null ? (
        <span className="text-xs text-slate-500">No ratings yet</span>
      ) : (
        <span className="text-xs text-slate-600 font-semibold">
          {safeRating.toFixed(1)}
          {typeof count === "number" ? (
            <span className="font-normal text-slate-500"> ({count})</span>
          ) : null}
        </span>
      )}
    </div>
  );
}
