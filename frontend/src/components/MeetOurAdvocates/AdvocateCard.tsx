import RatingStars from "./RatingStars";

export type PublicAdvocate = {
  id: number;
  name: string | null;
  headline?: string | null;
  practiceAreas?: string[] | null;
  experienceYears?: number | null;
  avatarUrl?: string | null;

  // optional if backend provides
  ratingAvg?: number | null;
  ratingCount?: number | null;
};

function toInitials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "A";
}

export default function AdvocateCard({
  a,
  onView,
}: {
  a: PublicAdvocate;
  onView?: (id: number) => void;
}) {
  const title = a.name || `Advocate #${a.id}`;
  const areas = Array.isArray(a.practiceAreas) ? a.practiceAreas : [];
  const primaryArea = areas[0] || "General Practice";

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 flex items-start gap-4">
        <div className="h-14 w-14 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center shrink-0">
          {a.avatarUrl ? (
            <img
              src={a.avatarUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="font-bold text-slate-600">{toInitials(title)}</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">{title}</div>
              <div className="text-sm text-slate-600 mt-0.5 truncate">
                {a.headline || primaryArea}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onView?.(a.id)}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              View
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
              {a.experienceYears ?? 0}+ yrs
            </span>

            <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
              {primaryArea}
            </span>
          </div>

          <div className="mt-3">
            <RatingStars rating={a.ratingAvg ?? null} count={a.ratingCount ?? null} />
          </div>

          {areas.length > 1 ? (
            <div className="mt-3 text-xs text-slate-500">
              +{areas.length - 1} more specializations
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
