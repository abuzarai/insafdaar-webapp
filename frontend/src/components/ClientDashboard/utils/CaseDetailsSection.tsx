import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  FileText,
  FolderOpen,
  Lock,
  RefreshCw,
  User,
  Video,
  ListChecks,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { API_BASE_URL } from "../../../config";

type Props = {
  caseId: number;
  caseRef?: string;
  onBack?: () => void;
};

type AccessPayment = {
  paymentStatus: string;
  paymentStatusComputed: string;
  paymentRequiredTotal: number;
  paymentVerifiedTotal: number;
  manualOverrideStatus: string | null;
  manualOverrideNote: string | null;
  manualOverrideAt: string | null;
};

type CaseDetailsPayload = {
  ok: boolean;
  unlocked: boolean;
  case: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    source: string | null;
    language: string | null;
    createdAt: string;
    updatedAt: string;
    client: {
      userId: number;
      name: string | null;
      email: string | null;
      phone: string | null;
      city: string | null;
    };
    advocate:
      | {
          assigned: true;
          userId: number;
          name: string | null;
          email: string | null;
          phone: string | null;
        }
      | { assigned: false };
  };
  payment: AccessPayment;
  vouchers: Array<{
    id: number;
    case_id: number;
    title: string;
    description: string | null;
    amount: number;
    status: string;
    due_date: string | null;
    voucher_pdf_url: string | null;
    is_installment: boolean;
    sequence_no: number;
    issued_at: string | null;
    verified_at: string | null;
    rejection_note: string | null;
    latest_proof_id: number | null;
    latest_proof_file_url: string | null;
    latest_proof_status: string | null;
    latest_proof_uploaded_at: string | null;
    created_at: string;
  }>;
  meetings: Array<{
    id: number;
    case_id: number;
    start_at: string | null;
    end_at: string | null;
    google_meet_link: string | null;
    status: string;
    approved_at: string | null;
    created_at: string;
  }>;
  contract: null | {
    id: number;
    caseId: number;
    versionNo: number;
    title: string | null;
    contractText: string;
    status: string;
    approvedAt: string | null;
    approvalNote: string | null;
    rejectionNote: string | null;
    signatures: Array<{
      id: number;
      signer_user_id: number;
      signer_role: string;
      typed_full_name: string;
      signed_at: string;
    }>;
    attachments: Array<{
      id: number;
      file_name: string;
      file_path: string;
      mime_type: string;
      file_size: number;
      created_at: string;
    }>;
  };
  documents: Array<{
    id: number;
    doc_type: string | null;
    file_url: string;
    status: string | null;
    note?: string | null;
    uploaded_at: string;
  }>;
  voiceNotes: Array<{
    id: number;
    language: string | null;
    audio_url: string;
    notes: string | null;
    created_at: string;
  }>;
  intake: null | {
    id: number;
    transcript: string | null;
    extracted_entities: any;
    domain: string | null;
    complexity: string | null;
    status: string | null;
    created_at: string;
  };
  timeline: Array<{
    id: number;
    from_status: string | null;
    to_status: string;
    actor_role: string | null;
    reason: string | null;
    metadata: any;
    created_at: string;
  }>;
};

type TabKey = "Overview" | "Timeline" | "Meetings" | "Contract" | "Payments" | "Documents";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function money(v: number | null | undefined) {
  return `Rs. ${Number(v || 0).toLocaleString()}`;
}

function dt(v?: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function d(v?: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function absUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function paymentTone(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "FULLY_PAID" || s === "MANUALLY_MARKED_PAID") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (s === "PARTIALLY_PAID") return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

export default function CaseDetailsSection({ caseId, caseRef, onBack }: Props) {
  const [tab, setTab] = useState<TabKey>("Overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [lockedReason, setLockedReason] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const [paymentGate, setPaymentGate] = useState<AccessPayment | null>(null);
  const [details, setDetails] = useState<CaseDetailsPayload | null>(null);
  const [docUploadType, setDocUploadType] = useState("OTHER");
  const [docUploadNote, setDocUploadNote] = useState("");
  const [docUploading, setDocUploading] = useState(false);

  const loadAll = async () => {
    try {
      setLoading(true);
      setMsg("");
      setLockedReason("");

      let accessUnlocked = false;
      let accessPayment: AccessPayment | null = null;

      try {
        const accessRes = await axios.get(`${API_BASE_URL}/api/client/dashboard/case-details/access`, {
          headers: authHeaders(),
          params: { caseId },
        });
        accessUnlocked = Boolean(accessRes.data?.unlocked);
        accessPayment = (accessRes.data?.payment || null) as AccessPayment | null;
      } catch (e: any) {
        if (e?.response?.status === 403 && e?.response?.data?.error === "PAYMENT_NOT_VERIFIED") {
          accessUnlocked = false;
          accessPayment = (e?.response?.data?.payment || null) as AccessPayment | null;
          setLockedReason(
            e?.response?.data?.message ||
              "Payment is not verified yet. Please upload payment proof in Billing and wait for admin verification."
          );
        } else {
          throw e;
        }
      }

      const detailsRes = await axios.get(`${API_BASE_URL}/api/client/dashboard/case-details/details`, {
        headers: authHeaders(),
        params: { caseId },
      });

      setDetails((detailsRes.data || null) as CaseDetailsPayload | null);
      setUnlocked(accessUnlocked || Boolean(detailsRes.data?.unlocked));
      setPaymentGate(accessPayment || (detailsRes.data?.payment || null));
    } catch (e: any) {
      setMsg(e?.response?.data?.error || e?.message || "Failed to load case details");
      setDetails(null);
      setUnlocked(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const refresh = async () => {
    try {
      setRefreshing(true);
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const uploadCaseDocument = async (file: File) => {
    try {
      setDocUploading(true);
      setMsg("");
      const fd = new FormData();
      fd.append("caseId", String(caseId));
      fd.append("docType", docUploadType || "OTHER");
      if (docUploadNote.trim()) fd.append("note", docUploadNote.trim());
      fd.append("file", file);

      await axios.post(`${API_BASE_URL}/api/client/dashboard/start-case/documents/upload`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });

      setDocUploadNote("");
      await loadAll();
    } catch (e: any) {
      setMsg(e?.response?.data?.error || e?.message || "Failed to upload document");
    } finally {
      setDocUploading(false);
    }
  };

  const caseData = details?.case;
  const vouchers = details?.vouchers || [];
  const meetings = details?.meetings || [];
  const contract = details?.contract || null;
  const timeline = details?.timeline || [];
  const docs = details?.documents || [];
  const voice = details?.voiceNotes || [];

  const upcomingMeeting = (() => {
    const now = Date.now();
    const sorted = [...meetings].sort((a, b) => new Date(a.start_at || a.created_at).getTime() - new Date(b.start_at || b.created_at).getTime());
    return sorted.find((m) => new Date(m.start_at || m.created_at).getTime() >= now) || sorted[0] || null;
  })();

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {onBack ? (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold"
              >
                <ArrowLeft size={16} /> Back
              </button>
            ) : null}
            <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">Case Details</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">
            {caseData?.title || "Case"} • Case ID <span className="font-semibold text-slate-900">{caseRef || caseData?.id || caseId}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {msg ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{msg}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading case details...</div>
      ) : null}

      {!loading && paymentGate ? (
        <div className="grid md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Payment Status</div>
            <div className={`mt-2 inline-flex px-2.5 py-1 rounded-full border text-xs font-bold ${paymentTone(paymentGate.paymentStatus)}`}>
              {paymentGate.paymentStatus}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Required Total</div>
            <div className="text-lg font-bold text-slate-900 mt-1">{money(paymentGate.paymentRequiredTotal)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Verified Total</div>
            <div className="text-lg font-bold text-slate-900 mt-1">{money(paymentGate.paymentVerifiedTotal)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Access</div>
            <div className="text-lg font-bold mt-1 text-slate-900">{unlocked ? "Unlocked" : "Locked"}</div>
          </div>
        </div>
      ) : null}

      {!loading && !unlocked ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl border border-amber-200 bg-white flex items-center justify-center">
              <Lock size={18} className="text-amber-700" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-amber-900">Case Workspace Locked</div>
              <div className="text-sm text-amber-800 mt-1">
                {lockedReason || "Payment verification is pending. Upload proof in Billing and wait for admin verification."}
              </div>
              {paymentGate?.manualOverrideStatus ? (
                <div className="mt-2 text-xs text-amber-800">
                  Manual Override: {paymentGate.manualOverrideStatus} {paymentGate.manualOverrideNote ? `• ${paymentGate.manualOverrideNote}` : ""}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => (window.location.href = "/client-dashboard?section=Billing")}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white text-sm font-semibold"
              >
                <CreditCard size={16} /> Go to Billing
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && unlocked ? (
        <>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center gap-2">
            <BadgeCheck size={16} /> Payment verified. Full case workspace unlocked.
          </div>

          <div className="flex flex-wrap gap-2">
            {(["Overview", "Timeline", "Meetings", "Contract", "Payments", "Documents"] as TabKey[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border ${
                  tab === t
                    ? "bg-[#004aad] text-white border-transparent"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" ? (
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="text-lg font-bold text-slate-900">Case Summary</div>
                <div className="text-sm text-slate-700">{caseData?.description || "No case summary available yet."}</div>
                <div className="grid md:grid-cols-2 gap-3 pt-2 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Lifecycle Status</div>
                    <div className="font-semibold text-slate-900 mt-1">{caseData?.status || "—"}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Next Meeting</div>
                    <div className="font-semibold text-slate-900 mt-1">{upcomingMeeting ? d(upcomingMeeting.start_at) : "No meeting scheduled"}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <User size={16} /> Advocate
                </div>
                {caseData?.advocate?.assigned ? (
                  <div className="text-sm text-slate-700 space-y-1">
                    <div className="font-semibold text-slate-900">{caseData.advocate.name || "Assigned"}</div>
                    <div>{caseData.advocate.email || "—"}</div>
                    <div>{caseData.advocate.phone || "—"}</div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600">No advocate assigned yet.</div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "Timeline" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-lg font-bold text-slate-900 mb-3">Case Timeline</div>
              <div className="space-y-2">
                {timeline.length === 0 ? (
                  <div className="text-sm text-slate-600">No timeline events yet.</div>
                ) : (
                  timeline.map((e) => (
                    <div key={e.id} className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="text-xs text-slate-500">{dt(e.created_at)}</div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">{e.from_status || "START"}{" -> "}{e.to_status}</div>
                      <div className="text-xs text-slate-600 mt-1">{e.reason || "No reason provided"}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {tab === "Meetings" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2"><Video size={18} /> Meetings</div>
              <div className="space-y-2">
                {meetings.length === 0 ? (
                  <div className="text-sm text-slate-600">No meetings yet.</div>
                ) : (
                  meetings.map((m) => (
                    <div key={m.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">{m.status}</div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">{dt(m.start_at)} {m.end_at ? `- ${dt(m.end_at)}` : ""}</div>
                      {m.google_meet_link ? (
                        <a href={m.google_meet_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#004aad] mt-1 inline-block">
                          Join/Copy Meet Link
                        </a>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {tab === "Contract" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileText size={18} /> Contract</div>
              {!contract ? (
                <div className="text-sm text-slate-600">No contract available yet.</div>
              ) : (
                <>
                  <div className="text-sm text-slate-700">Status: <span className="font-semibold text-slate-900">{contract.status}</span> • v{contract.versionNo}</div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap max-h-[260px] overflow-auto">
                    {contract.contractText}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <div className="font-semibold text-slate-900">Signatures</div>
                      {contract.signatures.length === 0 ? (
                        <div className="text-slate-600 mt-1">No signatures yet.</div>
                      ) : (
                        contract.signatures.map((s) => (
                          <div key={s.id} className="text-xs text-slate-700 mt-1">
                            {s.signer_role}: {s.typed_full_name} • {dt(s.signed_at)}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <div className="font-semibold text-slate-900">Attachments</div>
                      {contract.attachments.length === 0 ? (
                        <div className="text-slate-600 mt-1">No attachments.</div>
                      ) : (
                        contract.attachments.map((a) => (
                          <a key={a.id} href={absUrl(`/uploads/contracts/${a.file_path}`) || "#"} target="_blank" rel="noreferrer" className="block text-xs font-semibold text-[#004aad] mt-1">
                            {a.file_name}
                          </a>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === "Payments" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2"><CreditCard size={18} /> Payments</div>
              <div className="space-y-2">
                {vouchers.length === 0 ? (
                  <div className="text-sm text-slate-600">No vouchers issued for this case yet.</div>
                ) : (
                  vouchers.map((v) => (
                    <div key={v.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">#{v.id} {v.title}</div>
                        <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50">{v.status}</span>
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Amount: {money(v.amount)} • Due: {d(v.due_date)}
                      </div>
                      {v.rejection_note ? (
                        <div className="text-xs text-rose-700 mt-1">Reason: {v.rejection_note}</div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {v.voucher_pdf_url ? (
                          <a href={absUrl(v.voucher_pdf_url) || "#"} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#004aad]">
                            Open Voucher
                          </a>
                        ) : null}
                        {v.latest_proof_file_url ? (
                          <a href={absUrl(v.latest_proof_file_url) || "#"} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-700">
                            Open Uploaded Proof
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {tab === "Documents" ? (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2"><FolderOpen size={18} /> Case Documents</div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 space-y-2">
                  <div className="text-xs text-slate-500">Upload supporting document for this case</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    <select
                      value={docUploadType}
                      onChange={(e) => setDocUploadType(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      disabled={docUploading}
                    >
                      <option value="CNIC_FRONT">CNIC Front</option>
                      <option value="CNIC_BACK">CNIC Back</option>
                      <option value="ADDRESS_PROOF">Address Proof</option>
                      <option value="EVIDENCE">Evidence</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <label className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold ${docUploading ? "opacity-60" : "cursor-pointer hover:bg-slate-50"}`}>
                      <Upload size={15} />
                      {docUploading ? "Uploading..." : "Upload File"}
                      <input
                        type="file"
                        className="hidden"
                        accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx"
                        disabled={docUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadCaseDocument(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={docUploadNote}
                    onChange={(e) => setDocUploadNote(e.target.value.slice(0, 1000))}
                    rows={2}
                    placeholder="Optional note (visible to your lawyer)"
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm"
                    disabled={docUploading}
                  />
                </div>
                <div className="space-y-2">
                  {docs.length === 0 ? (
                    <div className="text-sm text-slate-600">No documents uploaded yet.</div>
                  ) : (
                    docs.map((drow) => (
                      <a key={drow.id} href={absUrl(drow.file_url) || "#"} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                        <div className="text-sm font-semibold text-slate-900">{drow.doc_type || "Document"}</div>
                        {drow.note ? <div className="text-xs text-slate-600 mt-1">Note: {drow.note}</div> : null}
                        <div className="text-xs text-slate-500 mt-1">Uploaded: {dt(drow.uploaded_at)}</div>
                      </a>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2"><ListChecks size={18} /> Interview / Voice Notes</div>
                {details?.intake ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 space-y-2">
                    <div className="text-xs text-slate-500">AI Interview</div>
                    <div className="text-sm text-slate-700 mt-1">
                      Domain: <span className="font-semibold text-slate-900">{details.intake.domain || "—"}</span> • Complexity: <span className="font-semibold text-slate-900">{details.intake.complexity || "—"}</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      Language: <span className="font-semibold text-slate-900">{(details.intake as any).language || "—"}</span> • Status: <span className="font-semibold text-slate-900">{details.intake.status || "—"}</span> • {dt(details.intake.created_at)}
                    </div>
                    {details.intake.transcript ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs text-slate-500 mb-1">Transcript Preview</div>
                        <div className="text-xs text-slate-700 whitespace-pre-wrap max-h-28 overflow-auto">
                          {String(details.intake.transcript).slice(0, 600)}
                          {String(details.intake.transcript).length > 600 ? "..." : ""}
                        </div>
                      </div>
                    ) : null}
                    {details.intake.extracted_entities &&
                    (Array.isArray(details.intake.extracted_entities)
                      ? details.intake.extracted_entities.length > 0
                      : Object.keys(details.intake.extracted_entities || {}).length > 0) ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs text-slate-500 mb-1">Extracted Entities</div>
                        <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-words max-h-28 overflow-auto">
                          {JSON.stringify(details.intake.extracted_entities, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 text-sm text-slate-600">
                    No AI interview found for this case yet.
                  </div>
                )}

                <div className="space-y-2">
                  {voice.length === 0 ? (
                    <div className="text-sm text-slate-600">No voice notes uploaded for this case yet.</div>
                  ) : (
                    voice.map((v) => (
                      <div key={v.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">{v.language || "—"} • {dt(v.created_at)}</div>
                        {v.audio_url ? (
                          <a href={absUrl(v.audio_url) || "#"} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#004aad] mt-1 inline-block">
                            Open Audio
                          </a>
                        ) : null}
                        {v.notes ? <div className="text-xs text-slate-700 mt-1">{v.notes}</div> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !details && !msg ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <TriangleAlert size={16} /> Case details are currently unavailable.
        </div>
      ) : null}
    </section>
  );
}
