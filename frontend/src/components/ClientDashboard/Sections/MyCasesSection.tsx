import React, { useMemo, useState, useEffect } from "react";
import {
  Search,
  Filter,
  CalendarDays,
  Bell,
  ChevronRight,
  Video,
  User,
  Briefcase,
  CreditCard,
  Gavel,
  BadgeCheck,
  Clock,
  XCircle,
  ExternalLink,
  FileText,
  Trash2,
} from "lucide-react";
import { API_BASE_URL } from "../../../config";
import { useActionDialogs } from "../../common/ActionDialog";

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

type FilterValue = "All" | CaseStatus;

type Props = {
  onOpenCase: (c: CaseSummary) => void;
};

/* ================= Helpers ================= */

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Badge({
  variant,
  children,
}: {
  variant: "blue" | "amber" | "green" | "gray" | "red";
  children: React.ReactNode;
}) {
  const styles =
    variant === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : variant === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : variant === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : variant === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border", styles)}>
      {children}
    </span>
  );
}

function paymentBadge(v: VoucherStatus, hasPdf?: boolean | null) {
  if (v === "VERIFIED")
    return (
      <Badge variant="green">
        <BadgeCheck size={14} /> Verified
      </Badge>
    );

  if (v === "GENERATED")
    return (
      <Badge variant="amber">
        <Clock size={14} /> {hasPdf ? "Voucher Ready" : "Voucher Generated"}
      </Badge>
    );

  if (v === "REJECTED")
    return (
      <Badge variant="red">
        <XCircle size={14} /> Rejected
      </Badge>
    );

  return (
    <Badge variant="gray">
      <CreditCard size={14} /> Not Generated
    </Badge>
  );
}

function statusBadge(s: CaseStatus) {
  if (s === "Ongoing") return <Badge variant="blue">Ongoing</Badge>;
  if (s === "Pending") return <Badge variant="amber">Pending</Badge>;
  return <Badge variant="green">Closed</Badge>;
}

function meetingBadge(meeting?: CaseSummary["nextMeeting"]) {
  if (meeting?.status && String(meeting.status).toUpperCase() === "APPROVED") {
    return (
      <Badge variant="green">
        <Video size={14} /> Meeting Approved
      </Badge>
    );
  }
  return (
    <Badge variant="gray">
      <Video size={14} /> No Meeting
    </Badge>
  );
}

function money(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `Rs. ${Number(n).toLocaleString()}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function fmtTime(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return d;
  }
}

function mapCaseStatus(dbStatus: string | null | undefined): CaseStatus {
  const s = String(dbStatus || "").toUpperCase();
  if (s === "CLOSED" || s === "RESOLVED") return "Closed";
  if (s === "DRAFT" || s === "PENDING" || s === "INTAKE_STARTED") return "Pending";
  return "Ongoing";
}

function lifecycleBadge(status?: string) {
  const s = String(status || "").toUpperCase();
  if (!s) return null;

  if (s === "CONTRACT_PENDING_SIGNATURES") {
    return (
      <Badge variant="amber">
        <FileText size={14} /> Contract Signatures Pending
      </Badge>
    );
  }
  if (s === "CONTRACT_PENDING_ADMIN_APPROVAL") {
    return (
      <Badge variant="amber">
        <Clock size={14} /> Contract Under Admin Review
      </Badge>
    );
  }
  if (s === "CASE_ACTIVE") {
    return (
      <Badge variant="green">
        <BadgeCheck size={14} /> Case Active
      </Badge>
    );
  }
  if (s === "ADVOCATE_ASSIGNED") {
    return (
      <Badge variant="blue">
        <Briefcase size={14} /> Advocate Assigned
      </Badge>
    );
  }
  if (s === "MATCHING_REVIEW") {
    return (
      <Badge variant="amber">
        <Filter size={14} /> Matching Review
      </Badge>
    );
  }

  return null;
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

export default function MyCasesSection({ onOpenCase }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterValue>("All");

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
          const txt = await res.text();
          throw new Error(txt || `Failed to load cases (${res.status})`);
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
        if (alive) setError(e?.message || "Failed to load cases");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadCasesAndMeetings();
    return () => {
      alive = false;
    };
  }, [CASES_URL, APPROVED_MEETINGS_URL, reloadTick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => (filter === "All" ? true : c.status === filter))
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

  const onCardKeyDown = (e: React.KeyboardEvent, c: CaseSummary) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(c);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">My Cases</h1>
          <p className="text-sm text-slate-600 mt-2">
            Voucher + Approved Meeting details are visible here. Court/Hearing is placeholder for now.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
            title="Calendar (placeholder)"
          >
            <CalendarDays size={16} className="text-[#004aad]" />
            Calendar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
            title="Alerts (placeholder)"
          >
            <Bell size={16} className="text-[#004aad]" />
            Alerts
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
          Loading cases...
        </div>
      )}

      {!loading && error && (
        <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm text-red-700 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
              <Search size={16} className="text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by Case ID, Title, Client, Advocate..."
                className="bg-transparent outline-none w-full text-sm text-slate-800"
              />
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold">
              <Filter size={16} className="text-[#004aad]" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterValue)}
                className="outline-none bg-transparent"
              >
                <option value="All">All</option>
                <option value="Ongoing">Ongoing</option>
                <option value="Pending">Pending</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {filtered.map((c) => {
              const meeting = c.nextMeeting;
              const voucher = c.payments;

              const voucherPdf = toAbsoluteUrlMaybe(voucher.voucherPdfUrl);
              const showVoucherDetails =
                voucher.voucherStatus !== "NOT_GENERATED" ||
                Boolean(voucher.voucherId) ||
                Boolean(voucher.amount) ||
                Boolean(voucher.dueDate) ||
                Boolean(voucherPdf);

              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(c)}
                  onKeyDown={(e) => onCardKeyDown(e, c)}
                  className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-[#004aad]/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">{c.id}</div>
                      <div className="text-lg font-bold text-slate-900 mt-1 truncate">{c.title}</div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {statusBadge(c.status)}
                        {lifecycleBadge(c.lifecycleStatus)}
                        {paymentBadge(voucher.voucherStatus, Boolean(voucherPdf))}
                        {meetingBadge(meeting)}
                      </div>
                    </div>
                    <ChevronRight className="text-slate-300 mt-1" />
                  </div>

                  <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <User size={14} className="text-[#004aad]" /> Client
                      </div>
                      <div className="text-slate-800 mt-1">{c.client.name}</div>
                      <div className="text-xs text-slate-600">{c.client.city || "—"}</div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <Briefcase size={14} className="text-[#004aad]" /> Advocate
                      </div>
                      <div className="text-slate-800 mt-1">
                        {c.advocate.assigned ? c.advocate.name : "Not assigned"}
                      </div>
                      <div className="text-xs text-slate-600">{c.advocate.assigned ? "Assigned" : "Admin will assign"}</div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 bg-white">
                      <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <Gavel size={14} className="text-[#004aad]" /> Court / Hearing
                      </div>
                      <div className="text-slate-800 mt-1">—</div>
                      <div className="text-xs text-slate-600">Will appear here later (backend pending)</div>
                    </div>

                    {/* Voucher Details (with PDF open link when available) */}
                    <div className="rounded-xl border border-slate-200 p-3 bg-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-slate-700 font-semibold">
                          <CreditCard size={14} className="text-[#004aad]" /> Voucher
                        </div>

                        {voucherPdf ? (
                          <a
                            href={voucherPdf}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white text-xs font-semibold hover:bg-[#003b82] transition"
                            title="Open Voucher PDF"
                          >
                            <FileText size={14} />
                            Open PDF
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </div>

                      <div className="text-slate-800 mt-2">
                        {showVoucherDetails ? (voucher.voucherId ? `#${voucher.voucherId}` : "—") : "—"}
                      </div>

                      <div className="text-xs text-slate-600 mt-1">
                        {voucher.amount ? `${money(voucher.amount)} • ` : ""}
                        Due: {voucher.dueDate ? fmtDate(voucher.dueDate) : "—"}
                      </div>

                      <div className="text-xs text-slate-600 mt-2">
                        {voucher.voucherStatus === "NOT_GENERATED" && "Voucher not generated yet."}
                        {voucher.voucherStatus === "GENERATED" &&
                          (voucherPdf ? "Voucher PDF is ready." : "Voucher generated. PDF will appear when uploaded.")}
                        {voucher.voucherStatus === "VERIFIED" && (voucherPdf ? "Payment verified. Voucher PDF available." : "Payment verified.")}
                        {voucher.voucherStatus === "REJECTED" && "Voucher was rejected. Please contact admin/support."}
                      </div>

                      {voucherPdf ? (
                        <div className="mt-2">
                          <a
                            href={voucherPdf}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-[#004aad] hover:underline break-all"
                          >
                            {voucherPdf}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                          <Video size={14} className="text-[#004aad]" />
                          Approved Meeting
                        </div>
                        <div className="text-sm text-slate-900 mt-1 font-semibold">
                          {meeting ? (
                            <>
                              {meeting.mode} • {fmtDate(meeting.start_at)} • {fmtTime(meeting.start_at)}
                            </>
                          ) : (
                            "No approved meeting yet."
                          )}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          {meeting?.link ? "Link is ready. You can join at meeting time." : "Admin will approve and add link."}
                        </div>
                      </div>

                      {meeting?.link ? (
                        <a
                          href={meeting.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white text-xs font-semibold hover:bg-[#003b82] transition"
                          title="Open Google Meet"
                        >
                          <ExternalLink size={14} />
                          Open
                        </a>
                      ) : null}
                    </div>

                    {meeting?.link ? (
                      <div className="mt-3">
                        <a
                          href={meeting.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-[#004aad] hover:underline break-all"
                        >
                          {meeting.link}
                        </a>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-slate-500">
                      Alerts: <span className="text-slate-700 font-semibold">{c.alertsCount ?? 0}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {canDeleteCase(c) ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCase(c);
                          }}
                          disabled={deletingCaseId === c.id}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 transition text-xs font-semibold text-rose-800 disabled:opacity-60"
                        >
                          <Trash2 size={14} />
                          {deletingCaseId === c.id ? "Deleting..." : "Delete"}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(c);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-xs font-semibold"
                      >
                        View Details
                        <ChevronRight size={16} className="text-slate-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
              No cases match your search/filter.
            </div>
          )}
        </>
      )}
      {dialogs}
    </section>
  );
}
