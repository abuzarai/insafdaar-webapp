import { formatStatus } from "../common/formatStatus";
import React, { useEffect, useMemo, useState } from "react";
import AuthedLink from "../common/AuthedLink";
import { FileText, PenSquare, CheckCircle2, RefreshCw, Paperclip, ShieldCheck, Sparkles, Save, XCircle, Plus, Download, AlertTriangle } from "lucide-react";
import { API_BASE_URL } from "../../config";
import { submitDraftJobAndPoll } from "../../utils/draftJob";

function isQuotaError(raw: string): boolean {
  return /429|RESOURCE_EXHAUSTED|quota|Quota|rate.?limit/i.test(raw || "");
}

function cleanErrorMessage(raw: string): string {
  if (!raw) return "Failed to generate AI draft.";
  const m = raw.match(/^(.*?)(?:\s*\{\s*['"]error|\.$)/s);
  const clean = (m && m[1] ? m[1] : raw).trim();
  return clean || "Failed to generate AI draft.";
}

function QuotaModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-base font-semibold text-slate-900">Daily AI limit reached</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition">
            <XCircle size={18} className="text-slate-700" />
          </button>
        </div>
        <div className="p-5">
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
              <div>• Use the AI Studio or another model with higher limits for lighter tasks.</div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white text-sm font-semibold hover:bg-[#003b82] transition"
              >
                OK, got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type AssignedCase = {
  id: string;
  title: string;
  status: string;
};

type Attachment = {
  id: number;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

type ContractPayload = {
  id: number;
  caseId: number;
  versionNo: number;
  title: string | null;
  contractText: string;
  status: string;
  attachments?: Attachment[];
  signatures?: {
    clientSignature?: { typed_full_name: string; signed_at: string } | null;
    advocateSignature?: { typed_full_name: string; signed_at: string } | null;
  };
};

type DraftSection = {
  id: string;
  heading: string;
  content: string;
};

type DraftContent = {
  title: string;
  sections: DraftSection[];
};

function authHeaders(json = false): Headers {
  const h = new Headers();
  const token = localStorage.getItem("token");
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (json) h.set("Content-Type", "application/json");
  return h;
}

async function safeJson(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function prettyFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ContractSection() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [contractTitle, setContractTitle] = useState("Representation Agreement");
  const [contractText, setContractText] = useState("");
  const [contract, setContract] = useState<ContractPayload | null>(null);
  const [typedFullName, setTypedFullName] = useState("");
  const [signatureNote, setSignatureNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"refresh" | "save" | "otpRequest" | "otpVerify" | "sign" | "upload" | null>(null);
  const [msg, setMsg] = useState("");
  const [otpRequestId, setOtpRequestId] = useState<number | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpSessionId, setOtpSessionId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [draftStudioOpen, setDraftStudioOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftBusy, setDraftBusy] = useState<null | "generate" | "save" | "rewrite" | "exportDocx" | "exportPdf">(null);
  const [draftResult, setDraftResult] = useState<{ generationId: string; documentType: string; draft: DraftContent | null } | null>(null);
  const [draftEditor, setDraftEditor] = useState<DraftContent | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [aiNotes, setAiNotes] = useState("");

  const [confirmedReadUnderstood, setConfirmedReadUnderstood] = useState(false);
  const [confirmedVoluntary, setConfirmedVoluntary] = useState(false);
  const [confirmedTypedSignature, setConfirmedTypedSignature] = useState(false);
  const [confirmedReviewedAttachments, setConfirmedReviewedAttachments] = useState(false);

  const selectedNumericCaseId = useMemo(() => {
    if (!selectedCaseId) return null;
    const raw = selectedCaseId.startsWith("CASE-") ? selectedCaseId.split("-")[1] : selectedCaseId;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [selectedCaseId]);

  const loadCases = async () => {
    const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/cases/assigned`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load cases");
    const list = Array.isArray(data?.cases) ? data.cases : [];
    setCases(list);
    if (!selectedCaseId && list.length > 0) setSelectedCaseId(String(list[0].id));
  };

  const loadContract = async (caseId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${caseId}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load contract");
    const c = (data?.contract || null) as ContractPayload | null;
    setContract(c);
    if (c) {
      setContractTitle(c.title || "Representation Agreement");
      setContractText(c.contractText || "");
    } else {
      setContractText("");
      setContractTitle("Representation Agreement");
    }
  };

  const refresh = async () => {
    try {
      setAction("refresh");
      setLoading(true);
      setMsg("");
      await loadCases();
      if (selectedNumericCaseId) await loadContract(selectedNumericCaseId);
    } catch (e: any) {
      setMsg(e?.message || "Failed to refresh");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedNumericCaseId) return;
    loadContract(selectedNumericCaseId).catch(() => setContract(null));
  }, [selectedNumericCaseId]);

  const fetchLatestAIDraft = async (caseId: number) => {
    setDraftLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${caseId}/ai-draft/latest`, {
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to load latest AI draft");

      if (data?.draft && data?.generation_id) {
        setDraftResult({
          generationId: String(data.generation_id),
          documentType: String(data.document_type || "Client-Lawyer Contract"),
          draft: data.draft,
        });
        setDraftEditor(data.draft);
        setSelectedSectionId(data.draft.sections?.[0]?.id || "");
        setDraftDirty(false);
        setDraftNotice("");
      } else {
        setDraftResult(null);
        setDraftEditor(null);
        setSelectedSectionId("");
        setDraftDirty(false);
        setDraftNotice("");
      }
    } finally {
      setDraftLoading(false);
    }
  };

  const startNewDraft = () => {
    if (!selectedNumericCaseId) return;
    const section: DraftSection = { id: `sec_${Date.now()}`, heading: "Scope of Services", content: "" };
    const draft: DraftContent = {
      title: `Client-Lawyer Contract - CASE ${selectedNumericCaseId}`,
      sections: [section],
    };
    setDraftResult({
      generationId: `manual_${Date.now()}`,
      documentType: "Client-Lawyer Contract",
      draft,
    });
    setDraftEditor(draft);
    setSelectedSectionId(section.id);
    setDraftDirty(true);
    setDraftNotice("Started new manual contract draft.");
  };

  const openDraftStudio = async () => {
    if (!selectedNumericCaseId) return;
    setDraftStudioOpen(true);
    try {
      await fetchLatestAIDraft(selectedNumericCaseId);
    } catch (e: any) {
      setDraftNotice(e?.message || "Failed to load latest AI draft");
    }
  };

  const generateAIDraft = async () => {
    if (!selectedNumericCaseId) return;
    try {
      setDraftBusy("generate");
      setDraftNotice("Generating draft… this can take a couple of minutes.");
      const statusData = await submitDraftJobAndPoll({
        submitUrl: `${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/ai-draft/generate`,
        body: { advocate_notes: aiNotes.trim(), language: "English" },
        statusUrlFor: (jobId) =>
          `${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/ai-draft/jobs/${encodeURIComponent(jobId)}`,
        headers: authHeaders(true),
      });

      setDraftResult({
        generationId: String(statusData?.generation_id || ""),
        documentType: String(statusData?.document_type || "Client-Lawyer Contract"),
        draft: statusData?.draft || null,
      });
      setDraftEditor(statusData?.draft || null);
      setSelectedSectionId(statusData?.draft?.sections?.[0]?.id || "");
      setDraftDirty(false);
      setDraftNotice("AI contract draft generated.");
    } catch (e: any) {
      const rawMsg = e?.message || "Failed to generate AI draft";
      if (isQuotaError(rawMsg)) {
        setQuotaExceeded(true);
      } else {
        setDraftNotice(cleanErrorMessage(rawMsg));
      }
    } finally {
      setDraftBusy(null);
    }
  };

  const saveAIDraft = async () => {
    if (!selectedNumericCaseId || !draftResult?.generationId || !draftEditor) return;
    try {
      setDraftBusy("save");
      setDraftNotice("");
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/ai-draft/save`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ generation_id: draftResult.generationId, draft: draftEditor }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.saved) throw new Error(data?.error || "Failed to save draft");
      setDraftDirty(false);
      setDraftNotice("Draft saved.");
    } catch (e: any) {
      setDraftNotice(e?.message || "Failed to save draft");
    } finally {
      setDraftBusy(null);
    }
  };

  const regenerateSection = async () => {
    if (!selectedNumericCaseId || !draftResult?.generationId || !draftEditor || !selectedSectionId || !rewriteInstruction.trim()) return;
    try {
      setDraftBusy("rewrite");
      setDraftNotice("");
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/ai-draft/regenerate-section`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          generation_id: draftResult.generationId,
          section_id: selectedSectionId,
          instruction: rewriteInstruction.trim(),
          current_draft: draftEditor,
          language: "English",
        }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.section) throw new Error(data?.error || "Failed to regenerate section");

      setDraftEditor((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((s) => (s.id === data.section.id ? data.section : s)),
        };
      });
      setDraftDirty(true);
      setDraftNotice("Section regenerated.");
    } catch (e: any) {
      setDraftNotice(e?.message || "Failed to regenerate section");
    } finally {
      setDraftBusy(null);
    }
  };

  const applyDraftToContractText = () => {
    if (!draftEditor) return;
    const text = [draftEditor.title, ...draftEditor.sections.map((s) => `${s.heading}\n${s.content}`)].join("\n\n");
    setContractTitle(draftEditor.title || "Representation Agreement");
    setContractText(text);
    setMsg("Draft content applied to contract text. Click Save Contract to persist as contract version.");
    setDraftStudioOpen(false);
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

  const exportDraft = async (kind: "docx" | "pdf") => {
    if (!selectedNumericCaseId || !draftEditor) return;
    try {
      setDraftNotice("");
      setDraftBusy(kind === "docx" ? "exportDocx" : "exportPdf");
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/ai-draft/export/${kind}`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ draft: draftEditor }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data = await safeJson(res);
          throw new Error(data?.error || `Failed to export ${kind.toUpperCase()}`);
        }
        throw new Error(`Failed to export ${kind.toUpperCase()}`);
      }

      const blob = await res.blob();
      const ext = kind === "docx" ? "docx" : "pdf";
      downloadBlob(blob, `Contract_CASE_${selectedNumericCaseId}.${ext}`);
      setDraftNotice(`${ext.toUpperCase()} downloaded.`);
    } catch (e: any) {
      setDraftNotice(e?.message || `Failed to export ${kind.toUpperCase()}`);
    } finally {
      setDraftBusy(null);
    }
  };

  const selectedDraftSection = useMemo(() => {
    if (!draftEditor?.sections?.length) return null;
    return draftEditor.sections.find((s) => s.id === selectedSectionId) || draftEditor.sections[0] || null;
  }, [draftEditor, selectedSectionId]);

  const saveContract = async () => {
    if (!selectedNumericCaseId) return;
    try {
      setAction("save");
      setLoading(true);
      setMsg("");
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({
          title: contractTitle,
          contractText,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to save contract");
      const saved = (data?.contract || null) as ContractPayload | null;
      setContract(saved);
      setMsg(
        `Contract saved — v${saved?.versionNo ?? "?"} persisted. Keep editing and save again anytime.`
      );
      setOtpCode("");
      setOtpRequestId(null);
      setOtpSessionId("");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save contract");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const uploadAttachment = async () => {
    if (!selectedNumericCaseId || !uploadFile) return;
    try {
      setAction("upload");
      setLoading(true);
      setMsg("");

      const form = new FormData();
      form.append("attachment", uploadFile);

      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/attachments`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to upload attachment");

      setUploadFile(null);
      setMsg("Attachment uploaded.");
      await loadContract(selectedNumericCaseId);
    } catch (e: any) {
      setMsg(e?.message || "Failed to upload attachment");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const requestOtp = async () => {
    if (!selectedNumericCaseId) return;
    try {
      setAction("otpRequest");
      setLoading(true);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/sign/request-otp`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to request OTP");

      setOtpRequestId(Number(data?.otpRequestId || 0) || null);
      setOtpSessionId("");
      setMsg("OTP sent to your email.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to request OTP");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const verifyOtp = async () => {
    if (!selectedNumericCaseId || !otpRequestId) return;
    try {
      setAction("otpVerify");
      setLoading(true);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/sign/verify-otp`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          otpRequestId,
          otpCode,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to verify OTP");

      setOtpSessionId(String(data?.otpSessionId || ""));
      setOtpCode("");
      setMsg("OTP verified successfully. You can sign now.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to verify OTP");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const signContract = async () => {
    if (!selectedNumericCaseId) return;
    try {
      setAction("sign");
      setLoading(true);
      setMsg("");
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/contracts/cases/${selectedNumericCaseId}/sign`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          typedFullName,
          // merged checkbox covers read + understood + agree → satisfies consent
          consentChecked: confirmedReadUnderstood,
          signatureNote: signatureNote.trim() || undefined,
          otpSessionId,
          confirmedReadUnderstood,
          confirmedVoluntary,
          confirmedTypedSignature,
          confirmedReviewedAttachments,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to sign contract");
      setContract((data?.contract || null) as ContractPayload | null);
      setMsg("Contract signed successfully.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign contract");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const advocateSigned = Boolean(contract?.signatures?.advocateSignature);
  const clientSigned = Boolean(contract?.signatures?.clientSignature);
  const otpVerified = Boolean(otpSessionId);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">Contract Workspace</h1>
          <p className="text-sm text-slate-600 mt-2">Source of truth is in-system text. Attachments are reference only.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openDraftStudio}
            disabled={!selectedNumericCaseId}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold disabled:opacity-50"
          >
            <Sparkles size={16} className="text-[#004aad]" /> Draft Studio
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={16} className={loading && action === "refresh" ? "animate-spin" : ""} />
            {loading && action === "refresh" ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {msg ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">{msg}</div> : null}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-xs text-slate-500 mb-2">Select assigned case</div>
        <select
          value={selectedCaseId}
          onChange={(e) => setSelectedCaseId(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-3 py-2"
        >
          {cases.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.id} - {c.title}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText size={16} /> Draft Contract {contract ? `(v${contract.versionNo})` : ""}
        </div>
        <input
          value={contractTitle}
          onChange={(e) => setContractTitle(e.target.value)}
          placeholder="Contract title"
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
        <textarea
          value={contractText}
          onChange={(e) => setContractText(e.target.value)}
          rows={12}
          placeholder="Write contract terms here..."
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={saveContract}
          disabled={loading || !selectedNumericCaseId || !contractText.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white font-semibold disabled:opacity-50"
        >
          <PenSquare size={16} /> {loading && action === "save" ? "Saving..." : "Save Contract"}
        </button>
        {msg ? (
          <div
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium ${
              msg.startsWith("") || msg.includes("saved") || msg.includes("created")
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {msg}
          </div>
        ) : null}
      </div>

      {contract && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Paperclip size={16} /> Attachments (PDF/DOCX, max 10MB each)
          </div>
          <div className="text-xs text-slate-500">Reference only. If attachment differs, contract text above governs signatures.</div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            <button
              type="button"
              onClick={uploadAttachment}
              disabled={loading || !uploadFile || !selectedNumericCaseId}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold disabled:opacity-50"
            >
              {loading && action === "upload" ? "Uploading..." : "Upload"}
            </button>
          </div>
          <div className="space-y-2">
            {(contract.attachments || []).length === 0 ? (
              <div className="text-sm text-slate-500">No attachments uploaded for this version.</div>
            ) : (
              (contract.attachments || []).map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 p-3 text-sm flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.file_name}</div>
                    <div className="text-xs text-slate-500">{a.mime_type} • {prettyFileSize(a.file_size)}</div>
                  </div>
                  <AuthedLink
                    url={`/uploads/contracts/${a.file_path}`}
                    className="text-[#004aad] text-xs font-semibold"
                  >
                    Open
                  </AuthedLink>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {draftStudioOpen && (
        <div className="fixed inset-0 z-[140] bg-slate-900/45 p-2 md:p-4">
          <div className="mx-auto h-full w-full max-w-[96rem] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 md:px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">Contract Draft Studio</div>
                <div className="text-sm md:text-base font-bold text-slate-900">
                  {draftResult?.documentType || "Client-Lawyer Contract"} • {draftResult?.generationId || "new_draft"} {draftDirty ? "• Unsaved changes" : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={startNewDraft}
                  disabled={draftBusy !== null || draftLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Plus size={14} className="text-[#004aad]" /> New Draft
                </button>
                <button
                  type="button"
                  onClick={generateAIDraft}
                  disabled={draftBusy !== null || draftLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Sparkles size={14} /> {draftBusy === "generate" ? "Generating..." : "Generate"}
                </button>
                <button
                  type="button"
                  onClick={saveAIDraft}
                  disabled={draftBusy !== null || !draftEditor || !draftResult}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Save size={14} className="text-[#004aad]" /> {draftBusy === "save" ? "Saving..." : "Save Draft"}
                </button>
                <button
                  type="button"
                  onClick={() => exportDraft("docx")}
                  disabled={draftBusy !== null || !draftEditor}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Download size={14} className="text-[#004aad]" /> {draftBusy === "exportDocx" ? "Exporting..." : "DOCX"}
                </button>
                <button
                  type="button"
                  onClick={() => exportDraft("pdf")}
                  disabled={draftBusy !== null || !draftEditor}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <Download size={14} className="text-[#004aad]" /> {draftBusy === "exportPdf" ? "Exporting..." : "PDF"}
                </button>
                <button
                  type="button"
                  onClick={applyDraftToContractText}
                  disabled={!draftEditor}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold disabled:opacity-60"
                >
                  <PenSquare size={14} className="text-[#004aad]" /> Apply to Contract
                </button>
                <button
                  type="button"
                  onClick={() => setDraftStudioOpen(false)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs md:text-sm font-semibold"
                >
                  <XCircle size={14} /> Close
                </button>
              </div>
            </div>

            <div className="px-4 md:px-6 py-2 border-b border-slate-100 bg-white text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>Use AI notes to steer generation tone and fee terms.</span>
              {draftLoading && <span>Loading latest draft...</span>}
            </div>

            {draftNotice ? <div className="px-4 md:px-6 py-2 text-xs md:text-sm border-b border-slate-100 text-slate-700 bg-slate-50">{draftNotice}</div> : null}
            {quotaExceeded && <QuotaModal onClose={() => setQuotaExceeded(false)} />}

            <div className="px-4 md:px-6 py-3 border-b border-slate-100">
              <textarea
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                rows={2}
                placeholder="Optional AI notes (fees, payment schedule, special clauses)..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none"
              />
            </div>

            <div className="flex-1 min-h-0 grid md:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="border-r border-slate-200 p-3 md:p-4 overflow-auto bg-slate-50">
                <div className="text-xs text-slate-500 mb-2">Sections</div>
                <div className="space-y-2">
                  {(draftEditor?.sections || []).map((s, idx) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSectionId(s.id)}
                      className={`w-full text-left rounded-xl border p-2 text-xs md:text-sm transition ${
                        s.id === (selectedDraftSection?.id || "")
                          ? "border-[#004aad] bg-[#004aad]/10 text-[#004aad]"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-semibold">{idx + 1}. {s.heading || `Section ${idx + 1}`}</div>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="p-3 md:p-4 overflow-auto">
                {!draftEditor ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    No saved draft found. Click <b>New Draft</b> or <b>Generate</b>.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-500">Draft Title</label>
                      <input
                        value={draftEditor.title}
                        onChange={(e) => {
                          setDraftEditor((prev) => (prev ? { ...prev, title: e.target.value } : prev));
                          setDraftDirty(true);
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    {selectedDraftSection ? (
                      <>
                        <div>
                          <label className="text-xs text-slate-500">Section Heading</label>
                          <input
                            value={selectedDraftSection.heading}
                            onChange={(e) => {
                              setDraftEditor((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  sections: prev.sections.map((s) => (s.id === selectedDraftSection.id ? { ...s, heading: e.target.value } : s)),
                                };
                              });
                              setDraftDirty(true);
                            }}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-slate-500">Section Content</label>
                          <textarea
                            value={selectedDraftSection.content}
                            onChange={(e) => {
                              setDraftEditor((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  sections: prev.sections.map((s) => (s.id === selectedDraftSection.id ? { ...s, content: e.target.value } : s)),
                                };
                              });
                              setDraftDirty(true);
                            }}
                            rows={14}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                          />
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">Rewrite Selected Section with AI</div>
                          <textarea
                            value={rewriteInstruction}
                            onChange={(e) => setRewriteInstruction(e.target.value)}
                            rows={3}
                            placeholder="Example: strengthen payment default clause and make it concise."
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={regenerateSection}
                            disabled={draftBusy !== null || !rewriteInstruction.trim()}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition text-sm font-semibold disabled:opacity-60"
                          >
                            <Sparkles size={14} /> {draftBusy === "rewrite" ? "Rewriting..." : "Rewrite with AI"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-500">Select a section to edit.</div>
                    )}
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      )}

      {contract && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <CheckCircle2 size={16} /> Signatures
            <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50">{formatStatus(contract.status)} • v{contract.versionNo}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="font-semibold text-slate-700">Client</div>
              <div className="mt-1 text-slate-600">
                {clientSigned
                  ? `${contract.signatures?.clientSignature?.typed_full_name} • ${new Date(
                      contract.signatures?.clientSignature?.signed_at || ""
                    ).toLocaleString()}`
                  : "Pending"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="font-semibold text-slate-700">Advocate</div>
              <div className="mt-1 text-slate-600">
                {advocateSigned
                  ? `${contract.signatures?.advocateSignature?.typed_full_name} • ${new Date(
                      contract.signatures?.advocateSignature?.signed_at || ""
                    ).toLocaleString()}`
                  : "Pending"}
              </div>
            </div>
          </div>

          {!advocateSigned && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50">
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck size={16} /> OTP Verification
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={requestOtp}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold disabled:opacity-50"
                >
                  {loading && action === "otpRequest" ? "Sending OTP..." : "Send OTP"}
                </button>
                <input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="Enter 6-digit OTP"
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={verifyOtp}
                  disabled={loading || otpVerified || !otpRequestId || otpCode.trim().length < 6}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold disabled:opacity-50"
                >
                  {loading && action === "otpVerify" ? "Verifying..." : otpVerified ? "OTP Verified" : "Verify OTP"}
                </button>
              </div>

              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  otpVerified
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {otpVerified
                  ? "OTP is verified for this signing session. You can click Sign Contract now."
                  : "OTP not verified yet. Request OTP, enter the code from email, then click Verify OTP."}
              </div>

              <div className="text-sm font-semibold text-slate-900">Advocate Signature</div>
              <input
                value={typedFullName}
                onChange={(e) => setTypedFullName(e.target.value)}
                placeholder="Type full legal name"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                value={signatureNote}
                onChange={(e) => setSignatureNote(e.target.value)}
                rows={2}
                placeholder="Optional note"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={confirmedReadUnderstood} onChange={(e) => setConfirmedReadUnderstood(e.target.checked)} />
                I confirm I have read, understood, and agree to this contract.
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={confirmedVoluntary} onChange={(e) => setConfirmedVoluntary(e.target.checked)} />
                I agree to these terms voluntarily.
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={confirmedTypedSignature} onChange={(e) => setConfirmedTypedSignature(e.target.checked)} />
                My typed full name is my legal signature.
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmedReviewedAttachments}
                  onChange={(e) => setConfirmedReviewedAttachments(e.target.checked)}
                />
                I confirm I reviewed all attached reference files.
              </label>

              <button
                type="button"
                onClick={signContract}
                disabled={
                  loading ||
                  !typedFullName.trim() ||
                  !otpSessionId ||
                  !confirmedReadUnderstood ||
                  !confirmedVoluntary ||
                  !confirmedTypedSignature ||
                  !confirmedReviewedAttachments
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white font-semibold disabled:opacity-50"
              >
                <CheckCircle2 size={16} /> {loading && action === "sign" ? "Signing..." : "Sign Contract"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
