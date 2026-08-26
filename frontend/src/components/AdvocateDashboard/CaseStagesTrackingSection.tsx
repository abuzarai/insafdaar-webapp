import { formatStatus } from "../common/formatStatus";
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { API_BASE_URL } from "../../config";

/* ================= Types ================= */

type Stage =
  | "INTAKE"
  | "RESEARCH"
  | "CASE_SUMMARY"
  | "CLIENT_VALIDATION"
  | "DIGITAL_DOCS"
  | "LITIGATION_STRATEGY"
  | "FILING_SUBMISSION"
  | "NOTICES_SUMMONS"
  | "REPLIES_MAINTAINABILITY"
  | "ISSUES_FRAMING"
  | "EVIDENCE"
  | "CROSS_EXAMINATION"
  | "FINAL_ARGUMENTS"
  | "JUDGMENT"
  | "EXECUTION";

type AssignedCase = {
  id: string; // could be numeric id serialized to string OR CASE-xxx, we keep string to be safe
  title: string;
  status: string;
};

type StageHistoryRow = {
  completed_stage: string;
  completed_at: string;
  completed_by_advocate_id: number;
  note: string | null;
};

type StagesResponse = {
  ok: true;
  stages: Stage[];
  current_stage: Stage;
  completed_stages: Stage[];
  history: StageHistoryRow[];
};

/* ================= Constants ================= */

const FALLBACK_STAGES: Stage[] = [
  "INTAKE",
  "RESEARCH",
  "CASE_SUMMARY",
  "CLIENT_VALIDATION",
  "DIGITAL_DOCS",
  "LITIGATION_STRATEGY",
  "FILING_SUBMISSION",
  "NOTICES_SUMMONS",
  "REPLIES_MAINTAINABILITY",
  "ISSUES_FRAMING",
  "EVIDENCE",
  "CROSS_EXAMINATION",
  "FINAL_ARGUMENTS",
  "JUDGMENT",
  "EXECUTION",
];

const ADV_CASES_BASE = `${API_BASE_URL}/api/advocate/dashboard/cases`;
const ADV_STAGES_BASE = `${API_BASE_URL}/api/advocate/dashboard`;

/* ================= Helpers ================= */

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
    throw new Error(
      `Expected JSON but got "${ct}". Response starts: ${txt.slice(0, 120)}`
    );
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

function stageLabel(stage: Stage) {
  return stage
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function fmtDateTime(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/* ================= UI: Premium Speedometer Gauge ================= */

function Gauge({
  percent,
  label,
  doneCount,
  totalCount,
}: {
  percent: number; // 0..100
  label: string;
  doneCount: number;
  totalCount: number;
}) {
  const p = clamp(percent, 0, 100);

  const start = -120;
  const end = 120;
  const angle = start + (p / 100) * (end - start);

  const cx = 160;
  const cy = 170;
  const r = 110;

  const rad = (deg: number) => (deg * Math.PI) / 180;

  const nx = cx + r * Math.cos(rad(angle));
  const ny = cy + r * Math.sin(rad(angle));

  const ARC_LEN = 346;

  const ticks = useMemo(() => {
    const items: Array<{
      v: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      major: boolean;
    }> = [];
    for (let v = 0; v <= 100; v += 5) {
      const a = start + (v / 100) * (end - start);
      const major = v % 25 === 0;

      const outer = r + 6;
      const inner = r - (major ? 18 : 10);

      const x1 = cx + outer * Math.cos(rad(a));
      const y1 = cy + outer * Math.sin(rad(a));
      const x2 = cx + inner * Math.cos(rad(a));
      const y2 = cy + inner * Math.sin(rad(a));

      items.push({ v, x1, y1, x2, y2, major });
    }
    return items;
  }, []);

  const labels = useMemo(() => [0, 25, 50, 75, 100], []);

  const labelPos = (v: number) => {
    const a = start + (v / 100) * (end - start);
    const rr = r - 34;
    return {
      x: cx + rr * Math.cos(rad(a)),
      y: cy + rr * Math.sin(rad(a)),
    };
  };

  const statusText =
    p >= 100 ? "Completed" : p >= 75 ? "Nearly done" : p >= 35 ? "In progress" : "Getting started";

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_34px_-20px_rgba(15,23,42,0.45)]">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 -right-28 h-72 w-72 rounded-full bg-blue-100/70 blur-3xl" />
        <div className="absolute -bottom-28 -left-28 h-72 w-72 rounded-full bg-slate-100 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(2,132,199,0.10),transparent_45%),radial-gradient(circle_at_70%_85%,rgba(2,6,23,0.07),transparent_48%)]" />
      </div>

      {/* top row */}
      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-medium tracking-wide text-slate-500">
            Progress Meter
          </div>

          <div className="mt-2 flex items-end gap-3 flex-wrap">
            <div className="text-4xl md:text-5xl font-extrabold leading-none text-slate-900">
              {p}%
            </div>

            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 backdrop-blur">
              <Clock size={14} />
              Live
            </span>

            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <ShieldCheck size={14} />
              {statusText}
            </span>
          </div>

          <div className="mt-2 text-sm text-slate-600">
            Current stage:{" "}
            <span className="font-semibold text-slate-900">{label}</span>
          </div>

          <div className="mt-1 text-xs text-slate-500">
            {doneCount}/{totalCount} stages completed
          </div>
        </div>

        {/* mini bar */}
        <div className="w-full sm:w-[260px]">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Overall</span>
            <span className="font-semibold text-slate-700">{p}%</span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
            <motion.div
              className="h-full rounded-full bg-[#004aad]"
              initial={{ width: 0 }}
              animate={{ width: `${p}%` }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>Start</span>
            <span>End</span>
          </div>
        </div>
      </div>

      {/* gauge */}
      <div className="relative mt-6 flex items-center justify-center">
        <div className="relative">
          <svg width="320" height="220" viewBox="0 0 320 220">
            <defs>
              <linearGradient id="gaugeGrad" x1="40" y1="0" x2="280" y2="0">
                <stop offset="0%" stopColor="#93c5fd" />
                <stop offset="55%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>

              <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow
                  dx="0"
                  dy="6"
                  stdDeviation="6"
                  floodColor="#0f172a"
                  floodOpacity="0.18"
                />
              </filter>

              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feColorMatrix
                  in="blur"
                  type="matrix"
                  values="
                    1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 0.35 0"
                />
                <feMerge>
                  <feMergeNode />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* base arc */}
            <path
              d="M 45 180 A 115 115 0 0 1 275 180"
              fill="none"
              stroke="currentColor"
              className="text-slate-200"
              strokeWidth="16"
              strokeLinecap="round"
            />

            {/* progress arc */}
            <path
              d="M 45 180 A 115 115 0 0 1 275 180"
              fill="none"
              stroke="url(#gaugeGrad)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={ARC_LEN}
              strokeDashoffset={ARC_LEN - (p / 100) * ARC_LEN}
              filter="url(#glow)"
            />

            {/* ticks */}
            {ticks.map((t) => (
              <line
                key={t.v}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke="currentColor"
                className={t.major ? "text-slate-400" : "text-slate-300"}
                strokeWidth={t.major ? 2.2 : 1.4}
                strokeLinecap="round"
                opacity={t.major ? 0.95 : 0.8}
              />
            ))}

            {/* tick labels */}
            {labels.map((v) => {
              const pos = labelPos(v);
              return (
                <text
                  key={v}
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748b"
                  style={{ fontWeight: 700 }}
                >
                  {v}
                </text>
              );
            })}

            {/* hub */}
            <circle cx={cx} cy={cy} r="18" fill="#0f172a" filter="url(#softShadow)" />
            <circle cx={cx} cy={cy} r="7" fill="#ffffff" opacity="0.9" />

            {/* needle */}
            <motion.line
              x1={cx}
              y1={cy}
              x2={nx}
              y2={ny}
              stroke="#0f172a"
              strokeWidth="6"
              strokeLinecap="round"
              initial={false}
              animate={{ x2: nx, y2: ny }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              filter="url(#softShadow)"
            />

            {/* labels */}
            <text x="52" y="205" fontSize="11" fill="#64748b" style={{ fontWeight: 800 }}>
              Start
            </text>
            <text x="262" y="205" fontSize="11" fill="#64748b" style={{ fontWeight: 800 }}>
              End
            </text>
          </svg>

          {/* floating callout */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-3">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
              {p < 100 ? "You’re on track — keep moving" : "All stages completed"}
            </div>
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="relative mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
          0–100% mapped to case stages
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#004aad]" />
          Completed portion
        </div>
      </div>
    </div>
  );
}

/* ================= Component ================= */

export default function CaseStagesTrackingSection() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");

  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [error, setError] = useState("");
  const [blockedStatus, setBlockedStatus] = useState<string | null>(null);

  const [stages, setStages] = useState<Stage[]>(FALLBACK_STAGES);
  const [completedStages, setCompletedStages] = useState<Stage[]>([]);
  const [currentStage, setCurrentStage] = useState<Stage>("INTAKE");
  const [history, setHistory] = useState<StageHistoryRow[]>([]);
  const [note, setNote] = useState("");

  const selectedCase = useMemo(
    () => cases.find((c) => String(c.id) === String(selectedCaseId)) || null,
    [cases, selectedCaseId]
  );

  const doneCount = completedStages.length;

  const progress = useMemo(() => {
    const total = Math.max(1, stages.length);
    return Math.round((doneCount / total) * 100);
  }, [doneCount, stages.length]);

  const historyByStage = useMemo(() => {
    const m = new Map<string, StageHistoryRow>();
    for (const h of history) {
      const k = String(h.completed_stage || "").toUpperCase();
      if (!m.has(k)) m.set(k, h);
    }
    return m;
  }, [history]);

  const currentIndex = useMemo(() => {
    const idx = stages.findIndex((s) => s === currentStage);
    return idx >= 0 ? idx : 0;
  }, [stages, currentStage]);

  const nextStage = useMemo(() => {
    const n = stages[currentIndex + 1];
    return n || null;
  }, [stages, currentIndex]);

  /* ================= Fetchers ================= */

  const fetchCases = async () => {
    setLoadingCases(true);
    setError("");
    try {
      const res = await fetch(`${ADV_CASES_BASE}/assigned`, {
        method: "GET",
        headers: authHeaders(),
      });

      const data = await safeJson<{
        cases?: AssignedCase[];
        message?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) {
        setBlockedStatus(blocked);
        return;
      }
        throw new Error(data?.message || data?.error || "Failed to load cases.");
      }

      const list = Array.isArray(data?.cases) ? data.cases : [];
      setCases(list);
      setBlockedStatus(null);

      const first = list?.[0]?.id ? String(list[0].id) : "";
      setSelectedCaseId((prev) => {
        if (prev && list.some((x) => String(x.id) === String(prev))) return prev;
        return first;
      });
    } catch (e: any) {
      setCases([]);
      setSelectedCaseId("");
      setError(e?.message || "Failed to load cases.");
    } finally {
      setLoadingCases(false);
    }
  };

  const fetchStages = async (caseId: string) => {
    if (!caseId) return;
    setLoadingStages(true);
    setError("");
    try {
      const res = await fetch(
        `${ADV_STAGES_BASE}/cases/${encodeURIComponent(caseId)}/stages`,
        {
          method: "GET",
          headers: authHeaders(),
        }
      );

      const data = await safeJson<StagesResponse | any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) {
          setBlockedStatus(blocked);
          return; // the friendly locked banner communicates this — no raw error box
        }
        throw new Error(data?.message || data?.error || "Failed to load stages.");
      }

      setStages(Array.isArray(data?.stages) ? data.stages : FALLBACK_STAGES);
      setCompletedStages(Array.isArray(data?.completed_stages) ? data.completed_stages : []);
      setCurrentStage(data?.current_stage || FALLBACK_STAGES[0]);
      setHistory(Array.isArray(data?.history) ? data.history : []);
      setBlockedStatus(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load stages.");
    } finally {
      setLoadingStages(false);
    }
  };

  useEffect(() => {
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    fetchStages(selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  /* ================= Actions ================= */

  const refreshAll = async () => {
    await fetchCases();
    if (selectedCaseId) await fetchStages(selectedCaseId);
  };

  const completeCurrentStage = async () => {
    if (!selectedCaseId) return;

    setActionLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${ADV_STAGES_BASE}/cases/${encodeURIComponent(selectedCaseId)}/stages/complete`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ stage: currentStage, note: note.trim() || null }),
        }
      );

      const data = await safeJson<any>(res);
      if (!res.ok) {
        const blocked = getCaseNotActiveStatus(data);
        if (blocked) {
          setBlockedStatus(blocked);
          return;
        }
        throw new Error(data?.message || data?.error || "Failed to complete stage.");
      }

      setNote("");
      await fetchStages(selectedCaseId);
    } catch (e: any) {
      setError(e?.message || "Failed to complete stage.");
    } finally {
      setActionLoading(false);
    }
  };

  /* ================= Render ================= */

  return (
    <section className="space-y-6">
      {/* Header (Premium) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_34px_-22px_rgba(15,23,42,0.45)]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-extrabold text-[#004aad]">
              Case Stages Tracking
            </h1>
            <p className="text-sm text-slate-600 mt-2 max-w-2xl">
              Elegant stage checklist + progress speedometer. Completing the current stage
              auto-advances and notifies the client.
            </p>

            {/* Case selector */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Select case:</span>

              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
                disabled={loadingCases || cases.length === 0}
              >
                {cases.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.id)} — {c.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={refreshAll}
                disabled={loadingCases || loadingStages}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
                title="Refresh"
              >
                <RefreshCw size={16} className={loadingCases || loadingStages ? "animate-spin" : ""} />
                Refresh
              </button>

              {selectedCase?.status ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border bg-slate-50 text-slate-700 border-slate-200">
                  <BadgeCheck size={14} />
                  {formatStatus(selectedCase.status)}
                </span>
              ) : null}
            </div>
          </div>

          {/* right meta */}
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              <Clock size={14} />
              Live updates
            </span>
            {nextStage ? (
              <div className="text-xs text-slate-500">
                Next: <span className="font-semibold text-slate-700">{stageLabel(nextStage)}</span>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Next: <span className="font-semibold text-slate-700">—</span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {blockedStatus && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 inline-flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5" />
            <span>
              Stage tracking is locked until the case is active. Current status: <b>{prettyLifecycleStatus(blockedStatus)}</b>.
              Complete contract signatures and admin approval first.
            </span>
          </div>
        )}
      </div>

      {/* Gauge */}
      <div className="max-w-5xl">
        <Gauge
          percent={progress}
          label={stageLabel(currentStage)}
          doneCount={doneCount}
          totalCount={stages.length}
        />
      </div>

      {/* Checklist + Actions */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_34px_-22px_rgba(15,23,42,0.45)]">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-extrabold text-slate-900">Stage Checklist</div>
            <div className="text-xs text-slate-500 mt-1">
              Only the <b>current</b> stage can be completed (backend also enforces).
            </div>
          </div>

          {loadingStages ? (
            <span className="inline-flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border bg-slate-50 text-slate-700 border-slate-200">
              <CheckCircle2 size={14} /> {doneCount}/{stages.length} done
            </span>
          )}
        </div>

        {/* Modern list */}
        <div className="mt-5 space-y-2">
          {stages.map((s, idx) => {
            const isDone = completedStages.includes(s);
            const isCurrent = s === currentStage;
            const h = historyByStage.get(String(s).toUpperCase());

            return (
              <motion.div
                key={s}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(idx * 0.02, 0.25) }}
                className={`group rounded-3xl border p-4 flex items-start justify-between gap-4 ${
                  isDone
                    ? "border-emerald-200 bg-emerald-50"
                    : isCurrent
                    ? "border-[#004aad] bg-blue-50/50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="min-w-0 flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${
                      isDone
                        ? "border-emerald-200 bg-white text-emerald-700"
                        : isCurrent
                        ? "border-blue-200 bg-white text-blue-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {isDone ? (
                      <BadgeCheck size={18} />
                    ) : isCurrent ? (
                      <Clock size={18} />
                    ) : (
                      <Lock size={18} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {idx + 1}. {stageLabel(s)}
                    </div>

                    <div className="mt-1 text-xs text-slate-600">
                      {isDone
                        ? `Completed • ${fmtDateTime(h?.completed_at)}`
                        : isCurrent
                        ? "Current stage — ready to complete"
                        : "Locked until previous stage completes"}
                    </div>

                    {h?.note ? (
                      <div className="mt-2 text-xs text-slate-600 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                        <span className="font-semibold text-slate-800">Note:</span> {h.note}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {isDone ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border bg-emerald-50 text-emerald-700 border-emerald-200">
                      <BadgeCheck size={14} /> Done
                    </span>
                  ) : isCurrent ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border bg-blue-50 text-blue-700 border-blue-200">
                      <Clock size={14} /> Current
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border bg-slate-50 text-slate-700 border-slate-200">
                      <Lock size={14} /> Locked
                    </span>
                  )}

                  <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-400 transition" />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Complete current stage */}
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Optional note to client</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Included in notification/email if backend uses it.
                </div>
              </div>
              <span className="text-[11px] text-slate-500">
                {note.trim().length}/240
              </span>
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 240))}
              rows={5}
              placeholder="Short update message for client..."
              className="mt-3 w-full rounded-3xl border border-slate-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#004aad]/20"
            />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-xs text-slate-500">Action</div>

            <div className="mt-2 text-sm font-semibold text-slate-900">
              Complete: {stageLabel(currentStage)}
            </div>

            {nextStage ? (
              <div className="mt-1 text-xs text-slate-500">
                Next stage will be:{" "}
                <span className="font-semibold text-slate-700">{stageLabel(nextStage)}</span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-500">
                Next stage will be: <span className="font-semibold text-slate-700">—</span>
              </div>
            )}

            <button
              type="button"
              onClick={completeCurrentStage}
              disabled={!selectedCaseId || loadingStages || actionLoading}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-3xl font-semibold transition bg-[#004aad] text-white hover:bg-[#003b82] disabled:opacity-60"
            >
              {actionLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              {actionLoading ? "Completing..." : "Mark Current Stage Completed"}
            </button>

            <div className="mt-3 text-xs text-slate-500">
              After completion, stage auto-advances and client receives email.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
