import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
  ClipboardList,
  BadgeCheck,
  Clock,
  PenLine,
  Eye,
  MessageSquareText,
  RefreshCw,
  User,
  Mail,
  Phone,
  XCircle,
  Search,
  Save,
  Sparkles,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

import { API_BASE_URL } from "../../config";
import { submitDraftJobAndPoll } from "../../utils/draftJob";

/** Strip the raw JSON blob that Gemini/backend errors often carry, keeping just the message. */
function cleanErrorMessage(raw: string): string {
  if (!raw) return "Failed to generate AI draft.";
  // "...message... {'error': {...}}" → take what's before the JSON object
  const m = raw.match(/^(.*?)(?:\s*\{\s*['"]error|\.$)/s);
  const clean = (m && m[1] ? m[1] : raw).trim();
  return clean || "Failed to generate AI draft.";
}

function isQuotaError(raw: string): boolean {
  return /429|RESOURCE_EXHAUSTED|quota|Quota|rate.?limit/i.test(raw || "");
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 transition"
          >
            <XCircle size={18} className="text-slate-700" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ================= Types ================= */

type DocStatus = "Provided" | "Missing" | "Needs Review" | "Approved";
type TemplateKey =
  | "Plaint"
  | "Written Statement"
  | "Affidavit"
  | "Application (Stay/Injunction)"
  | "Vakalatnama"
  | "Notice"
  | "Misc. Petition";

type DraftSection = {
  id: string;
  heading: string;
  content: string;
};

type DraftContent = {
  title: string;
  sections: DraftSection[];
};

type DraftBusyState = null | "save" | "rewrite" | "exportDocx" | "exportPdf";

const TEMPLATE_DOC_MAP: Record<TemplateKey, string> = {
  Plaint: "Plaint",
  "Written Statement": "Written Statement",
  Affidavit: "Affidavit",
  "Application (Stay/Injunction)": "Application (Stay/Injunction)",
  Vakalatnama: "Client-Lawyer Contract",
  Notice: "Notice",
  "Misc. Petition": "Misc. Petition",
};

type AcceptedCase = {
  id: string; // CASE-#
  title: string;
  status: string;
  client: { name: string; email: string; phone: string | null };
};

function normalizeLifecycleStatus(s: string) {
  const v = String(s || "").toUpperCase();
  if (v === "CONTRACT_PENDING_SIGNATURES") return "Contract Signatures Pending";
  if (v === "CONTRACT_PENDING_ADMIN_APPROVAL") return "Contract Under Admin Review";
  if (v === "MEETING_APPROVED") return "Meeting Approved";
  if (v === "MEETING_PENDING_ADMIN") return "Meeting Pending Admin";
  if (v === "CASE_ACTIVE") return "Case Active";
  if (v === "ACCEPTED") return "Accepted";
  return s || "—";
}

function getCaseNotActiveStatus(d: any): string | null {
  if (String(d?.error || "").toUpperCase() !== "CASE_NOT_ACTIVE") return null;
  return d?.currentStatus ? String(d.currentStatus) : null;
}

type BackendCaseDoc = {
  id: number;
  doc_type: string;
  file_url: string;
  status: string | null;
  note?: string | null;
  created_at: string;
  source?: "case" | "client";
};

type PreparationItem = {
  id: number;
  doc_key: string;
  title: string;
  is_required: boolean;
  is_provided: boolean;
  provided_doc_id: number | null;
  updated_at: string;
};

type PreparationResponse = {
  case: { id: string; title: string; status: string };
  client: { id: number; name: string; email: string; phone: string | null };
  documents: BackendCaseDoc[];
  preparation: {
    id: number;
    status: string;
    notes: string | null;
    items: PreparationItem[];
  };
  aiDraft: { status: string };
};

type DocItem = {
  id: string;
  rawId: number;
  name: string;
  type: string;
  note?: string;
  status: DocStatus;
  lastUpdated?: string;
  url?: string;
  source: "case" | "client";
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

function authOnlyHeaders(): Headers {
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
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${text.slice(0, 120)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function normalizeDocStatusFromBackend(s?: string | null): DocStatus {
  const v = String(s || "").toLowerCase();
  if (v.includes("approved")) return "Approved";
  if (v.includes("review")) return "Needs Review";
  if (v.includes("missing")) return "Missing";
  return "Provided";
}

function formatMaybePhone(p?: string | null) {
  const v = (p || "").trim();
  return v.length ? v : "—";
}

function resolveDocumentUrl(fileUrl?: string) {
  const raw = String(fileUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, API_BASE_URL).toString();
  } catch {
    return raw;
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

function DocBadge({ s }: { s: DocStatus }) {
  if (s === "Approved")
    return (
      <Badge variant="green">
        <BadgeCheck size={14} /> Approved
      </Badge>
    );
  if (s === "Provided")
    return (
      <Badge variant="blue">
        <CheckCircle2 size={14} /> Provided
      </Badge>
    );
  if (s === "Needs Review")
    return (
      <Badge variant="amber">
        <AlertTriangle size={14} /> Needs Review
      </Badge>
    );
  return (
    <Badge variant="red">
      <XCircle size={14} /> Missing
    </Badge>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700 min-w-0">
      <span className="text-slate-500">{icon}</span>
      <span className="text-slate-500">{label}:</span>
      <span className="font-semibold text-slate-900 truncate">{value}</span>
    </div>
  );
}

function PillTabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { key: string; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              active
                ? "border-[#004aad] bg-[#004aad]/10 text-[#004aad]"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={`ml-1 inline-flex min-w-[1.5rem] justify-center rounded-full px-2 py-0.5 text-[10px] ${
                  active ? "bg-[#004aad] text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ================= API Base ================= */

const ADV_PREP_BASE = `${API_BASE_URL}/api/advocate/dashboard/case-preparation`;

/* ================= Mapping ================= */

function mapBackendDocToUI(d: BackendCaseDoc): DocItem {
  const fileName = (() => {
    try {
      const p = new URL(d.file_url).pathname;
      return p.split("/").pop() || `Document-${d.id}`;
    } catch {
      const parts = String(d.file_url || "").split("/");
      return parts[parts.length - 1] || `Document-${d.id}`;
    }
  })();

  return {
    id: `DOC-${d.source || "case"}-${d.id}`,
    rawId: d.id,
    name: fileName,
    type: d.doc_type || "Document",
    note: d.note ? String(d.note) : undefined,
    status: normalizeDocStatusFromBackend(d.status),
    lastUpdated: d.created_at ? new Date(d.created_at).toLocaleString() : undefined,
    url: d.file_url,
    source: d.source === "client" ? "client" : "case",
  };
}

/* ================= Component ================= */

export default function CasePreparationSection() {
  // ✅ KEEP THIS “AI Draft Template” SECTION STATIC (same behavior)
  const [template, setTemplate] = useState<TemplateKey>("Application (Stay/Injunction)");
  const [noteToClient, setNoteToClient] = useState(
    "Please upload certified survey map + witness CNIC copies. Without these, court may delay evidence stage."
  );

  // Dynamic states
  const [acceptedCases, setAcceptedCases] = useState<AcceptedCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [details, setDetails] = useState<PreparationResponse | null>(null);

  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionLoading, setActionLoading] = useState<null | "checklist" | "request" | "complete" | "upload" | "draft">(null);
  const [error, setError] = useState<string>("");
  const [blockedStatus, setBlockedStatus] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [draftResult, setDraftResult] = useState<{ generationId: string; documentType: string; draft: DraftContent | null } | null>(
    null
  );
  const [latestDraftLoading, setLatestDraftLoading] = useState(false);
  const [draftStudioOpen, setDraftStudioOpen] = useState(false);
  const [draftEditor, setDraftEditor] = useState<DraftContent | null>(null);
  const [draftSelectedSectionId, setDraftSelectedSectionId] = useState<string>("");
  const [draftRewriteInstruction, setDraftRewriteInstruction] = useState("");
  const [draftBusy, setDraftBusy] = useState<DraftBusyState>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSavedAt, setAutoSavedAt] = useState("");
  const [quickUploadFile, setQuickUploadFile] = useState<File | null>(null);
  const [quickUploadDocType, setQuickUploadDocType] = useState("OTHER");
  const [quickUploadNote, setQuickUploadNote] = useState("");

  // Document verification UI states
  const [docTab, setDocTab] = useState<"all" | "missing" | "review" | "approved" | "provided">("all");
  const [docQuery, setDocQuery] = useState("");

  const selectedCaseSummary = useMemo(() => {
    return acceptedCases.find((c) => c.id === selectedCaseId) || null;
  }, [acceptedCases, selectedCaseId]);

  const clientUploads: DocItem[] = useMemo(() => {
    if (!details?.documents) return [];
    return details.documents.map(mapBackendDocToUI);
  }, [details]);

  const checklist = useMemo(() => details?.preparation?.items || [], [details]);

  const missingRequiredItems = useMemo(() => {
    return checklist.filter((i) => i.is_required && !i.is_provided);
  }, [checklist]);

  const missingFlags = useMemo(() => missingRequiredItems.map((i) => `${i.title} pending`), [missingRequiredItems]);

  const missingCount = useMemo(() => {
    const docsMissing = clientUploads.filter((d) => d.status === "Missing").length;
    const checklistMissing = missingRequiredItems.length;
    return docsMissing + checklistMissing;
  }, [clientUploads, missingRequiredItems]);

  const docCounts = useMemo(() => {
    const base = { all: clientUploads.length, missing: 0, review: 0, approved: 0, provided: 0 };
    for (const d of clientUploads) {
      if (d.status === "Missing") base.missing++;
      else if (d.status === "Needs Review") base.review++;
      else if (d.status === "Approved") base.approved++;
      else base.provided++;
    }
    return base;
  }, [clientUploads]);

  const filteredDocs = useMemo(() => {
    let arr = [...clientUploads];

    // tab
    if (docTab === "missing") arr = arr.filter((d) => d.status === "Missing");
    if (docTab === "review") arr = arr.filter((d) => d.status === "Needs Review");
    if (docTab === "approved") arr = arr.filter((d) => d.status === "Approved");
    if (docTab === "provided") arr = arr.filter((d) => d.status === "Provided");

    // search
    const q = docQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.type.toLowerCase().includes(q) ||
          d.status.toLowerCase().includes(q)
      );
    }

    // priority sort (verification-first)
    const rank = (s: DocStatus) =>
      s === "Missing" ? 0 : s === "Needs Review" ? 1 : s === "Provided" ? 2 : 3;
    arr.sort((a, b) => rank(a.status) - rank(b.status));

    return arr;
  }, [clientUploads, docTab, docQuery]);

  /* ================= Fetchers ================= */

  const fetchAcceptedCases = async () => {
    setLoadingCases(true);
    setError("");
    try {
      const res = await fetch(`${ADV_PREP_BASE}/cases/accepted`, {
        method: "GET",
        headers: authHeaders(),
      });

      const data = await safeJson<{ cases?: AcceptedCase[]; error?: string; message?: string }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to load accepted cases");
      }

      const list = Array.isArray(data?.cases) ? data.cases : [];
      setAcceptedCases(list);
      setBlockedStatus(null);

      // pick first only if current selection is empty or no longer exists
      const first = list?.[0]?.id || "";
      setSelectedCaseId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return first;
      });
    } catch (e: any) {
      setAcceptedCases([]);
      setSelectedCaseId("");
      setError(e?.message || "Failed to load accepted cases.");
    } finally {
      setLoadingCases(false);
    }
  };

  const fetchPreparationDetails = async (caseId: string) => {
    setLoadingDetails(true);
    setError("");
    try {
      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(caseId)}`, {
        method: "GET",
        headers: authHeaders(),
      });

      const data = await safeJson<PreparationResponse>(res);
      if (!res.ok) {
        const anyData = data as any;
        const blocked = getCaseNotActiveStatus(anyData);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(anyData?.message || anyData?.error || "Failed to load case preparation details");
      }

      setDetails(data);
      setBlockedStatus(null);
    } catch (e: any) {
      setDetails(null);
      setError(e?.message || "Failed to load case preparation details.");
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    fetchAcceptedCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    fetchPreparationDetails(selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  useEffect(() => {
    setDraftStudioOpen(false);
    setDraftEditor(null);
    setDraftResult(null);
    setDraftSelectedSectionId("");
    setDraftRewriteInstruction("");
    setDraftDirty(false);
    setDraftNotice("");
    setAutoSaveStatus("idle");
    setAutoSavedAt("");
  }, [selectedCaseId]);

  useEffect(() => {
    const loadLatestDraft = async () => {
      if (!details?.case?.id) return;
      setLatestDraftLoading(true);
      try {
        const mappedType = TEMPLATE_DOC_MAP[template];
        const latestUrl = `${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/ai-draft/latest?document_type=${encodeURIComponent(mappedType)}`;
        const res = await fetch(
          latestUrl,
          {
            method: "GET",
            headers: authHeaders(),
          }
        );

        const data = await safeJson<{
          error?: string;
          draft?: DraftContent | null;
          generation_id?: string;
          document_type?: string;
        }>(res);

        if (!res.ok) throw new Error(data?.error || "Failed to load latest draft.");

        if (data?.draft && data?.generation_id && data?.document_type) {
          setDraftResult({
            generationId: String(data.generation_id),
            documentType: String(data.document_type),
            draft: data.draft,
          });
          setDraftEditor(data.draft);
          setDraftSelectedSectionId(data.draft.sections?.[0]?.id || "");
          setDraftDirty(false);
          setDraftNotice("");
          setAutoSaveStatus("idle");
          setAutoSavedAt("");
        } else {
          setDraftEditor(null);
          setDraftResult(null);
          setDraftSelectedSectionId("");
          setDraftDirty(false);
          setDraftNotice("");
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load latest draft.");
      } finally {
        setLatestDraftLoading(false);
      }
    };

    if (selectedCaseId) {
      loadLatestDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId, template]);

  /* ================= Actions ================= */

  const handleGenerateDraft = () => {
    const run = async () => {
      if (!details?.case?.id) return;
      setError("");
      setActionLoading("draft");
      try {
        const mapped = TEMPLATE_DOC_MAP[template];

        setDraftNotice("Generating draft… this can take a couple of minutes.");
        const statusData = await submitDraftJobAndPoll({
          submitUrl: `${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/ai-draft/generate`,
          body: {
            document_type: mapped,
            advocate_notes: noteToClient.trim(),
            language: "English",
          },
          statusUrlFor: (jobId) =>
            `${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/ai-draft/jobs/${encodeURIComponent(jobId)}`,
          headers: authHeaders(),
        });

        setDraftResult({
          generationId: String(statusData?.generation_id || ""),
          documentType: String(statusData?.document_type || mapped),
          draft: statusData?.draft || null,
        });
        setDraftEditor(statusData?.draft || null);
        setDraftSelectedSectionId(statusData?.draft?.sections?.[0]?.id || "");
        setDraftRewriteInstruction("");
        setDraftDirty(false);
        setAutoSaveStatus("idle");
        setAutoSavedAt("");
        setDraftNotice("Draft generated. You can now edit, rewrite sections, and export.");
        setDraftStudioOpen(true);
      } catch (e: any) {
        const rawMsg = e?.message || "Failed to generate AI draft.";
        if (isQuotaError(rawMsg)) {
          setQuotaExceeded(true);
        } else {
          setError(cleanErrorMessage(rawMsg));
        }
      } finally {
        setActionLoading(null);
      }
    };

    run();
  };

  const handleStartNewDraft = () => {
    if (!details?.case?.id) {
      setError("Select an active case first.");
      return;
    }
    const mappedType = TEMPLATE_DOC_MAP[template];
    const seededTitle = `${mappedType} - CASE ${details.case.id}`;
    const seedSection: DraftSection = {
      id: `sec_${Date.now()}`,
      heading: "Draft Body",
      content: "",
    };
    const seededDraft: DraftContent = { title: seededTitle, sections: [seedSection] };

    setDraftEditor(seededDraft);
    setDraftSelectedSectionId(seedSection.id);
    setDraftResult({
      generationId: `manual_${Date.now()}`,
      documentType: mappedType,
      draft: seededDraft,
    });
    setDraftRewriteInstruction("");
    setDraftDirty(true);
    setAutoSaveStatus("idle");
    setAutoSavedAt("");
    setDraftNotice("Started a new draft.");
    setDraftStudioOpen(true);
  };

  const handleTemplateSelect = (nextTemplate: TemplateKey) => {
    if (nextTemplate === template) return;
    if (draftStudioOpen && draftDirty) {
      const ok = window.confirm("You have unsaved changes. Switching template will load another draft. Continue?");
      if (!ok) return;
    }
    setTemplate(nextTemplate);
  };

  const selectedDraftSection = useMemo(() => {
    if (!draftEditor?.sections?.length) return null;
    return draftEditor.sections.find((s) => s.id === draftSelectedSectionId) || draftEditor.sections[0] || null;
  }, [draftEditor, draftSelectedSectionId]);

  const setDraftTitle = (title: string) => {
    setDraftEditor((prev) => (prev ? { ...prev, title } : prev));
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const setDraftSectionHeading = (sectionId: string, heading: string) => {
    setDraftEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, heading } : s)),
      };
    });
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const setDraftSectionContent = (sectionId: string, content: string) => {
    setDraftEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, content } : s)),
      };
    });
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const ensureDraftContext = () => {
    if (!details?.case?.id || !draftResult?.generationId || !draftResult?.documentType || !draftEditor) {
      throw new Error("Draft context missing. Generate draft first.");
    }
    return {
      caseId: details.case.id,
      generationId: draftResult.generationId,
      documentType: draftResult.documentType,
      draft: draftEditor,
    };
  };

  const persistDraft = async (ctx: {
    caseId: string;
    generationId: string;
    documentType: string;
    draft: DraftContent;
  }) => {
    const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(ctx.caseId)}/ai-draft/save`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        generation_id: ctx.generationId,
        document_type: ctx.documentType,
        draft: ctx.draft,
      }),
    });

    const data = await safeJson<{ error?: string; saved?: boolean }>(res);
    if (!res.ok) throw new Error(data?.error || "Failed to save draft.");
    if (!data?.saved) throw new Error("Draft was not saved.");
  };

  const handleSaveDraft = async () => {
    try {
      setDraftNotice("");
      const ctx = ensureDraftContext();
      setDraftBusy("save");

      await persistDraft(ctx);

      setDraftDirty(false);
      setAutoSaveStatus("saved");
      setAutoSavedAt(new Date().toLocaleTimeString());
      setDraftNotice("Draft saved successfully.");
    } catch (e: any) {
      setAutoSaveStatus("error");
      setDraftNotice(e?.message || "Failed to save draft.");
    } finally {
      setDraftBusy(null);
    }
  };

  const addDraftSection = () => {
    setDraftEditor((prev) => {
      if (!prev) return prev;
      const idx = prev.sections.length + 1;
      const section: DraftSection = {
        id: `sec_${Date.now()}`,
        heading: `New Section ${idx}`,
        content: "",
      };
      setDraftSelectedSectionId(section.id);
      return { ...prev, sections: [...prev.sections, section] };
    });
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const moveDraftSection = (sectionId: string, dir: -1 | 1) => {
    setDraftEditor((prev) => {
      if (!prev) return prev;
      const current = prev.sections.findIndex((s) => s.id === sectionId);
      if (current < 0) return prev;
      const target = current + dir;
      if (target < 0 || target >= prev.sections.length) return prev;
      const next = [...prev.sections];
      const [item] = next.splice(current, 1);
      next.splice(target, 0, item);
      return { ...prev, sections: next };
    });
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const deleteDraftSection = (sectionId: string) => {
    setDraftEditor((prev) => {
      if (!prev) return prev;
      if (prev.sections.length <= 1) {
        setDraftNotice("At least one section is required.");
        return prev;
      }

      const idx = prev.sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return prev;
      const nextSections = prev.sections.filter((s) => s.id !== sectionId);
      const nextSelected = nextSections[Math.max(0, Math.min(idx, nextSections.length - 1))]?.id || "";
      setDraftSelectedSectionId(nextSelected);
      return { ...prev, sections: nextSections };
    });
    setDraftDirty(true);
    setAutoSaveStatus("idle");
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExportDraft = async (kind: "docx" | "pdf") => {
    try {
      setDraftNotice("");
      const ctx = ensureDraftContext();
      setDraftBusy(kind === "docx" ? "exportDocx" : "exportPdf");

      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(ctx.caseId)}/ai-draft/export/${kind}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          document_type: ctx.documentType,
          draft: ctx.draft,
        }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data = await safeJson<{ error?: string }>(res);
          throw new Error(data?.error || `Failed to export ${kind.toUpperCase()}.`);
        }
        throw new Error(`Failed to export ${kind.toUpperCase()}.`);
      }

      const blob = await res.blob();
      const ext = kind === "docx" ? "docx" : "pdf";
      const fileName = `${ctx.documentType.replace(/\s+/g, "_")}_${ctx.caseId}.${ext}`;
      downloadBlob(blob, fileName);
      setDraftNotice(`${ext.toUpperCase()} export downloaded.`);
    } catch (e: any) {
      setDraftNotice(e?.message || `Failed to export ${kind.toUpperCase()}.`);
    } finally {
      setDraftBusy(null);
    }
  };

  const handleRewriteSelectedSection = async () => {
    try {
      setDraftNotice("");
      const ctx = ensureDraftContext();
      if (!selectedDraftSection?.id) throw new Error("Select a section first.");
      const instruction = draftRewriteInstruction.trim();
      if (!instruction) throw new Error("Add rewrite instruction first.");

      setDraftBusy("rewrite");
      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(ctx.caseId)}/ai-draft/regenerate-section`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          generation_id: ctx.generationId,
          section_id: selectedDraftSection.id,
          instruction,
          document_type: ctx.documentType,
          language: "English",
          current_draft: ctx.draft,
        }),
      });

      const data = await safeJson<{ error?: string; section?: DraftSection }>(res);
      if (!res.ok) throw new Error(data?.error || "Failed to rewrite section.");
      if (!data?.section) throw new Error("Rewrite response missing section.");

      setDraftEditor((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((s) => (s.id === data.section!.id ? data.section! : s)),
        };
      });
      setDraftDirty(true);
      setDraftNotice("Section rewritten with AI.");
    } catch (e: any) {
      setDraftNotice(e?.message || "Failed to rewrite section.");
    } finally {
      setDraftBusy(null);
    }
  };

  const handleCloseDraftStudio = () => {
    if (draftDirty && !window.confirm("You have unsaved changes. Close draft studio anyway?")) return;
    setDraftStudioOpen(false);
  };

  const handleOpenDraftStudio = () => {
    if (!details?.case?.id) {
      setError("Select an active case first.");
      return;
    }
    setDraftStudioOpen(true);
  };

  useEffect(() => {
    if (!draftStudioOpen || !draftDirty || !draftEditor) return;
    if (draftBusy !== null) return;
    if (!details?.case?.id || !draftResult?.generationId || !draftResult?.documentType) return;

    const timer = window.setTimeout(async () => {
      try {
        const ctx = {
          caseId: details.case.id,
          generationId: draftResult.generationId,
          documentType: draftResult.documentType,
          draft: draftEditor,
        };
        setAutoSaveStatus("saving");
        await persistDraft(ctx);
        setDraftDirty(false);
        setAutoSaveStatus("saved");
        setAutoSavedAt(new Date().toLocaleTimeString());
      } catch (e: any) {
        setAutoSaveStatus("error");
        setDraftNotice(e?.message || "Autosave failed.");
      }
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [draftStudioOpen, draftDirty, draftEditor, draftBusy, details, draftResult]);

  useEffect(() => {
    if (!draftStudioOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (draftBusy !== null) return;

      const key = String(e.key || "").toLowerCase();
      const isMod = e.ctrlKey || e.metaKey;

      if (isMod && key === "s") {
        e.preventDefault();
        void handleSaveDraft();
        return;
      }

      if (isMod && key === "enter") {
        e.preventDefault();
        void handleRewriteSelectedSection();
        return;
      }

      if (e.altKey && (key === "arrowup" || key === "arrowdown") && selectedDraftSection?.id) {
        e.preventDefault();
        moveDraftSection(selectedDraftSection.id, key === "arrowup" ? -1 : 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    draftStudioOpen,
    draftBusy,
    selectedDraftSection?.id,
    draftRewriteInstruction,
    draftEditor,
    handleSaveDraft,
    handleRewriteSelectedSection,
    moveDraftSection,
  ]);

  const handleUpload = async () => {
    if (!details?.case?.id || !quickUploadFile) return;

    setError("");
    setActionLoading("upload");
    try {
      const form = new FormData();
      form.append("file", quickUploadFile);
      form.append("docType", quickUploadDocType || "OTHER");
      if (quickUploadNote.trim()) form.append("note", quickUploadNote.trim());

      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/documents/upload`, {
        method: "POST",
        headers: authOnlyHeaders(),
        body: form,
      });

      const data = await safeJson<{ error?: string; message?: string }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to upload document.");
      }

      setQuickUploadFile(null);
      setQuickUploadNote("");
      await fetchPreparationDetails(details.case.id);
    } catch (e: any) {
      setError(e?.message || "Failed to upload document.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleChecklist = async (doc_key: string, next: boolean) => {
    if (!details?.case?.id) return;
    setError("");
    setActionLoading("checklist");

    try {
      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/items`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ doc_key, is_provided: next, provided_doc_id: null }),
      });

      const data = await safeJson<{ item?: PreparationItem; error?: string; message?: string }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to update checklist item.");
      }

      await fetchPreparationDetails(details.case.id);
    } catch (e: any) {
      setError(e?.message || "Failed to update checklist item.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestMissing = async () => {
    if (!details?.case?.id) return;

    const missing_doc_keys = missingRequiredItems.map((i) => i.doc_key);
    if (missing_doc_keys.length === 0) {
      alert("No missing required checklist items.");
      return;
    }

    setError("");
    setActionLoading("request");
    try {
      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/request-docs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ missing_doc_keys, message: noteToClient }),
      });

      const data = await safeJson<{ ok?: boolean; error?: string; message?: string }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to request missing documents.");
      }

      alert("Request sent (logged).");
    } catch (e: any) {
      setError(e?.message || "Failed to request missing documents.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkCompleted = async () => {
    if (!details?.case?.id) return;

    setError("");
    setActionLoading("complete");
    try {
      const res = await fetch(`${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/complete`, {
        method: "PATCH",
        headers: authHeaders(),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to mark preparation complete.");
      }

      await fetchPreparationDetails(details.case.id);
      alert("Marked as completed.");
    } catch (e: any) {
      setError(e?.message || "Failed to mark preparation complete.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenDoc = (fileUrl: string) => {
    const resolved = resolveDocumentUrl(fileUrl);
    if (!resolved) return;
    window.open(resolved, "_blank", "noopener,noreferrer");
  };

  const handleDownloadDoc = (fileUrl: string) => {
    const resolved = resolveDocumentUrl(fileUrl);
    if (!resolved) return;
    const a = document.createElement("a");
    a.href = resolved;
    a.download = "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleUpdateDocStatus = async (doc: DocItem, status: "NEEDS_REVIEW" | "APPROVED") => {
    if (!details?.case?.id) return;
    setError("");
    setActionLoading("checklist");
    try {
      const res = await fetch(
        `${ADV_PREP_BASE}/${encodeURIComponent(details.case.id)}/documents/${doc.rawId}/status`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ status, source: doc.source }),
        }
      );

      const data = await safeJson<{ document?: BackendCaseDoc; error?: string; message?: string }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to update document status.");
      }

      await fetchPreparationDetails(details.case.id);
    } catch (e: any) {
      setError(e?.message || "Failed to update document status.");
    } finally {
      setActionLoading(null);
    }
  };

  /* ================= Render ================= */

  const showCaseSelector = loadingCases || acceptedCases.length > 0;

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">
            Case Preparation & Documentation
          </h1>
          <p className="text-sm text-slate-600 mt-2">
            Review uploads, verify documents, manage checklist, request missing docs, and generate drafts.
          </p>

          {/* Case selector + refresh (REMOVED empty section when no cases) */}
          {showCaseSelector && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Select case:</span>

              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                disabled={loadingCases || acceptedCases.length === 0}
              >
                {acceptedCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={fetchAcceptedCases}
                disabled={loadingCases}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                title="Refresh cases"
              >
                <RefreshCw size={16} className={loadingCases ? "animate-spin" : ""} />
                Refresh
              </button>

              <button
                type="button"
                onClick={handleOpenDraftStudio}
                disabled={!selectedCaseId || loadingCases}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                title="Open Draft Studio"
              >
                <PenLine size={16} className="text-[#004aad]" />
                Draft Studio
              </button>

              {loadingCases && <span className="text-xs text-slate-500">Loading cases…</span>}
            </div>
          )}

          {!loadingCases && acceptedCases.length === 0 && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              No accepted cases found.
            </div>
          )}

          {/* Client + Case info (more complete + no “— spam” layout) */}
          {(selectedCaseId || loadingDetails) && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Selected Case</div>
                  <div className="mt-1 text-sm font-bold text-slate-900 truncate">
                    {loadingDetails ? "Loading…" : details?.case?.title || selectedCaseSummary?.title || "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Keep uploads + checklist aligned before moving to filing/submission.
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenDraftStudio}
                    disabled={!details?.case?.id}
                    className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold disabled:opacity-60"
                  >
                    <PenLine size={13} className="text-[#004aad]" />
                    Open Draft Studio
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="gray">
                    <ClipboardList size={14} /> {details?.case?.id || selectedCaseSummary?.id || "—"}
                  </Badge>
                  <Badge variant={missingCount > 0 ? "amber" : "green"}>
                    <AlertTriangle size={14} /> Missing: {missingCount}
                  </Badge>
                  <Badge variant="gray">
                    <Clock size={14} /> Case: {normalizeLifecycleStatus(details?.case?.status || selectedCaseSummary?.status || "—")}
                  </Badge>
                </div>
              </div>

              <div className="mt-4 grid md:grid-cols-2 gap-2">
                <InfoRow icon={<User size={16} />} label="Client" value={details?.client?.name || selectedCaseSummary?.client?.name || "—"} />
                <InfoRow icon={<Mail size={16} />} label="Email" value={details?.client?.email || selectedCaseSummary?.client?.email || "—"} />
                <InfoRow icon={<Phone size={16} />} label="Cell" value={formatMaybePhone(details?.client?.phone || selectedCaseSummary?.client?.phone)} />
                <InfoRow icon={<AlertTriangle size={16} />} label="Required missing" value={String(missingRequiredItems.length)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {quotaExceeded && (
        <Modal title="Daily AI limit reached" onClose={() => setQuotaExceeded(false)}>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-700">
                The free AI tier has a daily limit (~20 generations per day for this model), and today's
                limit has been used up.
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">What you can do:</div>
              <div>• Try again later — the limit resets daily (midnight Pacific).</div>
              <div>• Use the AI Studio or drafting model with higher limits for lighter tasks.</div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setQuotaExceeded(false)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white text-sm font-semibold hover:bg-[#003b82] transition"
              >
                OK, got it
              </button>
            </div>
          </div>
        </Modal>
      )}

      {blockedStatus && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Preparation workflow is locked until the case is active. Current status: <b>{normalizeLifecycleStatus(blockedStatus)}</b>.
          Complete contract signatures and admin approval first.
        </div>
      )}

      {/* Top actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
      >
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Case summary */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">Case Snapshot</div>
            <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
              {loadingDetails ? "Loading…" : details?.case?.title || selectedCaseSummary?.title || "—"}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="gray">
                <ClipboardList size={14} /> {details?.case?.id || selectedCaseSummary?.id || "—"}
              </Badge>
              <Badge variant={missingCount > 0 ? "amber" : "green"}>
                <AlertTriangle size={14} /> Missing: {missingCount}
              </Badge>
            </div>
            <div className="text-xs text-slate-500 mt-3">
              Prioritize: Missing → Needs Review → Provided → Approved.
            </div>
          </div>

          {/* Draft Template UI improved (behavior unchanged) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">AI Draft Template</div>
              <Badge variant="gray">
                <PenLine size={14} /> Draft
              </Badge>
            </div>

            <div className="mt-3">
              <label className="text-xs text-slate-500">Select template</label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={template}
                  onChange={(e) => handleTemplateSelect(e.target.value as TemplateKey)}
                  className="h-10 min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none"
                >
                  <option>Plaint</option>
                  <option>Written Statement</option>
                  <option>Affidavit</option>
                  <option>Application (Stay/Injunction)</option>
                  <option>Vakalatnama</option>
                  <option>Notice</option>
                  <option>Misc. Petition</option>
                </select>

                <button
                  type="button"
                  onClick={handleGenerateDraft}
                  disabled={!details?.case?.id || actionLoading === "draft"}
                  className="inline-flex h-10 items-center gap-2 px-4 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm disabled:opacity-60"
                >
                  <PenLine size={16} />
                  {actionLoading === "draft" ? "Generating..." : "Generate"}
                </button>

                <button
                  type="button"
                  onClick={handleOpenDraftStudio}
                  disabled={!details?.case?.id}
                  className="inline-flex h-10 items-center gap-2 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm disabled:opacity-60"
                >
                  <Eye size={16} className="text-[#004aad]" />
                  Draft Studio
                </button>
              </div>
              <div className="text-xs text-slate-500 mt-2">Generates draft using case context, intake analysis, and approved document text.</div>

              {draftResult?.draft && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-64 overflow-auto">
                  <div className="text-xs text-slate-500">{draftResult.documentType} • {draftResult.generationId}</div>
                  <div className="text-sm font-bold text-slate-900 mt-1">{draftResult.draft.title}</div>
                  <div className="mt-2 text-xs text-slate-600">
                    {draftResult.draft.sections.length} section(s) ready in Draft Studio.
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Use Draft Studio to edit/rewrite/export.</div>
                </div>
              )}
            </div>
          </div>

          {/* Quick actions (cleaner + no dead space) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">Quick Actions</div>
              <Badge variant="blue">
                <FileText size={14} /> Docs
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={quickUploadDocType}
                onChange={(e) => setQuickUploadDocType(e.target.value)}
                className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                disabled={!details?.case?.id || actionLoading === "upload"}
              >
                <option value="CNIC_FRONT">CNIC Front</option>
                <option value="CNIC_BACK">CNIC Back</option>
                <option value="ADDRESS_PROOF">Address Proof</option>
                <option value="EVIDENCE">Evidence</option>
                <option value="OTHER">Other</option>
              </select>

              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx"
                onChange={(e) => setQuickUploadFile(e.target.files?.[0] || null)}
                className="col-span-2 text-xs"
                disabled={!details?.case?.id || actionLoading === "upload"}
              />

              <textarea
                value={quickUploadNote}
                onChange={(e) => setQuickUploadNote(e.target.value.slice(0, 1000))}
                rows={2}
                placeholder="Optional note for client and record"
                className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                disabled={!details?.case?.id || actionLoading === "upload"}
              />

              <button
                type="button"
                onClick={handleUpload}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm disabled:opacity-60"
                disabled={!details?.case?.id || !quickUploadFile || actionLoading === "upload"}
              >
                <Upload size={16} className="text-[#004aad]" />
                {actionLoading === "upload" ? "Uploading..." : "Upload"}
              </button>

              <button
                type="button"
                onClick={handleRequestMissing}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm disabled:opacity-60"
                disabled={!details?.case?.id || actionLoading === "request"}
              >
                <MessageSquareText size={16} className="text-[#004aad]" />
                {actionLoading === "request" ? "Requesting…" : "Request Missing"}
              </button>

              <button
                type="button"
                onClick={handleMarkCompleted}
                className="col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm disabled:opacity-60"
                disabled={!details?.case?.id || actionLoading === "complete"}
              >
                <CheckCircle2 size={16} />
                {actionLoading === "complete" ? "Marking…" : "Mark Step Completed"}
              </button>
            </div>

            {missingFlags.length > 0 && (
              <div className="mt-3 text-xs text-slate-600 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <div className="font-semibold text-amber-800 flex items-center gap-2">
                  <AlertTriangle size={14} /> Missing / Risk Flags
                </div>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  {missingFlags.slice(0, 6).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                  {missingFlags.length > 6 && <li>+{missingFlags.length - 6} more…</li>}
                </ul>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-12 gap-4">
        {/* Document verification list (improved) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <FileText size={18} className="text-[#004aad]" />
                Document Verification
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Filter and verify uploads quickly. Highest priority items appear first.
              </div>
            </div>
            <Badge variant="gray">
              <Eye size={14} /> View / Verify
            </Badge>
          </div>

          {/* Tabs + search */}
          <div className="mt-4 flex flex-col gap-3">
            <PillTabs
              value={docTab}
              onChange={(v) => setDocTab(v as any)}
              items={[
                { key: "all", label: "All", count: docCounts.all },
                { key: "missing", label: "Missing", count: docCounts.missing },
                { key: "review", label: "Needs Review", count: docCounts.review },
                { key: "provided", label: "Provided", count: docCounts.provided },
                { key: "approved", label: "Approved", count: docCounts.approved },
              ]}
            />

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
                placeholder="Search by filename, type, or status…"
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loadingDetails ? (
              <div className="text-sm text-slate-500">Loading documents…</div>
            ) : filteredDocs.length === 0 ? (
              <div className="text-sm text-slate-500">No documents match your filters.</div>
            ) : (
              filteredDocs.map((d) => (
                <div key={d.id} className="rounded-2xl border border-slate-200 p-4 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{d.name}</div>
                      <div className="text-xs text-slate-500 mt-1">{d.type}</div>
                      {d.note && <div className="text-xs text-slate-600 mt-2">Note: {d.note}</div>}
                      {d.lastUpdated && (
                        <div className="text-xs text-slate-500 mt-2">Uploaded: {d.lastUpdated}</div>
                      )}
                    </div>
                    <DocBadge s={d.status} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => d.url && handleOpenDoc(d.url)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                      disabled={!d.url}
                    >
                      <Eye size={16} className="text-[#004aad]" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => d.url && handleDownloadDoc(d.url)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                      disabled={!d.url}
                    >
                      <Download size={16} className="text-[#004aad]" />
                      Download
                    </button>
                    {(() => {
                      const isApproved = d.status === "Approved";
                      const isReview = d.status === "Needs Review";
                      const busy = !details?.case?.id || actionLoading === "checklist";
                      return (
                        <>
                          {isApproved ? (
                            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold">
                              <BadgeCheck size={16} className="text-emerald-700" />
                              Verified
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUpdateDocStatus(d, "APPROVED")}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition text-sm font-semibold disabled:opacity-60"
                              disabled={busy}
                            >
                              <BadgeCheck size={16} className="text-emerald-700" />
                              {isReview ? "Confirm Approval" : "Approve"}
                            </button>
                          )}
                          {isReview ? (
                            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold">
                              <AlertTriangle size={16} className="text-amber-700" />
                              Marked Needs Review
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUpdateDocStatus(d, "NEEDS_REVIEW")}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition text-sm font-semibold disabled:opacity-60"
                              disabled={busy}
                            >
                              <AlertTriangle size={16} className="text-amber-700" />
                              Needs Review
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Checklist + client message (kept but tighter) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <CheckCircle2 size={18} className="text-emerald-600" />
                Preparation Checklist
              </div>

              <Badge variant={missingRequiredItems.length > 0 ? "amber" : "green"}>
                <AlertTriangle size={14} /> Required Missing: {missingRequiredItems.length}
              </Badge>
            </div>

            <div className="mt-4 space-y-2">
              {loadingDetails ? (
                <div className="text-sm text-slate-500">Loading checklist…</div>
              ) : checklist.length === 0 ? (
                <div className="text-sm text-slate-500">No checklist items.</div>
              ) : (
                checklist.map((c) => (
                  <div
                    key={c.doc_key}
                    className={`rounded-2xl border p-4 flex items-start justify-between gap-3 ${
                      c.is_provided ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {c.title}{" "}
                        {c.is_required && <span className="text-xs text-amber-700">(Required)</span>}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">Key: {c.doc_key}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleChecklist(c.doc_key, !c.is_provided)}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition text-sm font-semibold disabled:opacity-60 ${
                        c.is_provided
                          ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                      disabled={!details?.case?.id || actionLoading === "checklist"}
                      title={actionLoading === "checklist" ? "Updating..." : "Toggle"}
                    >
                      {c.is_provided ? (
                        <>
                          <CheckCircle2 size={16} className="text-emerald-700" />
                          Done
                        </>
                      ) : (
                        <>
                          <Clock size={16} className="text-slate-700" />
                          Pending
                        </>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Message to client */}
            <div className="mt-5">
              <label className="text-sm font-semibold text-slate-800">Message to Client (Request / Notes)</label>
              <textarea
                value={noteToClient}
                onChange={(e) => setNoteToClient(e.target.value)}
                className="mt-2 w-full border border-slate-200 rounded-2xl p-3 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                rows={4}
                placeholder="Write what you need from client to proceed..."
              />
              <button
                type="button"
                onClick={handleRequestMissing}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm disabled:opacity-60"
                disabled={!details?.case?.id || actionLoading === "request"}
              >
                <MessageSquareText size={16} />
                {actionLoading === "request" ? "Sending..." : "Send to Client"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Note */}
      <div className="text-xs text-slate-500">
        Next step later: Filing/Submission workflow (court fee voucher, verification, diary number, notices/summons).
      </div>

      {draftStudioOpen && details?.case?.id && (
        <div className="fixed inset-0 z-[130] bg-slate-900/45 backdrop-blur-[1px] p-2 md:p-4">
          <div className="mx-auto h-full w-full max-w-[96rem] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 md:px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">Draft Studio</div>
                <div className="text-sm md:text-base font-bold text-slate-900 truncate">
                  {(draftResult?.documentType || TEMPLATE_DOC_MAP[template])} • {draftResult?.generationId || "new_draft"} {draftDirty ? "• Unsaved changes" : ""}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {autoSaveStatus === "saving"
                    ? "Autosaving..."
                    : autoSaveStatus === "saved" && autoSavedAt
                    ? `Autosaved at ${autoSavedAt}`
                    : autoSaveStatus === "error"
                    ? "Autosave failed"
                    : ""}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={template}
                  onChange={(e) => handleTemplateSelect(e.target.value as TemplateKey)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs md:text-sm outline-none"
                  disabled={draftBusy !== null || latestDraftLoading}
                >
                  <option>Plaint</option>
                  <option>Written Statement</option>
                  <option>Affidavit</option>
                  <option>Application (Stay/Injunction)</option>
                  <option>Vakalatnama</option>
                  <option>Notice</option>
                  <option>Misc. Petition</option>
                </select>

                <button
                  type="button"
                  onClick={handleStartNewDraft}
                  disabled={draftBusy !== null || latestDraftLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Plus size={14} className="text-[#004aad]" /> New Draft
                </button>

                <button
                  type="button"
                  onClick={handleGenerateDraft}
                  disabled={!details?.case?.id || actionLoading === "draft" || latestDraftLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Sparkles size={14} />
                  {actionLoading === "draft" ? "Generating..." : "Generate"}
                </button>

                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={draftBusy !== null || !draftEditor || !draftResult}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Save size={14} className="text-[#004aad]" />
                  {draftBusy === "save" ? "Saving..." : "Save"}
                </button>

                <button
                  type="button"
                  onClick={() => handleExportDraft("docx")}
                  disabled={draftBusy !== null || !draftEditor || !draftResult}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Download size={14} className="text-[#004aad]" />
                  {draftBusy === "exportDocx" ? "Exporting..." : "DOCX"}
                </button>

                <button
                  type="button"
                  onClick={() => handleExportDraft("pdf")}
                  disabled={draftBusy !== null || !draftEditor || !draftResult}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Download size={14} className="text-[#004aad]" />
                  {draftBusy === "exportPdf" ? "Exporting..." : "PDF"}
                </button>

                <button
                  type="button"
                  onClick={handleCloseDraftStudio}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold"
                >
                  <XCircle size={14} className="text-slate-600" /> Close
                </button>
              </div>
            </div>

            {draftNotice && (
              <div className="px-4 md:px-6 py-2 text-xs md:text-sm border-b border-slate-100 text-slate-700 bg-slate-50">
                {draftNotice}
              </div>
            )}

            <div className="px-4 md:px-6 py-2 border-b border-slate-100 bg-white text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>Shortcut: Ctrl/Cmd+S to Save</span>
              <span>Shortcut: Ctrl/Cmd+Enter to Rewrite with AI</span>
              <span>Shortcut: Alt+ArrowUp / Alt+ArrowDown to Reorder Section</span>
              {latestDraftLoading && <span>Loading latest draft...</span>}
            </div>

            <div className="flex-1 min-h-0 grid md:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="border-r border-slate-200 p-3 md:p-4 overflow-auto bg-slate-50">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">Sections</div>
                  <button
                    type="button"
                    onClick={addDraftSection}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold"
                  >
                    <Plus size={12} className="text-[#004aad]" /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {(draftEditor?.sections || []).map((s, idx) => {
                    const active = s.id === (selectedDraftSection?.id || "");
                    return (
                      <div
                        key={s.id}
                        onClick={() => setDraftSelectedSectionId(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDraftSelectedSectionId(s.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full text-left rounded-xl border p-2 text-xs md:text-sm transition ${
                          active
                            ? "border-[#004aad] bg-[#004aad]/10 text-[#004aad]"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="font-semibold">{idx + 1}. {s.heading || `Section ${idx + 1}`}</div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-500 truncate">{s.id}</div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveDraftSection(s.id, -1);
                              }}
                              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50"
                              title="Move up"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveDraftSection(s.id, 1);
                              }}
                              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50"
                              title="Move down"
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteDraftSection(s.id);
                              }}
                              className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-700 hover:bg-rose-100"
                              title="Delete section"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <main className="p-3 md:p-4 overflow-auto">
                <div className="space-y-3">
                  {!draftEditor ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      No saved draft found for this template and case. Click <b>New Draft</b> to start manually or <b>Generate</b> to create with AI.
                    </div>
                  ) : (
                    <>
                  <div>
                    <label className="text-xs text-slate-500">Draft Title</label>
                    <input
                      value={draftEditor.title}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                    />
                  </div>

                  {selectedDraftSection ? (
                    <>
                      <div>
                        <label className="text-xs text-slate-500">Section Heading</label>
                        <input
                          value={selectedDraftSection.heading}
                          onChange={(e) => setDraftSectionHeading(selectedDraftSection.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-500">Section Content</label>
                        <textarea
                          value={selectedDraftSection.content}
                          onChange={(e) => setDraftSectionContent(selectedDraftSection.id, e.target.value)}
                          rows={18}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                        />
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">Rewrite Selected Section with AI</div>
                        <textarea
                          value={draftRewriteInstruction}
                          onChange={(e) => setDraftRewriteInstruction(e.target.value)}
                          rows={3}
                          placeholder="Example: Make this section more concise and add stronger legal grounds with Pakistani civil practice tone."
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none"
                        />
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={handleRewriteSelectedSection}
                            disabled={draftBusy !== null}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-sm font-semibold disabled:opacity-60"
                          >
                            <Sparkles size={14} />
                            {draftBusy === "rewrite" ? "Rewriting..." : "Rewrite with AI"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500">Select a section to edit.</div>
                  )}
                    </>
                  )}
                </div>
              </main>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
