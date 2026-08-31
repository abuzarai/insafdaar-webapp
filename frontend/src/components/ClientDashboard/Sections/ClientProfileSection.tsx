import { formatStatus } from "../../common/formatStatus";
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../config";
import AuthedLink from "../../common/AuthedLink";
import UserAvatar from "../../common/UserAvatar";
import {
  BadgeCheck,
  ShieldCheck,
  Lock,
  Save,
  Camera,
  LayoutGrid,
  User,
  Phone,
  MapPin,
  CalendarDays,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type ProfileStatus = "INCOMPLETE" | "PENDING_VERIFICATION" | "VERIFIED";

type ClientProfile = {
  fullName: string;
  email: string;
  phone: string;
  cnic: string;
  city: string;
  address: string;
  location: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  identityDocStatus: ProfileStatus;
  addressProofStatus: ProfileStatus;
  documentsCompleted: boolean;
  avatarUrl: string;
  joined: string;
};

const CLIENT_BASE = `${API_BASE_URL}/api/client`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}` };
}

function StatusPill({ status }: { status: ProfileStatus }) {
  const styles = {
    VERIFIED: "bg-emerald-100 text-emerald-700 border-emerald-300",
    PENDING_VERIFICATION: "bg-amber-100 text-amber-700 border-amber-300",
    INCOMPLETE: "bg-slate-100 text-slate-700 border-slate-300",
  };

  const icons = {
    VERIFIED: BadgeCheck,
    PENDING_VERIFICATION: ShieldCheck,
    INCOMPLETE: Lock,
  };

  const labels = {
    VERIFIED: "Verified",
    PENDING_VERIFICATION: "Pending",
    INCOMPLETE: "Incomplete",
  };

  const Icon = icons[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${styles[status]}`}
    >
      <Icon size={14} />
      {labels[status]}
    </span>
  );
}

// Helpers
const normalizeDigits = (s: string) => s.replace(/\D/g, "");

const formatCnic = (digits13: string) =>
  `${digits13.slice(0, 5)}-${digits13.slice(5, 12)}-${digits13.slice(12)}`;

function validatePkPhone(phone: string) {
  let digits = normalizeDigits(phone);
  if (digits.startsWith("92") && digits.length === 12) {
    digits = "0" + digits.slice(2);
  } else if (digits.startsWith("0092") && digits.length === 13) {
    digits = "0" + digits.slice(4);
  }
  return digits.length === 11 && digits.startsWith("03");
}

function validatePkCnic(cnic: string) {
  const digits = normalizeDigits(cnic);
  return digits.length === 13;
}

type TabKey = "overview" | "personal" | "contact" | "emergency" | "verification";

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#004aad]/10 flex items-center justify-center text-[#004aad]">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  error,
  type = "text",
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  error?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-4 py-3 rounded-xl border transition-all duration-200
          ${
            disabled
              ? "bg-slate-50 text-slate-500 cursor-not-allowed"
              : "border-slate-200 focus:border-[#004aad] focus:ring-2 focus:ring-[#004aad]/20"
          }
          ${error ? "border-red-400 focus:border-red-500 focus:ring-red-200" : ""}
        `}
      />
      {error && (
        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <AlertCircle size={14} /> {error}
        </p>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-600">{k}</span>
      <span className="font-medium text-slate-900">{v || "—"}</span>
    </div>
  );
}

function BottomTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center py-2 px-1 transition-all ${
        active ? "text-[#004aad]" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      <div className={`p-2 rounded-xl ${active ? "bg-[#004aad]/10" : ""}`}>
        {icon}
      </div>
      <span className="text-xs font-medium mt-1">{label}</span>
    </button>
  );
}

export default function ClientProfileSection({
  onProfileUpdated,
}: {
  onProfileUpdated?: () => void;
}) {
  const [form, setForm] = useState<ClientProfile>({
    fullName: "",
    email: "",
    phone: "",
    cnic: "",
    city: "",
    address: "",
    location: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    identityDocStatus: "INCOMPLETE",
    addressProofStatus: "INCOMPLETE",
    documentsCompleted: false,
    avatarUrl: "",
    joined: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [docs, setDocs] = useState<any[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [tab, setTab] = useState<TabKey>("overview");
  const [viewMode, setViewMode] = useState(false);

  const completeness = useMemo(() => {
    const required = [
      form.fullName,
      form.phone,
      form.cnic,
      form.city,
      form.address,
      form.location,
      form.emergencyContactName,
      form.emergencyContactPhone,
    ];
    const filled = required.filter((x) => (x || "").trim().length > 0).length;
    return Math.round((filled / required.length) * 100);
  }, [form]);

  const canStartCase = completeness === 100 && form.documentsCompleted;

  // Validation errors (live feedback)
  const errors = {
    phone:
      form.phone && !validatePkPhone(form.phone)
        ? "Must be 11 digits starting with 03 (e.g., 03001234567)"
        : "",
    cnic:
      form.cnic && !validatePkCnic(form.cnic)
        ? "Must be 13 digits (e.g., 12345-1234567-1)"
        : "",
    emergencyPhone:
      form.emergencyContactPhone && !validatePkPhone(form.emergencyContactPhone)
        ? "Must be 11 digits starting with 03"
        : "",
  };

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${CLIENT_BASE}/`, { headers: authHeaders() });

      // supports {profile: ...} and {success:true, profile: ...}
      const profile = res.data?.profile ?? res.data?.data?.profile ?? null;

      if (!profile) {
        setMsg("Profile response missing 'profile'.");
        return;
      }

      setForm((p) => ({ ...p, ...profile }));
    } catch (err: any) {
      console.error("Profile load failed:", err);
      setMsg(
        err.response?.status === 404
          ? "Profile endpoint not found. Confirm backend mount: /api/client"
          : "Session expired. Please logout and login again."
      );
    } finally {
      setLoading(false);
    }
  };

  const loadDocs = async () => {
    try {
      const res = await axios.get(`${CLIENT_BASE}/documents`, {
        headers: authHeaders(),
      });
      setDocs(res.data?.documents || []);
    } catch (err) {
      console.error("Documents load failed:", err);
    }
  };

  // Which required docs are already uploaded? (drives chips + banner)
  const uploadedTypes = new Set((docs || []).map((d) => d.doc_type));
  const requiredDocTypes = ["CNIC_FRONT", "CNIC_BACK", "ADDRESS_PROOF"] as const;
  const missingDocs = requiredDocTypes.filter((t) => !uploadedTypes.has(t));
  const allDocsUploaded = missingDocs.length === 0;

  useEffect(() => {
    loadProfile();
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (k: keyof ClientProfile, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const saveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg("");

    if (!form.fullName.trim()) return setMsg("Full name is required.");
    if (errors.phone) return setMsg(errors.phone);
    if (errors.cnic) return setMsg(errors.cnic);
    if (errors.emergencyPhone) return setMsg(errors.emergencyPhone);

    setSaving(true);
    try {
      const cnicDigits = normalizeDigits(form.cnic);
      const payload = { ...form, cnic: formatCnic(cnicDigits) };

      await axios.put(
        `${CLIENT_BASE}/`,
        { profile: payload },
        { headers: authHeaders() }
      );

      setMsg("Profile updated successfully");
      await loadProfile();
      onProfileUpdated?.();
    } catch (e: any) {
      console.error("Save failed:", e);
      setMsg(
        e?.response?.data?.error || "Failed to save profile. Check console for details."
      );
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await axios.post(`${CLIENT_BASE}/avatar`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });

      setForm((p) => ({ ...p, avatarUrl: res.data?.avatarUrl || "" }));
      setMsg("Profile photo updated");
      onProfileUpdated?.();
    } catch (e: any) {
      setMsg("Avatar upload failed.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const uploadDoc = async (
    docType: "CNIC_FRONT" | "CNIC_BACK" | "ADDRESS_PROOF",
    file: File
  ) => {
    setUploading(docType);
    try {
      const fd = new FormData();
      fd.append("docType", docType);
      fd.append("file", file);

      const res = await axios.post(`${CLIENT_BASE}/documents`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });

      setMsg(`${docType.replace("_", " ")} uploaded`);
      await loadDocs();
      // ✅ Update ONLY the doc-gate flag from the upload response — do NOT
      // refetch+overwrite the form here (it wiped unsaved field edits and
      // looked like a page refresh). The sidebar gate refreshes via callback.
      const completed = res.data?.documentsCompleted;
      if (typeof completed === "boolean") {
        setForm((p) => ({ ...p, documentsCompleted: completed }));
      }
      onProfileUpdated?.();
    } catch (e: any) {
      setMsg("Upload failed.");
    } finally {
      setUploading(null);
    }
  };

  const avatarSrc = form.avatarUrl?.trim()
    ? `${API_BASE_URL}${form.avatarUrl}`
    : null;

  if (loading)
    return (
      <div className="p-8 text-center text-slate-500 animate-pulse">
        Loading profile...
      </div>
    );

  const renderMobileTabContent = () => {
    if (viewMode) {
      switch (tab) {
        case "overview":
          return (
            <div className="space-y-5">
              <Card title="Quick Summary" icon={<LayoutGrid size={18} />}>
                <KV k="Full Name" v={form.fullName} />
                <KV k="CNIC" v={form.cnic || "—"} />
                <KV k="City" v={form.city} />
                <KV k="Email" v={form.email} />
                <KV k="Phone" v={form.phone} />
              </Card>
              <Card title="Verification Status" icon={<ShieldCheck size={18} />}>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Identity Document</span>
                    <StatusPill status={form.identityDocStatus} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Address Proof</span>
                    <StatusPill status={form.addressProofStatus} />
                  </div>
                  <div className="pt-2 border-t">
                    <span className="text-sm font-medium">
                      Documents:{" "}
                      <span
                        className={
                          form.documentsCompleted
                            ? "text-emerald-600 font-semibold"
                            : "text-amber-600 font-semibold"
                        }
                      >
                        {form.documentsCompleted ? "Complete " : "Pending"}
                      </span>
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          );

        case "personal":
          return (
            <Card title="Personal Details" icon={<User size={18} />}>
              <KV k="Full Name" v={form.fullName} />
              <KV k="CNIC" v={form.cnic || "—"} />
              <KV k="City" v={form.city} />
              <KV k="Address" v={form.address} />
            </Card>
          );

        case "contact":
          return (
            <Card title="Contact Details" icon={<Phone size={18} />}>
              <KV k="Email" v={form.email} />
              <KV k="Phone" v={form.phone} />
              <KV k="Location" v={form.location} />
            </Card>
          );

        case "emergency":
          return (
            <Card title="Emergency Contact" icon={<MapPin size={18} />}>
              <KV k="Name" v={form.emergencyContactName} />
              <KV k="Phone" v={form.emergencyContactPhone} />
            </Card>
          );

        case "verification":
          return (
            <div className="space-y-5">
              <Card title="Verification Status" icon={<ShieldCheck size={18} />}>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Identity Document</span>
                    <StatusPill status={form.identityDocStatus} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Address Proof</span>
                    <StatusPill status={form.addressProofStatus} />
                  </div>
                </div>
              </Card>

              {docs.length > 0 && (
                <Card title="Uploaded Documents" icon={<FileText size={18} />}>
                  <ul className="space-y-3">
                    {docs.map((d) => (
                      <li
                        key={d.id}
                        className="flex justify-between items-center p-3 bg-slate-50 rounded-xl"
                      >
                        <div>
                          <div className="font-medium">
                            {String(d.doc_type || "").replace("_", " ")}
                          </div>
                          <div className="text-xs text-slate-500">{formatStatus(d.status)}</div>
                        </div>
                        <AuthedLink
                          url={d.file_url}
                          className="text-[#004aad] hover:underline font-medium"
                        >
                          View
                        </AuthedLink>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          );
      }
    }

    // Edit mode
    switch (tab) {
      case "overview":
        return (
          <Card title="Profile Overview" icon={<LayoutGrid size={18} />}>
            <p className="text-slate-600">
              Use the bottom tabs to edit different sections of your profile.
            </p>
          </Card>
        );

      case "personal":
        return (
          <Card title="Personal Information" icon={<User size={18} />}>
            <div className="space-y-4">
              <InputField
                label="Full Name *"
                value={form.fullName}
                onChange={(v) => onChange("fullName", v)}
                placeholder="Enter your full name"
              />
              <InputField
                label="CNIC *"
                value={form.cnic}
                onChange={(v) => onChange("cnic", v)}
                placeholder="12345-1234567-1"
                error={errors.cnic}
              />
              <InputField
                label="City *"
                value={form.city}
                onChange={(v) => onChange("city", v)}
                placeholder="e.g., Islamabad"
              />
              <InputField
                label="Address *"
                value={form.address}
                onChange={(v) => onChange("address", v)}
                placeholder="House #, Street, Area"
              />
            </div>
          </Card>
        );

      case "contact":
        return (
          <Card title="Contact Information" icon={<Phone size={18} />}>
            <div className="space-y-4">
              <InputField label="Email" value={form.email} placeholder="Your email" disabled />
              <InputField
                label="Phone Number *"
                value={form.phone}
                onChange={(v) => onChange("phone", v)}
                placeholder="03001234567"
                error={errors.phone}
              />
              <InputField
                label="Location / Landmark *"
                value={form.location}
                onChange={(v) => onChange("location", v)}
                placeholder="e.g., F-11 Markaz, Islamabad"
              />
            </div>
          </Card>
        );

      case "emergency":
        return (
          <Card title="Emergency Contact" icon={<MapPin size={18} />}>
            <div className="space-y-4">
              <InputField
                label="Emergency Contact Name *"
                value={form.emergencyContactName}
                onChange={(v) => onChange("emergencyContactName", v)}
                placeholder="Name"
              />
              <InputField
                label="Emergency Phone Number *"
                value={form.emergencyContactPhone}
                onChange={(v) => onChange("emergencyContactPhone", v)}
                placeholder="03001234567"
                error={errors.emergencyPhone}
              />
            </div>
          </Card>
        );

      case "verification":
        return (
          <Card title="Verification & Documents" icon={<ShieldCheck size={18} />}>
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl">
                  <div className="text-sm font-medium mb-2">Identity Document</div>
                  <StatusPill status={form.identityDocStatus} />
                </div>
                <div className="p-4 bg-slate-50 rounded-xl">
                  <div className="text-sm font-medium mb-2">Address Proof</div>
                  <StatusPill status={form.addressProofStatus} />
                </div>
              </div>

              <div className="p-5 bg-gradient-to-br from-slate-50 to-white rounded-2xl border border-slate-200">
                <h4 className="font-medium mb-3">Upload Required Documents</h4>
                {allDocsUploaded ? (
                  <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
                    ✓ All required documents uploaded — you can start a case.
                  </p>
                ) : (
                  <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                    Still missing: {missingDocs.map((m) => m.replace("_", " ")).join(", ")} —
                    required before you can start a case.
                  </p>
                )}
                <div className="grid gap-3">
                  {requiredDocTypes.map((t) => {
                    const uploaded = uploadedTypes.has(t);
                    return (
                      <label
                        key={t}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer hover:bg-slate-50
                          ${uploading === t ? "opacity-60 bg-slate-100" : ""}
                          ${uploaded ? "border-emerald-300 bg-emerald-50/40" : "border-red-200 bg-red-50/30"}`}
                      >
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {t.replace("_", " ")}
                            {uploaded ? (
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                ✓ Uploaded
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                                Missing
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {uploaded ? "Tap Replace to change the file" : "PNG, JPG, PDF"}
                          </div>
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          accept=".png,.jpg,.jpeg,.pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadDoc(t, f);
                          }}
                        />
                        <div className="text-[#004aad] font-medium">
                          {uploading === t ? "Uploading..." : uploaded ? "Replace" : "Upload"}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-4">
                  Documents are manually verified by admin before you can start a case.
                </p>
              </div>
            </div>
          </Card>
        );
    }
  };

  return (
    <section className="w-full min-h-screen bg-slate-50">
      {/* Mobile View */}
      <div className="md:hidden">
        <div className="p-5 pb-32">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#004aad]">My Profile</h1>
              <p className="text-sm text-slate-600 mt-1">
                Complete your profile to start filing cases.
              </p>
            </div>
            <button
              onClick={() => setViewMode(!viewMode)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                viewMode
                  ? "bg-[#004aad] text-white shadow-md"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {viewMode ? "Edit Mode" : "View Mode"}
            </button>
          </div>

          {/* Profile Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt="Profile"
                    className="w-20 h-20 rounded-full border-4 border-[#004aad]/20 object-cover"
                  />
                ) : (
                  <UserAvatar
                    name={form.fullName}
                    role="client"
                    size={80}
                    className="border-4 border-[#004aad]/20"
                  />
                )}
                {!viewMode && (
                  <label className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-white border-2 border-[#004aad] flex items-center justify-center cursor-pointer hover:bg-[#004aad]/10 transition">
                    <Camera size={16} className="text-[#004aad]" />
                    <input
                      type="file"
                      className="hidden"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={(e) =>
                        e.target.files?.[0] && uploadAvatar(e.target.files[0])
                      }
                    />
                  </label>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-slate-900 truncate">
                  {form.fullName || "Your Name"}
                </h2>
                <p className="text-sm text-slate-600">Registered Client</p>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-1.5">
                  <CalendarDays size={14} />
                  Joined: {form.joined || "—"}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">Profile Completeness</span>
                <span className="font-medium text-[#004aad]">{completeness}%</span>
              </div>
              <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="absolute h-full bg-gradient-to-r from-[#004aad] to-[#003b82] rounded-full transition-all duration-500"
                  style={{ width: `${completeness}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-center">
                {canStartCase ? (
                  <span className="text-emerald-600 font-medium flex items-center justify-center gap-1">
                    <CheckCircle2 size={14} /> Ready to Start Case
                  </span>
                ) : (
                  <span className="text-amber-600">
                    Complete profile & documents to start case
                  </span>
                )}
              </div>
            </div>

            {msg && (
              <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700">
                {msg}
              </div>
            )}
          </div>

          {/* Content */}
          {!viewMode ? (
            <form onSubmit={saveProfile} className="space-y-6">
              {renderMobileTabContent()}
              <button
                type="submit"
                disabled={saving || completeness !== 100}
                className={`w-full py-3.5 rounded-2xl font-semibold transition flex items-center justify-center gap-2
                  ${
                    saving || completeness !== 100
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : "bg-[#004aad] text-white hover:bg-[#003b82] shadow-md"
                  }`}
              >
                <Save size={18} />
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </form>
          ) : (
            renderMobileTabContent()
          )}
        </div>

        {/* Bottom Navigation */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-50">
          <div className="flex items-center justify-around py-2 px-4">
            <BottomTab
              active={tab === "overview"}
              onClick={() => setTab("overview")}
              icon={<LayoutGrid size={20} />}
              label="Overview"
            />
            <BottomTab
              active={tab === "personal"}
              onClick={() => setTab("personal")}
              icon={<User size={20} />}
              label="Personal"
            />
            <BottomTab
              active={tab === "contact"}
              onClick={() => setTab("contact")}
              icon={<Phone size={20} />}
              label="Contact"
            />
            <BottomTab
              active={tab === "emergency"}
              onClick={() => setTab("emergency")}
              icon={<MapPin size={20} />}
              label="Emergency"
            />
            <BottomTab
              active={tab === "verification"}
              onClick={() => setTab("verification")}
              icon={<ShieldCheck size={20} />}
              label="Verify"
            />
          </div>
        </div>
      </div>

      {/* Desktop View */}
      <div className="hidden md:block max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-[#004aad]">My Profile</h1>
            <p className="text-slate-600 mt-2">
              Keep your profile complete to start filing legal cases seamlessly.
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Profile Completeness</div>
            <div className="text-2xl font-bold text-[#004aad]">{completeness}%</div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Left Column - Avatar & Status */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center sticky top-6">
              <div className="relative inline-block">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt="Profile"
                    className="w-32 h-32 rounded-full border-4 border-[#004aad]/20 object-cover mx-auto"
                  />
                ) : (
                  <UserAvatar
                    name={form.fullName}
                    role="client"
                    size={128}
                    className="border-4 border-[#004aad]/20 mx-auto"
                  />
                )}
                <label className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-white border-2 border-[#004aad] flex items-center justify-center cursor-pointer hover:bg-[#004aad]/10 transition shadow-sm">
                  <Camera size={18} className="text-[#004aad]" />
                  <input
                    type="file"
                    className="hidden"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={(e) =>
                      e.target.files?.[0] && uploadAvatar(e.target.files[0])
                    }
                  />
                </label>
              </div>

              <h2 className="mt-4 text-xl font-bold text-slate-900">
                {form.fullName || "Your Name"}
              </h2>
              <p className="text-sm text-slate-600 mt-1">Registered Client</p>

              <div className="mt-6">
                <div className="text-sm text-slate-500 mb-2">Joined</div>
                <div className="flex items-center justify-center gap-2 text-slate-700">
                  <CalendarDays size={16} />
                  {form.joined || "—"}
                </div>
              </div>

              <div className="mt-8">
                <div className="text-sm text-slate-500 mb-2">Profile Completeness</div>
                <div className="relative h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="absolute h-full bg-gradient-to-r from-[#004aad] to-[#003b82] rounded-full transition-all duration-500"
                    style={{ width: `${completeness}%` }}
                  />
                </div>
                <div className="mt-3 text-sm font-medium">
                  {canStartCase ? (
                    <span className="text-emerald-600 flex items-center justify-center gap-1">
                      <CheckCircle2 size={16} /> Ready to Start Case
                    </span>
                  ) : (
                    <span className="text-amber-600">Complete to start cases</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Forms & Uploads */}
          <div className="md:col-span-2 space-y-6">
            {/* Personal & Contact */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card title="Personal Information" icon={<User size={18} />}>
                <div className="space-y-4">
                  <InputField
                    label="Full Name *"
                    value={form.fullName}
                    onChange={(v) => onChange("fullName", v)}
                    placeholder="Your full name"
                  />
                  <InputField
                    label="CNIC *"
                    value={form.cnic}
                    onChange={(v) => onChange("cnic", v)}
                    placeholder="12345-1234567-1"
                    error={errors.cnic}
                  />
                  <InputField
                    label="City *"
                    value={form.city}
                    onChange={(v) => onChange("city", v)}
                    placeholder="e.g., Islamabad"
                  />
                  <InputField
                    label="Address *"
                    value={form.address}
                    onChange={(v) => onChange("address", v)}
                    placeholder="Full address"
                  />
                </div>
              </Card>

              <Card title="Contact Information" icon={<Phone size={18} />}>
                <div className="space-y-4">
                  <InputField label="Email" value={form.email} placeholder="Your email" disabled />
                  <InputField
                    label="Phone Number *"
                    value={form.phone}
                    onChange={(v) => onChange("phone", v)}
                    placeholder="03001234567"
                    error={errors.phone}
                  />
                  <InputField
                    label="Location / Landmark *"
                    value={form.location}
                    onChange={(v) => onChange("location", v)}
                    placeholder="Area, landmark, or Google pin"
                  />
                </div>
              </Card>
            </div>

            {/* Emergency & Verification */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card title="Emergency Contact" icon={<MapPin size={18} />}>
                <div className="space-y-4">
                  <InputField
                    label="Emergency Contact Name *"
                    value={form.emergencyContactName}
                    onChange={(v) => onChange("emergencyContactName", v)}
                    placeholder="Name"
                  />
                  <InputField
                    label="Emergency Phone Number *"
                    value={form.emergencyContactPhone}
                    onChange={(v) => onChange("emergencyContactPhone", v)}
                    placeholder="03001234567"
                    error={errors.emergencyPhone}
                  />
                </div>
              </Card>

              <Card title="Verification & Documents" icon={<ShieldCheck size={18} />}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="text-sm font-medium mb-2">Identity Document</div>
                      <StatusPill status={form.identityDocStatus} />
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="text-sm font-medium mb-2">Address Proof</div>
                      <StatusPill status={form.addressProofStatus} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-3">Upload Documents</h4>
                    {!allDocsUploaded && (
                      <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                        Still missing: {missingDocs.map((m) => m.replace("_", " ")).join(", ")}
                      </p>
                    )}
                    <div className="grid gap-3">
                      {requiredDocTypes.map((t) => {
                        const uploaded = uploadedTypes.has(t);
                        return (
                          <label
                            key={t}
                            className={`p-4 rounded-xl border transition-all cursor-pointer hover:border-[#004aad]/50 hover:bg-[#004aad]/5
                              ${uploading === t ? "opacity-60 bg-slate-100" : ""}
                              ${uploaded ? "border-emerald-300 bg-emerald-50/40" : "border-red-200 bg-red-50/30"}`}
                          >
                            <div className="font-medium flex items-center gap-2">
                              {t.replace("_", " ")}
                              {uploaded ? (
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                  ✓ Uploaded
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                                  Missing
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {uploaded ? "Tap to replace the file" : "PNG, JPG, PDF"}
                            </div>
                            <input
                              type="file"
                              className="hidden"
                              accept=".png,.jpg,.jpeg,.pdf"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadDoc(t, f);
                              }}
                            />
                            <div className="mt-2 text-xs text-[#004aad] font-medium">
                              {uploading === t ? "Uploading..." : uploaded ? "Replace" : "Click to upload"}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Uploaded Files & Save */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Uploaded Documents</h3>
              {docs.length === 0 ? (
                <p className="text-slate-500 text-center py-6">No documents uploaded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex justify-between items-center p-4 bg-slate-50 rounded-xl"
                    >
                      <div>
                        <div className="font-medium">
                          {String(d.doc_type || "").replace("_", " ")}
                        </div>
                        <div className="text-xs text-slate-500">{formatStatus(d.status)}</div>
                      </div>
                      <AuthedLink
                        url={d.file_url}
                        className="px-4 py-2 bg-[#004aad]/10 text-[#004aad] rounded-lg hover:bg-[#004aad]/20 transition"
                      >
                        View
                      </AuthedLink>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  onClick={saveProfile}
                  disabled={saving || completeness !== 100}
                  className={`px-8 py-3 rounded-xl font-semibold flex items-center gap-2 transition
                    ${
                      saving || completeness !== 100
                        ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-[#004aad] text-white hover:bg-[#003b82] shadow-md"
                    }`}
                >
                  <Save size={18} />
                  {saving ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
