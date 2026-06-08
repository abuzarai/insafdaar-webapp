import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Save,
  User2,
  ShieldCheck,
  FileText,
  CalendarDays,
  Briefcase,
  GraduationCap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
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
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("text/html")) {
    throw new Error(
      `Backend returned HTML instead of JSON (status ${res.status}). Check API route: ${res.url}`
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

function badgeTone(kind: "good" | "warn" | "bad" | "neutral") {
  if (kind === "good") return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (kind === "warn") return "bg-amber-50 border-amber-200 text-amber-900";
  if (kind === "bad") return "bg-rose-50 border-rose-200 text-rose-800";
  return "bg-slate-50 border-slate-200 text-slate-700";
}

/**
 * ✅ IMPORTANT: your backend uses:
 * "Verified" | "Rejected" | "Pending" | "Not Uploaded"
 */
function docTone(status: string) {
  const s = String(status || "").toLowerCase();
  if (s.includes("verified")) return badgeTone("good");
  if (s.includes("rejected")) return badgeTone("bad");
  if (s.includes("pending")) return badgeTone("warn");
  if (s.includes("uploaded")) return badgeTone("warn");
  return badgeTone("neutral");
}

/* ================= types ================= */

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

type DaySchedules = Record<
  DayKey,
  { enabled: boolean; windows: Array<{ from: string; to: string }> }
>;

type Profile = {
  name: string | null;
  email: string | null;
  phone: string | null;

  headline: string | null;
  experienceYears: number;
  barCouncilId: string | null;
  city: string | null;
  court: string | null;
  languages: string[];
  practiceAreas: string[];
  bio: string | null;
  avatarUrl: string | null;
  publicProfileEnabled: boolean;

  // returned by backend full-profile controller
  isVerified?: boolean;
  verifiedAt?: string | null;
  verifiedByAdminId?: number | null;
  verificationNote?: string | null;

  // readiness returned by backend full-profile controller
  readyForApproval?: boolean;
  missingRequiredDocs?: string[];
  notVerifiedRequiredDocs?: string[];
};

type Availability = {
  mode: string;
  slotMinutes: number;
  bufferMinutes: number;
  maxBookingsPerDay: number;
  meetingLink: string;
  defaultLocation: string;
  appointmentTypes: Record<string, boolean>;
  notesToClients: string;
  daySchedules: DaySchedules;
};

type AdvocateDoc = {
  key: string; // doc_type
  status: string;
  lastUpdated: string | null;
  note: string | null; // admin_note
  fileUrl: string | null;
  reviewedAt?: string | null;
  reviewedByAdminId?: number | null;
};

type WorkRow = {
  id: number;
  org: string;
  role: string;
  from_year: number | null;
  to_year: number | null;
  location: string | null;
  highlights: string[] | null;
};

type EduRow = {
  id: number;
  degree: string;
  institute: string;
  year: number | null;
};

type FullPayload = {
  profile: Profile;
  availability: Availability;
  documents: AdvocateDoc[];
  workHistory: WorkRow[];
  education: EduRow[];
};

type SectionKey =
  | "profile"
  | "availability"
  | "documents"
  | "work"
  | "education"
  | "verification";

/* ================= component ================= */

export default function AdminAdvocateProfile() {
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

  const [data, setData] = useState<FullPayload | null>(null);

  // editable form states
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
    headline: "",
    experienceYears: "0",
    barCouncilId: "",
    city: "",
    court: "",
    languages: "", // comma separated
    practiceAreas: "", // comma separated
    bio: "",
    avatarUrl: "",
    publicProfileEnabled: true,
  });

  const [availForm, setAvailForm] = useState({
    mode: "Hybrid",
    slotMinutes: "30",
    bufferMinutes: "10",
    maxBookingsPerDay: "8",
    meetingLink: "",
    defaultLocation: "",
    notesToClients: "",
    appointmentTypesJson: "", // raw JSON string
    daySchedules: null as DaySchedules | null,
  });

  const [docBusyKey, setDocBusyKey] = useState<string | null>(null);
  const { prompt, dialogs } = useActionDialogs();

  const verifiedBadge = useMemo(() => {
    const v = !!data?.profile?.isVerified;
    return v
      ? { text: "Verified", tone: badgeTone("good") }
      : { text: "Not Verified", tone: badgeTone("neutral") };
  }, [data?.profile?.isVerified]);

  const docsCounts = useMemo(() => {
    const docs = data?.documents || [];
    const pending = docs.filter((d) =>
      String(d.status).toLowerCase().includes("pending")
    ).length;
    const verified = docs.filter((d) =>
      String(d.status).toLowerCase().includes("verified")
    ).length;
    const rejected = docs.filter((d) =>
      String(d.status).toLowerCase().includes("rejected")
    ).length;
    return { pending, verified, rejected, total: docs.length };
  }, [data?.documents]);

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
          isActive
            ? "bg-slate-50 border-slate-200"
            : "bg-white border-slate-200 hover:bg-slate-50"
        )}
      >
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center border",
            isActive
              ? "bg-white border-slate-200"
              : "bg-slate-50 border-slate-200"
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

  /* ================= API loaders ================= */

  const loadFull = async () => {
    if (!id) return;

    const res = await fetch(
      `${API_BASE_URL}/api/admin/advocates/${id}/full-profile`,
      { headers: authHeaders() }
    );
    const out = await safeJson(res);
    if (!res.ok) throw new Error(out?.error || "Failed to load advocate profile");

    const payload: FullPayload = out;

    setData(payload);

    const p = payload.profile;
    setProfileForm({
      name: p.name || "",
      email: p.email || "",
      phone: p.phone || "",
      headline: p.headline || "",
      experienceYears: String(p.experienceYears ?? 0),
      barCouncilId: p.barCouncilId || "",
      city: p.city || "",
      court: p.court || "",
      languages: Array.isArray(p.languages) ? p.languages.join(", ") : "",
      practiceAreas: Array.isArray(p.practiceAreas) ? p.practiceAreas.join(", ") : "",
      bio: p.bio || "",
      avatarUrl: p.avatarUrl || "",
      publicProfileEnabled: !!p.publicProfileEnabled,
    });

    const a = payload.availability;
    setAvailForm({
      mode: a.mode || "Hybrid",
      slotMinutes: String(a.slotMinutes ?? 30),
      bufferMinutes: String(a.bufferMinutes ?? 10),
      maxBookingsPerDay: String(a.maxBookingsPerDay ?? 8),
      meetingLink: a.meetingLink || "",
      defaultLocation: a.defaultLocation || "",
      notesToClients: a.notesToClients || "",
      appointmentTypesJson: a.appointmentTypes
        ? JSON.stringify(a.appointmentTypes, null, 2)
        : "{}",
      daySchedules: a.daySchedules || null,
    });
  };

  const refresh = async () => {
    try {
      setLoading(true);
      setMsg("");
      await loadFull();
    } catch (e: any) {
      setMsg(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ================= actions ================= */

  const saveProfile = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const body = {
        name: profileForm.name || null,
        email: profileForm.email || null,

        phone: profileForm.phone || null,
        headline: profileForm.headline || null,
        experience_years: Number(profileForm.experienceYears) || 0,
        bar_council_id: profileForm.barCouncilId || null,
        city: profileForm.city || null,
        court: profileForm.court || null,
        languages: profileForm.languages
          ? profileForm.languages.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        practice_areas: profileForm.practiceAreas
          ? profileForm.practiceAreas.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        bio: profileForm.bio || null,
        public_profile_enabled: !!profileForm.publicProfileEnabled,
      };

      const res = await fetch(`${API_BASE_URL}/api/admin/advocates/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });

      const out = await safeJson(res);
      if (!res.ok) throw new Error(out?.error || "Save failed");

      setMsg("✅ Advocate profile updated");
      await loadFull();
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ⚠️ NOTE:
   * Your backend file you shared does NOT include this route yet:
   * PUT /api/admin/advocates/:id/availability
   * Keep this UI, but you must add backend controller+route later.
   */
  const saveAvailability = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setMsg("");

      let appointmentTypes: any = {};
      try {
        appointmentTypes = availForm.appointmentTypesJson?.trim()
          ? JSON.parse(availForm.appointmentTypesJson)
          : {};
      } catch {
        throw new Error("appointmentTypes JSON is invalid");
      }

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const body = {
        mode: availForm.mode || "Hybrid",
        slotMinutes: Number(availForm.slotMinutes) || 30,
        bufferMinutes: Number(availForm.bufferMinutes) || 10,
        maxBookingsPerDay: Number(availForm.maxBookingsPerDay) || 8,
        meetingLink: availForm.meetingLink || "",
        defaultLocation: availForm.defaultLocation || "",
        notesToClients: availForm.notesToClients || "",
        appointmentTypes,
        daySchedules: availForm.daySchedules || undefined,
      };

      const res = await fetch(
        `${API_BASE_URL}/api/admin/advocates/${id}/availability`,
        { method: "PUT", headers, body: JSON.stringify(body) }
      );

      const out = await safeJson(res);
      if (!res.ok) throw new Error(out?.error || "Save availability failed");

      setMsg("✅ Availability updated");
      await loadFull();
    } catch (e: any) {
      setMsg(e?.message || "Save availability failed");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ FIXED: backend expects status: "Verified" | "Rejected" | "Pending"
   */
  const reviewDoc = async (
    docType: string,
    status: "Pending" | "Verified" | "Rejected"
  ) => {
    if (!id) return;
    const note =
      (await prompt({
        title: "Document Review Note",
        message: "Add admin note for this document review (visible in verification history).",
        confirmText: "Save Note",
        cancelText: "Skip",
        placeholder: "Optional review note...",
        defaultValue: "",
        required: false,
      })) ?? "";

    try {
      setDocBusyKey(docType);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(
        `${API_BASE_URL}/api/admin/advocates/${id}/documents/${encodeURIComponent(
          docType
        )}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status, admin_note: note }),
        }
      );

      const out = await safeJson(res);
      if (!res.ok) throw new Error(out?.error || "Failed to update document");

      setMsg("✅ Document updated");
      await loadFull();
      setActive("documents");
    } catch (e: any) {
      setMsg(e?.message || "Failed to update document");
    } finally {
      setDocBusyKey(null);
    }
  };

  const approveAdvocate = async () => {
    if (!id) return;
    const note =
      (await prompt({
        title: "Approve Advocate",
        message: "Add verification note for approval (optional, saved in audit).",
        confirmText: "Approve",
        cancelText: "Cancel",
        placeholder: "Optional approval note...",
        defaultValue: "",
        required: false,
      })) ?? "";

    try {
      setLoading(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(
        `${API_BASE_URL}/api/admin/advocates/${id}/approve`,
        { method: "POST", headers, body: JSON.stringify({ verification_note: note }) }
      );

      const out = await safeJson(res);
      if (!res.ok) throw new Error(out?.error || "Approve failed");

      setMsg("✅ Advocate approved");
      await loadFull();
      setActive("verification");
    } catch (e: any) {
      setMsg(e?.message || "Approve failed");
    } finally {
      setLoading(false);
    }
  };

  const unapproveAdvocate = async () => {
    if (!id) return;
    const note = await prompt({
      title: "Unapprove Advocate",
      message: "Enter reason for unapproving advocate (recommended for compliance trace).",
      confirmText: "Unapprove",
      cancelText: "Cancel",
      placeholder: "State reason for unapproval...",
      defaultValue: "",
      required: true,
      tone: "danger",
    });
    if (!note) return;

    try {
      setLoading(true);
      setMsg("");

      const headers = authHeaders();
      headers.set("Content-Type", "application/json");

      const res = await fetch(
        `${API_BASE_URL}/api/admin/advocates/${id}/unapprove`,
        { method: "POST", headers, body: JSON.stringify({ verification_note: note }) }
      );

      const out = await safeJson(res);
      if (!res.ok) throw new Error(out?.error || "Unapprove failed");

      setMsg("✅ Advocate unapproved");
      await loadFull();
      setActive("verification");
    } catch (e: any) {
      setMsg(e?.message || "Unapprove failed");
    } finally {
      setLoading(false);
    }
  };

  /* ================= derived ================= */

  const titleName =
    data?.profile?.name || data?.profile?.email || `Advocate #${id}`;

  const fields = useMemo(
    () =>
      [
        ["Name", "name"],
        ["Email", "email"],
        ["Phone", "phone"],
        ["Headline", "headline"],
        ["Experience Years", "experienceYears"],
        ["Bar Council ID", "barCouncilId"],
        ["City", "city"],
        ["Court", "court"],
        ["Languages (comma)", "languages"],
        ["Practice Areas (comma)", "practiceAreas"],
        ["Avatar URL", "avatarUrl"],
      ] as Array<[string, keyof typeof profileForm]>,
    []
  );

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
              <span>Advocates</span>
              <span>›</span>
              <span className="text-slate-700 font-semibold truncate">
                {titleName}
              </span>
            </div>
            <div className="text-lg font-bold text-slate-900 truncate">
              Advocate Profile
            </div>
          </div>

          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => navigate(-1)}>
              <ArrowLeft size={16} /> Back
            </GhostBtn>

            <GhostBtn onClick={refresh} disabled={loading}>
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
                msg.includes("✅")
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : msg.includes("❌")
                  ? "bg-rose-50 border-rose-200 text-rose-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
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
                    {data?.profile?.avatarUrl ? (
                      <img
                        src={data.profile.avatarUrl}
                        alt="avatar"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <User2 className="text-white/80" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">
                      {data?.profile?.name || "Advocate"}
                    </div>
                    <div className="text-xs text-white/80 truncate">
                      {data?.profile?.email || "—"}
                    </div>
                    <div className="text-xs text-white/80 mt-1">
                      ID:{" "}
                      <span className="font-semibold text-white">
                        {id || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "text-[11px] px-2 py-1 rounded-full border font-bold",
                      verifiedBadge.tone
                    )}
                  >
                    {verifiedBadge.text}
                  </span>

                  {docsCounts.pending > 0 ? (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                      style={{
                        background: BRAND.yellow,
                        borderColor: BRAND.yellow,
                        color: BRAND.navy,
                      }}
                    >
                      {docsCounts.pending} pending docs
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="p-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Docs</div>
                    <div className="text-lg font-bold text-slate-900">
                      {docsCounts.total}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Verified</div>
                    <div className="text-lg font-bold text-slate-900">
                      {docsCounts.verified}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Rejected</div>
                    <div className="text-lg font-bold text-slate-900">
                      {docsCounts.rejected}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <SectionButton
                    icon={<User2 size={18} />}
                    title="Profile"
                    subtitle="Advocate details"
                    activeKey="profile"
                  />
                  <SectionButton
                    icon={<CalendarDays size={18} />}
                    title="Availability"
                    subtitle="Slots & schedule"
                    activeKey="availability"
                  />
                  <SectionButton
                    icon={<FileText size={18} />}
                    title="Documents"
                    subtitle="Review verification docs"
                    activeKey="documents"
                    badge={
                      docsCounts.pending > 0 ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-bold border"
                          style={{
                            background: BRAND.yellow,
                            borderColor: BRAND.yellow,
                            color: BRAND.navy,
                          }}
                        >
                          {docsCounts.pending}
                        </span>
                      ) : undefined
                    }
                  />
                  <SectionButton
                    icon={<Briefcase size={18} />}
                    title="Work History"
                    subtitle="Experience list"
                    activeKey="work"
                  />
                  <SectionButton
                    icon={<GraduationCap size={18} />}
                    title="Education"
                    subtitle="Degrees list"
                    activeKey="education"
                  />
                  <SectionButton
                    icon={<ShieldCheck size={18} />}
                    title="Verification"
                    subtitle="Approve / unapprove advocate"
                    activeKey="verification"
                  />
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
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {!data ? (
                  <div className="text-sm text-slate-500">Loading…</div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {fields.map(([label, key]) => (
                      <div key={key}>
                        <label className="text-xs font-semibold text-slate-600">
                          {label}
                        </label>
                        <input
                          value={(profileForm as any)[key]}
                          onChange={(e) =>
                            setProfileForm({
                              ...profileForm,
                              [key]: e.target.value,
                            })
                          }
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
                        />
                      </div>
                    ))}

                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">
                        Bio
                      </label>
                      <textarea
                        value={profileForm.bio}
                        onChange={(e) =>
                          setProfileForm({ ...profileForm, bio: e.target.value })
                        }
                        rows={5}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                    </div>

                    <div className="md:col-span-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={profileForm.publicProfileEnabled}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            publicProfileEnabled: e.target.checked,
                          })
                        }
                      />
                      <span className="text-sm text-slate-700">
                        Public profile enabled
                      </span>
                    </div>

                    <div className="md:col-span-2 flex items-center gap-2">
                      <PrimaryBtn onClick={saveProfile} disabled={loading}>
                        <Save size={16} /> Save Profile
                      </PrimaryBtn>
                    </div>
                  </div>
                )}
              </CardShell>
            )}

            {/* AVAILABILITY */}
            {active === "availability" && (
              <CardShell
                title="Availability"
                right={
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <AlertTriangle size={16} className="inline mr-2 text-slate-500" />
                  This screen uses backend route:{" "}
                  <b>PUT /api/admin/advocates/:id/availability</b>. If you haven’t
                  added it yet, saving will fail until backend route exists.
                </div>

                <div className="mt-4 grid md:grid-cols-2 gap-4">
                  {[
                    ["Mode", "mode"],
                    ["Slot Minutes", "slotMinutes"],
                    ["Buffer Minutes", "bufferMinutes"],
                    ["Max Bookings / Day", "maxBookingsPerDay"],
                    ["Meeting Link", "meetingLink"],
                    ["Default Location", "defaultLocation"],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <label className="text-xs font-semibold text-slate-600">
                        {label}
                      </label>
                      <input
                        value={(availForm as any)[key]}
                        onChange={(e) =>
                          setAvailForm({ ...availForm, [key]: e.target.value })
                        }
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white"
                      />
                    </div>
                  ))}

                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">
                      Notes to clients
                    </label>
                    <textarea
                      value={availForm.notesToClients}
                      onChange={(e) =>
                        setAvailForm({
                          ...availForm,
                          notesToClients: e.target.value,
                        })
                      }
                      rows={3}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">
                      Appointment Types (JSON)
                    </label>
                    <textarea
                      value={availForm.appointmentTypesJson}
                      onChange={(e) =>
                        setAvailForm({
                          ...availForm,
                          appointmentTypesJson: e.target.value,
                        })
                      }
                      rows={6}
                      className="w-full font-mono text-xs border border-slate-200 rounded-lg px-3 py-2 mt-1 bg-white"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">
                      Day Schedules (Preview)
                    </label>
                    <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                      {JSON.stringify(availForm.daySchedules, null, 2)}
                    </pre>
                  </div>

                  <div className="md:col-span-2">
                    <PrimaryBtn onClick={saveAvailability} disabled={loading}>
                      <Save size={16} /> Save Availability
                    </PrimaryBtn>
                  </div>
                </div>
              </CardShell>
            )}

            {/* DOCUMENTS */}
            {active === "documents" && (
              <CardShell
                title={
                  <div className="flex items-center gap-2">
                    <span>Documents</span>
                    <span
                      className={cn(
                        "text-[11px] px-2 py-1 rounded-full border font-bold",
                        badgeTone("neutral")
                      )}
                    >
                      Total: {docsCounts.total}
                    </span>
                    {docsCounts.pending ? (
                      <span
                        className={cn(
                          "text-[11px] px-2 py-1 rounded-full border font-bold",
                          badgeTone("warn")
                        )}
                      >
                        Pending: {docsCounts.pending}
                      </span>
                    ) : null}
                  </div>
                }
                right={
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {!data ? (
                  <div className="text-sm text-slate-500">Loading…</div>
                ) : data.documents.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    No documents rows found.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.documents.map((d) => {
                      const busy = docBusyKey === d.key;
                      return (
                        <div
                          key={d.key}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-bold text-slate-900">
                                  {d.key}
                                </div>
                                <span
                                  className={cn(
                                    "text-[11px] px-2 py-1 rounded-full border font-bold",
                                    docTone(d.status)
                                  )}
                                >
                                  {d.status}
                                </span>
                                {d.lastUpdated ? (
                                  <span className="text-xs text-slate-500">
                                    Updated:{" "}
                                    {new Date(d.lastUpdated).toLocaleString()}
                                  </span>
                                ) : null}
                              </div>

                              {d.note ? (
                                <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">
                                  <span className="font-semibold">
                                    Admin note:
                                  </span>{" "}
                                  {d.note}
                                </div>
                              ) : null}

                              <div className="mt-2 flex items-center gap-2 flex-wrap">
                                {d.fileUrl ? (
                                  <a
                                    href={d.fileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm font-semibold underline"
                                    style={{ color: BRAND.navy }}
                                  >
                                    View File
                                  </a>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    No file uploaded
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => reviewDoc(d.key, "Verified")}
                                disabled={busy}
                                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                style={{ background: "#16a34a" }}
                              >
                                <CheckCircle2 size={16} />{" "}
                                {busy ? "..." : "Verify"}
                              </button>

                              <button
                                type="button"
                                onClick={() => reviewDoc(d.key, "Rejected")}
                                disabled={busy}
                                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                style={{ background: "#dc2626" }}
                              >
                                <XCircle size={16} />{" "}
                                {busy ? "..." : "Reject"}
                              </button>

                              <button
                                type="button"
                                onClick={() => reviewDoc(d.key, "Pending")}
                                disabled={busy}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold border disabled:opacity-60",
                                  "bg-white border-slate-200 hover:bg-slate-50 text-slate-800"
                                )}
                              >
                                <AlertTriangle size={16} />{" "}
                                {busy ? "..." : "Pending"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardShell>
            )}

            {/* WORK HISTORY */}
            {active === "work" && (
              <CardShell
                title="Work History"
                right={
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {!data ? (
                  <div className="text-sm text-slate-500">Loading…</div>
                ) : data.workHistory.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    No work history found.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.workHistory.map((w) => (
                      <div
                        key={w.id}
                        className="rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">
                            {w.role}{" "}
                            <span className="text-slate-500 font-semibold">
                              @ {w.org}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {w.from_year ?? "—"} – {w.to_year ?? "—"}
                            {w.location ? ` • ${w.location}` : ""}
                          </div>

                          {Array.isArray(w.highlights) && w.highlights.length ? (
                            <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
                              {w.highlights.map((h, idx) => (
                                <li key={idx}>{h}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardShell>
            )}

            {/* EDUCATION */}
            {active === "education" && (
              <CardShell
                title="Education"
                right={
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                {!data ? (
                  <div className="text-sm text-slate-500">Loading…</div>
                ) : data.education.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    No education records found.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.education.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <div className="font-bold text-slate-900">{e.degree}</div>
                        <div className="text-sm text-slate-700 mt-1">
                          {e.institute}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Year: {e.year ?? "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardShell>
            )}

            {/* VERIFICATION */}
            {active === "verification" && (
              <CardShell
                title="Verification"
                right={
                  <GhostBtn onClick={refresh} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                  </GhostBtn>
                }
              >
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs text-slate-500 font-semibold">
                      Current Status
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-[11px] px-2 py-1 rounded-full border font-bold",
                          verifiedBadge.tone
                        )}
                      >
                        {verifiedBadge.text}
                      </span>

                      {data?.profile?.readyForApproval === false ? (
                        <span
                          className={cn(
                            "text-[11px] px-2 py-1 rounded-full border font-bold",
                            badgeTone("warn")
                          )}
                        >
                          Not ready (docs missing)
                        </span>
                      ) : null}

                      {data?.profile?.verifiedAt ? (
                        <span className="text-xs text-slate-600">
                          Verified at:{" "}
                          <span className="font-semibold">
                            {new Date(data.profile.verifiedAt).toLocaleString()}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    {data?.profile?.verificationNote ? (
                      <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                        <span className="font-semibold">Note:</span>{" "}
                        {data.profile.verificationNote}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">
                        No verification note.
                      </div>
                    )}

                    {data?.profile?.missingRequiredDocs?.length ? (
                      <div className="mt-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-700">
                          Missing required docs:
                        </div>
                        <div className="mt-1">
                          {data.profile.missingRequiredDocs.join(", ")}
                        </div>
                      </div>
                    ) : null}

                    {data?.profile?.notVerifiedRequiredDocs?.length ? (
                      <div className="mt-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-700">
                          Required docs not verified:
                        </div>
                        <div className="mt-1">
                          {data.profile.notVerifiedRequiredDocs.join(", ")}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-xs text-slate-500 font-semibold">
                      Actions
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={approveAdvocate}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ background: "#16a34a" }}
                        title="Approve advocate (requires required docs Verified)"
                      >
                        <CheckCircle2 size={16} /> Approve Advocate
                      </button>

                      <button
                        type="button"
                        onClick={unapproveAdvocate}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ background: "#dc2626" }}
                      >
                        <XCircle size={16} /> Unapprove Advocate
                      </button>
                    </div>

                    <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-slate-400" />
                      Tip: Verify required documents first, then approve advocate.
                    </div>
                  </div>
                </div>
              </CardShell>
            )}
          </div>
        </div>
      </div>
      {dialogs}
    </div>
  );
}
