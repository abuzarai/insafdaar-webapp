import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../config";
import {
  BadgeCheck,
  Clock,
  XCircle,
  Download,
  Upload,
  Loader2,
  FileText,
  List,
  Info,
} from "lucide-react";

/**
 * ✅ Backend alignment notes:
 * - Billing status comes from public.client_billing.status:
 *   PENDING -> created (no PDF yet)
 *   SENT -> PDF generated & sent
 *   UPLOADED -> proof uploaded (if your backend sets this on upload; if not, we normalize using proof_status)
 *   VERIFIED / REJECTED -> final
 *
 * - Voucher PDF is stored in voucher_pdf_url (NOT voucher_file_url)
 * - Proof status comes from client_payment_proofs.status: UPLOADED/VERIFIED/REJECTED
 */

type VoucherStatus =
  | "PENDING"
  | "SENT"
  | "UPLOADED"
  | "VERIFIED"
  | "REJECTED";

type ProofStatus = "UPLOADED" | "VERIFIED" | "REJECTED";

type VoucherRow = {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  status: VoucherStatus;
  due_date: string | null;

  // ✅ backend: generated PDF lives here
  voucher_pdf_url: string | null;

  // optional admin attached file (backend: voucher_file_url) - keep if you want
  voucher_file_url?: string | null;

  created_at: string;
};

type VoucherDetails = VoucherRow & {
  bank_name?: string | null;
  bank_account_title?: string | null;
  bank_account_number?: string | null;
  bank_branch?: string | null;

  // proof metadata (depends on your vouchers.controller response)
  proof_id?: number | null;
  proof_file_url?: string | null;
  proof_status?: ProofStatus | null;
  proof_uploaded_at?: string | null;
  verified_at?: string | null;
};

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeVoucherStatus(s: any): VoucherStatus {
  const x = String(s || "").toUpperCase();
  if (x === "SENT" || x === "ISSUED_PENDING_PAYMENT") return "SENT";
  if (x === "UPLOADED" || x === "PROOF_UPLOADED" || x === "PAYMENT_PROOF_UPLOADED") return "UPLOADED";
  if (x === "VERIFIED" || x === "PAID_VERIFIED") return "VERIFIED";
  if (x === "REJECTED" || x === "PAYMENT_REJECTED") return "REJECTED";
  if (x === "PENDING") return "PENDING";
  return "PENDING";
}

function normalizeProofStatus(s: any): ProofStatus | null {
  const x = String(s || "").toUpperCase();
  if (x === "UPLOADED") return "UPLOADED";
  if (x === "VERIFIED") return "VERIFIED";
  if (x === "REJECTED") return "REJECTED";
  return null;
}

function safeDate(d: any) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString();
}

function StatusPill({ status }: { status: VoucherStatus }) {
  const cls =
    status === "VERIFIED"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "REJECTED"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  const Icon =
    status === "VERIFIED"
      ? BadgeCheck
      : status === "REJECTED"
      ? XCircle
      : Clock;

  const label =
    status === "VERIFIED"
      ? "Verified"
      : status === "REJECTED"
      ? "Rejected"
      : status === "UPLOADED"
      ? "Proof Uploaded"
      : status === "SENT"
      ? "Sent"
      : "Pending";

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${cls}`}
    >
      <Icon size={14} />
      {label}
    </span>
  );
}

function ProofPill({ status }: { status: ProofStatus | null | undefined }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border bg-slate-50 text-slate-700 border-slate-200">
        <Clock size={14} />
        None
      </span>
    );
  }

  const cls =
    status === "VERIFIED"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "REJECTED"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  const Icon =
    status === "VERIFIED"
      ? BadgeCheck
      : status === "REJECTED"
      ? XCircle
      : Clock;

  const label =
    status === "VERIFIED"
      ? "Verified"
      : status === "REJECTED"
      ? "Rejected"
      : "Uploaded";

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${cls}`}
    >
      <Icon size={14} />
      {label}
    </span>
  );
}

function MobileTabs({
  value,
  onChange,
  hasDetails,
}: {
  value: "LIST" | "DETAILS";
  onChange: (v: "LIST" | "DETAILS") => void;
  hasDetails: boolean;
}) {
  return (
    <div className="md:hidden sticky top-0 z-10 bg-white/90 backdrop-blur border border-slate-200 rounded-2xl p-1 shadow-sm">
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => onChange("LIST")}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition ${
            value === "LIST"
              ? "bg-[#004aad] text-white"
              : "bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <List size={16} />
          Vouchers
        </button>

        <button
          type="button"
          onClick={() => onChange("DETAILS")}
          disabled={!hasDetails}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition ${
            !hasDetails
              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
              : value === "DETAILS"
              ? "bg-[#004aad] text-white"
              : "bg-white text-slate-700 hover:bg-slate-50"
          }`}
          title={!hasDetails ? "Select a voucher first" : "View details"}
        >
          <Info size={16} />
          Details
        </button>
      </div>
    </div>
  );
}

function VoucherCard({
  v,
  active,
  onSelect,
}: {
  v: VoucherRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-4 transition ${
        active
          ? "border-[#004aad] bg-blue-50/40"
          : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">{v.title}</div>
          <div className="text-xs text-slate-500 mt-0.5">Voucher #{v.id}</div>
        </div>
        <StatusPill status={v.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Amount</div>
          <div className="font-bold text-slate-900">
            {`Rs. ${Number(v.amount || 0).toLocaleString()}`}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Due</div>
          <div className="font-bold text-slate-900">{safeDate(v.due_date)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        Created: <span className="font-semibold">{safeDate(v.created_at)}</span>
      </div>

      <div className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#004aad]">
        <FileText size={16} />
        Open
      </div>
    </button>
  );
}

export default function BillingSection() {
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);

  const [active, setActive] = useState<VoucherDetails | null>(null);

  const [proofName, setProofName] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  // ✅ mobile tab state
  const [mobileTab, setMobileTab] = useState<"LIST" | "DETAILS">("LIST");

  const fetchVouchers = async () => {
    try {
      setLoading(true);
      setMsg("");

      const res = await axios.get(
        `${API_BASE_URL}/api/client/dashboard/billing/vouchers`,
        { headers: authHeaders() }
      );

      // backend likely returns rows from client_billing
      const rows: VoucherRow[] = (res.data?.vouchers || []).map((r: any) => {
        const normalizedStatus = normalizeVoucherStatus(r.status);

        return {
          id: Number(r.id),
          title: r.title,
          description: r.description ?? null,
          amount: Number(r.amount ?? 0),
          status: normalizedStatus,
          due_date: r.due_date ?? null,
          voucher_pdf_url: r.voucher_pdf_url ?? null,
          voucher_file_url: r.voucher_file_url ?? null,
          created_at: r.created_at,
        };
      });

      setVouchers(rows);

      setSelectedVoucherId((prev) => {
        if (prev && rows.some((x) => x.id === prev)) return prev;
        return rows.length ? rows[0].id : null;
      });
    } catch (e: any) {
      setMsg(
        e?.response?.data?.error ||
          "❌ Failed to load vouchers. Please logout/login and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchDetails = async (billingId: number) => {
    try {
      setMsg("");

      const res = await axios.get(
        `${API_BASE_URL}/api/client/dashboard/billing/vouchers/${billingId}`,
        { headers: authHeaders() }
      );

      const v: any = res.data?.voucher;
      if (!v) {
        setActive(null);
        return;
      }

      // ✅ Derive status: if backend still returns status only, keep it.
      // If backend does NOT set billing.status to UPLOADED on proof upload,
      // we will "show" UPLOADED when proof_status=UPLOADED.
      const baseStatus = normalizeVoucherStatus(v.status);
      const proofStatus = normalizeProofStatus(v.proof_status);
      const derivedStatus: VoucherStatus =
        baseStatus === "SENT" && proofStatus === "UPLOADED"
          ? "UPLOADED"
          : baseStatus;

      const details: VoucherDetails = {
        ...v,
        id: Number(v.id),
        amount: Number(v.amount ?? 0),
        status: derivedStatus,

        voucher_pdf_url: v.voucher_pdf_url ?? null,
        voucher_file_url: v.voucher_file_url ?? null,

        bank_name: v.bank_name ?? null,
        bank_account_title: v.bank_account_title ?? null,
        bank_account_number: v.bank_account_number ?? null,
        bank_branch: v.bank_branch ?? null,

        proof_id: v.proof_id ?? null,
        proof_file_url: v.proof_file_url ?? null,
        proof_status: proofStatus,
        proof_uploaded_at: v.proof_uploaded_at ?? null,
        verified_at: v.verified_at ?? null,
      };

      setActive(details);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "❌ Failed to load voucher details.");
      setActive(null);
    }
  };

  useEffect(() => {
    fetchVouchers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedVoucherId) fetchDetails(selectedVoucherId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVoucherId]);

  const rowsForTable = useMemo(() => vouchers, [vouchers]);

  const uploadProof = async (file: File) => {
    if (!active) return;

    const st = normalizeVoucherStatus(active.status);

    // ✅ backend expects proof upload only after SENT (PDF exists)
    if (st !== "SENT" && st !== "UPLOADED") {
      setMsg(`❌ You cannot upload proof right now. Current status: ${st}`);
      return;
    }

    try {
      setUploadingProof(true);
      setMsg("");
      setProofName(file.name);

      const fd = new FormData();
      fd.append("proof", file);

      const res = await axios.post(
        `${API_BASE_URL}/api/client/dashboard/billing/vouchers/${active.id}/proof`,
        fd,
        { headers: { ...authHeaders(), "Content-Type": "multipart/form-data" } }
      );

      if (!res.data?.ok && res.data?.ok !== undefined) {
        // if backend returns {ok:true}, enforce; otherwise ignore
        throw new Error(res.data?.error || "Upload failed");
      }

      setMsg("✅ Payment proof uploaded. Admin will verify it.");

      await fetchVouchers();
      await fetchDetails(active.id);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || e?.message || "❌ Upload failed. Please try again.");
    } finally {
      setUploadingProof(false);
    }
  };

  // ✅ Voucher download should use voucher_pdf_url (generated PDF)
  const voucherHref =
    active?.voucher_pdf_url
      ? active.voucher_pdf_url.startsWith("http")
        ? active.voucher_pdf_url
        : `${API_BASE_URL}${active.voucher_pdf_url}`
      : null;

  const proofHref =
    active?.proof_file_url
      ? active.proof_file_url.startsWith("http")
        ? active.proof_file_url
        : `${API_BASE_URL}${active.proof_file_url}`
      : null;

  const canUpload =
    active &&
    (normalizeVoucherStatus(active.status) === "SENT" ||
      normalizeVoucherStatus(active.status) === "UPLOADED");

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">
          Billing & Vouchers
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          View vouchers, download voucher PDF, and upload payment proof for verification.
        </p>
        {msg && <div className="mt-2 text-sm text-amber-700">{msg}</div>}
      </div>

      {/* ✅ Mobile Tabs */}
      <MobileTabs value={mobileTab} onChange={setMobileTab} hasDetails={!!active} />

      {/* ✅ Mobile: Voucher list (cards) */}
      <div className={`md:hidden ${mobileTab === "LIST" ? "block" : "hidden"}`}>
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-slate-600 flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} />
              Loading…
            </div>
          ) : rowsForTable.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-slate-600">
              No vouchers yet.
            </div>
          ) : (
            rowsForTable.map((v) => (
              <VoucherCard
                key={v.id}
                v={v}
                active={selectedVoucherId === v.id}
                onSelect={() => {
                  setSelectedVoucherId(v.id);
                  setMobileTab("DETAILS");
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ✅ Desktop: Table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="text-slate-600 flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            Loading…
          </div>
        ) : rowsForTable.length === 0 ? (
          <div className="text-slate-600">No vouchers yet.</div>
        ) : (
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="text-slate-600 text-sm border-b">
                <th className="py-3 px-4">Voucher</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4">Due</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">PDF</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {rowsForTable.map((v) => (
                <tr
                  key={v.id}
                  className={`border-b transition ${
                    selectedVoucherId === v.id ? "bg-slate-50" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="text-sm font-semibold text-slate-900">{v.title}</div>
                    <div className="text-xs text-slate-500">Voucher #{v.id}</div>
                  </td>

                  <td className="py-3 px-4 font-semibold">
                    {`Rs. ${Number(v.amount || 0).toLocaleString()}`}
                  </td>

                  <td className="py-3 px-4">{safeDate(v.created_at)}</td>

                  <td className="py-3 px-4">{safeDate(v.due_date)}</td>

                  <td className="py-3 px-4">
                    <StatusPill status={v.status} />
                  </td>

                  <td className="py-3 px-4">
                    {v.voucher_pdf_url ? (
                      <a
                        href={
                          v.voucher_pdf_url.startsWith("http")
                            ? v.voucher_pdf_url
                            : `${API_BASE_URL}${v.voucher_pdf_url}`
                        }
                        className="inline-flex items-center gap-2 text-sm font-semibold text-[#004aad]"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download size={16} />
                        PDF
                      </a>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSelectedVoucherId(v.id)}
                      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
                    >
                      <FileText size={16} className="text-[#004aad]" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ✅ Details panel */}
      {active && (
        <div
          className={`bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 ${
            mobileTab === "DETAILS" ? "block" : "hidden md:block"
          }`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500">Selected Voucher</div>
              <div className="text-lg font-bold text-slate-900 mt-1">{active.title}</div>
              <div className="text-sm text-slate-600 mt-1">Voucher #{active.id}</div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={normalizeVoucherStatus(active.status)} />
              <ProofPill status={active.proof_status} />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Amount</div>
              <div className="text-sm font-bold text-slate-900 mt-1">
                {`Rs. ${Number(active.amount || 0).toLocaleString()}`}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Due Date</div>
              <div className="text-sm font-bold text-slate-900 mt-1">
                {safeDate(active.due_date)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Voucher PDF</div>
              <div className="text-sm font-bold text-slate-900 mt-1">
                {active.voucher_pdf_url ? "Available" : "Not generated"}
              </div>
            </div>
          </div>

          {(active.bank_name ||
            active.bank_account_title ||
            active.bank_account_number ||
            active.bank_branch) && (
            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">Bank Details</div>
              <div className="mt-2 space-y-1">
                <div>
                  <span className="text-slate-500">Bank:</span>{" "}
                  <span className="font-semibold">{active.bank_name || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Account Title:</span>{" "}
                  <span className="font-semibold">{active.bank_account_title || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Account Number:</span>{" "}
                  <span className="font-semibold">{active.bank_account_number || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Branch:</span>{" "}
                  <span className="font-semibold">{active.bank_branch || "—"}</span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">How it works</div>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>Download voucher PDF and pay the amount.</li>
              <li>Upload payment proof (receipt screenshot/pdf).</li>
              <li>Admin verifies payment and updates your status.</li>
            </ol>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                voucherHref
                  ? "bg-[#004aad] text-white hover:bg-[#003b82]"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed"
              }`}
              href={voucherHref || undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!voucherHref}
              onClick={(e) => {
                if (!voucherHref) e.preventDefault();
              }}
              title={!voucherHref ? "Voucher PDF not available yet" : "Download voucher PDF"}
            >
              <Download size={16} />
              Download Voucher
            </a>

            {canUpload && (
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold cursor-pointer">
                {uploadingProof ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Upload size={16} className="text-[#004aad]" />
                )}
                Upload Payment Proof
                <input
                  type="file"
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) uploadProof(f);
                  }}
                />
              </label>
            )}

            {proofName && (
              <span className="text-xs text-slate-600">
                Selected file: <span className="font-semibold">{proofName}</span>
              </span>
            )}

            <div className="text-sm text-slate-700">
              Proof uploaded:{" "}
              <span className="font-semibold">
                {active.proof_uploaded_at ? safeDate(active.proof_uploaded_at) : "—"}
              </span>
            </div>

            {proofHref && (
              <a
                className="text-sm font-semibold text-[#004aad]"
                href={proofHref}
                target="_blank"
                rel="noreferrer"
              >
                View uploaded proof
              </a>
            )}
          </div>

          {!canUpload && (
            <p className="text-xs text-slate-500">
              Upload proof is enabled only when voucher is pending payment or proof upload.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
