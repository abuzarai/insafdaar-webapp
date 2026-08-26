import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  ChevronRight,
  X,
  CalendarDays,
  MessageSquareText,
  Send,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Link as LinkIcon,
} from "lucide-react";

import { API_BASE_URL } from "../../config";

/* ================= Types ================= */

type DBCaseStatus = string;

type AssignedCase = {
  id: string;
  title: string;
  status: DBCaseStatus;
};

type MeetingRequestBody = {
  start_at: string; // ISO
  end_at: string; // ISO
  agenda?: string;
};

type ApprovedMeetingRow = {
  id: number;
  case_id: number;
  case_title?: string | null;
  agenda?: string | null;
  start_at: string;
  end_at: string;
  status: string;
  google_meet_link?: string | null;
};

/* ================= Helpers ================= */

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!ct.includes("application/json")) {
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${text.slice(0, 120)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function normalizeStatus(s: DBCaseStatus) {
  const v = (s || "").toString().trim().toUpperCase();
  if (v === "ADVOCATE_ASSIGNED") return "Awaiting Advocate Decision";
  if (v === "MATCHING_REVIEW") return "Matching Review";
  if (v === "MEETING_PENDING_ADMIN") return "Meeting Pending Admin";
  if (v === "MEETING_APPROVED") return "Meeting Approved";
  if (v === "CONTRACT_PENDING_SIGNATURES") return "Contract Signatures Pending";
  if (v === "CONTRACT_PENDING_ADMIN_APPROVAL") return "Contract Under Admin Review";
  if (v === "CASE_ACTIVE") return "Case Active";
  if (v === "ACCEPTED") return "Accepted";
  if (v === "REJECTED") return "Rejected";
  if (v === "UNDER_REVIEW" || v === "UNDER REVIEW") return "Under Review";
  if (v === "NEW") return "New";
  return s || "—";
}

function formatLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoFromLocalInput(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmtPKT(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
  } catch {
    return iso;
  }
}

/* ================= UI bits ================= */

function Pill({
  children,
  variant = "gray",
}: {
  children: React.ReactNode;
  variant?: "gray" | "blue" | "amber" | "green" | "red";
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
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${styles}`}>
      {children}
    </span>
  );
}

function Toast({ msg, type }: { msg: string; type: "ok" | "err" }) {
  return (
    <div
      className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold ${
        type === "ok"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-red-50 border-red-200 text-red-800"
      }`}
    >
      {msg}
    </div>
  );
}

/* ================= Component ================= */

export default function CaseDiscussion() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [approvedMeetings, setApprovedMeetings] = useState<ApprovedMeetingRow[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED">("All");

  const [selectedCase, setSelectedCase] = useState<AssignedCase | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [startLocal, setStartLocal] = useState(formatLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [endLocal, setEndLocal] = useState(formatLocalInputValue(new Date(Date.now() + 90 * 60 * 1000)));
  const [agenda, setAgenda] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  const ADV_CASES_BASE = `${API_BASE_URL}/api/advocate/dashboard/cases`;
  const ADV_DISCUSS_BASE = `${API_BASE_URL}/api/advocate/dashboard/case-discussion`;

  const fetchAssigned = async () => {
    setListLoading(true);
    try {
      const res = await fetch(`${ADV_CASES_BASE}/assigned`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<{ cases?: AssignedCase[]; error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to fetch cases");
      setCases(Array.isArray(data?.cases) ? data.cases : []);
    } catch (e: any) {
      setCases([]);
      setToast({ msg: e?.message || "Failed to load cases.", type: "err" });
    } finally {
      setListLoading(false);
    }
  };

  const fetchApprovedMeetings = async () => {
    setMeetingsLoading(true);
    try {
      const res = await fetch(`${ADV_DISCUSS_BASE}/meetings?status=APPROVED`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<{ meetings?: ApprovedMeetingRow[]; error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to load approved meetings");
      setApprovedMeetings(Array.isArray(data?.meetings) ? data.meetings : []);
    } catch (e: any) {
      setApprovedMeetings([]);
      setToast({ msg: e?.message || "Failed to load approved meetings.", type: "err" });
    } finally {
      setMeetingsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssigned();
    fetchApprovedMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => {
        if (filter === "All") return true;
        return (c.status || "").toString().trim().toUpperCase() === filter;
      })
      .filter((c) => {
        if (!q) return true;
        return c.id.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q);
      });
  }, [cases, filter, query]);

  const openCase = (c: AssignedCase) => {
    setSelectedCase(c);
    setShowForm(false);
    setAgenda("");
    setToast(null);
  };

  const closePanel = () => {
    setSelectedCase(null);
    setShowForm(false);
  };

  const submitRequest = async () => {
    if (!selectedCase) return;

    const startIso = toIsoFromLocalInput(startLocal);
    const endIso = toIsoFromLocalInput(endLocal);

    if (!startIso || !endIso) {
      setToast({ msg: "Please select valid start and end date/time.", type: "err" });
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      setToast({ msg: "End time must be after start time.", type: "err" });
      return;
    }

    setSubmitting(true);
    try {
      const body: MeetingRequestBody = {
        start_at: startIso,
        end_at: endIso,
        agenda: agenda.trim() ? agenda.trim() : undefined,
      };

      const res = await fetch(`${ADV_DISCUSS_BASE}/${selectedCase.id}/request-meeting`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to send meeting request.");

      setToast({ msg: "Request sent to admin. Please wait for approval.", type: "ok" });
      setShowForm(false);
      setAgenda("");

      // refresh approved list (in case admin already approved quickly)
      fetchApprovedMeetings();
    } catch (e: any) {
      setToast({ msg: e?.message || "Error sending request.", type: "err" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]"
          >
            <Toast msg={toast.msg} type={toast.type} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Case Discussion</h1>
          <p className="text-sm text-slate-600 mt-2">
            This section is only for meeting scheduling. Advocate requests a meeting — Admin schedules and approves.
          </p>
        </div>

        <Pill variant="blue">
          <CheckCircle2 size={14} /> {listLoading ? "Loading..." : `${cases.length} assigned cases`}
        </Pill>
      </div>

      {/* Approved meetings list */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-bold text-slate-900">Approved Meetings</div>
            <div className="text-sm text-slate-600 mt-1">
              Your approved meetings with Meet links (PKT time).
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Pill variant="green">
              <LinkIcon size={14} /> {meetingsLoading ? "Loading..." : `${approvedMeetings.length} approved`}
            </Pill>

            <button
              type="button"
              onClick={fetchApprovedMeetings}
              disabled={meetingsLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
            >
              <RefreshCw size={16} className={meetingsLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!meetingsLoading && approvedMeetings.length === 0 ? (
            <div className="text-sm text-slate-700">No approved meetings yet.</div>
          ) : (
            approvedMeetings.map((m) => (
              <div key={m.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Meeting #{m.id}</div>
                    <div className="text-sm font-bold text-slate-900 mt-1 truncate">
                      Case #{m.case_id}{m.case_title ? ` — ${m.case_title}` : ""}
                    </div>

                    <div className="mt-2 text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={16} className="text-slate-500" />
                        <span className="font-semibold">Start:</span>
                        <span>{fmtPKT(m.start_at)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <CalendarDays size={16} className="text-slate-500 opacity-0" />
                        <span className="font-semibold">End:</span>
                        <span>{fmtPKT(m.end_at)}</span>
                      </div>
                    </div>

                    {m.agenda ? (
                      <div className="text-sm text-slate-700 mt-2">
                        <span className="font-semibold">Agenda:</span> {m.agenda}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <Pill variant="green">{String(m.status || "APPROVED")}</Pill>

                    {m.google_meet_link ? (
                      <a
                        href={m.google_meet_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl font-semibold bg-[#004aad] text-white hover:bg-[#003b82] transition"
                      >
                        <ExternalLink size={16} />
                        Join Meet
                      </a>
                    ) : (
                      <div className="text-xs text-slate-500">Meet link not available</div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Search + filter */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
          <Search size={16} className="text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by case id or title..."
            className="bg-transparent outline-none w-full text-sm text-slate-800"
          />
          {query ? (
            <button
              type="button"
              className="p-1 rounded-lg hover:bg-slate-200/60 transition"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={16} className="text-slate-600" />
            </button>
          ) : null}
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold">
          <Filter size={16} className="text-[#004aad]" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="outline-none bg-transparent">
            <option value="All">All</option>
            <option value="NEW">New</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid lg:grid-cols-12 gap-4">
        {/* Left: case list */}
        <div className="lg:col-span-6 space-y-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => openCase(c)}
              className={`w-full text-left bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition
                ${selectedCase?.id === c.id ? "border-[#004aad] ring-2 ring-[#004aad]/15" : "border-slate-200 hover:border-slate-300"}
              `}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">{c.id}</div>
                  <div className="text-lg font-bold text-slate-900 mt-1 truncate">{c.title}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Pill variant="gray">
                      <MessageSquareText size={14} /> {normalizeStatus(c.status)}
                    </Pill>
                  </div>
                </div>
                <ChevronRight className="text-slate-300" />
              </div>
            </button>
          ))}

          {!listLoading && filtered.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
              No cases match your search/filter.
            </div>
          )}
        </div>

        {/* Right: request panel */}
        <div className="lg:col-span-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            {!selectedCase ? (
              <div className="text-slate-700">
                <div className="text-lg font-bold">Select a case</div>
                <p className="text-sm text-slate-600 mt-2">Choose a case from the list to request a meeting.</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Selected Case</div>
                    <div className="text-lg font-bold text-slate-900 mt-1 truncate">{selectedCase.title}</div>
                    <div className="text-xs text-slate-500 mt-1">Case ID: {selectedCase.id}</div>
                  </div>
                  <button
                    type="button"
                    onClick={closePanel}
                    className="p-2 rounded-xl hover:bg-slate-100 transition"
                    title="Close"
                  >
                    <X size={18} className="text-slate-700" />
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {!showForm ? (
                    <>
                      <div className="text-sm font-bold text-slate-900">Start meeting request</div>
                      <p className="text-sm text-slate-600 mt-2">
                        Please click <span className="font-semibold">Confirm</span> to request a meeting for this case client.
                      </p>

                      <button
                        type="button"
                        onClick={() => {
                          setShowForm(true);
                          setToast(null);
                        }}
                        className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold bg-[#004aad] text-white hover:bg-[#003b82] transition w-full"
                      >
                        <CheckCircle2 size={18} />
                        Confirm
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-bold text-slate-900">Meeting Request Form</div>
                      <p className="text-sm text-slate-600 mt-2">Admin will schedule the Google Meet and approve it.</p>

                      <div className="mt-4 space-y-3">
                        <label className="block">
                          <div className="text-xs font-semibold text-slate-700 mb-1">Start Time</div>
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <CalendarDays size={16} className="text-[#004aad]" />
                            <input
                              type="datetime-local"
                              className="w-full outline-none text-sm"
                              value={startLocal}
                              onChange={(e) => setStartLocal(e.target.value)}
                            />
                          </div>
                        </label>

                        <label className="block">
                          <div className="text-xs font-semibold text-slate-700 mb-1">End Time</div>
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <CalendarDays size={16} className="text-[#004aad]" />
                            <input
                              type="datetime-local"
                              className="w-full outline-none text-sm"
                              value={endLocal}
                              onChange={(e) => setEndLocal(e.target.value)}
                            />
                          </div>
                        </label>

                        <label className="block">
                          <div className="text-xs font-semibold text-slate-700 mb-1">Agenda (optional)</div>
                          <textarea
                            value={agenda}
                            onChange={(e) => setAgenda(e.target.value)}
                            rows={4}
                            placeholder="Write short agenda for admin + client..."
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                          />
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
                            disabled={submitting}
                          >
                            Back
                          </button>

                          <button
                            type="button"
                            onClick={submitRequest}
                            disabled={submitting}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold transition ${
                              submitting
                                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                                : "bg-[#004aad] text-white hover:bg-[#003b82]"
                            }`}
                          >
                            <Send size={18} />
                            {submitting ? "Sending..." : "Send to Admin"}
                          </button>
                        </div>

                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <AlertTriangle size={14} className="text-amber-500" />
                          Meeting will be created and shared by admin after approval.
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
