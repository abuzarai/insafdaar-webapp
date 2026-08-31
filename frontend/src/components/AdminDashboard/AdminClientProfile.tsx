import { formatStatus } from "../common/formatStatus";
import { isErrorMessage } from "../common/messageTone";
import React, { useEffect, useMemo, useState } from "react";
import AuthedLink from "../common/AuthedLink";
import AuthedAudio from "../common/AuthedAudio";
import {
  ArrowLeft,
  RefreshCw,
  Save,
  Plus,
  Send,
  Bell,
  Briefcase,
  MessageSquare,
  User2,
  CreditCard,
  ShieldCheck,
  Search,
  Filter,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Mic,
  UserCheck,
  Sparkles,
} from "lucide-react";
import { API_BASE_URL } from "../../config";
import { useNavigate, useParams } from "react-router-dom";
import { useActionDialogs } from "../common/ActionDialog";

/* ================= helpers ================= */

function authHeaders(): Headers {
  const headers = new Headers();
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Backend did not return JSON (status ${res.status}). Check API route: ${res.url}`);
  }
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoneyPKR(n: any) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  try {
    return new Intl.NumberFormat("en-PK").format(num);
  } catch {
    return String(num);
  }
}

function badgeTone(kind: "good" | "warn" | "bad" | "neutral") {
  if (kind === "good") return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (kind === "warn") return "bg-amber-50 border-amber-200 text-amber-900";
  if (kind === "bad") return "bg-rose-50 border-rose-200 text-rose-800";
  return "bg-slate-50 border-slate-200 text-slate-700";
}

function voucherTone(s: "NOT_GENERATED" | "GENERATED" | "VERIFIED" | "REJECTED") {
  if (s === "VERIFIED") return badgeTone("good");
  if (s === "REJECTED") return badgeTone("bad");
  if (s === "GENERATED") return badgeTone("warn");
  return badgeTone("neutral");
}

function billingTone(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "VERIFIED") return badgeTone("good");
  if (s === "REJECTED") return badgeTone("bad");
  if (s === "UPLOADED" || s === "PENDING") return badgeTone("warn");
  if (s === "SENT") return badgeTone("neutral");
  return badgeTone("neutral");
}

/* ================= types ================= */

type ClientFull = {
  user_id: number;
  email: string;
  role: string;
  created_at: string;

  name: string | null;
  phone: string | null;
  cnic: string | null;
  city: string | null;
  address: string | null;
  location: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  avatar_url: string | null;
  identity_doc_status: string | null;
  address_proof_status: string | null;
};

type BillingItem = {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  status: "PENDING" | "SENT" | "UPLOADED" | "VERIFIED" | "REJECTED" | string;
  created_at: string;
  due_date: string | null;
  voucher_pdf_url: string | null;
};

type PendingProof = {
  proof_id: number;
  proof_file_url: string;
  note: string | null;
  uploaded_at: string;
  billing_id: number;
  title: string;
  amount: number;
  voucher_pdf_url: string | null;
  client_email: string;
};

type ClientNotification = {
  id: number;
  user_id: number;
  title: string;
  message: string | null;
  type: string | null;
  priority: string | null;
  is_read: boolean | null;
  created_at: string;
};

type AdminCase = {
  id: string; // "CASE-123"
  title: string;
  status: string;
  client: { name: string; city: string; phone: string };
  advocate: { assigned: boolean; name?: string; phone?: string };
  court: { name: string; filedOn: string };
  nextHearing: any;
  nextMeeting: any;
  payments: {
    voucherStatus: "NOT_GENERATED" | "GENERATED" | "VERIFIED" | "REJECTED";
    voucherId: string | null;
    amount: number | null;
    dueDate: string | null;
  };
  alertsCount: number;
};

type AdminFeedback = {
  id: number;
  audience: string;
  category: string | null;
  sentiment: string;
  message: string | null;
  case_id: number | null;
  advocate_id: number | null;
  contact_pref: string | null;
  contact_value: string | null;
  created_at: string;

  website_ux: number | null;
  website_speed: number | null;
  admin_helpfulness: number | null;
  admin_response: number | null;
  advocate_knowledge: number | null;
  advocate_responsiveness: number | null;
  advocate_availability: number | null;
  advocate_case_handling: number | null;
};

type FormState = {
  email: string;
  name: string;
  phone: string;
  cnic: string;
  city: string;
  address: string;
  location: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  identity_doc_status: string;
  address_proof_status: string;
  avatar_url: string;
};

type SectionKey = "profile" | "start_case" | "notifications" | "cases" | "feedback" | "billing" | "proofs";

/** ✅ advocate list type */
type AdvocateOption = {
  id: number;
  name: string | null;
  email: string;
};

/** ✅ Start-case document + voice types (match your backend response fields) */
type StartCaseDocument = {
  id: number;
  doc_type: string;
  file_url: string;
  status: string;
  created_at: string;
};

type StartCaseVoiceNote = {
  id: number;
  language: string | null;
  audio_url: string;
  notes: string | null;
  created_at: string;
};

type MatchRun = {
  id: number;
  case_id: number;
  shortlist_size: number;
  input_snapshot?: Record<string, unknown> | null;
  created_at: string;
};

type MatchCandidate = {
  id: number;
  rank_position: number;
  total_score: number;
  score_breakdown: {
    domainFit?: number;
    languageFit?: number;
    cityFit?: number;
    experienceBonus?: number;
    availabilityBonus?: number;
    workloadPenalty?: number;
  };
  reasons: string[];
  advocate_id: number;
  advocate_name: string | null;
  advocate_email: string;
  city?: string | null;
  languages?: string[] | null;
  practice_areas?: string[] | null;
  experience_years?: number | null;
};

type StartCaseMeta = {
  case_id: number;
  case_title_short?: string | null;
  case_display_label?: string | null;
};

/* ================= component ================= */

export default function AdminClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  // brand tokens (navy + yellow accent)
  const BRAND = {
    navy: "#0B2A5B",
    navy2: "#103A7A",
    yellow: "#F2C94C",
  };

  const [active, setActive] = useState<SectionKey>("profile");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [client, setClient] = useState<ClientFull | null>(null);

  // billing + proofs
  const [billing, setBilling] = useState<BillingItem[]>([]);
  const [pendingProofs, setPendingProofs] = useState<PendingProof[]>([]);
  const [showCreateVoucher, setShowCreateVoucher] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const { prompt, dialogs } = useActionDialogs();

  // notifications
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [notifMsg, setNotifMsg] = useState("");

  // cases
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [casesTotal, setCasesTotal] = useState(0);
  const [casesMsg, setCasesMsg] = useState("");
  const [casesQ, setCasesQ] = useState("");
  const [casesStatus, setCasesStatus] = useState<"All" | string>("All");
  const [casesLimit, setCasesLimit] = useState(20);
  const [casesOffset, setCasesOffset] = useState(0);

  // feedback
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackQ, setFeedbackQ] = useState("");
  const [feedbackAudience, setFeedbackAudience] = useState<"All" | string>("All");
  const [feedbackSentiment, setFeedbackSentiment] = useState<"All" | string>("All");
  const [feedbackLimit, setFeedbackLimit] = useState(20);
  const [feedbackOffset, setFeedbackOffset] = useState(0);

  /** ✅ Start Case (admin review) */
  const [activeStartCaseId, setActiveStartCaseId] = useState<number | null>(null);
  const [activeStartCaseStatus, setActiveStartCaseStatus] = useState<string | null>(null);
  const [activeStartCaseLabel, setActiveStartCaseLabel] = useState<string | null>(null);
  const [startCaseDocuments, setStartCaseDocuments] = useState<StartCaseDocument[]>([]);
  const [startCaseVoiceNotes, setStartCaseVoiceNotes] = useState<StartCaseVoiceNote[]>([]);
  const [startCaseMsg, setStartCaseMsg] = useState("");
  const [matchingRun, setMatchingRun] = useState<MatchRun | null>(null);
  const [matchingCandidates, setMatchingCandidates] = useState<MatchCandidate[]>([]);
  const [matchingCaseMeta, setMatchingCaseMeta] = useState<StartCaseMeta | null>(null);
  const [matchingLoading, setMatchingLoading] = useState(false);

  /** ✅ assign advocate (moved to Start Case section) */
  const [advocates, setAdvocates] = useState<AdvocateOption[]>([]);
  const [selectedAdvocateId, setSelectedAdvocateId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");

  const [voucherForm, setVoucherForm] = useState({
    title: "Total Fee Voucher",
    description: "",
    amount: "",
    due_date: "",
    bank_name: "",
    bank_account_title: "",
    bank_account_number: "",
    bank_branch: "",
    case_id: "",
    advocate_id: "",
  });

  const [form, setForm] = useState<FormState>({
    email: "",
    name: "",
    phone: "",
    cnic: "",
    city: "",
    address: "",
    location: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    identity_doc_status: "",
    address_proof_status: "",
    avatar_url: "",
  });

  const fields = useMemo(
    () =>
      [
        ["Name", "name"],
        ["Email", "email"],
        ["Phone", "phone"],
        ["CNIC", "cnic"],
        ["City", "city"],
        ["Address", "address"],
        ["Location", "location"],
        ["Emergency Name", "emergency_contact_name"],
        ["Emergency Phone", "emergency_contact_phone"],
        ["Identity Doc Status", "identity_doc_status"],
        ["Address Proof Status", "address_proof_status"],
        ["Avatar URL", "avatar_url"],
      ] as Array<[string, keyof FormState]>,
    []
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);

  /* ================= load functions ================= */

  const loadClient = async () => {
    if (!id) return;
    const res = await fetch(`${API_BASE_URL}/api/admin/clients/${id}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "Failed to load client");

    setClient(data.client);
    setForm({
      email: data.client.email || "",
      name: data.client.name || "",
      phone: data.client.phone || "",
      cnic: data.client.cnic || "",
      city: data.client.city || "",
      address: data.client.address || "",
      location: data.client.location || "",
      emergency_contact_name: data.client.emergency_contact_name || "",
      emergency_contact_phone: data.client.emergency_contact_phone || "",
      identity_doc_status: data.client.identity_doc_status || "",
      address_proof_status: data.client.address_proof_status || "",
      avatar_url: data.client.avatar_url || "",
    });
  };

  const loadBilling = async () => {
    if (!id) return;
    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/client/${id}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setBilling([]);
      return;
    }
    setBilling((data?.billing || []) as BillingItem[]);
  };

  const loadPendingProofs = async () => {
    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/pending`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setPendingProofs([]);
      return;
    }
    setPendingProofs((data?.proofs || []) as PendingProof[]);
  };

  const loadClientNotifications = async () => {
    if (!id) return;
    setNotifMsg("");
    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/notifications/client/${id}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setNotifMsg(data?.error || "Failed to load notifications");
      setNotifications([]);
      return;
    }
    setNotifications(data?.notifications || []);
  };

  const loadClientCases = async (opts?: { q?: string; status?: string; limit?: number; offset?: number }) => {
    if (!id) return;
    setCasesMsg("");
    const q = opts?.q ?? casesQ;
    const status = opts?.status ?? casesStatus;
    const limit = opts?.limit ?? casesLimit;
    const offset = opts?.offset ?? casesOffset;

    const params = new URLSearchParams();
    if (q?.trim()) params.set("q", q.trim());
    if (status && status !== "All") params.set("status", status);
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/cases/${id}?${params.toString()}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setCasesMsg(data?.error || "Failed to load cases");
      setCases([]);
      setCasesTotal(0);
      return;
    }
    setCases(data?.cases || []);
    setCasesTotal(data?.total || 0);
  };

  const loadClientFeedback = async (opts?: {
    q?: string;
    audience?: string;
    sentiment?: string;
    limit?: number;
    offset?: number;
  }) => {
    if (!id) return;
    setFeedbackMsg("");

    const q = opts?.q ?? feedbackQ;
    const audience = opts?.audience ?? feedbackAudience;
    const sentiment = opts?.sentiment ?? feedbackSentiment;
    const limit = opts?.limit ?? feedbackLimit;
    const offset = opts?.offset ?? feedbackOffset;

    const params = new URLSearchParams();
    if (q?.trim()) params.set("q", q.trim());
    params.set("audience", audience || "All");
    params.set("sentiment", sentiment || "All");
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/feedback/${id}?${params.toString()}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setFeedbackMsg(data?.error || "Failed to load feedback");
      setFeedback([]);
      setFeedbackTotal(0);
      return;
    }
    setFeedback(data?.feedback || []);
    setFeedbackTotal(data?.total || 0);
  };

  /** ✅ load active start case (DRAFT/INTAKE_STARTED) */
  const loadActiveStartCase = async () => {
    if (!id) return null;
    setStartCaseMsg("");

    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/active?userId=${id}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);

    if (!res.ok) {
      setActiveStartCaseId(null);
      setActiveStartCaseStatus(null);
      setActiveStartCaseLabel(null);
      return null;
    }

    const c = data?.case || null;
    const cid = c?.id ? Number(c.id) : null;
    setActiveStartCaseId(cid);
    setActiveStartCaseStatus(c?.status ? String(c.status) : null);
    setActiveStartCaseLabel(c?.case_display_label ? String(c.case_display_label) : null);
    return cid;
  };

  const loadStartCaseDocuments = async (caseId?: number | null) => {
    const cid = caseId ?? activeStartCaseId;
    if (!cid) {
      setStartCaseDocuments([]);
      return;
    }

    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/documents?caseId=${cid}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setStartCaseDocuments([]);
      return;
    }
    setStartCaseDocuments((data?.documents || []) as StartCaseDocument[]);
  };

  const loadStartCaseVoiceNotes = async (caseId?: number | null) => {
    const cid = caseId ?? activeStartCaseId;
    if (!cid) {
      setStartCaseVoiceNotes([]);
      return;
    }

    const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/voice?caseId=${cid}`, {
      headers: authHeaders(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setStartCaseVoiceNotes([]);
      return;
    }
    setStartCaseVoiceNotes((data?.voiceNotes || []) as StartCaseVoiceNote[]);
  };

  const loadMatchingCandidates = async (caseId?: number | null) => {
    const cid = caseId ?? activeStartCaseId;
    if (!cid) {
      setMatchingRun(null);
      setMatchingCandidates([]);
      setMatchingCaseMeta(null);
      return;
    }

    setMatchingLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/client-access/start-case/matching/candidates?caseId=${cid}`,
        {
          headers: authHeaders(),
        }
      );
      const data = await safeJson(res);

      if (!res.ok) {
        setMatchingRun(null);
        setMatchingCandidates([]);
        setMatchingCaseMeta(null);
        return;
      }

      setMatchingRun((data?.run || null) as MatchRun | null);
      setMatchingCandidates((data?.candidates || []) as MatchCandidate[]);
      setMatchingCaseMeta((data?.caseMeta || null) as StartCaseMeta | null);
    } finally {
      setMatchingLoading(false);
    }
  };

  const runMatchingForActiveCase = async () => {
    if (!activeStartCaseId) {
      setAssignMsg("No active start case found.");
      return;
    }

    setMatchingLoading(true);
    setAssignMsg("");
    try {
      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/matching/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          caseId: activeStartCaseId,
          shortlistSize: 5,
        }),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to run matching");

      setAssignMsg("Matching run complete. Review shortlist and assign.");
      await loadMatchingCandidates(activeStartCaseId);
    } catch (e: any) {
      setAssignMsg(e?.message || "Failed to run matching");
    } finally {
      setMatchingLoading(false);
    }
  };

  /** ✅ load advocates list (single documented route: /api/admin/advocates) */
  const loadAdvocates = async () => {
    setAssignMsg("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/advocates`, {
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to load advocates");

      const list = Array.isArray(data?.advocates) ? data.advocates : [];
      const normalized: AdvocateOption[] = list
        .map((u: any) => ({
          id: Number(u?.id),
          name: u?.name ?? null,
          email: String(u?.email || ""),
        }))
        .filter((u: AdvocateOption) => Number.isFinite(u.id) && !!u.email);

      setAdvocates(normalized);
    } catch (e: any) {
      setAdvocates([]);
      setAssignMsg(e?.message || "Could not load advocates.");
    }
  };

  const refreshCommon = async () => {
    try {
      setLoading(true);
      setMsg("");
      await Promise.all([loadClient(), loadClientNotifications(), loadActiveStartCase(), loadAdvocates()]);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshStartCase = async () => {
    try {
      setLoading(true);
      setStartCaseMsg("");
      setAssignMsg("");

      // loadActiveStartCase already sets the state; reuse its return value
      // instead of fetching the same endpoint a second time.
      const cid = await loadActiveStartCase();

      await Promise.all([
        loadStartCaseDocuments(cid),
        loadStartCaseVoiceNotes(cid),
        loadAdvocates(),
        loadMatchingCandidates(cid),
      ]);
    } catch (e: any) {
      setStartCaseMsg(e.message || "Failed to load start case");
    } finally {
      setLoading(false);
    }
  };

  const refreshSection = async (section: SectionKey) => {
    try {
      setLoading(true);
      setMsg("");

      if (section === "profile") await loadClient();
      if (section === "start_case") await refreshStartCase();
      if (section === "notifications") await loadClientNotifications();
      if (section === "billing") await loadBilling();
      if (section === "proofs") await loadPendingProofs();
      if (section === "cases") await loadClientCases();
      if (section === "feedback") await loadClientFeedback();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCommon();
    setCasesOffset(0);
    setFeedbackOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    refreshSection(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* ================= actions ================= */

  const saveProfile = async () => {
    if (!id) return;
    setLoading(true);
    setMsg("");

    const headers = authHeaders();
    headers.set("Content-Type", "application/json");

    const res = await fetch(`${API_BASE_URL}/api/admin/clients/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(form),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      setMsg(data?.error || "Update failed");
    } else {
      setMsg("Client profile updated");
      await refreshCommon();
    }
    setLoading(false);
  };

  const createVoucher = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setMsg("");

      const fd = new FormData();
      fd.append("user_id", id);
      fd.append("title", voucherForm.title);
      fd.append("description", voucherForm.description);
      fd.append("amount", voucherForm.amount);
      if (voucherForm.due_date) fd.append("due_date", voucherForm.due_date);

      // ✅ bank fields (backend supports these)
      if (voucherForm.bank_name) fd.append("bank_name", voucherForm.bank_name);
      if (voucherForm.bank_account_title) fd.append("bank_account_title", voucherForm.bank_account_title);
      if (voucherForm.bank_account_number) fd.append("bank_account_number", voucherForm.bank_account_number);
      if (voucherForm.bank_branch) fd.append("bank_branch", voucherForm.bank_branch);

      // ✅ optional case/advocate linkage
      if (voucherForm.case_id) fd.append("case_id", voucherForm.case_id);
      if (voucherForm.advocate_id) fd.append("advocate_id", voucherForm.advocate_id);

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/vouchers`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to create voucher");

      setMsg("Voucher created");
      setShowCreateVoucher(false);
      setVoucherForm({
        title: "Total Fee Voucher",
        description: "",
        amount: "",
        due_date: "",
        bank_name: "",
        bank_account_title: "",
        bank_account_number: "",
        bank_branch: "",
        case_id: "",
        advocate_id: "",
      });
      await loadBilling();
      setActive("billing");
    } catch (e: any) {
      setMsg(e.message || "Failed to create voucher");
    } finally {
      setLoading(false);
    }
  };

  const sendVoucher = async (billingId: number) => {
    try {
      setSendingId(billingId);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/vouchers/${billingId}/send`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to send voucher");

      setMsg("Voucher sent (PDF generated)");
      await loadBilling();
    } catch (e: any) {
      setMsg(e.message || "Failed to send voucher");
    } finally {
      setSendingId(null);
    }
  };

  const verifyProof = async (proofId: number) => {
    try {
      setVerifyingId(proofId);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/${proofId}/verify`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Verify failed");

      setMsg("Proof verified");
      await Promise.all([loadPendingProofs(), loadBilling()]);
    } catch (e: any) {
      setMsg(e.message || "Verify failed");
    } finally {
      setVerifyingId(null);
    }
  };

  const rejectProof = async (proofId: number) => {
    const reason = await prompt({
      title: "Reject Payment Proof",
      message: "Enter rejection reason shown to client (required for payment correction).",
      confirmText: "Reject Proof",
      cancelText: "Cancel",
      placeholder: "Explain what client should fix in the proof...",
      defaultValue: "Payment proof rejected",
      required: true,
      tone: "danger",
    });
    if (!reason) return;
    const headers = authHeaders();
    headers.set("Content-Type", "application/json");

    try {
      setRejectingId(proofId);
      setMsg("");

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/billing/proofs/${proofId}/reject`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ reason }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Reject failed");

      setMsg("Proof rejected");
      await Promise.all([loadPendingProofs(), loadBilling()]);
    } catch (e: any) {
      setMsg(e.message || "Reject failed");
    } finally {
      setRejectingId(null);
    }
  };

  const markNotifRead = async (notifId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/notifications/${notifId}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to mark as read");
      loadClientNotifications();
    } catch (e: any) {
      setNotifMsg((e as any)?.message || "Failed to mark as read");
    }
  };

  /** ✅ Assign advocate to active start case (moved here) */
  const assignAdvocateToActiveStartCase = async () => {
    try {
      setAssignMsg("");

      if (!activeStartCaseId) {
        setAssignMsg("No active start case found for this client.");
        return;
      }

      const advIdNum = Number(selectedAdvocateId);
      if (!advIdNum) {
        setAssignMsg("Please select an advocate first.");
        return;
      }

      setAssigning(true);

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/assign-advocate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          caseId: activeStartCaseId,
          advocateId: advIdNum,
        }),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to assign advocate");

      setAssignMsg("Advocate assigned to active start case");
      await refreshStartCase();
    } catch (e: any) {
      setAssignMsg(e?.message || "Failed to assign advocate");
    } finally {
      setAssigning(false);
    }
  };

  /* ================= UI atoms ================= */

  const PrimaryBtn = ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition",
        "border border-transparent",
        "disabled:opacity-60 disabled:cursor-not-allowed"
      )}
      style={{ background: BRAND.navy, color: "white" }}
    >
      {children}
    </button>
  );

  const GhostBtn = ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
        "bg-white border border-slate-200 hover:bg-slate-50",
        "disabled:opacity-60 disabled:cursor-not-allowed"
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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="font-bold text-slate-900">{title}</div>
        {right}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );

  const SectionButton = ({
    icon,
    title,
    subtitle,
    badge,
    activeKey,
  }: {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    badge?: React.ReactNode;
    activeKey: SectionKey;
  }) => {
    const isActive = active === activeKey;
    return (
      <button
        type="button"
        onClick={() => setActive(activeKey)}
        className={cn(
          "w-full text-left rounded-xl border px-4 py-3 transition flex items-center gap-3",
          isActive ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200 hover:bg-slate-50"
        )}
      >
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center border",
            isActive ? "bg-white border-slate-200" : "bg-slate-50 border-slate-200"
          )}
          style={isActive ? { borderLeft: `3px solid ${BRAND.navy}` } : undefined}
        >
          <span style={{ color: BRAND.navy }}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900 flex items-center gap-2">
            <span className="truncate">{title}</span>
            {badge}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
        </div>
        <ChevronRight className="text-slate-400" size={18} />
      </button>
    );
  };

  const Pagination = ({
    total,
    limit,
    offset,
    onChange,
  }: {
    total: number;
    limit: number;
    offset: number;
    onChange: (nextOffset: number) => void;
  }) => {
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(total, offset + limit);
    const canPrev = offset > 0;
    const canNext = offset + limit < total;

    return (
      <div className="flex items-center justify-between gap-2 mt-4">
        <div className="text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-700">{start}</span>–
          <span className="font-semibold text-slate-700"> {end}</span> of{" "}
          <span className="font-semibold text-slate-700">{total}</span>
        </div>
        <div className="flex gap-2">
          <GhostBtn disabled={!canPrev} onClick={() => onChange(Math.max(0, offset - limit))}>
            Prev
          </GhostBtn>
          <GhostBtn disabled={!canNext} onClick={() => onChange(offset + limit)}>
            Next
          </GhostBtn>
        </div>
      </div>
    );
  };

  /* ================= UI ================= */

  return (
    <div className="min-h-screen bg-[#F6F8FC]">
      {/* Command bar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Admin</span>
              <span>›</span>
              <span>Clients</span>
              <span>›</span>
              <span className="text-slate-700 font-semibold truncate">
                {client?.name || client?.email || `Client #${id}`}
              </span>
            </div>
            <div className="text-lg font-bold text-slate-900 truncate">Client Profile</div>
          </div>

          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => navigate(-1)}>
              <ArrowLeft size={16} /> Back
            </GhostBtn>

            <GhostBtn onClick={() => refreshSection(active)} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </GhostBtn>

            <PrimaryBtn onClick={saveProfile} disabled={loading}>
              <Save size={16} /> Save
            </PrimaryBtn>
          </div>
        </div>

        {msg ? (
          <div className="max-w-[1400px] mx-auto px-4 md:px-6 pb-3">
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
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

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
        <div className="grid lg:grid-cols-[340px_1fr] gap-6">
          {/* Left rail */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div
                className="px-5 py-4"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navy2} 100%)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-lg bg-white/10 border border-white/20 overflow-hidden flex items-center justify-center">
                    {client?.avatar_url ? (
                      <img src={client.avatar_url} alt="avatar" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <User2 className="text-white/80" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">{client?.name || "Client"}</div>
                    <div className="text-xs text-white/80 truncate">{client?.email || "—"}</div>
                    <div className="text-xs text-white/80 mt-1">
                      ID: <span className="font-semibold text-white">{id || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Unread</div>
                    <div className="text-lg font-bold text-slate-900">{unreadCount}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Cases</div>
                    <div className="text-lg font-bold text-slate-900">{casesTotal || 0}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Feedback</div>
                    <div className="text-lg font-bold text-slate-900">{feedbackTotal || 0}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <SectionButton icon={<User2 size={18} />} title="Profile" subtitle="Client details & status" activeKey="profile" />

                  {/* NEW: Start Case section */}
                  <SectionButton
                    icon={<FileText size={18} />}
                    title="Start Case"
                    subtitle="Review docs, voice notes & assign advocate"
                    activeKey="start_case"
                    badge={
                      activeStartCaseId ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                          style={{
                            background: BRAND.yellow,
                            borderColor: BRAND.yellow,
                            color: BRAND.navy,
                          }}
                          title="Active start case exists"
                        >
                          Case {activeStartCaseId}
                        </span>
                      ) : undefined
                    }
                  />

                  <SectionButton
                    icon={<Bell size={18} />}
                    title="Notifications"
                    subtitle="Client alerts & messages"
                    activeKey="notifications"
                    badge={
                      unreadCount > 0 ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                          style={{
                            background: BRAND.yellow,
                            borderColor: BRAND.yellow,
                            color: BRAND.navy,
                          }}
                        >
                          {unreadCount}
                        </span>
                      ) : undefined
                    }
                  />
                  <SectionButton icon={<Briefcase size={18} />} title="Cases" subtitle="All cases for this client" activeKey="cases" />
                  <SectionButton icon={<MessageSquare size={18} />} title="Feedback" subtitle="Ratings & comments" activeKey="feedback" />
                  <SectionButton icon={<CreditCard size={18} />} title="Billing" subtitle="Vouchers & payments" activeKey="billing" />
                  <SectionButton icon={<ShieldCheck size={18} />} title="Pending Proofs" subtitle="Verify or reject proofs" activeKey="proofs" />
                </div>
              </div>
            </div>
          </div>

          {/* Main */}
          <div className="space-y-6">
            {/* PROFILE */}
            {active === "profile" && (
              <CardShell
                title="Profile"
                right={
                  <GhostBtn onClick={() => refreshSection("profile")} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {client ? (
                  <div className="grid md:grid-cols-2 gap-4">
                    {fields.map(([label, key]) => (
                      <div key={key}>
                        <label className="text-xs font-semibold text-slate-600">{label}</label>
                        <input
                          value={form[key]}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Loading…</div>
                )}
              </CardShell>
            )}

            {/* NEW: START CASE */}
            {active === "start_case" && (
              <CardShell
                title={
                  <div className="flex items-center gap-2">
                    <span>Start Case (Admin Review)</span>
                    <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                      {activeStartCaseLabel || (activeStartCaseId ? `Case #${activeStartCaseId}` : "No active case")}
                    </span>
                    {activeStartCaseStatus ? (
                      <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                        {activeStartCaseStatus}
                      </span>
                    ) : null}
                  </div>
                }
                right={
                  <div className="flex items-center gap-2">
                    <GhostBtn onClick={refreshStartCase} disabled={loading}>
                      <RefreshCw size={16} /> Refresh
                    </GhostBtn>
                  </div>
                }
              >
                {startCaseMsg ? (
                  <div className="p-3 mb-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800 font-semibold">
                    {startCaseMsg}
                  </div>
                ) : null}

                {!activeStartCaseId ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-900">No active start case</div>
                    <div className="text-sm text-slate-600 mt-1">
                      Client must have a case in <b>DRAFT</b> or <b>INTAKE_STARTED</b>.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Assign Advocate */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <Sparkles size={16} />
                              <span>Admin-Reviewed Matching (Top 5)</span>
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              Run matching to get ranked advocates with full score breakdown and reasons.
                            </div>
                            {matchingRun ? (
                              <div className="text-xs text-slate-600 mt-2">
                                Last run #{matchingRun.id} at {new Date(matchingRun.created_at).toLocaleString()}
                              </div>
                            ) : null}
                            {matchingCaseMeta?.case_display_label ? (
                              <div className="text-xs text-slate-600 mt-1">{matchingCaseMeta.case_display_label}</div>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-2">
                            <GhostBtn onClick={() => loadMatchingCandidates(activeStartCaseId)} disabled={matchingLoading}>
                              <RefreshCw size={16} /> Refresh
                            </GhostBtn>
                            <PrimaryBtn onClick={runMatchingForActiveCase} disabled={matchingLoading || assigning}>
                              {matchingLoading ? "Running..." : "Run Matching"}
                            </PrimaryBtn>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          {matchingCandidates.length === 0 ? (
                            <div className="text-sm text-slate-600">No shortlist yet. Click Run Matching.</div>
                          ) : (
                            matchingCandidates.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => setSelectedAdvocateId(String(c.advocate_id))}
                                className={cn(
                                  "w-full text-left rounded-lg border p-3 transition",
                                  selectedAdvocateId === String(c.advocate_id)
                                    ? "border-[#0B2A5B] bg-[#0B2A5B]/5"
                                    : "border-slate-200 bg-white hover:bg-slate-50"
                                )}
                              >
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                  <div>
                                    <div className="text-sm font-bold text-slate-900">
                                      #{c.rank_position} {c.advocate_name || "Advocate"} ({c.advocate_email})
                                    </div>
                                    <div className="text-xs text-slate-600 mt-1">
                                      {c.city || "City —"} • Exp {c.experience_years ?? 0}y • Languages {Array.isArray(c.languages) && c.languages.length > 0 ? c.languages.join(", ") : "—"}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xs text-slate-500">Total Score</div>
                                    <div className="text-lg font-extrabold text-slate-900">{Number(c.total_score || 0).toFixed(2)}</div>
                                  </div>
                                </div>
                                <div className="mt-2 text-xs text-slate-600">
                                  Domain {c.score_breakdown?.domainFit ?? 0} • Language {c.score_breakdown?.languageFit ?? 0} • City {c.score_breakdown?.cityFit ?? 0} • Exp {c.score_breakdown?.experienceBonus ?? 0} • Availability {c.score_breakdown?.availabilityBonus ?? 0} • Workload Penalty -{c.score_breakdown?.workloadPenalty ?? 0}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {(c.reasons || []).join(" | ")}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <UserCheck size={18} />
                            <span>Assign Advocate</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Pick from shortlist or full list, then assign. Advocate acceptance is required next.
                          </div>

                          {assignMsg ? (
                            <div
                              className={cn(
                                "mt-3 rounded-lg border px-3 py-2 text-sm font-semibold",
                                isErrorMessage(assignMsg)
                                  ? "bg-rose-50 border-rose-200 text-rose-900"
                                  : "bg-emerald-50 border-emerald-200 text-emerald-900"
                              )}
                            >
                              {assignMsg}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={selectedAdvocateId}
                            onChange={(e) => setSelectedAdvocateId(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-2 bg-white min-w-[260px]"
                            disabled={assigning}
                            title="Select advocate"
                          >
                            <option value="">Select advocate…</option>
                            {advocates.map((a) => (
                              <option key={a.id} value={String(a.id)}>
                                {a.name ? `${a.name} (${a.email})` : a.email}
                              </option>
                            ))}
                          </select>

                          <PrimaryBtn onClick={assignAdvocateToActiveStartCase} disabled={!selectedAdvocateId || assigning}>
                            {assigning ? "Assigning..." : "Assign"}
                          </PrimaryBtn>

                          <GhostBtn onClick={() => loadAdvocates()} disabled={assigning}>
                            <RefreshCw size={16} /> Reload
                          </GhostBtn>
                        </div>
                      </div>
                    </div>

                    {/* Documents */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <FileText size={18} />
                            <span>Client Documents</span>
                            <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                              {startCaseDocuments.length}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">Review uploaded documents for this start case.</div>
                        </div>
                        <GhostBtn onClick={() => loadStartCaseDocuments(activeStartCaseId)} disabled={loading}>
                          <RefreshCw size={16} /> Refresh Docs
                        </GhostBtn>
                      </div>

                      {startCaseDocuments.length === 0 ? (
                        <div className="text-sm text-slate-500 mt-3">No documents found for this case.</div>
                      ) : (
                        <div className="overflow-x-auto mt-3">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                              <tr className="border-b border-slate-200">
                                <th className="p-3 text-left font-semibold text-slate-600">Type</th>
                                <th className="p-3 text-left font-semibold text-slate-600">Status</th>
                                <th className="p-3 text-left font-semibold text-slate-600">Uploaded</th>
                                <th className="p-3 text-left font-semibold text-slate-600">File</th>
                              </tr>
                            </thead>
                            <tbody>
                              {startCaseDocuments.map((d) => (
                                <tr key={d.id} className="border-b border-slate-100">
                                  <td className="p-3 font-semibold text-slate-900">{d.doc_type || "—"}</td>
                                  <td className="p-3">
                                    <span className={cn("px-2 py-1 rounded-full border text-[11px] font-bold", badgeTone("neutral"))}>
                                      {String(d.status || "").toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="p-3">{new Date(d.created_at).toLocaleString()}</td>
                                  <td className="p-3">
                                    {d.file_url ? (
                                      <AuthedLink
                                        url={d.file_url}
                                        className="font-semibold underline"
                                        style={{ color: BRAND.navy }}
                                      >
                                        View
                                      </AuthedLink>
                                    ) : (
                                      <span className="text-xs text-slate-400">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Voice notes */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <Mic size={18} />
                            <span>Voice Notes</span>
                            <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                              {startCaseVoiceNotes.length}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Admin can listen to voice notes uploaded by the client for this start case.
                          </div>
                        </div>
                        <GhostBtn onClick={() => loadStartCaseVoiceNotes(activeStartCaseId)} disabled={loading}>
                          <RefreshCw size={16} /> Refresh Voice
                        </GhostBtn>
                      </div>

                      {startCaseVoiceNotes.length === 0 ? (
                        <div className="text-sm text-slate-500 mt-3">No voice notes found for this case.</div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {startCaseVoiceNotes.map((v) => (
                            <div key={v.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="text-sm font-semibold text-slate-900">
                                  Voice #{v.id}{" "}
                                  <span className="text-xs font-normal text-slate-500">
                                    · {v.language ? v.language : "—"} · {new Date(v.created_at).toLocaleString()}
                                  </span>
                                </div>
                                {v.audio_url ? (
                                  <AuthedLink
                                    url={v.audio_url}
                                    className="text-xs font-semibold underline"
                                    style={{ color: BRAND.navy }}
                                  >
                                    Open audio
                                  </AuthedLink>
                                ) : null}
                              </div>

                              {v.audio_url ? (
                                <AuthedAudio className="w-full mt-2" src={v.audio_url} />
                              ) : (
                                <div className="text-xs text-slate-500 mt-2">No audio URL.</div>
                              )}

                              {v.notes ? <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{v.notes}</div> : null}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* NOTE: "Admin upload voice note" needs a backend POST endpoint.
                          Right now your backend shared only has GET /start-case/voice.
                          When you add POST endpoint, we can wire it here. */}
                      <div className="mt-4 text-xs text-slate-500 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-slate-400" />
                        Upload voice note from admin is not wired (backend POST endpoint needed).
                      </div>
                    </div>
                  </div>
                )}
              </CardShell>
            )}

            {/* NOTIFICATIONS */}
            {active === "notifications" && (
              <CardShell
                title="Notifications"
                right={
                  <GhostBtn onClick={() => refreshSection("notifications")} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {notifMsg ? (
                  <div className="p-3 mb-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800 font-semibold">
                    {notifMsg}
                  </div>
                ) : null}

                {notifications.length === 0 ? (
                  <div className="text-sm text-slate-500">No notifications found.</div>
                ) : (
                  <div className="space-y-3">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={cn(
                          "rounded-xl border p-4 flex items-start justify-between gap-4",
                          n.is_read ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-bold text-slate-900">{n.title}</div>
                            {n.type ? (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                                {n.type}
                              </span>
                            ) : null}
                            {n.priority ? (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                                {n.priority}
                              </span>
                            ) : null}
                            <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
                              {n.is_read ? "Read" : "Unread"}
                            </span>
                          </div>

                          {n.message ? <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{n.message}</div> : null}

                          <div className="text-xs text-slate-500 mt-2">{new Date(n.created_at).toLocaleString()}</div>
                        </div>

                        {!n.is_read ? <PrimaryBtn onClick={() => markNotifRead(n.id)}>Mark read</PrimaryBtn> : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardShell>
            )}

            {/* CASES (removed assign-advocate UI from here) */}
            {active === "cases" && (
              <CardShell
                title={
                  <div className="flex items-center gap-2">
                    <span>Cases</span>
                    <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                      Total: {casesTotal}
                    </span>
                  </div>
                }
                right={
                  <GhostBtn onClick={() => refreshSection("cases")} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {/* Filters */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={casesQ}
                      onChange={(e) => setCasesQ(e.target.value)}
                      placeholder="Search by Case ID, title or description…"
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 bg-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center gap-2">
                      <Filter size={16} className="text-slate-400" />
                      <select
                        value={casesStatus}
                        onChange={(e) => setCasesStatus(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      >
                        <option value="All">All Status</option>
                        <option value="OPEN">Open</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="CLOSED">Closed</option>
                        <option value="PENDING">Pending</option>
                      </select>
                    </div>

                    <select
                      value={casesLimit}
                      onChange={(e) => setCasesLimit(Number(e.target.value))}
                      className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      title="Page size"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>

                    <PrimaryBtn
                      onClick={() => {
                        setCasesOffset(0);
                        loadClientCases({ q: casesQ, status: casesStatus, limit: casesLimit, offset: 0 });
                      }}
                    >
                      Apply
                    </PrimaryBtn>
                  </div>
                </div>

                {casesMsg ? (
                  <div className="p-3 mt-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800 font-semibold">
                    {casesMsg}
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {cases.length === 0 ? (
                    <div className="text-sm text-slate-500">No cases found.</div>
                  ) : (
                    cases.map((c) => (
                      <div key={c.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-bold text-slate-900">{c.title || "—"}</div>

                              <span className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                                {c.id}
                              </span>

                              <span className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                                {formatStatus(c.status)}
                              </span>

                              <span
                                className={cn(
                                  "text-[11px] px-2 py-1 rounded-full border",
                                  c.alertsCount > 0 ? badgeTone("warn") : badgeTone("neutral")
                                )}
                              >
                                Alerts: {c.alertsCount}
                              </span>

                              <span className={cn("text-[11px] px-2 py-1 rounded-full border", voucherTone(c.payments.voucherStatus))}>
                                Voucher: {c.payments.voucherStatus}
                              </span>
                            </div>

                            <div className="text-xs text-slate-500 mt-2">
                              Advocate:{" "}
                              <span className="font-semibold text-slate-700">
                                {c.advocate?.assigned ? c.advocate?.name || "Assigned" : "Not assigned"}
                              </span>
                              {" · "}Voucher ID: <span className="font-semibold text-slate-700">{c.payments.voucherId || "—"}</span>
                              {" · "}Amount:{" "}
                              <span className="font-semibold text-slate-700">
                                {c.payments.amount == null ? "—" : `PKR ${formatMoneyPKR(c.payments.amount)}`}
                              </span>
                              {" · "}Due: <span className="font-semibold text-slate-700">{c.payments.dueDate || "—"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  <Pagination
                    total={casesTotal}
                    limit={casesLimit}
                    offset={casesOffset}
                    onChange={(nextOffset) => {
                      setCasesOffset(nextOffset);
                      loadClientCases({ q: casesQ, status: casesStatus, limit: casesLimit, offset: nextOffset });
                    }}
                  />
                </div>
              </CardShell>
            )}

            {/* FEEDBACK */}
            {active === "feedback" && (
              <CardShell
                title={
                  <div className="flex items-center gap-2">
                    <span>Feedback</span>
                    <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                      Total: {feedbackTotal}
                    </span>
                  </div>
                }
                right={
                  <GhostBtn onClick={() => refreshSection("feedback")} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {/* Filters */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={feedbackQ}
                      onChange={(e) => setFeedbackQ(e.target.value)}
                      placeholder="Search feedback message…"
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 bg-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={feedbackAudience}
                      onChange={(e) => setFeedbackAudience(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      title="Audience"
                    >
                      <option value="All">All Audience</option>
                      <option value="Client">Client</option>
                      <option value="Advocate">Advocate</option>
                      <option value="Admin">Admin</option>
                    </select>

                    <select
                      value={feedbackSentiment}
                      onChange={(e) => setFeedbackSentiment(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      title="Sentiment"
                    >
                      <option value="All">All Sentiment</option>
                      <option value="Positive">Positive</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Negative">Negative</option>
                    </select>

                    <select
                      value={feedbackLimit}
                      onChange={(e) => setFeedbackLimit(Number(e.target.value))}
                      className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      title="Page size"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>

                    <PrimaryBtn
                      onClick={() => {
                        setFeedbackOffset(0);
                        loadClientFeedback({
                          q: feedbackQ,
                          audience: feedbackAudience,
                          sentiment: feedbackSentiment,
                          limit: feedbackLimit,
                          offset: 0,
                        });
                      }}
                    >
                      Apply
                    </PrimaryBtn>
                  </div>
                </div>

                {feedbackMsg ? (
                  <div className="p-3 mt-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800 font-semibold">
                    {feedbackMsg}
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {feedback.length === 0 ? (
                    <div className="text-sm text-slate-500">No feedback found.</div>
                  ) : (
                    feedback.map((f) => (
                      <div key={f.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-bold text-slate-900">{f.audience}</div>

                              <span
                                className={cn(
                                  "text-[11px] px-2 py-1 rounded-full border",
                                  f.sentiment === "Positive"
                                    ? badgeTone("good")
                                    : f.sentiment === "Negative"
                                    ? badgeTone("bad")
                                    : badgeTone("neutral")
                                )}
                              >
                                {f.sentiment}
                              </span>

                              {f.category ? (
                                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                                  {f.category}
                                </span>
                              ) : null}

                              {typeof f.case_id === "number" ? (
                                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                                  Case: {f.case_id}
                                </span>
                              ) : null}

                              {typeof f.advocate_id === "number" ? (
                                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                                  Advocate: {f.advocate_id}
                                </span>
                              ) : null}
                            </div>

                            {f.message ? (
                              <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{f.message}</div>
                            ) : (
                              <div className="text-sm text-slate-500 mt-2">No message.</div>
                            )}

                            <div className="grid md:grid-cols-4 gap-2 mt-3">
                              {[
                                ["Website UX", f.website_ux],
                                ["Website Speed", f.website_speed],
                                ["Admin Help", f.admin_helpfulness],
                                ["Admin Response", f.admin_response],
                                ["Adv Knowledge", f.advocate_knowledge],
                                ["Adv Response", f.advocate_responsiveness],
                                ["Adv Avail", f.advocate_availability],
                                ["Adv Handling", f.advocate_case_handling],
                              ].map(([label, val]) => (
                                <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                  <div className="text-[11px] font-semibold text-slate-600">{label}</div>
                                  <div className="text-lg font-bold text-slate-900">{val == null ? "—" : String(val)}</div>
                                </div>
                              ))}
                            </div>

                            <div className="text-xs text-slate-500 mt-2">
                              {new Date(f.created_at).toLocaleString()}
                              {f.contact_pref || f.contact_value ? (
                                <>
                                  {" · "}Contact: <span className="font-semibold text-slate-700">{f.contact_pref || "—"}</span>{" "}
                                  <span className="text-slate-500">{f.contact_value ? `(${f.contact_value})` : ""}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  <Pagination
                    total={feedbackTotal}
                    limit={feedbackLimit}
                    offset={feedbackOffset}
                    onChange={(nextOffset) => {
                      setFeedbackOffset(nextOffset);
                      loadClientFeedback({
                        q: feedbackQ,
                        audience: feedbackAudience,
                        sentiment: feedbackSentiment,
                        limit: feedbackLimit,
                        offset: nextOffset,
                      });
                    }}
                  />
                </div>
              </CardShell>
            )}

            {/* BILLING */}
            {active === "billing" && (
              <CardShell
                title="Billing / Vouchers"
                right={
                  <div className="flex items-center gap-2">
                    <GhostBtn onClick={() => refreshSection("billing")} disabled={loading}>
                      <RefreshCw size={16} /> Refresh
                    </GhostBtn>
                    <PrimaryBtn onClick={() => setShowCreateVoucher(true)}>
                      <Plus size={16} /> Create Voucher
                    </PrimaryBtn>
                  </div>
                }
              >
                {billing.length === 0 ? (
                  <div className="text-sm text-slate-500">No vouchers yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="p-3 text-left font-semibold text-slate-600">Title</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Amount</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Status</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Voucher PDF</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Due</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Created</th>
                          <th className="p-3 text-right font-semibold text-slate-600">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.map((b) => {
                          const st = String(b.status || "").toUpperCase();
                          return (
                            <tr key={b.id} className="border-b border-slate-100">
                              <td className="p-3 font-semibold text-slate-900">{b.title}</td>
                              <td className="p-3">PKR {formatMoneyPKR(b.amount)}</td>
                              <td className="p-3">
                                <span className={cn("px-2 py-1 rounded-full border text-[11px] font-bold", billingTone(b.status))}>
                                  {st}
                                </span>
                              </td>
                              <td className="p-3">
                                {b.voucher_pdf_url ? (
                                  <AuthedLink
                                    url={b.voucher_pdf_url}
                                    className="font-semibold underline"
                                    style={{ color: BRAND.navy }}
                                  >
                                    View PDF
                                  </AuthedLink>
                                ) : (
                                  <span className="text-xs text-slate-400">Not generated</span>
                                )}
                              </td>
                              <td className="p-3">
                                {b.due_date ? new Date(b.due_date).toLocaleDateString() : <span className="text-xs text-slate-400">—</span>}
                              </td>
                              <td className="p-3">{new Date(b.created_at).toLocaleDateString()}</td>
                              <td className="p-3 text-right">
                                {st === "PENDING" ? (
                                  <button
                                    onClick={() => sendVoucher(b.id)}
                                    disabled={sendingId === b.id}
                                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60"
                                    type="button"
                                  >
                                    <Send size={14} /> {sendingId === b.id ? "Sending..." : "Send"}
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardShell>
            )}

            {/* PROOFS */}
            {active === "proofs" && (
              <CardShell
                title={
                  <div className="flex items-center gap-2">
                    <span>Pending Payment Proofs</span>
                    <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                      {pendingProofs.length}
                    </span>
                  </div>
                }
                right={
                  <GhostBtn onClick={() => refreshSection("proofs")} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {pendingProofs.length === 0 ? (
                  <div className="text-sm text-slate-500">No pending proofs.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="p-3 text-left font-semibold text-slate-600">Client</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Voucher</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Amount</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Uploaded</th>
                          <th className="p-3 text-left font-semibold text-slate-600">Links</th>
                          <th className="p-3 text-right font-semibold text-slate-600">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingProofs.map((p) => (
                          <tr key={p.proof_id} className="border-b border-slate-100">
                            <td className="p-3 font-semibold text-slate-900">{p.client_email}</td>
                            <td className="p-3">{p.title}</td>
                            <td className="p-3">PKR {formatMoneyPKR(p.amount)}</td>
                            <td className="p-3">{new Date(p.uploaded_at).toLocaleString()}</td>
                            <td className="p-3">
                              <div className="flex flex-col gap-1">
                                <AuthedLink
                                  url={p.proof_file_url}
                                  className="font-semibold underline"
                                  style={{ color: BRAND.navy }}
                                >
                                  View proof
                                </AuthedLink>

                                {p.voucher_pdf_url ? (
                                  <AuthedLink
                                    url={p.voucher_pdf_url}
                                    className="font-semibold underline"
                                    style={{ color: BRAND.navy }}
                                  >
                                    Voucher PDF
                                  </AuthedLink>
                                ) : null}

                                {p.note ? <div className="text-xs text-slate-500">Note: {p.note}</div> : null}
                              </div>
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => verifyProof(p.proof_id)}
                                  disabled={verifyingId === p.proof_id}
                                  className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                                  style={{ background: "#16a34a" }}
                                  type="button"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <CheckCircle2 size={16} /> {verifyingId === p.proof_id ? "Verifying..." : "Verify"}
                                  </span>
                                </button>
                                <button
                                  onClick={() => rejectProof(p.proof_id)}
                                  disabled={rejectingId === p.proof_id}
                                  className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                                  style={{ background: "#dc2626" }}
                                  type="button"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <XCircle size={16} /> {rejectingId === p.proof_id ? "Rejecting..." : "Reject"}
                                  </span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 text-xs text-slate-500 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-slate-400" />
                  Tip: verify only after checking voucher amount & proof details.
                </div>
              </CardShell>
            )}
          </div>
        </div>
      </div>

      {/* Create Voucher Modal */}
      {showCreateVoucher && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg border border-slate-200 shadow-xl overflow-hidden">
            <div
              className="px-6 py-4 border-b border-slate-200"
              style={{
                background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navy2} 100%)`,
              }}
            >
              <div className="font-bold text-white">Create Voucher</div>
              <div className="text-xs text-white/80 mt-1">Fill voucher details and create it for the client.</div>
            </div>

            <div className="p-6 grid gap-3">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Title"
                value={voucherForm.title}
                onChange={(e) => setVoucherForm({ ...voucherForm, title: e.target.value })}
              />

              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Amount"
                value={voucherForm.amount}
                onChange={(e) => setVoucherForm({ ...voucherForm, amount: e.target.value })}
              />

              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Due date (optional)"
                type="date"
                value={voucherForm.due_date}
                onChange={(e) => setVoucherForm({ ...voucherForm, due_date: e.target.value })}
              />

              {/* Bank fields */}
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Bank Name (optional)"
                value={voucherForm.bank_name}
                onChange={(e) => setVoucherForm({ ...voucherForm, bank_name: e.target.value })}
              />

              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Account Title (optional)"
                value={voucherForm.bank_account_title}
                onChange={(e) => setVoucherForm({ ...voucherForm, bank_account_title: e.target.value })}
              />

              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Account Number (optional)"
                value={voucherForm.bank_account_number}
                onChange={(e) => setVoucherForm({ ...voucherForm, bank_account_number: e.target.value })}
              />

              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Branch (optional)"
                value={voucherForm.bank_branch}
                onChange={(e) => setVoucherForm({ ...voucherForm, bank_branch: e.target.value })}
              />

              {/* optional linkage */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="Case ID (optional)"
                  value={voucherForm.case_id}
                  onChange={(e) => setVoucherForm({ ...voucherForm, case_id: e.target.value })}
                />
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="Advocate ID (optional)"
                  value={voucherForm.advocate_id}
                  onChange={(e) => setVoucherForm({ ...voucherForm, advocate_id: e.target.value })}
                />
              </div>

              <textarea
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="Description"
                rows={4}
                value={voucherForm.description}
                onChange={(e) => setVoucherForm({ ...voucherForm, description: e.target.value })}
              />
            </div>

            <div className="px-6 pb-6 flex justify-end gap-2">
              <GhostBtn onClick={() => setShowCreateVoucher(false)} disabled={loading}>
                Cancel
              </GhostBtn>
              <PrimaryBtn onClick={createVoucher} disabled={loading}>
                {loading ? "Creating..." : "Create"}
              </PrimaryBtn>
            </div>
          </div>
        </div>
      )}
      {dialogs}
    </div>
  );
}
