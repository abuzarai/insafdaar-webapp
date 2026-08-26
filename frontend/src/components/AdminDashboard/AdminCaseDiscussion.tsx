import { formatStatus } from "../common/formatStatus";
import { isErrorMessage } from "../common/messageTone";
import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../config";
import {
  Search,
  Filter,
  CalendarDays,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  RefreshCw,
} from "lucide-react";

/* ================= Types ================= */

type MeetingStatus =
  | "PENDING_ADMIN"
  | "APPROVED"
  | "CANCELLED"
  | "REJECTED"
  | string;

type AdminMeetingRow = {
  id: number;
  case_id: number;
  client_user_id: number;
  advocate_id: number;

  agenda: string | null;
  start_at: string;
  end_at: string;
  status: MeetingStatus;

  admin_note: string | null;

  google_event_id: string | null;
  google_meet_link: string | null;

  created_at: string;
  updated_at: string;
  approved_at: string | null;

  // optional extra fields if you add in backend join:
  client_email?: string | null;
  advocate_email?: string | null;
  client_name?: string | null;
  advocate_name?: string | null;
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
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON but got "${contentType}". Response starts: ${text.slice(0, 120)}`
    );
  }
  return (text ? JSON.parse(text) : null) as T;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "green" | "red";
}) {
  const styles =
    tone === "green"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : tone === "red"
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : tone === "amber"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : tone === "blue"
      ? "bg-indigo-50 text-indigo-800 border-indigo-200"
      : "bg-slate-50 text-slate-800 border-slate-200";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border",
        styles
      )}
    >
      {children}
    </span>
  );
}

function statusTone(s: string): "gray" | "blue" | "amber" | "green" | "red" {
  const v = (s || "").toUpperCase();
  if (v === "PENDING_ADMIN") return "amber";
  if (v === "APPROVED") return "green";
  if (v === "CANCELLED") return "gray";
  if (v === "REJECTED") return "red";
  return "blue";
}

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ================= Component ================= */

export default function AdminCaseDiscussion({
  onActionComplete,
}: {
  onActionComplete?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AdminMeetingRow[]>([]);
  const [msg, setMsg] = useState<string>("");

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<
    "All" | "PENDING_ADMIN" | "APPROVED" | "REJECTED"
  >("PENDING_ADMIN");

  const [selected, setSelected] = useState<AdminMeetingRow | null>(null);

  // approve/reject form
  const [meetLink, setMeetLink] = useState("");
  const [googleEventId, setGoogleEventId] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const ADMIN_BASE = `${API_BASE_URL}/api/admin/case-discussion`;

  const loadMeetings = async () => {
    try {
      setLoading(true);
      setMsg("");

      // ✅ BACKEND ROUTES:
      // GET /api/admin/case-discussion/meeting-requests?status=PENDING_ADMIN
      const url =
        filter === "All"
          ? `${ADMIN_BASE}/meeting-requests`
          : `${ADMIN_BASE}/meeting-requests?status=${encodeURIComponent(filter)}`;

      const res = await fetch(url, { headers: authHeaders() });
      const data = await safeJson<any>(res);

      if (!res.ok) throw new Error(data?.error || "Failed to load meetings");

      setRows(Array.isArray(data?.meetings) ? data.meetings : []);
    } catch (e: any) {
      setRows([]);
      setMsg(`${e?.message || "Failed to load meetings"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((r) => {
      const parts = [
        String(r.id),
        String(r.case_id),
        r.agenda || "",
        r.client_email || "",
        r.advocate_email || "",
        r.client_name || "",
        r.advocate_name || "",
        r.status || "",
      ]
        .join(" ")
        .toLowerCase();

      return parts.includes(needle);
    });
  }, [rows, q]);

  const openRow = (r: AdminMeetingRow) => {
    setSelected(r);
    setMeetLink(r.google_meet_link || "");
    setGoogleEventId(r.google_event_id || "");
    setAdminNote("");
    setMsg("");
  };

  const closeModal = () => setSelected(null);

  const approve = async () => {
    if (!selected) return;

    if (!meetLink.trim()) {
      setMsg("Google Meet link is required to approve.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      // ✅ BACKEND ROUTE:
      // PATCH /api/admin/case-discussion/meeting-requests/:meetingId/approve
      const res = await fetch(
        `${ADMIN_BASE}/meeting-requests/${selected.id}/approve`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({
            google_meet_link: meetLink.trim(),
            google_event_id: googleEventId.trim()
              ? googleEventId.trim()
              : null,
            admin_note: adminNote.trim() ? adminNote.trim() : null,
          }),
        }
      );

      const data = await safeJson<any>(res);
      if (!res.ok) throw new Error(data?.error || "Approve failed");

      setMsg("Meeting approved & saved.");
      closeModal();
      await loadMeetings();
      onActionComplete?.();
    } catch (e: any) {
      setMsg(`${e?.message || "Approve failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const reject = async () => {
    if (!selected) return;

    const reason = adminNote.trim() || "Rejected by admin.";
    try {
      setLoading(true);
      setMsg("");

      // ✅ BACKEND ROUTE:
      // PATCH /api/admin/case-discussion/meeting-requests/:meetingId/reject
      const res = await fetch(
        `${ADMIN_BASE}/meeting-requests/${selected.id}/reject`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ admin_note: reason }),
        }
      );

      const data = await safeJson<any>(res);
      if (!res.ok) throw new Error(data?.error || "Reject failed");

      setMsg("Meeting rejected.");
      closeModal();
      await loadMeetings();
      onActionComplete?.();
    } catch (e: any) {
      setMsg(`${e?.message || "Reject failed"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
          <Search size={16} className="text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search meeting id, case id, agenda, emails..."
            className="bg-transparent outline-none w-full text-sm text-slate-800"
          />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold">
          <Filter size={16} className="text-slate-700" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="outline-none bg-transparent"
          >
            <option value="All">All</option>
            <option value="PENDING_ADMIN">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        <button
          onClick={loadMeetings}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {msg ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm font-semibold",
            isErrorMessage(msg)
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900"
          )}
        >
          {msg}
        </div>
      ) : null}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">Meeting Requests</div>
            <div className="text-xs text-slate-500 mt-1">
              Showing{" "}
              <span className="font-semibold text-slate-900">
                {filtered.length}
              </span>{" "}
              meeting(s)
            </div>
          </div>
          <Badge tone="blue">{filter}</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold">Meeting</th>
                <th className="text-left px-4 py-3 font-semibold">Case</th>
                <th className="text-left px-4 py-3 font-semibold">Time</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-4">
                      <div className="h-4 bg-slate-200 rounded w-24" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 bg-slate-200 rounded w-24" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 bg-slate-200 rounded w-56" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 bg-slate-200 rounded w-24" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-8 bg-slate-200 rounded w-24 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-slate-700">
                    No meeting requests found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-4 font-bold text-slate-900">
                      #{r.id}
                    </td>
                    <td className="px-4 py-4 text-slate-900 font-semibold">
                      {r.case_id}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      <div className="inline-flex items-center gap-2">
                        <CalendarDays size={16} className="text-slate-500" />
                        <span>
                          {fmt(r.start_at)} → {fmt(r.end_at)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={statusTone(r.status)}>{formatStatus(r.status)}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => openRow(r)}
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 transition"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="font-extrabold text-slate-900">
                  Meeting #{selected.id} • Case {selected.case_id}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {fmt(selected.start_at)} → {fmt(selected.end_at)} •{" "}
                  <Badge tone={statusTone(selected.status)}>
                    {formatStatus(selected.status)}
                  </Badge>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selected.agenda ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-700">Agenda</div>
                  <div className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">
                    {selected.agenda}
                  </div>
                </div>
              ) : null}

              {/* Meet link input */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  Google Meet Link (required)
                </div>
                <div className="flex gap-2">
                  <input
                    value={meetLink}
                    onChange={(e) => setMeetLink(e.target.value)}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                    title="Copy"
                    onClick={() => {
                      const ok = copyToClipboard(meetLink || "");
                      setMsg(ok ? "Copied meet link" : "Could not copy");
                    }}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                    title="Open"
                    onClick={() =>
                      meetLink &&
                      window.open(meetLink, "_blank", "noopener,noreferrer")
                    }
                    disabled={!meetLink}
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>
              </div>

              {/* Optional Google calendar event id */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  Google Calendar Event ID (optional)
                </div>
                <input
                  value={googleEventId}
                  onChange={(e) => setGoogleEventId(e.target.value)}
                  placeholder="eventId from calendar (optional)"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {/* Admin note */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  Admin Note (optional / or rejection reason)
                </div>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={4}
                  placeholder="Write note to store in DB (optional)"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={reject}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100 transition disabled:opacity-60"
                >
                  <XCircle size={16} />
                  Reject
                </button>

                <button
                  type="button"
                  onClick={approve}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 transition disabled:opacity-60"
                >
                  <CheckCircle2 size={16} />
                  Approve
                </button>
              </div>

              <div className="text-xs text-slate-500">
                NOTE: Email notifications to client/advocate after approve will
                be handled in backend later (your plan).
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
