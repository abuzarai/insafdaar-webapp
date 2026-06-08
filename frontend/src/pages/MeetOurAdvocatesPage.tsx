import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../config";
import AdvocateCard, {
  PublicAdvocate,
} from "../components/MeetOurAdvocates/AdvocateCard";

const PUBLIC_ADVOCATES_ENDPOINT = "/api/public/advocates";

/* ================= helpers ================= */

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("text/html")) {
    throw new Error(
      `Backend returned HTML instead of JSON (status ${res.status}). Route: ${res.url}`
    );
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Backend did not return valid JSON (status ${res.status}). Route: ${res.url}`
    );
  }
}

/* ================= page ================= */

export default function MeetOurAdvocatesPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PublicAdvocate[]>([]);

  const load = async () => {
    try {
      setLoading(true);
      setErr("");

      const res = await fetch(`${API_BASE_URL}${PUBLIC_ADVOCATES_ENDPOINT}`);
      const out = await safeJson(res);

      if (!res.ok) throw new Error(out?.error || "Failed to load advocates");

      const advocates = Array.isArray(out) ? out : out?.advocates;
      if (!Array.isArray(advocates)) throw new Error("Invalid response");

      setItems(
        advocates.map((a: any) => ({
          id: Number(a.id),
          name: a.name ?? null,
          headline: a.headline ?? null,
          practiceAreas: a.practiceAreas ?? a.practice_areas ?? [],
          experienceYears: a.experienceYears ?? a.experience_years ?? 0,
          avatarUrl: a.avatarUrl ?? a.avatar_url ?? null,
          ratingAvg: a.ratingAvg ?? a.rating_avg ?? null,
          ratingCount: a.ratingCount ?? a.rating_count ?? null,
        }))
      );
    } catch (e: any) {
      setErr(e?.message || "Failed to load advocates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;

    return items.filter((a) => {
      const name = String(a.name || "").toLowerCase();
      const headline = String(a.headline || "").toLowerCase();
      const areas = (a.practiceAreas || []).join(" ").toLowerCase();
      return name.includes(s) || headline.includes(s) || areas.includes(s);
    });
  }, [items, q]);

  return (
    <div className="min-h-screen bg-[#F6F8FC]">
      {/* 🔵 DARK HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#060b18] via-[#0a1428] to-[#00142e] text-white">
        {/* subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "70px 70px",
          }}
        />

        <div className="relative z-10 max-w-[1200px] mx-auto px-4 md:px-6 py-16">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Meet Our <span className="text-[#f5b301]">Advocates</span>
          </h1>

          <p className="text-gray-300 mt-4 max-w-2xl">
            Connect with verified legal professionals based on specialization,
            experience, and client ratings.
          </p>

          {/* Search */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, practice area, or expertise…"
              className="
                w-full sm:w-[520px]
                rounded-lg px-4 py-3
                bg-white/10 text-white placeholder-gray-400
                border border-white/20
                focus:outline-none focus:ring-2 focus:ring-[#f5b301]/60
              "
            />

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="
                px-6 py-3 rounded-lg
                bg-[#f5b301] text-[#00142e]
                font-semibold
                hover:bg-[#ffd84d]
                transition
                disabled:opacity-60
              "
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {err && (
            <div className="mt-6 rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {err}
            </div>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-10">
        {loading && items.length === 0 ? (
          <div className="text-sm text-slate-500">Loading advocates…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-slate-500">
            No advocates found{q ? ` for "${q}"` : ""}.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => (
              <AdvocateCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
