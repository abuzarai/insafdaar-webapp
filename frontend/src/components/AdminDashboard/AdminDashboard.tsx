import { formatStatus } from "../common/formatStatus";
import { isErrorMessage } from "../common/messageTone";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Search,
  Trash2,
  Pencil,
  Eye,
  RefreshCw,
  ShieldCheck,
  BarChart3,
  Bell,
  Home,
  Bot,
  LogOut,
  Menu,
  Inbox,
  CalendarDays,
  ClipboardList,
  FileSignature,
  Receipt,
  Check,
  Ban,
} from "lucide-react";
import { API_BASE_URL } from "../../config";
import { useNavigate } from "react-router-dom";

import AdminCaseDiscussion from "../../components/AdminDashboard/AdminCaseDiscussion";
import AssignmentQueuePanel from "../../components/AdminDashboard/AssignmentQueuePanel";
import { useActionDialogs } from "../common/ActionDialog";

type ClientRow = {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  created_at: string;
};

type AdvocateRow = {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  created_at: string;

  headline?: string | null;
  experience_years?: number | null;
  bar_council_id?: string | null;
  city?: string | null;
  court?: string | null;
  languages?: string[] | null;
  practice_areas?: string[] | null;
  public_profile_enabled?: boolean | null;
};

type PerfOverview = {
  total_requests: number;
  avg_latency_ms: number;
  error_rate_5xx: number; // 0..100
  unique_users: number;
};

type PerfSystem = {
  timestamp: string;
  uptimeSec: number;
  nodeVersion: string;
  pid: number;
  platform: string;
  arch: string;
  cpuCores: number;
  loadAvg: number[];
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
  };
  hostMemory: {
    totalMb: number;
    freeMb: number;
  };
};

type PerfEndpointRow = {
  method: string;
  route: string;
  total_requests: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  error_rate_5xx: number;
  last_seen_at: string;
};

type PerfTrafficRow = {
  method: string;
  route: string;
  requests: number;
  avg_latency_ms: number;
  last_seen_at: string;
};

type PerfStatusClassRow = {
  status_class: string;
  count: number;
};

type PerfTopCodeRow = {
  status: number;
  count: number;
};

type PerfSlowRow = {
  endpoint: string;
  method: string;
  count: number;
  avg_ms: number;
  p95_ms: number;
};

type PerfErrorRow = {
  endpoint: string;
  method: string;
  status_code: number;
  count: number;
};

type AdminNotificationRow = {
  id: number;
  title: string;
  description: string | null;
  type: string | null;
  is_read: boolean;
  created_at: string;
};

function notificationPriority(n: AdminNotificationRow): "high" | "medium" | "low" {
  const type = String(n.type || "").toUpperCase();
  const title = String(n.title || "").toUpperCase();
  if (type.includes("ERROR") || title.includes("REJECT") || title.includes("FAILED")) return "high";
  if (type.includes("CASE") || title.includes("APPROVAL") || title.includes("PENDING")) return "medium";
  return "low";
}

function authHeaders(): Headers {
  const headers = new Headers();
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("text/html")) {
    throw new Error(
      `Backend returned HTML instead of JSON (status ${res.status}). Check API_BASE_URL and route: ${res.url}`
    );
  }
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Backend did not return valid JSON (status ${res.status}). Check API route: ${res.url}`
    );
  }
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-4 bg-slate-200 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-slate-200 bg-slate-50 text-slate-700">
      {children}
    </span>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = "primary",
}: {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon: React.ReactNode;
  tone?: "primary" | "accent" | "neutral";
}) {
  const styles =
    tone === "accent"
      ? { bg: "#FFFBEB", ring: "#FCD34D", fg: "#92400E" } // amber soft
      : tone === "neutral"
      ? { bg: "#F1F5F9", ring: "#CBD5E1", fg: "#334155" } // slate soft
      : { bg: "#EEF2FF", ring: "#C7D2FE", fg: "#1E3A8A" }; // indigo soft

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">
            {title}
          </div>
          <div className="mt-1 text-3xl font-extrabold text-slate-900">
            {value}
          </div>
          {subtitle ? (
            <div className="mt-1 text-xs text-slate-600 font-medium">
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          className="w-11 h-11 rounded-2xl border flex items-center justify-center"
          style={{
            background: styles.bg,
            borderColor: styles.ring,
            color: styles.fg,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

type TabKey = "clients" | "advocates" | "performance" | "meetings";

type PendingContractRow = {
  id: number;
  case_id: number;
  version_no: number;
  title: string | null;
  status: string;
  updated_at: string;
  case_title?: string | null;
  client_name?: string | null;
  advocate_name?: string | null;
};

type ContractDetails = {
  id: number;
  caseId: number;
  versionNo?: number;
  title: string | null;
  contractText: string;
  status: string;
  artifact?: {
    id: number;
    canonical_text_sha256: string;
    generated_at: string;
  } | null;
  attachments?: Array<{
    id: number;
    file_name: string;
    file_path: string;
    mime_type: string;
    file_size: number;
    created_at: string;
  }>;
  signatures?: {
    clientSignature?: {
      typed_full_name: string;
      signed_at: string;
      contract_version_no?: number;
      canonical_text_sha256_at_sign?: string;
      confirmed_read_understood?: boolean;
      confirmed_voluntary?: boolean;
      confirmed_typed_signature?: boolean;
      confirmed_reviewed_attachments?: boolean;
    } | null;
    advocateSignature?: {
      typed_full_name: string;
      signed_at: string;
      contract_version_no?: number;
      canonical_text_sha256_at_sign?: string;
      confirmed_read_understood?: boolean;
      confirmed_voluntary?: boolean;
      confirmed_typed_signature?: boolean;
      confirmed_reviewed_attachments?: boolean;
    } | null;
  };
};

type BillingVoucherRow = {
  id: number;
  user_id: number;
  case_id: number | null;
  title: string;
  amount: number;
  status: string;
  due_date: string | null;
  voucher_pdf_url: string | null;
  created_at: string;
};

type PendingProofRow = {
  proof_id: number;
  client_user_id: number;
  billing_id: number;
  case_id: number | null;
  title: string;
  amount: number;
  proof_file_url: string;
  voucher_pdf_url: string | null;
  note: string | null;
  uploaded_at: string;
  client_email: string | null;
};

type VoucherCaseOption = {
  case_id: number;
  client_user_id: number;
  assigned_advocate_id: number | null;
  status: string;
  case_title: string | null;
  payment_required_total: number;
  payment_verified_total: number;
  payment_status: string;
  client_name: string | null;
  client_email: string | null;
  advocate_name: string | null;
  advocate_email: string | null;
  updated_at: string;
};

function rowTone(index: number) {
  return index % 2 === 0 ? "bg-white" : "bg-slate-50/60";
}

function contractPriority(status: string, updatedAt?: string | null): "high" | "medium" | "low" {
  const s = String(status || "").toUpperCase();
  if (s !== "PENDING_ADMIN_APPROVAL") return "low";
  if (!updatedAt) return "medium";
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs > 24 * 60 * 60 * 1000) return "high";
  return "medium";
}

function priorityChip(priority: "high" | "medium" | "low") {
  if (priority === "high") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-rose-200 bg-rose-50 text-rose-800">High</span>;
  }
  if (priority === "medium") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800">Medium</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-slate-200 bg-slate-50 text-slate-700">Low</span>;
}

type WorkflowCounts = {
  assignments: number;
  meetings: number;
  contracts: number;
  notifications: number;
};

export default function AdminDashboard() {
  const navigate = useNavigate();

  const BRAND = {
    primary: "#1E3A8A",
    primary2: "#2563EB",
    accent: "#F59E0B",
    pageBg: "#F2F5FA",
    barBg: "#EEF2FF",
    soft: "#EFF6FF",
  };

  const [tab, setTab] = useState<TabKey | "contracts" | "assignments" | "overview" | "vouchers">("overview");

  const [totalClients, setTotalClients] = useState(0);
  const [totalAdvocates, setTotalAdvocates] = useState(0);

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [advocates, setAdvocates] = useState<AdvocateRow[]>([]);

  // Notifications view (Bell)
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [notifsMsg, setNotifsMsg] = useState("");
  const [adminNotifs, setAdminNotifs] = useState<AdminNotificationRow[]>([]);

  // Client modal
  const [editClient, setEditClient] = useState<ClientRow | null>(null);
  const [editClientForm, setEditClientForm] = useState({
    name: "",
    phone: "",
    email: "",
  });

  // Advocate modal
  const [editAdvocate, setEditAdvocate] = useState<AdvocateRow | null>(null);
  const [editAdvocateForm, setEditAdvocateForm] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    court: "",
    bar_council_id: "",
  });

  const activeControllerRef = useRef<AbortController | null>(null);

  // Performance state
  const perfControllerRef = useRef<AbortController | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfMsg, setPerfMsg] = useState("");
  const [perfOverview, setPerfOverview] = useState<PerfOverview | null>(null);
  const [perfSystem, setPerfSystem] = useState<PerfSystem | null>(null);
  const [perfEndpoints, setPerfEndpoints] = useState<PerfEndpointRow[]>([]);
  const [perfTraffic, setPerfTraffic] = useState<PerfTrafficRow[]>([]);
  const [perfStatusClasses, setPerfStatusClasses] = useState<PerfStatusClassRow[]>([]);
  const [perfTopCodes, setPerfTopCodes] = useState<PerfTopCodeRow[]>([]);
  const [endpointSearch, setEndpointSearch] = useState("");
  const [perfSlow, setPerfSlow] = useState<PerfSlowRow[]>([]);
  const [perfErrors, setPerfErrors] = useState<PerfErrorRow[]>([]);
  const [pendingContracts, setPendingContracts] = useState<PendingContractRow[]>([]);
  const [selectedContractCaseId, setSelectedContractCaseId] = useState<number | null>(null);
  const [contractDetails, setContractDetails] = useState<ContractDetails | null>(null);
  const [contractBusy, setContractBusy] = useState(false);
  const [contractAction, setContractAction] = useState<"refresh" | "approve" | "reject" | null>(null);
  const [workflowCounts, setWorkflowCounts] = useState<WorkflowCounts>({
    assignments: 0,
    meetings: 0,
    contracts: 0,
    notifications: 0,
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { confirm, prompt, dialogs } = useActionDialogs();

  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherAction, setVoucherAction] = useState<"refresh" | "create" | "send" | "verify" | "reject" | "override" | null>(null);
  const [voucherCaseId, setVoucherCaseId] = useState("");
  const [voucherTitle, setVoucherTitle] = useState("Case Voucher");
  const voucherAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [voucherDueDate, setVoucherDueDate] = useState("");
  const [voucherInstallment, setVoucherInstallment] = useState(false);
  const [voucherSequenceNo, setVoucherSequenceNo] = useState("1");
  const [billingRows, setBillingRows] = useState<BillingVoucherRow[]>([]);
  const [pendingProofs, setPendingProofs] = useState<PendingProofRow[]>([]);
  const [voucherCaseOptions, setVoucherCaseOptions] = useState<VoucherCaseOption[]>([]);

  const pct = (n?: number | null) =>
    typeof n === "number" ? `${Number(n).toFixed(1)}%` : "—";

  const msOrDash = (n?: number | null) =>
    typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}ms` : "—";

  /* =================== UI atoms =================== */

  const PrimaryBtn = ({
    children,
    onClick,
    disabled,
    title,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
        "border border-transparent disabled:opacity-60 disabled:cursor-not-allowed",
        "hover:brightness-[0.98] active:brightness-[0.96]",
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primary2} 100%)`,
        color: "white",
      }}
    >
      {children}
    </button>
  );

  const GhostBtn = ({
    children,
    onClick,
    disabled,
    title,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
        "bg-white border border-slate-200 hover:bg-slate-50",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );

  const CardShell = ({
    title,
    right,
    children,
  }: {
    title: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="font-bold text-slate-900">{title}</div>
        {right}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );

  const SegTab = ({
    active,
    icon,
    label,
    onClick,
  }: {
    active: boolean;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 min-w-[160px] inline-flex items-center justify-center gap-2",
        "px-4 py-2.5 rounded-xl border text-sm font-semibold transition",
        active
          ? "border-slate-200 text-slate-900"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
      )}
      style={
        active
          ? {
              borderLeft: `3px solid ${BRAND.accent}`,
              background: BRAND.soft,
            }
          : undefined
      }
    >
      <span style={{ color: active ? BRAND.primary : "#334155" }}>{icon}</span>
      {label}
    </button>
  );

  /* =================== loaders =================== */

  const loadStats = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/stats`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load stats");
    setTotalClients(data?.totalClients || 0);
    setTotalAdvocates(data?.totalAdvocates || 0);
  };

  const loadClients = async (search: string, signal?: AbortSignal) => {
    const res = await fetch(
      `${API_BASE_URL}/api/admin/clients?q=${encodeURIComponent(search)}`,
      { headers: authHeaders(), signal }
    );
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load clients");
    setClients(data?.clients || []);
  };

  const loadAdvocates = async (search: string, signal?: AbortSignal) => {
    const res = await fetch(
      `${API_BASE_URL}/api/admin/advocates?q=${encodeURIComponent(search)}`,
      { headers: authHeaders(), signal }
    );
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load advocates");
    setAdvocates(data?.advocates || []);
  };

  const loadPerformanceOverview = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/overview`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok)
      throw new Error(data?.error || "Failed to load performance overview");
    setPerfOverview((data?.overview || null) as PerfOverview | null);
  };

  const loadPerformanceSystem = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/system`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load system snapshot");
    setPerfSystem((data || null) as PerfSystem | null);
  };

  const loadPerformanceEndpoints = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/endpoints?limit=200`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load endpoints inventory");
    setPerfEndpoints((data?.endpoints || []) as PerfEndpointRow[]);
  };

  const loadPerformanceTraffic = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/traffic?limit=15`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load traffic endpoints");
    setPerfTraffic((data?.traffic || []) as PerfTrafficRow[]);
  };

  const loadPerformanceStatusCodes = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/status-codes`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load status code distribution");
    setPerfStatusClasses((data?.classes || []) as PerfStatusClassRow[]);
    setPerfTopCodes((data?.topCodes || []) as PerfTopCodeRow[]);
  };

  const loadPerformanceSlow = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/slow`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load slow endpoints");
    setPerfSlow(data?.slow || []);
  };

  const loadPerformanceErrors = async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/performance/errors`, {
      headers: authHeaders(),
      signal,
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load errors");
    setPerfErrors(data?.errors || []);
  };

  const loadAdminNotifications = async () => {
    try {
      setNotifsLoading(true);
      setNotifsMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/notifications`, {
        headers: authHeaders(),
      });
      const data = await safeJson(res);

      if (!res.ok) {
        throw new Error(
          data?.error ||
            "Failed to load notifications. Ensure GET /api/admin/notifications exists."
        );
      }

      setAdminNotifs(data?.notifications || []);
    } catch (e: any) {
      setNotifsMsg(e?.message || "Failed to load notifications");
      setAdminNotifs([]);
    } finally {
      setNotifsLoading(false);
    }
  };

  const loadPendingContracts = async () => {
    const res = await fetch(`${API_BASE_URL}/api/admin/contracts/pending`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load contracts");
    setPendingContracts(data?.contracts || []);
  };

  const loadContractDetails = async (caseId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/admin/contracts/cases/${caseId}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load contract details");
    setContractDetails((data?.contract || null) as ContractDetails | null);
  };

  const loadAllBilling = async () => {
    const out: BillingVoucherRow[] = [];
    for (const c of clients) {
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/client/${c.id}`, {
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) continue;
      const rows = Array.isArray(data?.billing) ? data.billing : [];
      for (const r of rows) {
        out.push({
          id: Number(r.id),
          user_id: Number(r.user_id),
          case_id: r.case_id ? Number(r.case_id) : null,
          title: String(r.title || "Voucher"),
          amount: Number(r.amount || 0),
          status: String(r.status || ""),
          due_date: r.due_date || null,
          voucher_pdf_url: r.voucher_pdf_url || null,
          created_at: r.created_at,
        });
      }
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setBillingRows(out);
  };

  const loadPendingPaymentProofs = async () => {
    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/pending`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load pending payment proofs");
    setPendingProofs((data?.proofs || []) as PendingProofRow[]);
  };

  const loadVoucherCaseOptions = async () => {
    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/cases/options`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load active cases");
    const rows = (data?.cases || []) as VoucherCaseOption[];
    setVoucherCaseOptions(rows);
    if (!voucherCaseId && rows.length > 0) {
      setVoucherCaseId(String(rows[0].case_id));
    }
  };

  const loadWorkflowCounts = async () => {
    const [assignRes, meetingsRes, contractsRes, notifsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/admin/client-access/start-case/assignment-queue`, {
        headers: authHeaders(),
      }).then((r) => safeJson(r).then((d) => ({ ok: r.ok, data: d }))),
      fetch(`${API_BASE_URL}/api/admin/case-discussion/meeting-requests?status=PENDING_ADMIN`, {
        headers: authHeaders(),
      }).then((r) => safeJson(r).then((d) => ({ ok: r.ok, data: d }))),
      fetch(`${API_BASE_URL}/api/admin/contracts/pending`, {
        headers: authHeaders(),
      }).then((r) => safeJson(r).then((d) => ({ ok: r.ok, data: d }))),
      fetch(`${API_BASE_URL}/api/admin/notifications`, {
        headers: authHeaders(),
      }).then((r) => safeJson(r).then((d) => ({ ok: r.ok, data: d }))),
    ]);

    const assignments =
      assignRes.ok && Array.isArray(assignRes.data?.queue)
        ? assignRes.data.queue.filter(
            (item: { status?: string }) =>
              String(item.status || "").toUpperCase() !== "ADVOCATE_ASSIGNED"
          ).length
        : 0;
    const meetings =
      meetingsRes.ok && Array.isArray(meetingsRes.data?.meetings)
        ? meetingsRes.data.meetings.length
        : 0;
    const contracts =
      contractsRes.ok && Array.isArray(contractsRes.data?.contracts)
        ? contractsRes.data.contracts.length
        : 0;
    const notifications =
      notifsRes.ok && Array.isArray(notifsRes.data?.notifications)
        ? notifsRes.data.notifications.filter((n: AdminNotificationRow) => !n.is_read).length
        : 0;

    setWorkflowCounts({ assignments, meetings, contracts, notifications });
  };

  /* =================== refreshers =================== */

  const refreshAll = async (search = q) => {
    if (activeControllerRef.current) activeControllerRef.current.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      setLoading(true);
      setMsg("");

      await Promise.all([
        loadStats(controller.signal),
        loadClients(search, controller.signal),
        loadAdvocates(search, controller.signal),
        loadPerformanceOverview(controller.signal),
        loadWorkflowCounts(),
      ]);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setMsg(e?.message || "Failed to load admin data");
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshPerformance = async () => {
    if (perfControllerRef.current) perfControllerRef.current.abort();
    const controller = new AbortController();
    perfControllerRef.current = controller;

    try {
      setPerfLoading(true);
      setPerfMsg("");
      await Promise.all([
        loadPerformanceOverview(controller.signal),
        loadPerformanceSystem(controller.signal),
        loadPerformanceEndpoints(controller.signal),
        loadPerformanceTraffic(controller.signal),
        loadPerformanceStatusCodes(controller.signal),
        loadPerformanceSlow(controller.signal),
        loadPerformanceErrors(controller.signal),
      ]);
    } catch (e: any) {
      if (e?.name !== "AbortError")
        setPerfMsg(e?.message || "Failed to load performance");
    } finally {
      setPerfLoading(false);
    }
  };

  useEffect(() => {
    refreshAll("");
    return () => {
      if (activeControllerRef.current) activeControllerRef.current.abort();
      if (perfControllerRef.current) perfControllerRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== "performance") return;
    refreshPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "contracts") return;
    setContractBusy(true);
    loadPendingContracts()
      .catch((e: any) => setMsg(e?.message || "Failed to load contracts"))
      .finally(() => setContractBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "vouchers") return;
    setVoucherBusy(true);
    Promise.all([loadVoucherCaseOptions(), loadAllBilling(), loadPendingPaymentProofs()])
      .catch((e: any) => setMsg(e?.message || "Failed to load voucher data"))
      .finally(() => setVoucherBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "overview" && tab !== "meetings" && tab !== "contracts" && tab !== "assignments") return;
    loadWorkflowCounts().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // switching tabs closes notifications + clears banner
  useEffect(() => {
    setShowNotifications(false);
    setMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* =================== actions =================== */

  const openEditClient = (c: ClientRow) => {
    setEditClient(c);
    setEditClientForm({
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
    });
  };

  const saveClientEdit = async () => {
    if (!editClient) return;
    try {
      setLoading(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(
        `${API_BASE_URL}/api/admin/clients/${editClient.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(editClientForm),
        }
      );

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Update failed");

      setMsg("Client updated");
      setEditClient(null);
      await refreshAll();
    } catch (e: any) {
      setMsg(`${e?.message || "Update failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteClient = async (id: number) => {
    const ok = await confirm({
      title: "Delete Client Account",
      message:
        "Delete this client account permanently? This removes profile access and related dashboard records. This action cannot be undone.",
      confirmText: "Delete Client",
      cancelText: "Keep Client",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/clients/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Delete failed");

      setMsg("Client deleted");
      await refreshAll();
    } catch (e: any) {
      setMsg(`${e?.message || "Delete failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const openEditAdvocate = (a: AdvocateRow) => {
    setEditAdvocate(a);
    setEditAdvocateForm({
      name: a.name || "",
      phone: a.phone || "",
      email: a.email || "",
      city: a.city || "",
      court: a.court || "",
      bar_council_id: a.bar_council_id || "",
    });
  };

  const saveAdvocateEdit = async () => {
    if (!editAdvocate) return;

    try {
      setLoading(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(
        `${API_BASE_URL}/api/admin/advocates/${editAdvocate.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(editAdvocateForm),
        }
      );

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Update failed");

      setMsg("Advocate updated");
      setEditAdvocate(null);
      await refreshAll();
    } catch (e: any) {
      setMsg(`${e?.message || "Update failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteAdvocate = async (id: number) => {
    const ok = await confirm({
      title: "Delete Advocate Account",
      message:
        "Delete this advocate account permanently? This removes login access and associated profile records. This action cannot be undone.",
      confirmText: "Delete Advocate",
      cancelText: "Keep Advocate",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/advocates/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Delete failed");

      setMsg("Advocate deleted");
      await refreshAll();
    } catch (e: any) {
      setMsg(`${e?.message || "Delete failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const onSearch = async () => {
    setShowNotifications(false);
    setMsg("");
    await refreshAll(q);
  };

  const filteredClients = useMemo(() => clients, [clients]);
  const filteredAdvocates = useMemo(() => advocates, [advocates]);

  const doLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const approveContract = async (caseId: number) => {
    try {
      setContractAction("approve");
      setContractBusy(true);
      setMsg("");
      const res = await fetch(`${API_BASE_URL}/api/admin/contracts/cases/${caseId}/approve`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to approve contract");
      setMsg("Contract approved and case activated");
      await loadPendingContracts();
      if (selectedContractCaseId === caseId) {
        setSelectedContractCaseId(null);
        setContractDetails(null);
      }
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to approve contract"}`);
    } finally {
      setContractBusy(false);
      setContractAction(null);
    }
  };

  const rejectContract = async (caseId: number) => {
    const rejectionNote = await prompt({
      title: "Reject Contract",
      message: "Enter a clear rejection reason for both client and advocate. This will be saved in the audit log.",
      confirmText: "Reject Contract",
      cancelText: "Cancel",
      placeholder: "Explain the required contract changes...",
      defaultValue: "Contract changes requested",
      required: true,
      tone: "danger",
    });
    if (!rejectionNote) return;
    try {
      setContractAction("reject");
      setContractBusy(true);
      setMsg("");
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/contracts/cases/${caseId}/reject`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rejectionNote }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to reject contract");
      setMsg("Contract sent back for revision");
      await loadPendingContracts();
      if (selectedContractCaseId === caseId) {
        await loadContractDetails(caseId).catch(() => setContractDetails(null));
      }
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to reject contract"}`);
    } finally {
      setContractBusy(false);
      setContractAction(null);
    }
  };

  const createVoucher = async () => {
    try {
      const caseId = Number(voucherCaseId || 0);
      const normalizedAmount = String(voucherAmountInputRef.current?.value || "").replace(/,/g, "").trim();
      const amount = Number(normalizedAmount);
      if (!caseId) {
        setMsg("Select an active case to create a voucher.");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setMsg("Enter a valid amount (numbers only, e.g. 15000)");
        return;
      }

      setVoucherAction("create");
      setVoucherBusy(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/cases/${caseId}/vouchers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: voucherTitle || "Case Voucher",
          amount,
          due_date: voucherDueDate || undefined,
          is_installment: voucherInstallment,
          sequence_no: Number(voucherSequenceNo || 1),
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to create voucher");

      setMsg("Voucher created");
      await Promise.all([loadAllBilling(), loadVoucherCaseOptions()]);
      if (voucherAmountInputRef.current) voucherAmountInputRef.current.value = "";
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to create voucher"}`);
    } finally {
      setVoucherBusy(false);
      setVoucherAction(null);
    }
  };

  const sendVoucher = async (billingId: number) => {
    try {
      setVoucherAction("send");
      setVoucherBusy(true);
      setMsg("");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/vouchers/${billingId}/send`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to send voucher");
      setMsg("Voucher issued to client");
      await Promise.all([loadAllBilling(), loadVoucherCaseOptions()]);
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to send voucher"}`);
    } finally {
      setVoucherBusy(false);
      setVoucherAction(null);
    }
  };

  const verifyPaymentProof = async (proofId: number) => {
    try {
      setVoucherAction("verify");
      setVoucherBusy(true);
      setMsg("");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/${proofId}/verify`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to verify proof");
      setMsg("Payment verified");
      await Promise.all([loadPendingPaymentProofs(), loadAllBilling(), loadVoucherCaseOptions()]);
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to verify proof"}`);
    } finally {
      setVoucherBusy(false);
      setVoucherAction(null);
    }
  };

  const rejectPaymentProof = async (proofId: number, caseId?: number | null) => {
    const reason = await prompt({
      title: "Reject Payment Proof",
      message: "Enter reason shown to the client.",
      confirmText: "Reject",
      cancelText: "Cancel",
      placeholder: "Reason for rejection",
      required: true,
      tone: "danger",
    });
    if (!reason) return;
    try {
      setVoucherAction("reject");
      setVoucherBusy(true);
      setMsg("");
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/${proofId}/reject`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ reason }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to reject proof");
      setMsg("Payment proof rejected");
      await Promise.all([loadPendingPaymentProofs(), loadAllBilling(), loadVoucherCaseOptions()]);
      if (caseId) {
        await fetch(`${API_BASE_URL}/api/admin/client-access/billing/cases/${caseId}/manual-payment-status`, {
          method: "POST",
          headers,
          body: JSON.stringify({ status: "CLEAR_OVERRIDE", note: "" }),
        }).catch(() => {});
      }
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to reject proof"}`);
    } finally {
      setVoucherBusy(false);
      setVoucherAction(null);
    }
  };

  const manualMarkCasePaid = async () => {
    const caseId = Number(voucherCaseId || 0);
    if (!caseId) {
      setMsg("Case ID is required for manual override");
      return;
    }
    const note = await prompt({
      title: "Manual Payment Override",
      message: "Enter reason for setting case payment status manually.",
      confirmText: "Set Fully Paid",
      cancelText: "Cancel",
      placeholder: "Reason",
      required: true,
    });
    if (!note) return;
    try {
      setVoucherAction("override");
      setVoucherBusy(true);
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/cases/${caseId}/manual-payment-status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status: "FULLY_PAID", note }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to set manual payment status");
      setMsg("Case payment manually marked as fully paid");
      await loadVoucherCaseOptions();
    } catch (e: any) {
      setMsg(`${e?.message || "Failed to set manual payment status"}`);
    } finally {
      setVoucherBusy(false);
      setVoucherAction(null);
    }
  };

  const topLatency = perfOverview ? msOrDash(perfOverview.avg_latency_ms) : "—";
  const topErr = perfOverview ? pct(perfOverview.error_rate_5xx) : "—";

  const filteredPerfEndpoints = useMemo(() => {
    const qx = endpointSearch.trim().toLowerCase();
    if (!qx) return perfEndpoints;
    return perfEndpoints.filter((r) =>
      `${String(r.method || "")} ${String(r.route || "")}`.toLowerCase().includes(qx)
    );
  }, [perfEndpoints, endpointSearch]);

  const recentActivity = useMemo<
    Array<{
      id: string;
      title: string;
      meta: string;
      priority: "high" | "medium" | "low";
      onClick: () => void;
    }>
  >(() => {
    const notifItems = (adminNotifs || []).slice(0, 5).map((n) => ({
      id: `notif-${n.id}`,
      title: n.title || "Notification",
      meta: new Date(n.created_at).toLocaleString(),
      priority: notificationPriority(n) as "high" | "medium" | "low",
      onClick: openNotifications,
    }));

    const systemItems = [
      {
        id: "sys-assign",
        title: `${workflowCounts.assignments} case(s) waiting for assignment review`,
        meta: "Assignments queue",
      priority: (workflowCounts.assignments > 5 ? "high" : workflowCounts.assignments > 0 ? "medium" : "low") as
        | "high"
        | "medium"
        | "low",
        onClick: () => setTab("assignments"),
      },
      {
        id: "sys-meetings",
        title: `${workflowCounts.meetings} meeting request(s) pending admin approval`,
        meta: "Meeting approvals",
      priority: (workflowCounts.meetings > 3 ? "high" : workflowCounts.meetings > 0 ? "medium" : "low") as
        | "high"
        | "medium"
        | "low",
        onClick: () => setTab("meetings"),
      },
      {
        id: "sys-contracts",
        title: `${workflowCounts.contracts} contract(s) waiting for approval`,
        meta: "Contract approvals",
      priority: (workflowCounts.contracts > 3 ? "high" : workflowCounts.contracts > 0 ? "medium" : "low") as
        | "high"
        | "medium"
        | "low",
        onClick: () => setTab("contracts"),
      },
      {
        id: "sys-perf",
        title: `System health: avg latency ${topLatency}, 5xx ${topErr}`,
        meta: perfSystem?.timestamp ? `Updated ${new Date(perfSystem.timestamp).toLocaleString()}` : "Performance snapshot",
        priority: (
          typeof perfOverview?.error_rate_5xx === "number" && perfOverview.error_rate_5xx >= 5
            ? "high"
            : typeof perfOverview?.error_rate_5xx === "number" && perfOverview.error_rate_5xx > 0
            ? "medium"
            : "low"
        ) as "high" | "medium" | "low",
        onClick: () => setTab("performance"),
      },
    ];

    return [...notifItems, ...systemItems].slice(0, 8);
  }, [
    adminNotifs,
    workflowCounts.assignments,
    workflowCounts.meetings,
    workflowCounts.contracts,
    topLatency,
    topErr,
    perfOverview?.error_rate_5xx,
    perfSystem?.timestamp,
  ]);

  const unreadCount = useMemo(
    () => adminNotifs.filter((n) => !n.is_read).length,
    [adminNotifs]
  );

  const selectedVoucherCase = useMemo(
    () => voucherCaseOptions.find((c) => String(c.case_id) === String(voucherCaseId)) || null,
    [voucherCaseOptions, voucherCaseId]
  );

  const navItems = [
    {
      key: "overview" as const,
      label: "Overview",
      icon: <LayoutDashboard size={18} />,
      count: 0,
    },
    {
      key: "assignments" as const,
      label: "Assignments",
      icon: <ClipboardList size={18} />,
      count: workflowCounts.assignments,
    },
    {
      key: "meetings" as const,
      label: "Meetings",
      icon: <CalendarDays size={18} />,
      count: workflowCounts.meetings,
    },
    {
      key: "contracts" as const,
      label: "Contracts",
      icon: <FileSignature size={18} />,
      count: workflowCounts.contracts,
    },
    {
      key: "vouchers" as const,
      label: "Vouchers",
      icon: <Receipt size={18} />,
      count: pendingProofs.length,
    },
    {
      key: "clients" as const,
      label: "Clients",
      icon: <Users size={18} />,
      count: 0,
    },
    {
      key: "advocates" as const,
      label: "Advocates",
      icon: <ShieldCheck size={18} />,
      count: 0,
    },
    {
      key: "performance" as const,
      label: "Performance",
      icon: <BarChart3 size={18} />,
      count: 0,
    },
  ];

  const openNotifications = async () => {
    setShowNotifications(true);
    setMsg("");
    await loadAdminNotifications();
  };

  /* =================== render =================== */

  return (
    <div className="min-h-screen w-full flex" style={{ background: BRAND.pageBg }}>
      <aside className="hidden lg:flex lg:w-72 xl:w-80 border-r border-slate-200 bg-white/95 backdrop-blur flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Admin Console</div>
          <div className="text-xl font-extrabold text-slate-900 mt-1">Insafdaar Ops</div>
          <div className="text-xs text-slate-500 mt-1">Workflow-first management dashboard</div>
        </div>

        <div className="p-3 space-y-1 overflow-auto flex-1">
          {navItems.map((item) => {
            const active = !showNotifications && tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setShowNotifications(false);
                  setTab(item.key);
                }}
                className={cn(
                  "w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition border",
                  active
                    ? "bg-indigo-50 border-indigo-200 text-indigo-900"
                    : "bg-white border-transparent text-slate-700 hover:bg-slate-50"
                )}
              >
                <span className="inline-flex items-center gap-2">
                  {item.icon}
                  {item.label}
                </span>
                {item.count > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={openNotifications}
            className={cn(
              "w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition border",
              showNotifications
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-white border-transparent text-slate-700 hover:bg-slate-50"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Bell size={18} />
              Notifications
            </span>
            {unreadCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              </span>
            ) : null}
          </button>
        </div>

      </aside>

      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileNavOpen(false)}>
          <div
            className="w-72 h-full bg-white border-r border-slate-200 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-2 mb-2 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-900">Admin Sections</div>
            </div>
            <div className="space-y-1">
              {navItems.map((item) => {
                const active = !showNotifications && tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setShowNotifications(false);
                      setTab(item.key);
                      setMobileNavOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition border",
                      active
                        ? "bg-indigo-50 border-indigo-200 text-indigo-900"
                        : "bg-white border-transparent text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      {item.icon}
                      {item.label}
                    </span>
                    {item.count > 0 ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800">{item.count > 99 ? "99+" : item.count}</span> : null}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  openNotifications();
                  setMobileNavOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition border bg-white border-transparent text-slate-700 hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Bell size={18} /> Notifications
                </span>
                {unreadCount > 0 ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-10 backdrop-blur border-b border-slate-200" style={{ background: `${BRAND.barBg}CC` }}>
          <div className="w-full px-4 md:px-6 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1"
                >
                  <Menu size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Admin</span>
                <span>›</span>
                <span className="text-slate-700 font-semibold">{showNotifications ? "Notifications" : String(tab).toUpperCase()}</span>
              </div>
              <div className="text-lg font-bold text-slate-900">{showNotifications ? "Notifications" : "Operations Workspace"}</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/")}
                title="Go to Home"
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
              >
                <Home size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={() => navigate("/legal-assistant")}
                title="Open Legal Assistant"
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
              >
                <Bot size={18} className="text-slate-700" />
              </button>

              <GhostBtn onClick={() => refreshAll()} disabled={loading} title="Refresh all">
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} style={{ color: BRAND.primary }} />
                {loading ? "Refreshing..." : "Refresh"}
              </GhostBtn>
              <button
                onClick={openNotifications}
                className="relative inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Notifications"
                type="button"
              >
                <Bell size={18} className="text-slate-700" />
                {unreadCount > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center bg-rose-500 text-white border-2 border-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={doLogout}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 transition"
                title="Logout"
              >
                <LogOut size={18} className="text-rose-800" />
              </button>
            </div>
          </div>
          {msg && !showNotifications ? (
            <div className="w-full px-4 md:px-6 pb-3">
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm font-semibold",
                  isErrorMessage(msg)
                    ? "bg-rose-50 border-rose-200 text-rose-900"
                    : "bg-emerald-50 border-emerald-200 text-emerald-900"
                )}
              >
                {msg}
              </div>
            </div>
          ) : null}
        </div>

        <div className="w-full px-4 md:px-6 py-6">
        {showNotifications ? (
          /* ================= NOTIFICATIONS VIEW ================= */
          <div className="space-y-4">
            <div className="relative">
              <div
                className="absolute -inset-x-2 -top-3 h-20 rounded-2xl blur-2xl opacity-60 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(245,158,11,0.16) 0%, rgba(37,99,235,0.12) 50%, rgba(30,58,138,0.14) 100%)",
                }}
              />
              <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Inbox size={18} style={{ color: BRAND.primary }} />
                    <div className="font-bold text-slate-900">
                      Admin Notifications
                    </div>
                    <Badge>{adminNotifs.length}</Badge>
                    {unreadCount ? <Badge>{unreadCount} unread</Badge> : null}
                  </div>
                  <GhostBtn
                    onClick={loadAdminNotifications}
                    disabled={notifsLoading}
                    title="Refresh notifications"
                    className="px-3"
                  >
                    <RefreshCw
                      size={16}
                      className={notifsLoading ? "animate-spin" : ""}
                      style={{ color: BRAND.primary }}
                    />
                    {notifsLoading ? "Loading..." : "Refresh"}
                  </GhostBtn>
                </div>

                <div className="p-6">
                  {notifsMsg ? (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                      {notifsMsg}
                    </div>
                  ) : null}

                  {notifsLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="h-4 bg-slate-200 rounded w-1/3" />
                          <div className="mt-3 h-4 bg-slate-200 rounded w-2/3" />
                          <div className="mt-2 h-3 bg-slate-200 rounded w-1/4" />
                        </div>
                      ))}
                    </div>
                  ) : adminNotifs.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-slate-700 font-semibold">
                      No notifications yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {adminNotifs.map((n) => (
                        <div
                          key={n.id}
                          className={cn(
                            "rounded-2xl border p-4 transition",
                            n.is_read
                              ? "border-slate-200 bg-white"
                              : "border-amber-200 bg-amber-50"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-extrabold text-slate-900">
                                  {n.title}
                                </div>
                                {n.type ? <Badge>{n.type}</Badge> : null}
                                {!n.is_read ? <Badge>NEW</Badge> : null}
                              </div>

                              {n.description ? (
                                <div className="mt-1 text-sm text-slate-700 whitespace-pre-line">
                                  {n.description}
                                </div>
                              ) : null}

                              <div className="mt-2 text-xs font-semibold text-slate-500">
                                {new Date(n.created_at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ================= DASHBOARD VIEW ================= */
          <div className="space-y-6">
            {/* KPIs */}
            <div className="relative">
              <div
                className="absolute -inset-x-2 -top-3 h-24 rounded-2xl blur-2xl opacity-60 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(37,99,235,0.18) 0%, rgba(245,158,11,0.14) 50%, rgba(30,58,138,0.16) 100%)",
                }}
              />
              <div className="relative grid md:grid-cols-3 gap-4">
                <KpiCard
                  title="Total Clients"
                  value={totalClients}
                  subtitle="Registered client accounts"
                  icon={<Users size={20} />}
                  tone="primary"
                />
                <KpiCard
                  title="Total Advocates"
                  value={totalAdvocates}
                  subtitle="Registered advocate accounts"
                  icon={<ShieldCheck size={20} />}
                  tone="neutral"
                />
                <KpiCard
                  title="Platform Latency"
                  value={topLatency}
                  subtitle={`Error rate: ${topErr}`}
                  icon={<BarChart3 size={20} />}
                  tone="accent"
                />
              </div>
            </div>

            {/* Search bar */}
            {(tab === "clients" || tab === "advocates") && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
                <Search size={16} className="text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                  placeholder="Search by name, email, phone..."
                  className="bg-transparent outline-none w-full text-sm text-slate-800"
                />
              </div>

              <PrimaryBtn onClick={onSearch} disabled={loading} title="Search">
                Search
              </PrimaryBtn>
            </div>
            )}

            {/* Tabs */}
            {tab !== "overview" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-2 lg:hidden">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <SegTab
                  active={tab === "clients"}
                  icon={<Users size={18} />}
                  label="Clients"
                  onClick={() => setTab("clients")}
                />
                <SegTab
                  active={tab === "advocates"}
                  icon={<ShieldCheck size={18} />}
                  label="Advocates"
                  onClick={() => setTab("advocates")}
                />
                <SegTab
                  active={tab === "performance"}
                  icon={<BarChart3 size={18} />}
                  label="Performance"
                  onClick={() => setTab("performance")}
                />
                <SegTab
                  active={tab === "meetings"}
                  icon={<CalendarDays size={18} />}
                  label="Meetings"
                  onClick={() => setTab("meetings")}
                />
                <SegTab
                  active={tab === "assignments"}
                  icon={<Users size={18} />}
                  label="Assignments"
                  onClick={() => setTab("assignments")}
                />
                <SegTab
                  active={tab === "contracts"}
                  icon={<FileSignature size={18} />}
                  label="Contracts"
                  onClick={() => setTab("contracts")}
                />
                <SegTab
                  active={tab === "vouchers"}
                  icon={<Receipt size={18} />}
                  label="Vouchers"
                  onClick={() => setTab("vouchers")}
                />
              </div>
            </div>
            )}

            {tab === "overview" && (
              <div className="space-y-5">
                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <button
                    type="button"
                    onClick={() => setTab("assignments")}
                    className="text-left rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:bg-amber-100 transition"
                  >
                    <div className="text-xs font-bold text-amber-900 uppercase tracking-wide">Assignments Queue</div>
                    <div className="mt-2 text-3xl font-extrabold text-amber-950">{workflowCounts.assignments}</div>
                    <div className="mt-1 text-xs text-amber-800">Cases waiting for matching/approval</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab("meetings")}
                    className="text-left rounded-2xl border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100 transition"
                  >
                    <div className="text-xs font-bold text-blue-900 uppercase tracking-wide">Meeting Approvals</div>
                    <div className="mt-2 text-3xl font-extrabold text-blue-950">{workflowCounts.meetings}</div>
                    <div className="mt-1 text-xs text-blue-800">Pending admin decisions</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab("contracts")}
                    className="text-left rounded-2xl border border-emerald-200 bg-emerald-50 p-4 hover:bg-emerald-100 transition"
                  >
                    <div className="text-xs font-bold text-emerald-900 uppercase tracking-wide">Contract Approvals</div>
                    <div className="mt-2 text-3xl font-extrabold text-emerald-950">{workflowCounts.contracts}</div>
                    <div className="mt-1 text-xs text-emerald-800">Signed contracts awaiting review</div>
                  </button>

                  <button
                    type="button"
                    onClick={openNotifications}
                    className="text-left rounded-2xl border border-rose-200 bg-rose-50 p-4 hover:bg-rose-100 transition"
                  >
                    <div className="text-xs font-bold text-rose-900 uppercase tracking-wide">Unread Notifications</div>
                    <div className="mt-2 text-3xl font-extrabold text-rose-950">{workflowCounts.notifications}</div>
                    <div className="mt-1 text-xs text-rose-800">System alerts and workflow updates</div>
                  </button>
                </div>

                <div className="grid lg:grid-cols-3 gap-4">
                  <CardShell
                    title="Today’s Work"
                    right={
                      <GhostBtn onClick={() => loadWorkflowCounts().catch(() => {})}>
                        <RefreshCw size={16} /> Refresh
                      </GhostBtn>
                    }
                  >
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span>Approve lawyer assignments</span>
                        <span className="font-bold text-slate-900">{workflowCounts.assignments}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span>Approve meetings</span>
                        <span className="font-bold text-slate-900">{workflowCounts.meetings}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span>Approve signed contracts</span>
                        <span className="font-bold text-slate-900">{workflowCounts.contracts}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span>Unread alerts</span>
                        <span className="font-bold text-slate-900">{workflowCounts.notifications}</span>
                      </div>
                    </div>
                  </CardShell>

                  <CardShell title="Quick Actions">
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() => setTab("assignments")}
                        className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left px-3 py-2 text-sm font-semibold"
                      >
                        Open Assignment Queue
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("meetings")}
                        className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left px-3 py-2 text-sm font-semibold"
                      >
                        Open Meeting Requests
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("contracts")}
                        className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left px-3 py-2 text-sm font-semibold"
                      >
                        Open Contract Approvals
                      </button>
                      <button
                        type="button"
                        onClick={openNotifications}
                        className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left px-3 py-2 text-sm font-semibold"
                      >
                        Open Notifications
                      </button>
                    </div>
                  </CardShell>

                  <CardShell title="System Snapshot">
                    <div className="space-y-3 text-sm">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-500">Total Clients</div>
                        <div className="text-xl font-extrabold text-slate-900">{totalClients}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-500">Total Advocates</div>
                        <div className="text-xl font-extrabold text-slate-900">{totalAdvocates}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-500">Avg Latency</div>
                        <div className="text-xl font-extrabold text-slate-900">{topLatency}</div>
                      </div>
                    </div>
                  </CardShell>

                  <CardShell title="Recent Activity">
                    <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                      {recentActivity.length === 0 ? (
                        <div className="text-sm text-slate-600">No recent activity yet.</div>
                      ) : (
                        recentActivity.map((a) => {
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={a.onClick}
                              className="w-full text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-bold text-slate-900 truncate">{a.title}</div>
                                {priorityChip(a.priority)}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1">{a.meta}</div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </CardShell>
                </div>
              </div>
            )}

            {/* MEETINGS (render) */}
            {tab === "meetings" && (
              <AdminCaseDiscussion
                onActionComplete={() => loadWorkflowCounts().catch(() => {})}
              />
            )}

            {tab === "assignments" && <AssignmentQueuePanel />}

            {/* CLIENTS */}
            {tab === "clients" && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">
                      Registered Clients
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Showing{" "}
                      <span className="font-semibold text-slate-900">
                        {filteredClients.length}
                      </span>{" "}
                      client(s)
                    </div>
                  </div>

                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                    style={{
                      background: "#FFFBEB",
                      borderColor: "#FCD34D",
                      color: BRAND.primary,
                    }}
                  >
                    Enterprise
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold">ID</th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Client
                        </th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Contact
                        </th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Created
                        </th>
                        <th className="text-right px-4 py-3 font-semibold">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <SkeletonRow key={i} cols={5} />
                        ))
                      ) : filteredClients.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-slate-700">
                            No clients found.
                          </td>
                        </tr>
                      ) : (
                        filteredClients.map((c) => (
                            <tr key={c.id} className={cn("hover:bg-slate-50 transition", rowTone(c.id))}>
                            <td className="px-4 py-4 font-bold text-slate-900">
                              {c.id}
                            </td>

                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold text-slate-900">
                                  {c.name || "—"}
                                </div>
                                <Badge>{c.role}</Badge>
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {c.email}
                              </div>
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {c.phone || "—"}
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {new Date(c.created_at).toLocaleString()}
                            </td>

                            <td className="px-4 py-4">
                              <div className="flex justify-end gap-2 flex-wrap">
                                <GhostBtn
                                  onClick={() =>
                                    navigate(`/admin/clients/${c.id}`)
                                  }
                                  title="View"
                                >
                                  <Eye
                                    size={16}
                                    style={{ color: BRAND.primary }}
                                  />
                                  View
                                </GhostBtn>

                                <GhostBtn
                                  onClick={() => openEditClient(c)}
                                  title="Edit"
                                >
                                  <Pencil
                                    size={16}
                                    style={{ color: BRAND.primary }}
                                  />
                                  Edit
                                </GhostBtn>

                                <button
                                  type="button"
                                  onClick={() => deleteClient(c.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ADVOCATES */}
            {tab === "advocates" && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">
                      Registered Advocates
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Showing{" "}
                      <span className="font-semibold text-slate-900">
                        {filteredAdvocates.length}
                      </span>{" "}
                      advocate(s)
                    </div>
                  </div>

                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                    style={{
                      background: "#FFFBEB",
                      borderColor: "#FCD34D",
                      color: BRAND.primary,
                    }}
                  >
                    Enterprise
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold">ID</th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Advocate
                        </th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Contact
                        </th>
                        <th className="text-left px-4 py-3 font-semibold">
                          Created
                        </th>
                        <th className="text-right px-4 py-3 font-semibold">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <SkeletonRow key={i} cols={5} />
                        ))
                      ) : filteredAdvocates.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-slate-700">
                            No advocates found.
                          </td>
                        </tr>
                      ) : (
                        filteredAdvocates.map((a) => (
                            <tr key={a.id} className={cn("hover:bg-slate-50 transition", rowTone(a.id))}>
                            <td className="px-4 py-4 font-bold text-slate-900">
                              {a.id}
                            </td>

                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold text-slate-900">
                                  {a.name || "—"}
                                </div>
                                <Badge>{a.role}</Badge>
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {a.email}
                              </div>
                              {a.city || a.court ? (
                                <div className="text-xs text-slate-500 mt-1">
                                  {a.city || "—"}{" "}
                                  {a.court ? `• ${a.court}` : ""}
                                </div>
                              ) : null}
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {a.phone || "—"}
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {new Date(a.created_at).toLocaleString()}
                            </td>

                            <td className="px-4 py-4">
                              <div className="flex justify-end gap-2 flex-wrap">
                                <GhostBtn
                                  onClick={() =>
                                    navigate(`/admin/advocates/${a.id}`)
                                  }
                                  title="View"
                                >
                                  <Eye
                                    size={16}
                                    style={{ color: BRAND.primary }}
                                  />
                                  View
                                </GhostBtn>

                                <GhostBtn
                                  onClick={() => openEditAdvocate(a)}
                                  title="Edit"
                                >
                                  <Pencil
                                    size={16}
                                    style={{ color: BRAND.primary }}
                                  />
                                  Edit
                                </GhostBtn>

                                <button
                                  type="button"
                                  onClick={() => deleteAdvocate(a.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PERFORMANCE */}
            {tab === "performance" && (
              <div className="space-y-4">
                <CardShell
                  title="Performance"
                  right={
                    <GhostBtn
                      onClick={() => refreshPerformance()}
                      disabled={perfLoading}
                    >
                      <RefreshCw
                        size={16}
                        className={perfLoading ? "animate-spin" : ""}
                        style={{ color: BRAND.primary }}
                      />
                      {perfLoading ? "Loading..." : "Refresh"}
                    </GhostBtn>
                  }
                >
                  {perfMsg ? (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                      {perfMsg}
                    </div>
                  ) : null}

                  <div className="grid md:grid-cols-4 gap-3">
                    <KpiCard
                      title="Requests"
                      value={perfOverview?.total_requests ?? "—"}
                      subtitle="Last 24h"
                      icon={<BarChart3 size={20} />}
                      tone="primary"
                    />
                    <KpiCard
                      title="Avg Latency"
                      value={
                        perfOverview ? msOrDash(perfOverview.avg_latency_ms) : "—"
                      }
                      subtitle="Average response time"
                      icon={<BarChart3 size={20} />}
                      tone="neutral"
                    />
                    <KpiCard
                      title="Unique Users"
                      value={
                        perfOverview?.unique_users ?? "—"
                      }
                      subtitle="Observed in logs"
                      icon={<BarChart3 size={20} />}
                      tone="neutral"
                    />
                    <KpiCard
                      title="5xx Error Rate"
                      value={pct(perfOverview?.error_rate_5xx)}
                      subtitle="Server-side failures"
                      icon={<ShieldCheck size={20} />}
                      tone="accent"
                    />
                  </div>
                </CardShell>

                <div className="grid md:grid-cols-2 gap-4">
                  <CardShell title="System Snapshot">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">Uptime</div>
                        <div className="font-semibold text-slate-900">{perfSystem ? `${Math.floor((perfSystem.uptimeSec || 0) / 60)} min` : "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">Node</div>
                        <div className="font-semibold text-slate-900">{perfSystem?.nodeVersion || "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">RSS Memory</div>
                        <div className="font-semibold text-slate-900">{perfSystem ? `${perfSystem.memory.rssMb} MB` : "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">Heap Used</div>
                        <div className="font-semibold text-slate-900">{perfSystem ? `${perfSystem.memory.heapUsedMb} MB` : "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">Load Avg (1m)</div>
                        <div className="font-semibold text-slate-900">{perfSystem?.loadAvg?.[0]?.toFixed?.(2) || "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-slate-500">Host Free RAM</div>
                        <div className="font-semibold text-slate-900">{perfSystem ? `${perfSystem.hostMemory.freeMb} MB` : "—"}</div>
                      </div>
                    </div>
                  </CardShell>

                  <CardShell title="HTTP Status Health">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {(["2xx", "3xx", "4xx", "5xx"] as const).map((k) => {
                        const row = perfStatusClasses.find((x) => String(x.status_class) === k);
                        return (
                          <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">{k}</div>
                            <div className="font-semibold text-slate-900">{row?.count ?? 0}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">Top status codes</div>
                    <div className="flex flex-wrap gap-2">
                      {perfTopCodes.length === 0 ? (
                        <span className="text-sm text-slate-600">No status data</span>
                      ) : (
                        perfTopCodes.map((c) => (
                          <span key={String(c.status)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700">
                            {c.status}: {c.count}
                          </span>
                        ))
                      )}
                    </div>
                  </CardShell>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900">Endpoint Inventory</div>
                      <div className="text-xs text-slate-500 mt-1">Traffic + latency + 5xx rate by endpoint.</div>
                    </div>
                    <input
                      value={endpointSearch}
                      onChange={(e) => setEndpointSearch(e.target.value)}
                      placeholder="Search endpoint..."
                      className="w-64 max-w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="text-left px-4 py-3 font-semibold">Method</th>
                          <th className="text-left px-4 py-3 font-semibold">Route</th>
                          <th className="text-left px-4 py-3 font-semibold">Requests</th>
                          <th className="text-left px-4 py-3 font-semibold">Avg (ms)</th>
                          <th className="text-left px-4 py-3 font-semibold">P95 (ms)</th>
                          <th className="text-left px-4 py-3 font-semibold">5xx %</th>
                          <th className="text-left px-4 py-3 font-semibold">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {perfLoading ? (
                          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
                        ) : filteredPerfEndpoints.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-10 text-slate-700">No endpoints found.</td>
                          </tr>
                        ) : (
                          filteredPerfEndpoints.map((r, i) => (
                            <tr key={`${r.method}-${r.route}-${i}`} className="hover:bg-slate-50 transition">
                              <td className="px-4 py-3 font-bold text-slate-900">{r.method}</td>
                              <td className="px-4 py-3 text-slate-900">{r.route}</td>
                              <td className="px-4 py-3 text-slate-700">{r.total_requests}</td>
                              <td className="px-4 py-3 text-slate-700">{r.avg_latency_ms}</td>
                              <td className="px-4 py-3 text-slate-700">{r.p95_latency_ms}</td>
                              <td className="px-4 py-3 text-slate-700">{pct(r.error_rate_5xx)}</td>
                              <td className="px-4 py-3 text-slate-700">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">Top Traffic Endpoints</div>
                      <div className="text-xs text-slate-500 mt-1">Highest request volume with latency context.</div>
                    </div>
                    <Badge>Backend</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="text-left px-4 py-3 font-semibold">Method</th>
                          <th className="text-left px-4 py-3 font-semibold">Endpoint</th>
                          <th className="text-left px-4 py-3 font-semibold">Requests</th>
                          <th className="text-left px-4 py-3 font-semibold">Avg (ms)</th>
                          <th className="text-left px-4 py-3 font-semibold">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {perfLoading ? (
                          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                        ) : perfTraffic.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-10 text-slate-700">No traffic data found.</td>
                          </tr>
                        ) : (
                          perfTraffic.map((r, i) => (
                            <tr key={`${r.method}-${r.route}-${i}`} className="hover:bg-slate-50 transition">
                              <td className="px-4 py-3 font-bold text-slate-900">{r.method}</td>
                              <td className="px-4 py-3 text-slate-900">{r.route}</td>
                              <td className="px-4 py-3 text-slate-700">{r.requests}</td>
                              <td className="px-4 py-3 text-slate-700">{r.avg_latency_ms}</td>
                              <td className="px-4 py-3 text-slate-700">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Slow endpoints */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">
                        Slow Endpoints
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Top endpoints by latency (avg + p95).
                      </div>
                    </div>
                    <Badge>Backend</Badge>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="text-left px-4 py-3 font-semibold">
                            Method
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Endpoint
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Count
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Avg (ms)
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            P95 (ms)
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {perfLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <SkeletonRow key={i} cols={5} />
                          ))
                        ) : perfSlow.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-10 text-slate-700"
                            >
                              No slow endpoints found.
                            </td>
                          </tr>
                        ) : (
                          perfSlow.map((r, i) => (
                            <tr
                              key={i}
                              className="hover:bg-slate-50 transition"
                            >
                              <td className="px-4 py-3 font-bold text-slate-900">
                                {r.method}
                              </td>
                              <td className="px-4 py-3 text-slate-900">
                                {r.endpoint}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {r.count}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {Number.isFinite(r.avg_ms)
                                  ? Math.round(r.avg_ms)
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {Number.isFinite(r.p95_ms)
                                  ? Math.round(r.p95_ms)
                                  : "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Errors */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">Top Errors</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Grouped by endpoint + status code.
                      </div>
                    </div>
                    <Badge>Backend</Badge>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="text-left px-4 py-3 font-semibold">
                            Method
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Endpoint
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Status
                          </th>
                          <th className="text-left px-4 py-3 font-semibold">
                            Count
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {perfLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <SkeletonRow key={i} cols={4} />
                          ))
                        ) : perfErrors.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-10 text-slate-700"
                            >
                              No errors found.
                            </td>
                          </tr>
                        ) : (
                          perfErrors.map((r, i) => (
                            <tr
                              key={i}
                              className="hover:bg-slate-50 transition"
                            >
                              <td className="px-4 py-3 font-bold text-slate-900">
                                {r.method}
                              </td>
                              <td className="px-4 py-3 text-slate-900">
                                {r.endpoint}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {r.status_code}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {r.count}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === "vouchers" && (
              <div className="space-y-4">
                <CardShell
                  title="Create Voucher"
                  right={
                    <GhostBtn
                      onClick={() => {
                        setVoucherAction("refresh");
                        setVoucherBusy(true);
                        Promise.all([loadVoucherCaseOptions(), loadAllBilling(), loadPendingPaymentProofs()])
                          .catch((e: any) => setMsg(e?.message || "Failed to refresh vouchers"))
                          .finally(() => {
                            setVoucherBusy(false);
                            setVoucherAction(null);
                          });
                      }}
                      disabled={voucherBusy}
                    >
                      <RefreshCw size={16} className={voucherBusy && voucherAction === "refresh" ? "animate-spin" : ""} />
                      {voucherBusy && voucherAction === "refresh" ? "Refreshing..." : "Refresh"}
                    </GhostBtn>
                  }
                >
                  <div className="grid md:grid-cols-12 gap-3">
                    <select
                      value={voucherCaseId}
                      onChange={(e) => setVoucherCaseId(e.target.value)}
                      className="md:col-span-4 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    >
                      {voucherCaseOptions.map((c) => (
                        <option key={c.case_id} value={String(c.case_id)}>
                          Case #{c.case_id} - {c.case_title || c.client_name || "Case"}
                        </option>
                      ))}
                    </select>
                    <input
                      value={voucherTitle}
                      onChange={(e) => setVoucherTitle(e.target.value)}
                      placeholder="Title"
                      className="md:col-span-3 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      ref={voucherAmountInputRef}
                      inputMode="decimal"
                      placeholder="Amount"
                      className="md:col-span-2 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      type="date"
                      value={voucherDueDate}
                      onChange={(e) => setVoucherDueDate(e.target.value)}
                      className="md:col-span-2 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      value={voucherSequenceNo}
                      onChange={(e) => setVoucherSequenceNo(e.target.value)}
                      placeholder="Sequence"
                      className="md:col-span-1 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  {selectedVoucherCase ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">Selected Case Context</div>
                      <div className="mt-1">
                        Case #{selectedVoucherCase.case_id} • Client #{selectedVoucherCase.client_user_id} ({selectedVoucherCase.client_name || "—"})
                      </div>
                      <div className="mt-1">
                        Status: {formatStatus(selectedVoucherCase.status)} • Paid: Rs. {Number(selectedVoucherCase.payment_verified_total || 0).toLocaleString()} / Rs. {Number(selectedVoucherCase.payment_required_total || 0).toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={voucherInstallment} onChange={(e) => setVoucherInstallment(e.target.checked)} />
                      Installment voucher
                    </label>
                    <PrimaryBtn
                      onClick={createVoucher}
                      disabled={
                        voucherBusy ||
                        (voucherCaseOptions.length === 0 && !voucherCaseId)
                      }
                    >
                      {voucherBusy && voucherAction === "create"
                        ? "Creating..."
                        : voucherCaseOptions.length === 0 && !voucherCaseId
                        ? "Loading cases..."
                        : "Create Voucher"}
                    </PrimaryBtn>
                    <GhostBtn onClick={manualMarkCasePaid} disabled={voucherBusy || !voucherCaseId}>
                      {voucherBusy && voucherAction === "override" ? "Updating..." : "Manual Mark Case Paid"}
                    </GhostBtn>
                  </div>
                </CardShell>

                <div className="grid lg:grid-cols-2 gap-4">
                  <CardShell title="All Vouchers">
                    <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
                      {billingRows.length === 0 ? (
                        <div className="text-sm text-slate-600">No vouchers yet.</div>
                      ) : (
                        billingRows.map((b) => (
                          <div key={b.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-bold text-slate-900">#{b.id} {b.title}</div>
                              <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50">{formatStatus(b.status)}</span>
                            </div>
                            <div className="text-xs text-slate-600 mt-1">
                              Client #{b.user_id} • Case #{b.case_id || "—"} • Rs. {Number(b.amount || 0).toLocaleString()}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              {(() => {
                                const vs = String(b.status || "").toUpperCase();
                                const isPaid = vs === "VERIFIED" || vs === "PAID_VERIFIED" || vs === "FULLY_PAID";
                                const isSent = vs === "SENT" || vs === "PROOF_UPLOADED" || vs === "PAYMENT_PROOF_UPLOADED" || vs === "PAYMENT_REJECTED" || vs === "ISSUED_PENDING_PAYMENT";
                                if (isPaid) {
                                  // fully paid — view only
                                  return b.voucher_pdf_url ? (
                                    <a
                                      href={b.voucher_pdf_url.startsWith("http") ? b.voucher_pdf_url : `${API_BASE_URL}${b.voucher_pdf_url}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#004aad]"
                                    >
                                      View
                                    </a>
                                  ) : null;
                                }
                                return (
                                  <>
                                    <GhostBtn onClick={() => sendVoucher(b.id)} disabled={voucherBusy} className="px-3 py-1.5">
                                      {voucherBusy && voucherAction === "send" ? "Sending..." : isSent ? "Resend" : "Issue/Send"}
                                    </GhostBtn>
                                    {b.voucher_pdf_url ? (
                                      <a
                                        href={b.voucher_pdf_url.startsWith("http") ? b.voucher_pdf_url : `${API_BASE_URL}${b.voucher_pdf_url}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-semibold text-[#004aad]"
                                      >
                                        Open PDF
                                      </a>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardShell>

                  <CardShell title="Pending Payment Proofs">
                    <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
                      {pendingProofs.length === 0 ? (
                        <div className="text-sm text-slate-600">No pending proofs.</div>
                      ) : (
                        pendingProofs.map((p) => (
                          <div key={p.proof_id} className="rounded-xl border border-slate-200 p-3">
                            <div className="text-sm font-bold text-slate-900">Proof #{p.proof_id} • Voucher #{p.billing_id}</div>
                            <div className="text-xs text-slate-600 mt-1">Client #{p.client_user_id} • Case #{p.case_id || "—"} • Rs. {Number(p.amount || 0).toLocaleString()}</div>
                            <div className="text-xs text-slate-500 mt-1">Uploaded: {new Date(p.uploaded_at).toLocaleString()}</div>
                            {p.note ? <div className="text-xs text-slate-700 mt-1">Note: {p.note}</div> : null}
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <a
                                href={`${API_BASE_URL}${p.proof_file_url}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold text-[#004aad]"
                              >
                                Open Proof
                              </a>
                              {p.voucher_pdf_url ? (
                                <a
                                  href={p.voucher_pdf_url.startsWith("http") ? p.voucher_pdf_url : `${API_BASE_URL}${p.voucher_pdf_url}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-semibold text-slate-700"
                                >
                                  Open Voucher
                                </a>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => verifyPaymentProof(p.proof_id)}
                                disabled={voucherBusy}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60"
                              >
                                {voucherBusy && voucherAction === "verify" ? "Verifying..." : "Verify"}
                              </button>
                              <button
                                type="button"
                                onClick={() => rejectPaymentProof(p.proof_id, p.case_id)}
                                disabled={voucherBusy}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-60"
                              >
                                {voucherBusy && voucherAction === "reject" ? "Rejecting..." : "Reject"}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardShell>
                </div>
              </div>
            )}

            {tab === "contracts" && (
              <div className="grid lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="font-bold text-slate-900">Pending Contract Approvals</div>
                    <GhostBtn
                      onClick={() => {
                        setContractAction("refresh");
                        setContractBusy(true);
                        loadPendingContracts()
                          .catch((e: any) => setMsg(e?.message || "Failed to refresh contracts"))
                          .finally(() => {
                            setContractBusy(false);
                            setContractAction(null);
                          });
                      }}
                      disabled={contractBusy}
                    >
                      <RefreshCw size={16} className={contractBusy && contractAction === "refresh" ? "animate-spin" : ""} />
                      {contractBusy && contractAction === "refresh" ? "Refreshing..." : "Refresh"}
                    </GhostBtn>
                  </div>

                  <div className="space-y-2">
                    {pendingContracts.length === 0 ? (
                      <div className="text-sm text-slate-600">No contracts waiting for admin approval.</div>
                    ) : (
                      pendingContracts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedContractCaseId(c.case_id);
                            loadContractDetails(c.case_id).catch(() => setContractDetails(null));
                          }}
                          className={cn(
                            "w-full text-left rounded-xl border p-3 transition",
                            selectedContractCaseId === c.case_id
                              ? "border-[#1E3A8A] bg-[#EEF2FF]"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-slate-500">Case #{c.case_id}</div>
                            {priorityChip(contractPriority(c.status, c.updated_at))}
                          </div>
                          <div className="text-sm font-bold text-slate-900 mt-1">{c.case_title || c.title || "Contract"}</div>
                          <div className="text-xs text-slate-600 mt-1">
                            Client: {c.client_name || "—"} • Advocate: {c.advocate_name || "—"}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">Updated {new Date(c.updated_at).toLocaleString()}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  {!contractDetails ? (
                    <div className="text-sm text-slate-600">Select a contract from the left list to review.</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-lg font-bold text-slate-900">{contractDetails.title || `Contract #${contractDetails.id}`}</div>
                          <div className="text-xs text-slate-500 mt-1">Status: {formatStatus(contractDetails.status)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => approveContract(contractDetails.caseId)}
                            disabled={contractBusy}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-60"
                          >
                            <Check size={16} /> {contractBusy && contractAction === "approve" ? "Approving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectContract(contractDetails.caseId)}
                            disabled={contractBusy}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white font-semibold disabled:opacity-60"
                          >
                            <Ban size={16} /> {contractBusy && contractAction === "reject" ? "Rejecting..." : "Reject"}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap min-h-[240px] max-h-[520px] overflow-auto">
                        {contractDetails.contractText}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-bold text-slate-900">Attachments (Reference)</div>
                        <div className="text-xs text-slate-500 mt-1">Canonical contract text above is the signed source of truth.</div>
                        <div className="mt-3 space-y-2">
                          {(contractDetails.attachments || []).length === 0 ? (
                            <div className="text-sm text-slate-600">No attachments uploaded.</div>
                          ) : (
                            (contractDetails.attachments || []).map((a) => (
                              <a
                                key={a.id}
                                href={`${API_BASE_URL}/uploads/contracts/${a.file_path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"
                              >
                                <div className="text-sm font-semibold text-slate-900 truncate">{a.file_name}</div>
                                <div className="text-xs text-slate-500 mt-1">{a.mime_type}</div>
                              </a>
                            ))
                          )}
                        </div>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-700">Artifact Evidence</div>
                          {contractDetails.artifact ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-600 break-all">
                              <div>Hash: {contractDetails.artifact.canonical_text_sha256}</div>
                              <div>Generated: {new Date(contractDetails.artifact.generated_at).toLocaleString()}</div>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-rose-700">No artifact found for this version.</div>
                          )}
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3 text-xs">
                        <div className="rounded-xl border border-slate-200 p-3 bg-white">
                          <div className="font-semibold text-slate-700">Client Signature</div>
                          <div className="mt-1 text-slate-600">
                            {contractDetails.signatures?.clientSignature
                              ? `${contractDetails.signatures.clientSignature.typed_full_name} • ${new Date(
                                  contractDetails.signatures.clientSignature.signed_at
                                ).toLocaleString()}`
                              : "Pending"}
                          </div>
                          {contractDetails.signatures?.clientSignature ? (
                            <div className="mt-2 text-[11px] text-slate-600">
                              Confirmations: {contractDetails.signatures.clientSignature.confirmed_read_understood ? "Read" : "No Read"}, {contractDetails.signatures.clientSignature.confirmed_voluntary ? "Voluntary" : "No Voluntary"}, {contractDetails.signatures.clientSignature.confirmed_typed_signature ? "Typed Sig" : "No Typed Sig"}, {contractDetails.signatures.clientSignature.confirmed_reviewed_attachments ? "Reviewed Attachments" : "No Attachment Review"}
                              <div className="mt-1 break-all">v{contractDetails.signatures.clientSignature.contract_version_no || "?"} • {contractDetails.signatures.clientSignature.canonical_text_sha256_at_sign || "No hash"}</div>
                            </div>
                          ) : null}
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3 bg-white">
                          <div className="font-semibold text-slate-700">Advocate Signature</div>
                          <div className="mt-1 text-slate-600">
                            {contractDetails.signatures?.advocateSignature
                              ? `${contractDetails.signatures.advocateSignature.typed_full_name} • ${new Date(
                                  contractDetails.signatures.advocateSignature.signed_at
                                ).toLocaleString()}`
                              : "Pending"}
                          </div>
                          {contractDetails.signatures?.advocateSignature ? (
                            <div className="mt-2 text-[11px] text-slate-600">
                              Confirmations: {contractDetails.signatures.advocateSignature.confirmed_read_understood ? "Read" : "No Read"}, {contractDetails.signatures.advocateSignature.confirmed_voluntary ? "Voluntary" : "No Voluntary"}, {contractDetails.signatures.advocateSignature.confirmed_typed_signature ? "Typed Sig" : "No Typed Sig"}, {contractDetails.signatures.advocateSignature.confirmed_reviewed_attachments ? "Reviewed Attachments" : "No Attachment Review"}
                              <div className="mt-1 break-all">v{contractDetails.signatures.advocateSignature.contract_version_no || "?"} • {contractDetails.signatures.advocateSignature.canonical_text_sha256_at_sign || "No hash"}</div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* EDIT CLIENT MODAL */}
      {editClient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div
              className="px-6 py-4 border-b border-slate-200"
              style={{
                background: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primary2} 100%)`,
              }}
            >
              <div className="text-white font-bold">
                Edit Client #{editClient.id}
              </div>
              <div className="text-xs text-white/80 mt-1">
                Update client account details.
              </div>
            </div>

            <div className="p-6 grid gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Name
                </label>
                <input
                  value={editClientForm.name}
                  onChange={(e) =>
                    setEditClientForm({
                      ...editClientForm,
                      name: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Email
                </label>
                <input
                  value={editClientForm.email}
                  onChange={(e) =>
                    setEditClientForm({
                      ...editClientForm,
                      email: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Phone
                </label>
                <input
                  value={editClientForm.phone}
                  onChange={(e) =>
                    setEditClientForm({
                      ...editClientForm,
                      phone: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <GhostBtn onClick={() => setEditClient(null)}>Cancel</GhostBtn>
                <PrimaryBtn onClick={saveClientEdit} disabled={loading}>
                  {loading ? "Saving..." : "Save"}
                </PrimaryBtn>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialogs}

      {/* EDIT ADVOCATE MODAL */}
      {editAdvocate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div
              className="px-6 py-4 border-b border-slate-200"
              style={{
                background: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primary2} 100%)`,
              }}
            >
              <div className="text-white font-bold">
                Edit Advocate #{editAdvocate.id}
              </div>
              <div className="text-xs text-white/80 mt-1">
                Update advocate details.
              </div>
            </div>

            <div className="p-6 grid gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Name
                </label>
                <input
                  value={editAdvocateForm.name}
                  onChange={(e) =>
                    setEditAdvocateForm({
                      ...editAdvocateForm,
                      name: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Email
                </label>
                <input
                  value={editAdvocateForm.email}
                  onChange={(e) =>
                    setEditAdvocateForm({
                      ...editAdvocateForm,
                      email: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Phone
                </label>
                <input
                  value={editAdvocateForm.phone}
                  onChange={(e) =>
                    setEditAdvocateForm({
                      ...editAdvocateForm,
                      phone: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">
                    City
                  </label>
                  <input
                    value={editAdvocateForm.city}
                    onChange={(e) =>
                      setEditAdvocateForm({
                        ...editAdvocateForm,
                        city: e.target.value,
                      })
                    }
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">
                    Court
                  </label>
                  <input
                    value={editAdvocateForm.court}
                    onChange={(e) =>
                      setEditAdvocateForm({
                        ...editAdvocateForm,
                        court: e.target.value,
                      })
                    }
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Bar Council ID
                </label>
                <input
                  value={editAdvocateForm.bar_council_id}
                  onChange={(e) =>
                    setEditAdvocateForm({
                      ...editAdvocateForm,
                      bar_council_id: e.target.value,
                    })
                  }
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <GhostBtn onClick={() => setEditAdvocate(null)}>Cancel</GhostBtn>
                <PrimaryBtn onClick={saveAdvocateEdit} disabled={loading}>
                  {loading ? "Saving..." : "Save"}
                </PrimaryBtn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
