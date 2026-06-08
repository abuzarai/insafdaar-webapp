import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../config";
import { RefreshCw, Receipt, BadgeCheck, Clock3 } from "lucide-react";

type AssignedCase = { id: number; title: string; status: string };

type VoucherRow = {
  id: number;
  case_id: number;
  title: string;
  amount: number;
  status: string;
  due_date: string | null;
  voucher_pdf_url: string | null;
  is_installment: boolean;
  sequence_no: number;
  issued_at: string | null;
  verified_at: string | null;
  rejection_note: string | null;
};

type PaymentSummary = {
  payment_required_total: number;
  payment_verified_total: number;
  payment_status_computed: string;
  payment_status: string;
  payment_manual_override_status: string | null;
  payment_manual_override_note: string | null;
};

function authHeaders() {
  const token = localStorage.getItem("token");
  const h = new Headers();
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function safeJson(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function money(v: any) {
  return `Rs. ${Number(v || 0).toLocaleString()}`;
}

export default function VoucherSection() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const selectedNumericCaseId = useMemo(() => Number(selectedCaseId || 0) || null, [selectedCaseId]);

  const loadCases = async () => {
    const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/cases/assigned`, { headers: authHeaders() });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load cases");
    const rows = (data?.cases || []) as AssignedCase[];
    setCases(rows);
    if (!selectedCaseId && rows.length) setSelectedCaseId(String(rows[0].id));
  };

  const loadVouchers = async (caseId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/cases/${caseId}/vouchers`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load vouchers");
    setVouchers(Array.isArray(data?.vouchers) ? data.vouchers : []);
    setPayment((data?.payment || null) as PaymentSummary | null);
  };

  const refresh = async () => {
    try {
      setLoading(true);
      setMsg("");
      await loadCases();
      if (selectedNumericCaseId) await loadVouchers(selectedNumericCaseId);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load voucher status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedNumericCaseId) return;
    loadVouchers(selectedNumericCaseId).catch(() => setVouchers([]));
  }, [selectedNumericCaseId]);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">Voucher Status</h1>
          <p className="text-sm text-slate-600 mt-2">Read-only payment progress per assigned case.</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          {loading ? "Refreshing..." : "Refresh"}
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

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Required Total</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{money(payment?.payment_required_total)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Verified Paid</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{money(payment?.payment_verified_total)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Payment Status</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{payment?.payment_status || "UNPAID"}</div>
          {payment?.payment_manual_override_status ? (
            <div className="text-xs text-amber-700 mt-1">Manual override: {payment.payment_manual_override_status}</div>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Receipt size={16} /> Case Vouchers
        </div>

        {vouchers.length === 0 ? (
          <div className="text-sm text-slate-500">No vouchers issued for this case yet.</div>
        ) : (
          <div className="space-y-2">
            {vouchers.map((v) => {
              const done = ["PAID_VERIFIED", "VERIFIED"].includes(String(v.status || "").toUpperCase());
              return (
                <div key={v.id} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">#{v.id} - {v.title}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {money(v.amount)} • Due: {v.due_date ? new Date(v.due_date).toLocaleDateString() : "—"} • Status: {v.status}
                    </div>
                    {v.rejection_note ? <div className="text-xs text-rose-700 mt-1">Reason: {v.rejection_note}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {done ? <BadgeCheck size={16} className="text-emerald-600" /> : <Clock3 size={16} className="text-amber-600" />}
                    {v.voucher_pdf_url ? (
                      <a
                        href={v.voucher_pdf_url.startsWith("http") ? v.voucher_pdf_url : `${API_BASE_URL}${v.voucher_pdf_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-[#004aad]"
                      >
                        Open Voucher
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
