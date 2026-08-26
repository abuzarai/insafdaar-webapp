import { formatStatus, formatAiEnum } from "../common/formatStatus";
import React, { useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  ChevronRight,
  X,
  FileText,
  Download,
  PlayCircle,
  PauseCircle,
  User,
  Mail,
  CalendarDays,
  BadgeCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquareText,
  Copy,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import { API_BASE_URL } from "../../config";
import { useActionDialogs } from "../common/ActionDialog";

/* ================= Backend Types ================= */

type DBCaseStatus = string;

type AssignedCase = {
  id: string;
  title: string;
  status: DBCaseStatus;
};

type FullCaseRow = {
  id: string;
  title: string;
  description: string | null;
  status: DBCaseStatus;
  source: string | null;
  language: string | null;
  created_at: string;
  updated_at: string | null;

  user_id: string;
  assigned_advocate_id: string;

  client_name: string | null;
  client_email: string | null;
};

type DocRow = {
  id: string;
  doc_type: string | null;
  file_url: string | null;
  status: string | null;
  created_at: string;
};

type VoiceNoteRow = {
  id: string;
  language: string | null;
  audio_url: string | null;
  notes: string | null;
  created_at: string;
};

type FullCaseResponse = {
  case: FullCaseRow;
  clientDocuments: DocRow[];
  caseDocuments: DocRow[];
  voiceNotes: VoiceNoteRow[];
  interview?: {
    sessionId: number;
    meta: {
      mode: string | null;
      provider: string | null;
      status: string | null;
      language: string | null;
      completedAt: string | null;
      updatedAt: string | null;
      audioUrl: string | null;
      audioDuration: number | null;
      completionSource: string | null;
      resultHash: string | null;
      webhookReceivedAt: string | null;
      fallbackReceivedAt: string | null;
    };
    summary: {
      primaryLanguage: string | null;
      legalDomain: string | null;
      issueSummary: string | null;
      urgency: string | null;
      urgencyReasoning: string | null;
      adrSuitable: boolean | null;
      adrReasoning: string | null;
      confidenceScore: number | null;
      keyEntities: {
        parties: string[];
        locations: string[];
        dates: string[];
        amounts: string[];
      };
    };
    transcript: string | null;
  } | null;
};

/* ================= Auth + Fetch Helpers ================= */

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!ct.includes("application/json")) {
    console.error("Unexpected response:", text);
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${text.slice(0, 120)}`);
  }

  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    console.error("Invalid JSON:", text);
    throw new Error(`Invalid JSON response. Starts: ${text.slice(0, 120)}`);
  }
}

/* ================= UI Helpers ================= */

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
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${styles}`}>
      {children}
    </span>
  );
}

function normalizeStatus(s: DBCaseStatus) {
  const v = (s || "").toString().trim().toUpperCase();
  if (v === "ACCEPTED") return "Accepted";
  if (v === "REJECTED") return "Rejected";
  if (v === "UNDER_REVIEW" || v === "UNDER REVIEW") return "Under Review";
  if (v === "NEW") return "New";
  return s || "—";
}

function statusBadge(status: DBCaseStatus) {
  const s = (status || "").toString().trim().toUpperCase();

  if (s === "ADVOCATE_ASSIGNED")
    return (
      <Badge variant="blue">
        <CheckCircle2 size={14} /> Awaiting Advocate Decision
      </Badge>
    );

  if (s === "MATCHING_REVIEW")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Matching Review
      </Badge>
    );

  if (s === "MEETING_PENDING_ADMIN")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Meeting Pending Admin
      </Badge>
    );

  if (s === "MEETING_APPROVED")
    return (
      <Badge variant="blue">
        <CheckCircle2 size={14} /> Meeting Approved
      </Badge>
    );

  if (s === "CONTRACT_PENDING_SIGNATURES")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Contract Signatures Pending
      </Badge>
    );

  if (s === "CONTRACT_PENDING_ADMIN_APPROVAL")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Contract Under Admin Review
      </Badge>
    );

  if (s === "CASE_ACTIVE")
    return (
      <Badge variant="green">
        <BadgeCheck size={14} /> Case Active
      </Badge>
    );

  if (s === "ACCEPTED")
    return (
      <Badge variant="green">
        <BadgeCheck size={14} /> Accepted
      </Badge>
    );

  if (s === "REJECTED")
    return (
      <Badge variant="red">
        <XCircle size={14} /> Rejected
      </Badge>
    );

  if (s === "UNDER_REVIEW" || s === "UNDER REVIEW")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Under Review
      </Badge>
    );

  if (s === "NEW")
    return (
      <Badge variant="blue">
        <CheckCircle2 size={14} /> New
      </Badge>
    );

  return (
    <Badge variant="gray">
      <CheckCircle2 size={14} /> {normalizeStatus(status)}
    </Badge>
  );
}

function formatDT(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function docIcon() {
  return <FileText size={16} className="text-[#004aad]" />;
}

function docDisplayName(d: DocRow) {
  const t = d.doc_type?.trim();
  if (t) return t;

  const url = d.file_url || "";
  const last = url.split("/").pop() || "Document";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function isHttp(url: string) {
  return /^https?:\/\//i.test(url);
}

function resolveUrl(url: string | null | undefined) {
  if (!url) return null;
  if (isHttp(url)) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return url;
}

/* Small UI bits */
function SkeletonLine({ w = "w-full" }: { w?: string }) {
  return <div className={`h-3 ${w} rounded-full bg-slate-100 animate-pulse`} />;
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ===================== Component ===================== */

export default function AdvocateCaseIntakeSection() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED">("All");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [full, setFull] = useState<FullCaseResponse | null>(null);

  const [listLoading, setListLoading] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);

  const [audioPlayingId, setAudioPlayingId] = useState<string | null>(null);
  const [showInterviewTranscript, setShowInterviewTranscript] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"accept" | "reject" | null>(null);
  const { prompt, dialogs } = useActionDialogs();

  // toast-ish
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

  // ✅ backend mounted at /api/advocate/dashboard/...
  const ADV_CASES_BASE = `${API_BASE_URL}/api/advocate/dashboard/cases`;

  const fetchAssigned = async () => {
    setListLoading(true);
    try {
      const response = await fetch(`${ADV_CASES_BASE}/assigned`, {
        method: "GET",
        headers: authHeaders(),
      });

      const data = await safeJson<{ cases?: AssignedCase[]; message?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data?.message || data?.error || "Failed to fetch cases");
      setCases(Array.isArray(data?.cases) ? data.cases : []);
    } catch (err) {
      console.error("Error fetching cases:", err);
      setCases([]);
      showToast("Failed to load cases.", "err");
    } finally {
      setListLoading(false);
    }
  };

  const fetchFull = async (caseId: string) => {
    setFullLoading(true);
    try {
      const response = await fetch(`${ADV_CASES_BASE}/${caseId}/full`, {
        method: "GET",
        headers: authHeaders(),
      });

      const data = await safeJson<any>(response);
      if (!response.ok) throw new Error(data?.message || data?.error || "Failed to load case.");
      if (!data?.case) throw new Error("Invalid response from server.");

      setFull(data as FullCaseResponse);
    } catch (err: any) {
      console.error("Error loading case:", err);
      setFull(null);
      showToast(err?.message || "Error loading case details.", "err");
    } finally {
      setFullLoading(false);
    }
  };

  useEffect(() => {
    fetchAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on ESC
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Lock body scroll while modal open
  useEffect(() => {
    if (!selectedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedId]);

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

  const openCase = async (id: string) => {
    setSelectedId(id);
    setFull(null);
    setAudioPlayingId(null);
    setShowInterviewTranscript(false);
    await fetchFull(id);
  };

  const closeModal = () => {
    setSelectedId(null);
    setFull(null);
    setAudioPlayingId(null);
    setShowInterviewTranscript(false);
  };

  const acceptCase = async (id: string | null) => {
    if (!id) return;
    setDecisionBusy("accept");
    try {
      const response = await fetch(`${ADV_CASES_BASE}/${id}/accept`, {
        method: "POST",
        headers: authHeaders(),
      });

      const data = await safeJson<any>(response);
      if (!response.ok) throw new Error(data?.message || data?.error || "Failed to accept case.");

      showToast(data?.message || "Case accepted.", "ok");
      closeModal();
      await fetchAssigned();
    } catch (err: any) {
      showToast(err?.message || "Error accepting case.", "err");
    } finally {
      setDecisionBusy(null);
    }
  };

  const rejectCase = async (id: string | null) => {
    if (!id) return;

    const reason = await prompt({
      title: "Reject Case",
      message: "Provide rejection reason for admin reassignment notes.",
      confirmText: "Reject Case",
      cancelText: "Cancel",
      placeholder: "Explain why this case should be reassigned...",
      defaultValue: "Insufficient alignment with current caseload",
      required: false,
      tone: "danger",
    });
    if (reason === null) return;

    setDecisionBusy("reject");
    try {
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const response = await fetch(`${ADV_CASES_BASE}/${id}/reject`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason }),
      });

      const data = await safeJson<any>(response);
      if (!response.ok) throw new Error(data?.message || data?.error || "Failed to reject case.");

      showToast(data?.message || "Case rejected. Returned to admin for reassignment.", "ok");
      closeModal();
      await fetchAssigned();
    } catch (err: any) {
      showToast(err?.message || "Error rejecting case.", "err");
    } finally {
      setDecisionBusy(null);
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
            <div
              className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold ${
                toast.type === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}
            >
              {toast.msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Advocate Cases</h1>
          <p className="text-sm text-slate-600 mt-2">Open a case to review details, documents and voice notes — then accept.</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="blue">
            <CheckCircle2 size={14} /> {listLoading ? "Loading..." : `${cases.length} cases`}
          </Badge>
        </div>
      </div>

      {/* Search + filter */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus-within:ring-2 focus-within:ring-[#004aad]/20">
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

      {/* Cards */}
      <div className="grid lg:grid-cols-2 gap-4">
        {(listLoading ? Array.from({ length: 6 }) : filtered).map((c: any, idx: number) => {
          if (listLoading) {
            return (
              <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <SkeletonLine w="w-28" />
                <div className="mt-3">
                  <SkeletonLine w="w-3/4" />
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="h-6 w-24 rounded-full bg-slate-100 animate-pulse" />
                  <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
                </div>
              </div>
            );
          }

          const item = c as AssignedCase;
          return (
            <motion.button
              key={item.id}
              onClick={() => openCase(item.id)}
              className="group text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-[#004aad]/25"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="truncate">{item.id}</span>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const ok = copyToClipboard(item.id);
                        showToast(ok ? "Case ID copied." : "Could not copy.", ok ? "ok" : "err");
                      }}
                      title="Copy case id"
                    >
                      <Copy size={14} className="text-slate-500" />
                    </button>
                  </div>

                  <div className="text-lg font-bold text-slate-900 mt-1 truncate">{item.title}</div>
                  <div className="mt-2 flex flex-wrap gap-2">{statusBadge(item.status)}</div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <span className="hidden sm:inline text-xs font-semibold text-slate-500 opacity-0 group-hover:opacity-100 transition">
                    Open
                  </span>
                  <ChevronRight className="text-slate-300 group-hover:text-slate-500 transition" />
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {!listLoading && filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-slate-700">
          No cases match your search/filter.
        </div>
      )}

      {/* Review Modal */}
      <AnimatePresence>
        {selectedId && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => {
              // click outside closes
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <motion.div
              initial={{ y: 18, opacity: 0, scale: 0.99 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 18, opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              {/* Sticky Header */}
              <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
                <div className="p-4 sm:p-5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="inline-flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition"
                        title="Back"
                      >
                        <ArrowLeft size={16} className="text-slate-600" />
                        <span className="hidden sm:inline">Back</span>
                      </button>

                      <span className="hidden sm:inline">•</span>
                      <span className="truncate">{selectedId}</span>

                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition"
                        onClick={() => {
                          const ok = copyToClipboard(selectedId);
                          showToast(ok ? "Case ID copied." : "Could not copy.", ok ? "ok" : "err");
                        }}
                        title="Copy case id"
                      >
                        <Copy size={14} className="text-slate-500" />
                      </button>

                      {full?.case?.created_at ? (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span className="hidden sm:inline truncate">{formatDT(full.case.created_at)}</span>
                        </>
                      ) : null}
                    </div>

                    <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
                      {fullLoading ? "Loading case..." : full?.case?.title || "—"}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {statusBadge(full?.case?.status || "—")}
                      {full?.case?.language ? (
                        <Badge variant="gray">
                          <MessageSquareText size={14} /> {full.case.language}
                        </Badge>
                      ) : null}
                      {full?.case?.source ? (
                        <Badge variant="gray">
                          <CheckCircle2 size={14} /> {full.case.source}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="p-2 rounded-xl hover:bg-slate-100 transition"
                      aria-label="Close"
                      title="Close (Esc)"
                    >
                      <X size={20} className="text-slate-700" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="max-h-[78vh] overflow-auto">
                <div className="p-4 sm:p-5 grid lg:grid-cols-12 gap-4">
                  {/* Left */}
                  <div className="lg:col-span-5 space-y-4">
                    {/* Client */}
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-bold text-slate-900">Client</div>

                      {fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <SkeletonLine w="w-48" />
                          <SkeletonLine w="w-56" />
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <User size={16} className="text-[#004aad]" />
                            <span className="font-semibold">{full?.case?.client_name || "—"}</span>
                          </div>

                          {full?.case?.client_email ? (
                            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Mail size={16} className="text-[#004aad]" />
                                <span className="truncate">{full.case.client_email}</span>
                              </div>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white transition border border-transparent hover:border-slate-200"
                                onClick={() => {
                                  const ok = copyToClipboard(full.case.client_email || "");
                                  showToast(ok ? "Email copied." : "Could not copy.", ok ? "ok" : "err");
                                }}
                                title="Copy email"
                              >
                                <Copy size={14} className="text-slate-500" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Timeline */}
                    <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                      <div className="text-sm font-bold text-slate-900">Timeline</div>
                      {fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <SkeletonLine w="w-64" />
                          <SkeletonLine w="w-52" />
                        </div>
                      ) : (
                        <div className="mt-3 text-sm text-slate-700 space-y-1">
                          <div className="flex items-center gap-2">
                            <CalendarDays size={16} className="text-[#004aad]" />
                            <span className="text-slate-500">Created:</span>
                            <span className="font-semibold">{formatDT(full?.case?.created_at)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Updated:</span>{" "}
                            <span className="font-semibold">{formatDT(full?.case?.updated_at)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Voice Notes */}
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-bold text-slate-900">Voice Notes</div>

                      {fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                          <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                        </div>
                      ) : (full?.voiceNotes?.length || 0) === 0 ? (
                        <div className="text-sm text-slate-600 mt-2">No voice notes available.</div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {full!.voiceNotes.map((v) => {
                            const openUrl = resolveUrl(v.audio_url);
                            return (
                              <div key={v.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-900">
                                      Voice Note {v.language ? `• ${v.language}` : ""}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Recorded: {formatDT(v.created_at)}</div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {openUrl ? (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition bg-[#004aad] text-white hover:bg-[#003b82]"
                                        onClick={() => {
                                          setAudioPlayingId((prev) => (prev === v.id ? null : v.id));
                                          window.open(openUrl, "_blank", "noopener,noreferrer");
                                        }}
                                      >
                                        {audioPlayingId === v.id ? <PauseCircle size={18} /> : <PlayCircle size={18} />}
                                        {audioPlayingId === v.id ? "Pause" : "Play"}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"
                                      >
                                        <PlayCircle size={18} />
                                        Unavailable
                                      </button>
                                    )}

                                    {openUrl ? (
                                      <button
                                        type="button"
                                        className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                                        title="Open in new tab"
                                        onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
                                      >
                                        <ExternalLink size={16} className="text-slate-600" />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>

                                {v.notes ? (
                                  <div className="mt-3 text-xs text-slate-600 whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-200 p-3">
                                    {v.notes}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm font-bold text-slate-900">AI Interview Summary</div>
                        {full?.interview?.meta?.completedAt ? (
                          <div className="text-xs text-slate-500">Completed: {formatDT(full.interview.meta.completedAt)}</div>
                        ) : null}
                      </div>

                      {full?.interview?.meta ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Source: <span className="font-semibold text-slate-700">{full.interview.meta.completionSource || "unknown"}</span>
                          {full.interview.meta.resultHash ? <span> • Hash: {full.interview.meta.resultHash.slice(0, 10)}</span> : null}
                        </div>
                      ) : null}

                      {!fullLoading && !full?.interview ? (
                        <div className="text-sm text-amber-700 mt-2">Interview results are not available yet.</div>
                      ) : fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <SkeletonLine />
                          <SkeletonLine w="w-5/6" />
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div>
                            <span className="text-slate-500">Legal Domain:</span>{" "}
                            <span className="font-semibold">{formatAiEnum("domain", full?.interview?.summary?.legalDomain)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Issue Summary:</span>{" "}
                            <span className="font-semibold">{full?.interview?.summary?.issueSummary || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Primary Language:</span>{" "}
                            <span>{formatAiEnum("language", full?.interview?.summary?.primaryLanguage)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Urgency:</span>{" "}
                            <span>
                              {formatAiEnum("urgency", full?.interview?.summary?.urgency)}
                            </span>
                            {full?.interview?.summary?.confidenceScore !== null && full?.interview?.summary?.confidenceScore !== undefined ? (
                              <span>
                                {" "}
                                • <span className="text-slate-500">Confidence:</span> {(full.interview.summary.confidenceScore * 100).toFixed(0)}%
                              </span>
                            ) : null}
                          </div>
                          <div>
                            <span className="text-slate-500">Urgency Reasoning:</span>{" "}
                            <span>{full?.interview?.summary?.urgencyReasoning || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">ADR Suitable:</span>{" "}
                            <span>
                              {full?.interview?.summary?.adrSuitable === true
                                ? "Yes"
                                : full?.interview?.summary?.adrSuitable === false
                                ? "No"
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">ADR Reasoning:</span>{" "}
                            <span>{full?.interview?.summary?.adrReasoning || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Parties:</span>{" "}
                            <span>
                              {Array.isArray(full?.interview?.summary?.keyEntities?.parties) &&
                              (full?.interview?.summary?.keyEntities?.parties?.length || 0) > 0
                                ? full?.interview?.summary?.keyEntities?.parties?.join(" | ")
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Locations:</span>{" "}
                            <span>
                              {Array.isArray(full?.interview?.summary?.keyEntities?.locations) &&
                              (full?.interview?.summary?.keyEntities?.locations?.length || 0) > 0
                                ? full?.interview?.summary?.keyEntities?.locations?.join(" | ")
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Dates:</span>{" "}
                            <span>
                              {Array.isArray(full?.interview?.summary?.keyEntities?.dates) &&
                              (full?.interview?.summary?.keyEntities?.dates?.length || 0) > 0
                                ? full?.interview?.summary?.keyEntities?.dates?.join(" | ")
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Amounts:</span>{" "}
                            <span>
                              {Array.isArray(full?.interview?.summary?.keyEntities?.amounts) &&
                              (full?.interview?.summary?.keyEntities?.amounts?.length || 0) > 0
                                ? full?.interview?.summary?.keyEntities?.amounts?.join(" | ")
                                : "—"}
                            </span>
                          </div>

                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => setShowInterviewTranscript((v) => !v)}
                              className="inline-flex items-center px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 transition text-xs font-semibold"
                            >
                              {showInterviewTranscript ? "Hide Transcript" : "View Transcript"}
                            </button>
                          </div>

                          {showInterviewTranscript ? (
                            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 whitespace-pre-wrap">
                              {full?.interview?.transcript || "Transcript not available."}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Case Description */}
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-bold text-slate-900">Case Details</div>

                      {fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <SkeletonLine />
                          <SkeletonLine w="w-5/6" />
                          <SkeletonLine w="w-2/3" />
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="text-xs text-slate-500">Description</div>
                            <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{full?.case?.description || "—"}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Documents */}
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-bold text-slate-900">Documents</div>

                      {fullLoading ? (
                        <div className="mt-3 space-y-2">
                          <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                          <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                        </div>
                      ) : (
                        <div className="mt-3 space-y-5">
                          {/* Client docs */}
                          <div>
                            <div className="text-xs font-semibold text-slate-700">Client Documents</div>
                            {(full?.clientDocuments?.length || 0) === 0 ? (
                              <div className="text-sm text-slate-600 mt-2">No client documents.</div>
                            ) : (
                              <div className="mt-2 space-y-2">
                                {full!.clientDocuments.map((d) => {
                                  const openUrl = resolveUrl(d.file_url);
                                  return (
                                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                                      <div className="flex items-start gap-3 min-w-0">
                                        <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                                          {docIcon()}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-slate-900 truncate">{docDisplayName(d)}</div>
                                          <div className="text-xs text-slate-500">
                                            {d.status ? `Status: ${formatStatus(d.status)} • ` : ""}Uploaded: {formatDT(d.created_at)}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        <button
                                          type="button"
                                          disabled={!openUrl}
                                          onClick={() => openUrl && window.open(openUrl, "_blank", "noopener,noreferrer")}
                                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
                                            openUrl
                                              ? "border-slate-200 bg-white hover:bg-slate-50"
                                              : "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                                          }`}
                                        >
                                          <Download size={16} className="text-[#004aad]" />
                                          View
                                        </button>

                                        {openUrl ? (
                                          <button
                                            type="button"
                                            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                                            title="Open in new tab"
                                            onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
                                          >
                                            <ExternalLink size={16} className="text-slate-600" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Case docs */}
                          <div>
                            <div className="text-xs font-semibold text-slate-700">Case Documents</div>
                            {(full?.caseDocuments?.length || 0) === 0 ? (
                              <div className="text-sm text-slate-600 mt-2">No case documents.</div>
                            ) : (
                              <div className="mt-2 space-y-2">
                                {full!.caseDocuments.map((d) => {
                                  const openUrl = resolveUrl(d.file_url);
                                  return (
                                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                                      <div className="flex items-start gap-3 min-w-0">
                                        <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                                          {docIcon()}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-slate-900 truncate">{docDisplayName(d)}</div>
                                          <div className="text-xs text-slate-500">
                                            {d.status ? `Status: ${formatStatus(d.status)} • ` : ""}Uploaded: {formatDT(d.created_at)}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        <button
                                          type="button"
                                          disabled={!openUrl}
                                          onClick={() => openUrl && window.open(openUrl, "_blank", "noopener,noreferrer")}
                                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
                                            openUrl
                                              ? "border-slate-200 bg-white hover:bg-slate-50"
                                              : "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                                          }`}
                                        >
                                          <Download size={16} className="text-[#004aad]" />
                                          View
                                        </button>

                                        {openUrl ? (
                                          <button
                                            type="button"
                                            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                                            title="Open in new tab"
                                            onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
                                          >
                                            <ExternalLink size={16} className="text-slate-600" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sticky Actions (inside modal scroll area bottom padding) */}
                    <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                      <div className="flex flex-col sm:flex-row gap-2">
                        {(() => {
                          const currentStatus = String(full?.case?.status || "").toUpperCase();
                          const alreadyAccepted = currentStatus === "ACCEPTED" || currentStatus === "CASE_ACTIVE";
                          const alreadyRejected = currentStatus === "REJECTED";
                          const awaitingAssignment = currentStatus !== "ADVOCATE_ASSIGNED";
                          return (
                            <>
                        <button
                          type="button"
                          disabled={
                            fullLoading ||
                            !full?.case?.id ||
                            alreadyAccepted ||
                            alreadyRejected ||
                            awaitingAssignment ||
                            !!decisionBusy
                          }
                          onClick={() => acceptCase(selectedId)}
                          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold transition ${
                            fullLoading ||
                            alreadyAccepted ||
                            alreadyRejected ||
                            awaitingAssignment ||
                            !!decisionBusy
                              ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                              : "bg-[#004aad] text-white hover:bg-[#003b82]"
                          }`}
                        >
                          <BadgeCheck size={18} />
                          {alreadyAccepted
                            ? "Case Accepted"
                            : awaitingAssignment
                            ? "Awaiting Assignment"
                            : decisionBusy === "accept"
                            ? "Accepting..."
                            : "Accept Case"}
                        </button>

                        <button
                          type="button"
                          disabled={
                            fullLoading ||
                            !full?.case?.id ||
                            alreadyAccepted ||
                            alreadyRejected ||
                            awaitingAssignment ||
                            !!decisionBusy
                          }
                          onClick={() => rejectCase(selectedId)}
                          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold transition ${
                            fullLoading ||
                            alreadyAccepted ||
                            alreadyRejected ||
                            awaitingAssignment ||
                            !!decisionBusy
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                          }`}
                        >
                          <XCircle size={18} />
                          {alreadyRejected
                            ? "Case Rejected"
                            : awaitingAssignment
                            ? "Awaiting Assignment"
                            : decisionBusy === "reject"
                            ? "Rejecting..."
                            : "Reject Case"}
                        </button>
                            </>
                          );
                        })()}
                      </div>

                      <div className="text-xs text-slate-600 mt-3">
                        Tip: Use <span className="font-semibold">Accept</span> only if documents + facts are sufficient to proceed.
                        <span className="text-slate-500"> (Close: click outside or press Esc)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
                  <div className="text-xs text-slate-500">You can close anytime with Esc or clicking outside.</div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {dialogs}
    </section>
  );
}
