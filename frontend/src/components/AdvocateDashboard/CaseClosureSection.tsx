import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BadgeCheck, Save, RefreshCw, AlertTriangle } from "lucide-react";
import { API_BASE_URL } from "../../config";

type AssignedCase = { id: number; title: string; status: string };

type ClosureReport = {
  id: number;
  case_id: number;
  advocate_id: number;
  outcome: string;
  court_name: string | null;
  judge_name: string | null;
  judgment_date: string | null;
  case_trial_result: string;
  court_final_order: string;
  final_remarks: string;
  created_at: string;
  updated_at: string;
};

function authHeaders(): Headers {
  const h = new Headers();
  h.set("Accept", "application/json");
  h.set("Content-Type", "application/json");
  const token = localStorage.getItem("token");
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();
  if (!ct.includes("application/json")) {
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${txt.slice(0, 120)}`);
  }
  return (txt ? JSON.parse(txt) : null) as T;
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

const BASE = `${API_BASE_URL}/api/advocate/dashboard/case-closure`;

const OUTCOMES = ["WON", "LOST", "DISMISSED", "SETTLED", "WITHDRAWN", "PENDING_APPEAL", "OTHER"] as const;

export default function CaseClosureSection() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | "">("");

  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [blockedStatus, setBlockedStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const tRef = useRef<number | null>(null);

  const [form, setForm] = useState({
    outcome: "WON",
    court_name: "",
    judge_name: "",
    judgment_date: "",
    case_trial_result: "",
    court_final_order: "",
    final_remarks: "",
  });

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setToast(null), 2500);
  };

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) || null,
    [cases, selectedCaseId]
  );

  const fetchCases = async () => {
    setLoadingCases(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/cases`, { method: "GET", headers: authHeaders() });
      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to load cases");
      }

      const list: AssignedCase[] = Array.isArray(data?.cases) ? data.cases : [];
      setCases(list);
      setBlockedStatus(null);

      const first = list?.[0]?.id ?? "";
      setSelectedCaseId((prev) => (prev !== "" && list.some((x) => x.id === prev) ? prev : first));
    } catch (e: any) {
      setCases([]);
      setSelectedCaseId("");
      setError(e?.message || "Failed to load cases.");
    } finally {
      setLoadingCases(false);
    }
  };

  const fetchReport = async (caseId: number) => {
    setLoadingReport(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/cases/${caseId}`, { method: "GET", headers: authHeaders() });
      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to load report");
      }

      const report: ClosureReport | null = data?.report || null;

      if (report) {
        setForm({
          outcome: report.outcome || "WON",
          court_name: report.court_name || "",
          judge_name: report.judge_name || "",
          judgment_date: report.judgment_date ? String(report.judgment_date).slice(0, 10) : "",
          case_trial_result: report.case_trial_result || "",
          court_final_order: report.court_final_order || "",
          final_remarks: report.final_remarks || "",
        });
      } else {
        setForm({
          outcome: "WON",
          court_name: "",
          judge_name: "",
          judgment_date: "",
          case_trial_result: "",
          court_final_order: "",
          final_remarks: "",
        });
      }
      setBlockedStatus(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load report.");
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCaseId === "") return;
    fetchReport(selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  const save = async () => {
    if (selectedCaseId === "") return;

    // quick required validation
    if (!form.case_trial_result.trim() || !form.court_final_order.trim() || !form.final_remarks.trim()) {
      showToast("Please fill required fields (trial result, final order, remarks).", "err");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/cases/${selectedCaseId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          outcome: form.outcome,
          court_name: form.court_name || null,
          judge_name: form.judge_name || null,
          judgment_date: form.judgment_date || null,
          case_trial_result: form.case_trial_result,
          court_final_order: form.court_final_order,
          final_remarks: form.final_remarks,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) setBlockedStatus(blocked);
        throw new Error(data?.message || data?.error || "Failed to save closure report");
      }

      showToast("Closure report saved.", "ok");
      await fetchReport(selectedCaseId);
    } catch (e: any) {
      setError(e?.message || "Failed to save closure report.");
      showToast(e?.message || "Failed to save closure report.", "err");
    } finally {
      setSaving(false);
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
        <div className="min-w-0">
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Case Closure</h1>
          <p className="text-sm text-slate-600 mt-2">
            Submit final court outcome, final order, trial result, and advocate remarks.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Select case:</span>

            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
              disabled={loadingCases || cases.length === 0}
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id} — {c.title}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={fetchCases}
              disabled={loadingCases}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
            >
              <RefreshCw size={16} className={loadingCases ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {selectedCase && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs text-slate-500">Selected</div>
              <div className="mt-1 text-sm font-bold text-slate-900 truncate">{selectedCase.title}</div>
              <div className="mt-1 text-xs text-slate-500">Status: {selectedCase.status}</div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || loadingReport || selectedCaseId === ""}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm disabled:opacity-60"
        >
          <Save size={16} />
          {saving ? "Saving..." : "Save Closure"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 inline-flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {blockedStatus && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 inline-flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5" />
          <span>
            Case closure is locked until the case is active. Current status: <b>{prettyLifecycleStatus(blockedStatus)}</b>.
            Finish contract signatures and admin approval first.
          </span>
        </div>
      )}

      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        {loadingReport ? (
          <div className="text-sm text-slate-500">Loading closure report…</div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500">Outcome *</label>
              <select
                value={form.outcome}
                onChange={(e) => setForm((p) => ({ ...p, outcome: e.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Court Name</label>
                  <input
                    value={form.court_name}
                    onChange={(e) => setForm((p) => ({ ...p, court_name: e.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    placeholder="e.g. Civil Court Lahore"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Judge Name</label>
                  <input
                    value={form.judge_name}
                    onChange={(e) => setForm((p) => ({ ...p, judge_name: e.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    placeholder="e.g. Justice ..."
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs text-slate-500">Judgment Date</label>
                <input
                  type="date"
                  value={form.judgment_date}
                  onChange={(e) => setForm((p) => ({ ...p, judgment_date: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500">Case Trial Result *</label>
              <textarea
                value={form.case_trial_result}
                onChange={(e) => setForm((p) => ({ ...p, case_trial_result: e.target.value }))}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none"
                placeholder="Write trial result summary..."
              />

              <label className="text-xs text-slate-500 mt-4 block">Court Final Order / Decision *</label>
              <textarea
                value={form.court_final_order}
                onChange={(e) => setForm((p) => ({ ...p, court_final_order: e.target.value }))}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none"
                placeholder="Exact order passed by court..."
              />

              <label className="text-xs text-slate-500 mt-4 block">Final Advocate Remarks *</label>
              <textarea
                value={form.final_remarks}
                onChange={(e) => setForm((p) => ({ ...p, final_remarks: e.target.value }))}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none"
                placeholder="Final remarks, lessons, next steps, appeal advice..."
              />
            </div>

            <div className="lg:col-span-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || selectedCaseId === ""}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm disabled:opacity-60"
              >
                <BadgeCheck size={16} />
                {saving ? "Saving..." : "Submit / Update Closure"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
