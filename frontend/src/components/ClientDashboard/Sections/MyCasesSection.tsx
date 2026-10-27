import React, { useMemo, useState, useEffect } from "react";
import { Search, Filter, ChevronRight, Briefcase, ExternalLink, FileText, Trash2, Video } from "lucide-react";
import { formatStatus } from "../../common/formatStatus";
import { safeExternalHref } from "../../../utils/url";
import { API_BASE_URL } from "../../../config";
import { useActionDialogs } from "../../common/ActionDialog";
import { Badge } from "../../common/Badge";
import { caseNextStep } from "../utils/caseNextStep";

/* ================= Types ================= */

export type VoucherStatus = "NOT_GENERATED" | "GENERATED" | "VERIFIED" | "REJECTED";

// ✅ Match backend meeting status (case_meetings.status)
export type MeetingStatus = "APPROVED" | "PENDING_ADMIN" | "REJECTED" | "CANCELLED" | string;

export type CaseStatus = "Ongoing" | "Pending" | "Closed";

export type CaseSummary = {
  id: string;
  title: string;
  status: CaseStatus;
  lifecycleStatus?: string;

  client: { name: string; city: string; phone: string };
  advocate: { assigned: boolean; name?: string; phone?: string };

  // placeholder for now
  court: { name: string; filedOn: string };
  nextHearing?: { date: string; time?: string; purpose?: string };

  // ✅ approved meeting details (shown if available)
  nextMeeting?: {
    start_at: string; // ISO
    end_at: string; // ISO
    mode: string; // Google Meet
    link?: string;
    status: MeetingStatus;
  };

  payments: {
    voucherStatus: VoucherStatus;
    voucherId?: string | null;
    amount?: number | null;
    dueDate?: string | null;

    // ✅ NEW: pdf url coming from backend
    voucherPdfUrl?: string | null;
  };

  alertsCount?: number;
};

type Props = {
  onOpenCase: (c: CaseSummary) => void;
  onContinueCase?: (c: CaseSummary) => void;
  onStartCase?: () => void;
};

/* ================= Helpers ================= */

function mapCaseStatus(dbStatus: string | null | undefined): CaseStatus {
  const s = String(dbStatus || "").toUpperCase();
  if (s === "CLOSED" || s === "RESOLVED") return "Closed";
  if (s === "DRAFT" || s === "PENDING" || s === "INTAKE_STARTED") return "Pending";
  return "Ongoing";
}

function toAbsoluteUrlMaybe(url?: string | null) {
  if (!url) return null;
  const u = String(url);
  if (!u) return null;
  // if already absolute, keep it
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  // otherwise prefix with API base (common pattern for stored paths)
  return `${API_BASE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

function mapCaseFromApi(api: any): CaseSummary {
  // backend returns either: {cases:[...]} items, each item already has payments + nextMeeting (maybe)
  // We map safely and also support voucherPdfUrl key differences.
  const payments = api?.payments || {};

  return {
    id: String(api.id ?? "—"),
    title: api.title ?? "—",
    status: mapCaseStatus(api.status),
    lifecycleStatus: String(api.status || ""),

    client: {
      name: api.client?.name ?? "—",
      city: api.client?.city ?? "—",
      phone: api.client?.phone ?? "—",
    },

    advocate: api.advocate?.assigned
      ? { assigned: true, name: api.advocate.name, phone: api.advocate.phone }
      : { assigned: false },

    court: { name: "—", filedOn: "—" },
    nextHearing: undefined,

    // meetings are merged later from approved meetings endpoint (your current working logic)
    nextMeeting: undefined,

    payments: {
      voucherStatus: (payments.voucherStatus ?? "NOT_GENERATED") as VoucherStatus,
      voucherId: payments.voucherId ?? null,
      amount: payments.amount ?? null,
      dueDate: payments.dueDate ?? null,

      // ✅ accept different backend key styles
      voucherPdfUrl:
        payments.voucherPdfUrl ?? payments.voucher_pdf_url ?? payments.voucherPDFUrl ?? payments.voucherPdf ?? null,
    },

    alertsCount: api.alertsCount ?? api.alerts_count ?? 0,
  };
}

function getAuthToken(): string | null {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("accessToken")
  );
}

/* ================= Component ================= */

export default function MyCasesSection({ onOpenCase, onContinueCase, onStartCase }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");

  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const { confirm, dialogs } = useActionDialogs();

  const CASES_URL = `${API_BASE_URL}/api/client/dashboard/cases`;
  const APPROVED_MEETINGS_URL = `${API_BASE_URL}/api/client/dashboard/meetings/approved`;

  const parseCaseId = (id: string) => {
    if (!id) return NaN;
    const raw = id.startsWith("CASE-") ? id.split("-")[1] : id;
    return Number(raw);
  };

  const canDeleteCase = (c: CaseSummary) => {
    const s = String(c.lifecycleStatus || "").toUpperCase();
    return ["DRAFT", "INTAKE_STARTED", "MATCHING_REVIEW", "ADVOCATE_ASSIGNED"].includes(s);
  };

  const deleteCase = async (c: CaseSummary) => {
    const caseId = parseCaseId(c.id);
    if (!Number.isFinite(caseId)) {
      setError("Invalid case id");
      return;
    }

    const ok = await confirm({
      title: "Delete Case Permanently",
      message: `Permanently delete ${c.id}? This will remove the case and related data (interview, matching, meeting, contract, and notifications) from the database. This action cannot be undone.`,
      confirmText: "Delete Case",
      cancelText: "Keep Case",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setDeletingCaseId(c.id);
      setError("");

      const token = getAuthToken();
      if (!token) throw new Error("Unauthorized: token missing. Please login again.");

      const res = await fetch(`${API_BASE_URL}/api/client/dashboard/cases/${caseId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Failed to delete case (${res.status})`);
      }

      setReloadTick((n) => n + 1);
    } catch (e: any) {
      setError(e?.message || "Failed to delete case");
    } finally {
      setDeletingCaseId(null);
    }
  };

  useEffect(() => {
    let alive = true;

    async function loadCasesAndMeetings() {
      try {
        setLoading(true);
        setError("");

        const token = getAuthToken();
        if (!token) throw new Error("Unauthorized: token missing. Please login again.");

        // 1) cases
        const res = await fetch(CASES_URL, {
          method: "GET",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          throw new Error("We couldn’t load your cases. Please try again.");
        }

        const data = await res.json();
        const list = Array.isArray(data) ? data : data.cases || [];
        const mapped: CaseSummary[] = list.map(mapCaseFromApi);

        // 2) approved meetings (best-effort; if route missing, just ignore)
        let meetingsMap: Record<string, any> = {};
        try {
          const mRes = await fetch(APPROVED_MEETINGS_URL, {
            method: "GET",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          });

          if (mRes.ok) {
            const mData = await mRes.json();
            const meetings = Array.isArray(mData?.meetings) ? mData.meetings : [];
            meetingsMap = meetings.reduce((acc: any, m: any) => {
              const caseKey = `CASE-${m.case_id}`;
              // if multiple meetings per case, keep the earliest upcoming / first sorted by backend
              if (!acc[caseKey]) acc[caseKey] = m;
              return acc;
            }, {});
          }
        } catch {
          // ignore
        }

        // 3) merge meeting into each case
        const merged: CaseSummary[] = mapped.map((c) => {
          const m = meetingsMap[c.id];
          if (!m) return c;

          return {
            ...c,
            nextMeeting: {
              start_at: m.start_at,
              end_at: m.end_at,
              mode: "Google Meet",
              link: m.google_meet_link || undefined,
              status: String(m.status || "APPROVED"),
            },
          };
        });

        if (alive) setCases(merged);
      } catch (e: any) {
        if (alive) setError(getAuthToken() ? "We couldn’t load your cases. Please try again." : "Please sign in again to view your cases.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadCasesAndMeetings();
    return () => {
      alive = false;
    };
  }, [CASES_URL, APPROVED_MEETINGS_URL, reloadTick]);

  const recordedStages = Array.from(new Set(cases.map((c) => c.lifecycleStatus).filter((stage): stage is string => !!stage)));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => (filter === "All" ? true : c.lifecycleStatus === filter))
      .filter((c) => {
        if (!q) return true;
        return (
          c.id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.advocate.name || "").toLowerCase().includes(q) ||
          c.client.name.toLowerCase().includes(q) ||
          c.client.city.toLowerCase().includes(q)
        );
      });
  }, [cases, filter, query]);

  const open = (c: CaseSummary) => onOpenCase(c);

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">My Cases</h1>
          <p className="text-sm text-slate-600 mt-2">
            All your matters, including drafts. Open a case for its details, billing and contract.
          </p>
        </div>
      </div>

      {loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
          Loading cases...
        </div>
      )}

      {!loading && error && (
        <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm text-red-700 whitespace-pre-wrap">
          <p role="alert">{error}</p>
          {getAuthToken() ? <button type="button" onClick={() => setReloadTick(n => n + 1)} className="mt-3 min-h-[44px] font-semibold text-[#004aad] underline">Try again</button> : <a href="/login" className="inline-flex items-center mt-3 min-h-[44px] font-semibold text-[#004aad] underline">Sign in</a>}
        </div>
      )}

      {!loading && !error && (
        <>
          {cases.length > 0 && <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 bg-slate-50">
              <Search size={16} className="text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search cases"
                placeholder="Search by case or lawyer"
                className="min-h-[44px] bg-transparent outline-none w-full text-sm text-slate-800"
              />
            </div>

            <div className="inline-flex min-h-[44px] items-center gap-2 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold">
              <Filter size={16} className="text-[#004aad]" />
              <select
                aria-label="Filter by recorded stage"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="min-h-[44px] outline-none bg-transparent"
              >
                <option value="All">All</option>
                {recordedStages.map((stage) => <option key={stage} value={stage}>{formatStatus(stage)}</option>)}
              </select>
            </div>
          </div>}

          <div className="grid lg:grid-cols-2 gap-4">
            {filtered.map((c) => {
              const meeting = c.nextMeeting;
              const voucher = c.payments;

              const voucherPdf = toAbsoluteUrlMaybe(voucher.voucherPdfUrl);
              return (
                <article
                  key={c.id}
                  aria-label={`${c.id}: ${c.title}`}
                  className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
                >
                  <div className="text-xs text-slate-500">{c.id}</div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">{c.title}</h2>
                  <div className="mt-2">
                    <Badge variant="blue">{c.lifecycleStatus ? formatStatus(c.lifecycleStatus) : "Stage not recorded"}</Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-sm text-slate-700">
                    <Briefcase size={16} className="text-[#004aad]" />
                    Advocate: {c.advocate.assigned ? c.advocate.name || "Assigned (name not recorded)" : "Not assigned"}
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{caseNextStep(c.lifecycleStatus)}</p>
                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onContinueCase && ["DRAFT", "INTAKE_STARTED", "MATCHING_REVIEW"].includes(c.lifecycleStatus || "") ? onContinueCase(c) : open(c)}
                      className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-sm font-semibold"
                    >
                      {onContinueCase && ["DRAFT", "INTAKE_STARTED"].includes(c.lifecycleStatus || "") ? "Continue case" : onContinueCase && c.lifecycleStatus === "MATCHING_REVIEW" ? "View lawyer options" : "Open case"} <ChevronRight size={16} />
                    </button>
                    {voucherPdf ? (
                      <a href={safeExternalHref(voucherPdf)} target="_blank" rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[#004aad] hover:underline">
                        <FileText size={14} /> Voucher PDF <ExternalLink size={14} />
                      </a>
                    ) : null}
                    {meeting?.link ? (
                      <a href={safeExternalHref(meeting.link)} target="_blank" rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[#004aad] hover:underline">
                        <Video size={14} /> Approved meeting <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                  {canDeleteCase(c) ? (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => deleteCase(c)}
                        disabled={deletingCaseId === c.id}
                        className="inline-flex min-h-[44px] items-center gap-2 text-xs text-rose-800 hover:underline disabled:opacity-60"
                      >
                        <Trash2 size={14} />
                        {deletingCaseId === c.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
              {cases.length ? "No cases match your search. Try another search or choose All." : "You haven’t started a case yet."}
                {!cases.length && onStartCase && <button type="button" onClick={onStartCase} className="block mt-4 min-h-[44px] px-4 rounded-xl bg-[#004aad] text-white font-semibold">Start a case</button>}
            </div>
          )}
        </>
      )}
      {dialogs}
    </section>
  );
}
