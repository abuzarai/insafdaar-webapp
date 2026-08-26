import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gavel,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Users,
  XCircle,
  AlertTriangle,
} from "lucide-react";

import { API_BASE_URL } from "../../config";

/* =========================
   API ROUTES (edit here only)
========================= */

const ADV_BASE = `${API_BASE_URL}/api/advocate/dashboard`;

const ROUTES = {
  // ✅ GET /api/advocate/dashboard/hearings/cases
  casesAssigned: `${ADV_BASE}/hearings/cases`,

  // ✅ GET /api/advocate/dashboard/hearings/cases/:caseId
  hearingsByCase: (caseId: number) => `${ADV_BASE}/hearings/cases/${caseId}`,

  // ✅ POST /api/advocate/dashboard/hearings/cases/:caseId
  createHearing: (caseId: number) => `${ADV_BASE}/hearings/cases/${caseId}`,

  // ✅ PATCH /api/advocate/dashboard/hearings/:hearingId/status
  updateStatus: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/status`,

  // ✅ PUT /api/advocate/dashboard/hearings/:hearingId/attendance
  saveAttendance: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/attendance`,

  // ✅ PUT /api/advocate/dashboard/hearings/:hearingId/proceedings
  saveProceedings: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/proceedings`,

  // ✅ Evidence
  addEvidence: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/evidence`,
  listEvidence: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/evidence`,

  // ✅ Drafts
  addDraft: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/drafts`,
  listDrafts: (hearingId: number) => `${ADV_BASE}/hearings/${hearingId}/drafts`,
};

/* =========================
   Types
========================= */

type AssignedCase = {
  id: string; // sometimes backend sends string
  title: string;
  status: string;
  created_at?: string;
};

type HearingRow = {
  id: number;
  case_id: number;
  advocate_id: number;
  hearing_at: string;
  court_name: string | null;
  courtroom: string | null;
  purpose: string | null;
  status: "SCHEDULED" | "HELD" | "ADJOURNED" | "CANCELLED" | string;
  created_at: string;
  updated_at: string;

  // joined fields from listCaseHearings
  client_present?: boolean | null;
  respondent_present?: boolean | null;
  client_note?: string | null;
  advocate_note?: string | null;
  court_statement?: string | null;
  outcome_summary?: string | null;
  next_hearing_at?: string | null;
};

type Attendance = {
  client_present: boolean | null;
  respondent_present: boolean | null;
  client_note: string | null;
  advocate_note: string | null;
};

type Proceedings = {
  court_statement: string;
  outcome_summary: string | null;
  next_hearing_at: string | null;
};

type EvidenceRow = {
  id: number;
  hearing_id: number;
  title: string;
  description: string | null;
  file_url: string | null;
  added_by: "ADVOCATE" | "CLIENT" | string;
  created_at: string;
};

type DraftRow = {
  id: number;
  hearing_id: number;
  draft_type: "PETITION" | "REPLY" | "APPLICATION" | "ARGUMENTS" | "OTHER" | string;
  content: string;
  file_url: string | null;
  created_at: string;
  updated_at: string;
};

type HearingDetailsResponse = {
  hearing: HearingRow;
  attendance: Attendance | null;
  proceedings: Proceedings | null;
  evidence: EvidenceRow[];
  drafts: DraftRow[];
};

type ApiError = { error?: string; message?: string; ok?: boolean };

/* =========================
   Helpers
========================= */

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("token");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!ct.includes("application/json")) {
    // backend might send HTML error page if route mismatch
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${text.slice(0, 160)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function apiMsg(d: any, fallback: string) {
  return d?.message || d?.error || fallback;
}

function getCaseNotActiveStatus(d: any): string | null {
  if (String(d?.error || "").toUpperCase() !== "CASE_NOT_ACTIVE") return null;
  return d?.currentStatus ? String(d.currentStatus) : null;
}

function prettyLifecycleStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (!s) return "Unknown";
  if (s === "CONTRACT_PENDING_SIGNATURES") return "Contract signatures pending";
  if (s === "CONTRACT_PENDING_ADMIN_APPROVAL") return "Contract under admin approval";
  if (s === "MEETING_APPROVED") return "Meeting approved";
  if (s === "MEETING_PENDING_ADMIN") return "Meeting pending admin approval";
  if (s === "ACCEPTED") return "Advocate accepted";
  return s.replace(/_/g, " ").toLowerCase();
}

function fmtDT(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return x;
  return d.toLocaleString();
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* =========================
   Small UI atoms
========================= */

function Badge({
  variant,
  children,
}: {
  variant: "blue" | "green" | "gray" | "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    variant === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : variant === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : variant === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : variant === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${cls}`}>
      {children}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/* =========================
   Component
========================= */

export default function CaseHearingSection() {
  // Cases
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);

  // Selected case + hearings
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [hearings, setHearings] = useState<HearingRow[]>([]);
  const [hearingsLoading, setHearingsLoading] = useState(false);

  // Selected hearing details
  const [selectedHearingId, setSelectedHearingId] = useState<number | null>(null);
  const [details, setDetails] = useState<HearingDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Errors
  const [error, setError] = useState<string>("");
  const [blockedStatus, setBlockedStatus] = useState<string | null>(null);

  // Create hearing form
  const [newHearingAt, setNewHearingAt] = useState<string>("");
  const [newCourtName, setNewCourtName] = useState<string>("");
  const [newCourtroom, setNewCourtroom] = useState<string>("");
  const [newPurpose, setNewPurpose] = useState<string>("");

  // Attendance form
  const [clientPresent, setClientPresent] = useState<boolean>(false);
  const [respondentPresent, setRespondentPresent] = useState<boolean>(false);
  const [clientNote, setClientNote] = useState<string>("");
  const [advocateNote, setAdvocateNote] = useState<string>("");

  // Proceedings form
  const [courtStatement, setCourtStatement] = useState<string>("");
  const [outcomeSummary, setOutcomeSummary] = useState<string>("");
  const [nextHearingAt, setNextHearingAt] = useState<string>("");

  // Evidence form
  const [evTitle, setEvTitle] = useState<string>("");
  const [evDesc, setEvDesc] = useState<string>("");

  // Draft form
  const [draftType, setDraftType] = useState<string>("APPLICATION");
  const [draftContent, setDraftContent] = useState<string>("");

  // Status change
  const [statusUpdating, setStatusUpdating] = useState(false);

  /* =========================
     Fetchers
  ========================= */

  const fetchCases = async () => {
    setCasesLoading(true);
    setError("");
    try {
      const res = await fetch(ROUTES.casesAssigned, { method: "GET", headers: authHeaders() });
      const data = await safeJson<{ ok?: boolean; cases?: AssignedCase[] } & ApiError>(res);

      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to load cases."));
      }

      const list = Array.isArray(data?.cases) ? data.cases : [];
      setCases(list);
      setBlockedStatus(null);

      // auto select first case if none selected
      const firstId = toInt(list?.[0]?.id);
      setSelectedCaseId((prev) => prev ?? firstId);
    } catch (e: any) {
      setCases([]);
      setSelectedCaseId(null);
      setError(e?.message || "Failed to load cases.");
    } finally {
      setCasesLoading(false);
    }
  };

  const fetchHearings = async (caseId: number) => {
    setHearingsLoading(true);
    setError("");
    try {
      const res = await fetch(ROUTES.hearingsByCase(caseId), { method: "GET", headers: authHeaders() });

      // backend: { ok:true, case: {...}, hearings: [...] }
      const data = await safeJson<{ ok?: boolean; case?: any; hearings?: HearingRow[] } & ApiError>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to load hearings."));
      }

      const list = Array.isArray(data?.hearings) ? data.hearings : [];
      setHearings(list);
      setBlockedStatus(null);

      if (list.length) setSelectedHearingId((prev) => prev ?? list[0].id);
      else {
        setSelectedHearingId(null);
        setDetails(null);
      }
    } catch (e: any) {
      setHearings([]);
      setSelectedHearingId(null);
      setDetails(null);
      setError(e?.message || "Failed to load hearings.");
    } finally {
      setHearingsLoading(false);
    }
  };

  const fetchHearingDetails = async (hearingId: number) => {
    setDetailsLoading(true);
    setError("");
    try {
      // 1) hearing + attendance/proceedings are already in hearings list (joined by backend)
      const h = hearings.find((x) => x.id === hearingId);
      if (!h) throw new Error("Selected hearing not found in list. Refresh hearings.");

      const attendance: Attendance | null =
        typeof h.client_present === "boolean" ||
        typeof h.respondent_present === "boolean" ||
        h.client_note != null ||
        h.advocate_note != null
          ? {
              client_present: typeof h.client_present === "boolean" ? h.client_present : null,
              respondent_present: typeof h.respondent_present === "boolean" ? h.respondent_present : null,
              client_note: h.client_note ?? null,
              advocate_note: h.advocate_note ?? null,
            }
          : null;

      const proceedings: Proceedings | null =
        (h.court_statement && h.court_statement.trim()) || h.outcome_summary != null || h.next_hearing_at != null
          ? {
              court_statement: (h.court_statement || "").trim(),
              outcome_summary: h.outcome_summary ?? null,
              next_hearing_at: h.next_hearing_at ?? null,
            }
          : null;

      // 2) evidence + drafts endpoints
      const [evRes, drRes] = await Promise.all([
        fetch(ROUTES.listEvidence(hearingId), { method: "GET", headers: authHeaders() }),
        fetch(ROUTES.listDrafts(hearingId), { method: "GET", headers: authHeaders() }),
      ]);

      const evData = await safeJson<{ ok?: boolean; evidence?: EvidenceRow[] } & ApiError>(evRes);
      if (!evRes.ok) {
        const blocked = getCaseNotActiveStatus(evData);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(evData, "Failed to load evidence."));
      }

      const drData = await safeJson<{ ok?: boolean; drafts?: DraftRow[] } & ApiError>(drRes);
      if (!drRes.ok) {
        const blocked = getCaseNotActiveStatus(drData);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(drData, "Failed to load drafts."));
      }

      const packed: HearingDetailsResponse = {
        hearing: h,
        attendance,
        proceedings,
        evidence: Array.isArray(evData?.evidence) ? evData.evidence : [],
        drafts: Array.isArray(drData?.drafts) ? drData.drafts : [],
      };

      setDetails(packed);
      setBlockedStatus(null);

      // hydrate forms
      setClientPresent(Boolean(attendance?.client_present));
      setRespondentPresent(Boolean(attendance?.respondent_present));
      setClientNote(attendance?.client_note || "");
      setAdvocateNote(attendance?.advocate_note || "");

      setCourtStatement(proceedings?.court_statement || "");
      setOutcomeSummary(proceedings?.outcome_summary || "");
      setNextHearingAt(proceedings?.next_hearing_at ? toLocalInput(proceedings.next_hearing_at) : "");

      // reset add forms
      setEvTitle("");
      setEvDesc("");
      setDraftContent("");
    } catch (e: any) {
      setDetails(null);
      setError(e?.message || "Failed to load hearing details.");
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    fetchHearings(selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  useEffect(() => {
    if (!selectedHearingId) return;
    fetchHearingDetails(selectedHearingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHearingId, hearings]);

  /* =========================
     Actions
  ========================= */

  const createHearing = async () => {
    if (!selectedCaseId) return setError("Select a case first.");
    if (!newHearingAt) return setError("Select hearing date/time.");

    setError("");
    try {
      const res = await fetch(ROUTES.createHearing(selectedCaseId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          hearing_at: new Date(newHearingAt).toISOString(),
          court_name: newCourtName.trim() || null,
          courtroom: newCourtroom.trim() || null,
          purpose: newPurpose.trim() || null,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to create hearing."));
      }

      setNewHearingAt("");
      setNewCourtName("");
      setNewCourtroom("");
      setNewPurpose("");
      await fetchHearings(selectedCaseId);
    } catch (e: any) {
      setError(e?.message || "Failed to create hearing.");
    }
  };

  const saveAttendance = async () => {
    if (!selectedHearingId) return;
    setError("");
    try {
      const res = await fetch(ROUTES.saveAttendance(selectedHearingId), {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          client_present: clientPresent,
          respondent_present: respondentPresent,
          client_note: clientNote.trim() || null,
          advocate_note: advocateNote.trim() || null,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to save attendance."));
      }

      if (selectedCaseId) await fetchHearings(selectedCaseId);
      await fetchHearingDetails(selectedHearingId);
    } catch (e: any) {
      setError(e?.message || "Failed to save attendance.");
    }
  };

  const saveProceedings = async () => {
    if (!selectedHearingId) return;
    if (!courtStatement.trim()) return setError("Court statement is required.");

    setError("");
    try {
      const res = await fetch(ROUTES.saveProceedings(selectedHearingId), {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          court_statement: courtStatement.trim(),
          outcome_summary: outcomeSummary.trim() || null,
          next_hearing_at: nextHearingAt ? new Date(nextHearingAt).toISOString() : null,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to save proceedings."));
      }

      if (selectedCaseId) await fetchHearings(selectedCaseId);
      await fetchHearingDetails(selectedHearingId);
    } catch (e: any) {
      setError(e?.message || "Failed to save proceedings.");
    }
  };

  const addEvidence = async () => {
    if (!selectedHearingId) return;
    if (!evTitle.trim()) return setError("Evidence title is required.");

    setError("");
    try {
      const res = await fetch(ROUTES.addEvidence(selectedHearingId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: evTitle.trim(),
          description: evDesc.trim() || null,
          file_url: null,
          added_by: "ADVOCATE",
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to add evidence."));
      }

      setEvTitle("");
      setEvDesc("");
      await fetchHearingDetails(selectedHearingId);
    } catch (e: any) {
      setError(e?.message || "Failed to add evidence.");
    }
  };

  const addDraft = async () => {
    if (!selectedHearingId) return;
    if (!draftContent.trim()) return setError("Draft content is required.");

    setError("");
    try {
      const res = await fetch(ROUTES.addDraft(selectedHearingId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          draft_type: draftType,
          content: draftContent.trim(),
          file_url: null,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to add draft."));
      }

      setDraftContent("");
      await fetchHearingDetails(selectedHearingId);
    } catch (e: any) {
      setError(e?.message || "Failed to add draft.");
    }
  };

  const updateHearingStatus = async (nextStatus: string) => {
    if (!selectedHearingId) return;
    setStatusUpdating(true);
    setError("");
    try {
      const res = await fetch(ROUTES.updateStatus(selectedHearingId), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(apiMsg(data, "Failed to update hearing status."));
      }

      if (selectedCaseId) await fetchHearings(selectedCaseId);
      await fetchHearingDetails(selectedHearingId);
    } catch (e: any) {
      setError(e?.message || "Failed to update hearing status.");
    } finally {
      setStatusUpdating(false);
    }
  };

  /* =========================
     Derived
  ========================= */

  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return cases.find((c) => toInt(c.id) === selectedCaseId) || null;
  }, [cases, selectedCaseId]);

  const hearingStatusBadge = (s: string) => {
    const v = (s || "").toUpperCase();
    if (v === "SCHEDULED")
      return (
        <Badge variant="blue">
          <CalendarDays size={14} /> Scheduled
        </Badge>
      );
    if (v === "HELD")
      return (
        <Badge variant="green">
          <CheckCircle2 size={14} /> Held
        </Badge>
      );
    if (v === "ADJOURNED")
      return (
        <Badge variant="amber">
          <Gavel size={14} /> Adjourned
        </Badge>
      );
    if (v === "CANCELLED")
      return (
        <Badge variant="red">
          <ClipboardList size={14} /> Cancelled
        </Badge>
      );
    return <Badge variant="gray">{s}</Badge>;
  };

  /* =========================
     Render
  ========================= */

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Court Hearing</h1>
          <p className="text-sm text-slate-600 mt-2">
            Select a case → select a hearing → mark attendance, write proceedings, add evidence & drafts.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchCases}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
          title="Refresh cases"
        >
          <RefreshCw size={16} className={casesLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {blockedStatus && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 inline-flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5" />
          <span>
            Hearing workflow is locked until the case is active. Current status: <b>{prettyLifecycleStatus(blockedStatus)}</b>.
            Complete contract signatures and admin approval to continue.
          </span>
        </div>
      )}

      {/* Case selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
        <div className="text-sm font-semibold text-slate-800">Select Case:</div>

        <select
          value={selectedCaseId ?? ""}
          onChange={(e) => setSelectedCaseId(toInt(e.target.value))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none w-full md:w-[420px]"
          disabled={casesLoading || cases.length === 0}
        >
          {cases.length === 0 ? (
            <option value="">No cases</option>
          ) : (
            cases.map((c) => {
              const id = toInt(c.id);
              return (
                <option key={c.id} value={id ?? ""}>
                  #{c.id} — {c.title}
                </option>
              );
            })
          )}
        </select>

        <div className="ml-auto flex flex-wrap gap-2">
          <Badge variant="gray">
            <FileText size={14} /> {selectedCase ? `#${selectedCase.id}` : "—"}
          </Badge>
          <Badge variant="gray">
            <ClipboardList size={14} /> {hearingsLoading ? "Loading hearings..." : `${hearings.length} hearings`}
          </Badge>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid lg:grid-cols-12 gap-4">
        {/* Left: Hearings list + create */}
        <div className="lg:col-span-4 space-y-4">
          <Card title="Hearings (for selected case)">
            {hearingsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                Loading hearings...
              </div>
            ) : hearings.length === 0 ? (
              <div className="text-sm text-slate-600">No hearings found for this case.</div>
            ) : (
              <div className="space-y-2">
                {hearings.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedHearingId(h.id)}
                    className={`w-full text-left rounded-2xl border p-4 transition ${
                      selectedHearingId === h.id
                        ? "border-[#004aad] bg-blue-50/40"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">Hearing #{h.id}</div>
                        <div className="text-xs text-slate-500 mt-1">{fmtDT(h.hearing_at)}</div>
                        <div className="mt-2 flex flex-wrap gap-2">{hearingStatusBadge(h.status)}</div>
                      </div>

                      <div className="text-xs text-slate-500">{h.court_name ? h.court_name : "—"}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Schedule New Hearing">
            <div className="space-y-3">
              <div>
                <div className="text-xs text-slate-500">Hearing Date/Time</div>
                <input
                  type="datetime-local"
                  value={newHearingAt}
                  onChange={(e) => setNewHearingAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500">Court Name (optional)</div>
                  <input
                    value={newCourtName}
                    onChange={(e) => setNewCourtName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    placeholder="Example: Lahore High Court"
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Courtroom (optional)</div>
                  <input
                    value={newCourtroom}
                    onChange={(e) => setNewCourtroom(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    placeholder="Room / Bench"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Purpose (optional)</div>
                <input
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                  placeholder="Example: Evidence submission"
                />
              </div>

              <button
                type="button"
                onClick={createHearing}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm"
              >
                <Plus size={16} />
                Create Hearing
              </button>

              <div className="text-[11px] text-slate-500">
                Reminders will be emailed by cron job (24h & 6h) when hearing is scheduled.
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Hearing details */}
        <div className="lg:col-span-8 space-y-4">
          <Card title="Hearing Details">
            {!selectedHearingId ? (
              <div className="text-sm text-slate-600">Select a hearing to view details.</div>
            ) : detailsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                Loading hearing details...
              </div>
            ) : !details?.hearing ? (
              <div className="text-sm text-slate-600">No details available.</div>
            ) : (
              <div className="space-y-4">
                {/* Top summary */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">
                      Case #{details.hearing.case_id} — Hearing #{details.hearing.id}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{fmtDT(details.hearing.hearing_at)}</div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {hearingStatusBadge(details.hearing.status)}
                      {details.hearing.court_name ? (
                        <Badge variant="gray">
                          <Gavel size={14} /> {details.hearing.court_name}
                        </Badge>
                      ) : null}
                      {details.hearing.purpose ? (
                        <Badge variant="gray">
                          <ClipboardList size={14} /> {details.hearing.purpose}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={statusUpdating}
                      onClick={() => updateHearingStatus("HELD")}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                    >
                      {statusUpdating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      Mark Held
                    </button>

                    <button
                      type="button"
                      disabled={statusUpdating}
                      onClick={() => updateHearingStatus("ADJOURNED")}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                    >
                      <Gavel size={16} />
                      Adjourned
                    </button>

                    <button
                      type="button"
                      disabled={statusUpdating}
                      onClick={() => updateHearingStatus("CANCELLED")}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                    >
                      <XCircle size={16} />
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Attendance */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
                      <Users size={16} className="text-[#004aad]" />
                      Attendance
                    </div>
                    <button
                      type="button"
                      onClick={saveAttendance}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-sm font-semibold"
                    >
                      <Save size={16} />
                      Save
                    </button>
                  </div>

                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={clientPresent}
                        onChange={(e) => setClientPresent(e.target.checked)}
                      />
                      Client present
                    </label>

                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={respondentPresent}
                        onChange={(e) => setRespondentPresent(e.target.checked)}
                      />
                      Respondent present
                    </label>
                  </div>

                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-500">Client note (optional)</div>
                      <textarea
                        value={clientNote}
                        onChange={(e) => setClientNote(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none"
                        placeholder="Client attendance note..."
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Advocate note (optional)</div>
                      <textarea
                        value={advocateNote}
                        onChange={(e) => setAdvocateNote(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none"
                        placeholder="Advocate attendance note..."
                      />
                    </div>
                  </div>
                </div>

                {/* Proceedings */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">Court Proceedings</div>
                    <button
                      type="button"
                      onClick={saveProceedings}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-sm font-semibold"
                    >
                      <Save size={16} />
                      Save
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-xs text-slate-500">Court statement (required)</div>
                      <textarea
                        value={courtStatement}
                        onChange={(e) => setCourtStatement(e.target.value)}
                        rows={4}
                        className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none"
                        placeholder="Write what happened in court..."
                      />
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Outcome summary (optional)</div>
                      <input
                        value={outcomeSummary}
                        onChange={(e) => setOutcomeSummary(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        placeholder="Short outcome..."
                      />
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Next hearing date (optional)</div>
                      <input
                        type="datetime-local"
                        value={nextHearingAt}
                        onChange={(e) => setNextHearingAt(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                      />
                      <div className="text-[11px] text-slate-500 mt-1">
                        If you set next hearing date here, backend auto-creates next hearing only if no upcoming scheduled
                        hearing exists.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Evidence */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-bold text-slate-900">Evidence</div>

                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-500">Title</div>
                      <input
                        value={evTitle}
                        onChange={(e) => setEvTitle(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        placeholder="Evidence title..."
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Description (optional)</div>
                      <input
                        value={evDesc}
                        onChange={(e) => setEvDesc(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        placeholder="Short description..."
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={addEvidence}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
                  >
                    <Plus size={16} className="text-[#004aad]" />
                    Add Evidence
                  </button>

                  <div className="mt-4 space-y-2">
                    {(details.evidence || []).length === 0 ? (
                      <div className="text-sm text-slate-600">No evidence added yet.</div>
                    ) : (
                      details.evidence.map((e) => (
                        <div key={e.id} className="rounded-2xl border border-slate-200 p-3 bg-slate-50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{e.title}</div>
                              <div className="text-xs text-slate-500 mt-1">{e.description || "—"}</div>
                              <div className="text-[11px] text-slate-500 mt-1">
                                Added: {fmtDT(e.created_at)} • By: {e.added_by}
                              </div>
                            </div>
                            <Badge variant="gray">
                              <FileText size={14} /> Evidence
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Drafts */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-bold text-slate-900">Drafts</div>

                  <div className="mt-3 grid md:grid-cols-3 gap-3">
                    <div className="md:col-span-1">
                      <div className="text-xs text-slate-500">Draft Type</div>
                      <select
                        value={draftType}
                        onChange={(e) => setDraftType(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      >
                        <option value="PETITION">PETITION</option>
                        <option value="REPLY">REPLY</option>
                        <option value="APPLICATION">APPLICATION</option>
                        <option value="ARGUMENTS">ARGUMENTS</option>
                        <option value="OTHER">OTHER</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-slate-500">Draft Content</div>
                      <textarea
                        value={draftContent}
                        onChange={(e) => setDraftContent(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none"
                        placeholder="Write the draft text..."
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={addDraft}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
                  >
                    <Plus size={16} className="text-[#004aad]" />
                    Add Draft
                  </button>

                  <div className="mt-4 space-y-2">
                    {(details.drafts || []).length === 0 ? (
                      <div className="text-sm text-slate-600">No drafts added yet.</div>
                    ) : (
                      details.drafts.map((d) => (
                        <div key={d.id} className="rounded-2xl border border-slate-200 p-3 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{d.draft_type}</div>
                              <div className="text-xs text-slate-500 mt-1">Updated: {fmtDT(d.updated_at)}</div>
                              <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-200 p-3">
                                {d.content}
                              </div>
                            </div>
                            <Badge variant="gray">
                              <FileText size={14} /> Draft
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Aligned with backend: uses hearings list for attendance/proceedings fields; evidence/drafts fetched from
                  their GET endpoints.
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}

/* Convert ISO -> datetime-local value */
function toLocalInput(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  } catch {
    return "";
  }
}
