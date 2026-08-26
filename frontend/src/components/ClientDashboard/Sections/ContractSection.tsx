import { formatStatus } from "../../common/formatStatus";
import React, { useEffect, useMemo, useState } from "react";
import { FileText, CheckCircle2, PenSquare, RefreshCw, Paperclip, ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "../../../config";

type CaseItem = {
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

function authHeaders(json = false): Headers {
  const headers = new Headers();
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (json) headers.set("Content-Type", "application/json");
  return headers;
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
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [contract, setContract] = useState<ContractPayload | null>(null);
  const [typedFullName, setTypedFullName] = useState("");
  const [signatureNote, setSignatureNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"refresh" | "otpRequest" | "otpVerify" | "sign" | null>(null);
  const [msg, setMsg] = useState("");
  const [otpRequestId, setOtpRequestId] = useState<number | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpSessionId, setOtpSessionId] = useState("");

  const [confirmedReadUnderstood, setConfirmedReadUnderstood] = useState(false);
  const [confirmedVoluntary, setConfirmedVoluntary] = useState(false);
  const [confirmedTypedSignature, setConfirmedTypedSignature] = useState(false);
  const [confirmedReviewedAttachments, setConfirmedReviewedAttachments] = useState(false);

  const selectedNumericCaseId = useMemo(() => {
    if (!selectedCaseId) return null;
    const normalized = selectedCaseId.startsWith("CASE-")
      ? selectedCaseId.split("-")[1]
      : selectedCaseId;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }, [selectedCaseId]);

  const loadCases = async () => {
    const res = await fetch(`${API_BASE_URL}/api/client/dashboard/cases`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load cases");
    const list = Array.isArray(data?.cases) ? data.cases : [];
    setCases(list);
    if (!selectedCaseId && list.length > 0) setSelectedCaseId(String(list[0].id));
  };

  const loadContract = async (caseId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/client/dashboard/contracts/cases/${caseId}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load contract");
    setContract((data?.contract || null) as ContractPayload | null);
  };

  const refresh = async () => {
    try {
      setAction("refresh");
      setLoading(true);
      setMsg("");
      await loadCases();
      if (selectedNumericCaseId) await loadContract(selectedNumericCaseId);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load contracts");
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
    loadContract(selectedNumericCaseId).catch(() => {
      setContract(null);
    });
  }, [selectedNumericCaseId]);

  const requestOtp = async () => {
    if (!selectedNumericCaseId) return;
    try {
      setAction("otpRequest");
      setLoading(true);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/client/dashboard/contracts/cases/${selectedNumericCaseId}/sign/request-otp`, {
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

      const res = await fetch(`${API_BASE_URL}/api/client/dashboard/contracts/cases/${selectedNumericCaseId}/sign/verify-otp`, {
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
      const res = await fetch(`${API_BASE_URL}/api/client/dashboard/contracts/cases/${selectedNumericCaseId}/sign`, {
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

  const clientSigned = Boolean(contract?.signatures?.clientSignature);
  const advocateSigned = Boolean(contract?.signatures?.advocateSignature);
  const otpVerified = Boolean(otpSessionId);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">Case Contract</h1>
          <p className="text-sm text-slate-600 mt-2">In-system contract text is the signed legal source of truth.</p>
        </div>
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

      {msg ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">{msg}</div> : null}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-xs text-slate-500 mb-2">Select case</div>
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

      {!contract ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-600">No contract available for selected case yet.</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-bold">
              <FileText size={18} /> {contract.title || `Contract #${contract.id}`} (v{contract.versionNo})
              <span className="text-xs font-semibold px-2 py-1 rounded-full border border-slate-200 bg-slate-50">{formatStatus(contract.status)}</span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
              {contract.contractText}
            </div>

            <div className="rounded-xl border border-slate-200 p-4 space-y-2 bg-white">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Paperclip size={16} /> Attachments (reference only)
              </div>
              {(contract.attachments || []).length === 0 ? (
                <div className="text-sm text-slate-500">No attachments uploaded for this version.</div>
              ) : (
                (contract.attachments || []).map((a) => (
                  <div key={a.id} className="rounded-xl border border-slate-200 p-3 text-sm flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.file_name}</div>
                      <div className="text-xs text-slate-500">{a.mime_type} • {prettyFileSize(a.file_size)}</div>
                    </div>
                    <a
                      href={`${API_BASE_URL}/uploads/contracts/${a.file_path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#004aad] text-xs font-semibold"
                    >
                      Open
                    </a>
                  </div>
                ))
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 p-3 bg-white">
                <div className="font-semibold text-slate-700">Client Signature</div>
                <div className="mt-1 text-slate-600">
                  {clientSigned
                    ? `${contract.signatures?.clientSignature?.typed_full_name} • ${new Date(
                        contract.signatures?.clientSignature?.signed_at || ""
                      ).toLocaleString()}`
                    : "Pending"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 bg-white">
                <div className="font-semibold text-slate-700">Advocate Signature</div>
                <div className="mt-1 text-slate-600">
                  {advocateSigned
                    ? `${contract.signatures?.advocateSignature?.typed_full_name} • ${new Date(
                        contract.signatures?.advocateSignature?.signed_at || ""
                      ).toLocaleString()}`
                    : "Pending"}
                </div>
              </div>
            </div>

            {!clientSigned && (
              <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white">
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

                <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <PenSquare size={16} /> Sign Contract
                </div>
                <input
                  value={typedFullName}
                  onChange={(e) => setTypedFullName(e.target.value)}
                  placeholder="Type your full legal name"
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
                  <input
                    type="checkbox"
                    checked={confirmedReadUnderstood}
                    onChange={(e) => setConfirmedReadUnderstood(e.target.checked)}
                  />
                  I confirm I have read, understood, and agree to this contract.
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={confirmedVoluntary}
                    onChange={(e) => setConfirmedVoluntary(e.target.checked)}
                  />
                  I agree to these terms voluntarily.
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={confirmedTypedSignature}
                    onChange={(e) => setConfirmedTypedSignature(e.target.checked)}
                  />
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
        </>
      )}
    </section>
  );
}
