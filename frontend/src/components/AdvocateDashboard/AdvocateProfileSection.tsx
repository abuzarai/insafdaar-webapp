// AdvocateProfileSection.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { API_BASE_URL } from "../../config";
import UserAvatar from "../common/UserAvatar";

import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  FileText,
  Globe,
  Gavel,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
  Upload,
  UserRound,
  X,
  Plus,
  Trash2,
  Save,
  Timer,
  Users,
  Video,
  Building,
  Loader2,
  Pencil,
  Check,
} from "lucide-react";

type VerificationStatus = "Not Uploaded" | "Pending" | "Verified" | "Rejected";
type DocumentKey = "cnicFront" | "cnicBack" | "barLicense" | "degree" | "experienceLetter";

type DocumentItem = {
  key: DocumentKey;
  label: string;
  hint: string;
  status: VerificationStatus;
  lastUpdated?: string;
  note?: string | null;
  fileUrl?: string | null;
};

type WorkItem = {
  id: number;
  org: string;
  role: string;
  from_year: string | number | null;
  to_year: string | number | null;
  location: string | null;
  highlights: string[]; // backend stores text[]
};

type EducationItem = {
  id: number;
  degree: string;
  institute: string;
  year: string | number | null;
};

type SlotMode = "Online" | "Court" | "Hybrid";
type SlotType = "Client Meeting" | "Court Appearance" | "Office Visit";
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

type DaySchedule = {
  enabled: boolean;
  windows: { from: string; to: string }[];
};

type AvailabilitySettings = {
  mode: SlotMode;
  slotMinutes: 30 | 45 | 60;
  bufferMinutes: 0 | 5 | 10 | 15;
  maxBookingsPerDay: number;
  meetingLink?: string | null;
  defaultLocation?: string | null;
  daySchedules: Record<DayKey, DaySchedule>;
  appointmentTypes: Record<SlotType, boolean>;
  notesToClients: string;
};

type AdvocateProfile = {
  name: string;
  headline: string;
  experienceYears: number;
  email: string;
  phone: string;
  barCouncilId: string;
  city: string;
  court: string;
  languages: string[];
  practiceAreas: string[];
  bio: string;
  avatarUrl?: string | null;

  rating?: { avg: number; reviews: number };
  stats?: { totalCases: number; ongoing: number; successRate: string; aiInsights: number };
};

// ---- helpers ----
function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function Badge({
  variant,
  children,
}: {
  variant: "blue" | "amber" | "green" | "gray" | "red";
  children: React.ReactNode;
}) {
  const styles =
    variant === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : variant === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : variant === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : variant === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${styles}`}>
      {children}
    </span>
  );
}

function statusBadge(status: VerificationStatus) {
  if (status === "Verified")
    return (
      <Badge variant="green">
        <ShieldCheck size={14} /> Verified
      </Badge>
    );
  if (status === "Pending")
    return (
      <Badge variant="amber">
        <CalendarDays size={14} /> Pending Review
      </Badge>
    );
  if (status === "Rejected")
    return (
      <Badge variant="red">
        <X size={14} /> Rejected
      </Badge>
    );
  return (
    <Badge variant="gray">
      <Upload size={14} /> Not Uploaded
    </Badge>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent = "text-[#004aad]",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-slate-500 text-sm">{label}</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-1 ${accent}`}>{value}</p>
        </div>
        <div className="h-11 w-11 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
          {icon}
        </div>
      </div>
    </div>
  );
}

const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(d: DayKey) {
  return (
    {
      Mon: "Monday",
      Tue: "Tuesday",
      Wed: "Wednesday",
      Thu: "Thursday",
      Fri: "Friday",
      Sat: "Saturday",
      Sun: "Sunday",
    }[d] ?? d
  );
}

function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toFrontendDate(d: any) {
  if (!d) return undefined;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toLocaleDateString("en-GB");
}

function normalizeDocStatus(x: any): VerificationStatus {
  const s = String(x || "").toUpperCase();
  if (s === "VERIFIED") return "Verified";
  if (s === "PENDING") return "Pending";
  if (s === "REJECTED") return "Rejected";
  return "Not Uploaded";
}

function parseCsvTags(s: string): string[] {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toCsv(list: string[] | undefined | null) {
  return (list || []).join(", ");
}

// ---- defaults used as fallback / merge ----
const DEFAULT_DOCS: DocumentItem[] = [
  { key: "cnicFront", label: "CNIC (Front)", hint: "Clear photo/scan • JPG/PNG/PDF", status: "Not Uploaded" },
  { key: "cnicBack", label: "CNIC (Back)", hint: "Clear photo/scan • JPG/PNG/PDF", status: "Not Uploaded" },
  { key: "barLicense", label: "Bar Council License", hint: "License / Card / Certificate • PDF preferred", status: "Not Uploaded" },
  { key: "degree", label: "Law Degree", hint: "LLB/Equivalent • PDF preferred", status: "Not Uploaded" },
  {
    key: "experienceLetter",
    label: "Experience Letter (Optional)",
    hint: "Any proof of experience • PDF/JPG",
    status: "Not Uploaded",
    note: "This improves trust score for clients.",
  },
];

const DEFAULT_AVAILABILITY: AvailabilitySettings = {
  mode: "Hybrid",
  slotMinutes: 30,
  bufferMinutes: 10,
  maxBookingsPerDay: 8,
  meetingLink: "",
  defaultLocation: "",
  appointmentTypes: {
    "Client Meeting": true,
    "Court Appearance": true,
    "Office Visit": false,
  },
  notesToClients: "",
  daySchedules: {
    Mon: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Tue: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Wed: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Thu: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Fri: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Sat: { enabled: true, windows: [{ from: "16:00", to: "21:00" }] },
    Sun: { enabled: false, windows: [{ from: "16:00", to: "21:00" }] },
  },
};

export default function AdvocateProfileSection() {
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState<AdvocateProfile | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [edit, setEdit] = useState<{
    name: string;
    headline: string;
    experienceYears: number;
    phone: string;
    barCouncilId: string;
    city: string;
    court: string;
    languagesCsv: string;
    practiceAreasCsv: string;
    bio: string;
  }>({
    name: "",
    headline: "",
    experienceYears: 0,
    phone: "",
    barCouncilId: "",
    city: "",
    court: "",
    languagesCsv: "",
    practiceAreasCsv: "",
    bio: "",
  });

  const [savingAvailability, setSavingAvailability] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<DocumentKey | null>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>(DEFAULT_DOCS);
  const [availability, setAvailability] = useState<AvailabilitySettings>(DEFAULT_AVAILABILITY);

  const [workHistory, setWorkHistory] = useState<WorkItem[]>([]);
  const [education, setEducation] = useState<EducationItem[]>([]);

  // ---------------- API calls (Step-2B aligned) ----------------
  const fetchFullProfile = async () => {
    const res = await axios.get(`${API_BASE_URL}/api/advocate/dashboard/profile`, { headers: authHeaders() });
    return res.data as {
      profile: AdvocateProfile;
      availability: AvailabilitySettings;
      documents: Array<{ key: DocumentKey; status: any; lastUpdated: any; note?: any; fileUrl?: any }>;
      workHistory: WorkItem[];
      education: EducationItem[];
    };
  };

  const patchProfileApi = async (payload: Partial<AdvocateProfile>) => {
    // ✅ backend expects camelCase keys at root (NOT snake_case)
    const res = await axios.patch(
      `${API_BASE_URL}/api/advocate/dashboard/profile`,
      {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        headline: payload.headline,
        experienceYears: payload.experienceYears,
        barCouncilId: payload.barCouncilId,
        city: payload.city,
        court: payload.court,
        languages: payload.languages,
        practiceAreas: payload.practiceAreas,
        bio: payload.bio,
        avatarUrl: payload.avatarUrl,
      },
      { headers: authHeaders() }
    );
    return res.data?.profile as AdvocateProfile;
  };

  const uploadDocumentApi = async (docKey: DocumentKey, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await axios.post(`${API_BASE_URL}/api/advocate/dashboard/profile/documents/${docKey}/upload`, fd, {
      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    });
    return res.data;
  };

  const saveAvailabilityApi = async (payload: AvailabilitySettings) => {
    const res = await axios.put(`${API_BASE_URL}/api/advocate/dashboard/profile/availability`, payload, {
      headers: authHeaders(),
    });
    return res.data?.availability as AvailabilitySettings;
  };

  // ---------------- load data ----------------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setMsg("");

        const data = await fetchFullProfile();

        const p = data.profile ?? null;
        const a = data.availability ?? DEFAULT_AVAILABILITY;
        const docsFromApi = Array.isArray(data.documents) ? data.documents : [];

        setProfile(p);
        setAvailability(a);
        setWorkHistory(Array.isArray(data.workHistory) ? data.workHistory : []);
        setEducation(Array.isArray(data.education) ? data.education : []);

        if (p) {
          setEdit({
            name: p.name ?? "",
            headline: p.headline ?? "",
            experienceYears: Number(p.experienceYears ?? 0),
            phone: p.phone ?? "",
            barCouncilId: p.barCouncilId ?? "",
            city: p.city ?? "",
            court: p.court ?? "",
            languagesCsv: toCsv(p.languages),
            practiceAreasCsv: toCsv(p.practiceAreas),
            bio: p.bio ?? "",
          });
        }

        const merged: DocumentItem[] = DEFAULT_DOCS.map((d) => {
          const hit = docsFromApi.find((x) => x.key === d.key);
          if (!hit) return d;

          return {
            ...d,
            status: normalizeDocStatus(hit.status),
            lastUpdated: toFrontendDate(hit.lastUpdated),
            fileUrl: hit.fileUrl ?? null,
            note: hit.note ?? d.note ?? null,
          };
        });

        setDocuments(merged);
      } catch (e: any) {
        setMsg(e?.response?.data?.error || "Failed to load advocate profile. Please logout/login and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ---------------- profile edit helpers ----------------
  const toggleEdit = () => {
    if (!profile) return;
    if (!editMode) {
      setEdit({
        name: profile.name ?? "",
        headline: profile.headline ?? "",
        experienceYears: Number(profile.experienceYears ?? 0),
        phone: profile.phone ?? "",
        barCouncilId: profile.barCouncilId ?? "",
        city: profile.city ?? "",
        court: profile.court ?? "",
        languagesCsv: toCsv(profile.languages),
        practiceAreasCsv: toCsv(profile.practiceAreas),
        bio: profile.bio ?? "",
      });
    }
    setEditMode((p) => !p);
  };

  const saveProfile = async () => {
    try {
      setSavingProfile(true);
      setMsg("");

      if (!edit.name.trim()) return setMsg("Name is required.");
      if (!edit.city.trim()) return setMsg("City is required.");
      if (!edit.court.trim()) return setMsg("Court is required.");

      const payload: Partial<AdvocateProfile> = {
        name: edit.name.trim(),
        headline: edit.headline.trim(),
        experienceYears: clampInt(Number(edit.experienceYears), 0, 60),
        phone: edit.phone.trim(),
        barCouncilId: edit.barCouncilId.trim(),
        city: edit.city.trim(),
        court: edit.court.trim(),
        languages: parseCsvTags(edit.languagesCsv),
        practiceAreas: parseCsvTags(edit.practiceAreasCsv),
        bio: edit.bio.trim(),
      };

      const updated = await patchProfileApi(payload);
      setProfile(updated);
      setEditMode(false);
      setMsg("Profile updated.");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ---------------- availability helpers ----------------
  const addWindow = (day: DayKey) => {
    setAvailability((p) => {
      const dayObj = p.daySchedules[day];
      const windows = [...dayObj.windows, { from: "16:00", to: "18:00" }];
      return { ...p, daySchedules: { ...p.daySchedules, [day]: { ...dayObj, windows } } };
    });
  };

  const removeWindow = (day: DayKey, idx: number) => {
    setAvailability((p) => {
      const dayObj = p.daySchedules[day];
      const windows = dayObj.windows.filter((_, i) => i !== idx);
      return {
        ...p,
        daySchedules: {
          ...p.daySchedules,
          [day]: { ...dayObj, windows: windows.length ? windows : [{ from: "16:00", to: "18:00" }] },
        },
      };
    });
  };

  const updateWindow = (day: DayKey, idx: number, key: "from" | "to", value: string) => {
    setAvailability((p) => {
      const dayObj = p.daySchedules[day];
      const windows = dayObj.windows.map((w, i) => (i === idx ? { ...w, [key]: value } : w));
      return { ...p, daySchedules: { ...p.daySchedules, [day]: { ...dayObj, windows } } };
    });
  };

  const saveAvailability = async () => {
    try {
      setSavingAvailability(true);
      setMsg("");
      const updated = await saveAvailabilityApi(availability);
      setAvailability(updated);
      setMsg("Availability saved.");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Failed to save availability.");
    } finally {
      setSavingAvailability(false);
    }
  };

  // ---------------- document upload handler ----------------
  const refreshDocumentsFromFullProfile = async () => {
    const data = await fetchFullProfile();
    const docsFromApi = Array.isArray(data.documents) ? data.documents : [];
    const merged: DocumentItem[] = DEFAULT_DOCS.map((d) => {
      const hit = docsFromApi.find((x) => x.key === d.key);
      if (!hit) return d;
      return {
        ...d,
        status: normalizeDocStatus(hit.status),
        lastUpdated: toFrontendDate(hit.lastUpdated),
        fileUrl: hit.fileUrl ?? null,
        note: hit.note ?? d.note ?? null,
      };
    });
    setDocuments(merged);
  };

  const handleUpload = async (docKey: DocumentKey, file: File) => {
    try {
      setUploadingKey(docKey);
      setMsg("");

      await uploadDocumentApi(docKey, file);

      await refreshDocumentsFromFullProfile();
      setMsg("Document uploaded. Pending admin review.");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Upload failed. Please try again.");
    } finally {
      setUploadingKey(null);
    }
  };

  // ---------------- UI computed ----------------
  const uiProfile = useMemo(() => {
    return (
      profile ?? {
        name: "—",
        headline: "—",
        experienceYears: 0,
        email: "—",
        phone: "—",
        barCouncilId: "—",
        city: "—",
        court: "—",
        languages: [],
        practiceAreas: [],
        bio: "—",
        avatarUrl: null,
        rating: { avg: 0, reviews: 0 },
        stats: { totalCases: 0, ongoing: 0, successRate: "—", aiInsights: 0 },
      }
    );
  }, [profile]);

  const avatarSrc =
    uiProfile.avatarUrl && uiProfile.avatarUrl.startsWith("http")
      ? uiProfile.avatarUrl
      : uiProfile.avatarUrl
      ? `${API_BASE_URL}${uiProfile.avatarUrl}`
      : null;

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post(
        `${API_BASE_URL}/api/advocate/dashboard/profile/avatar`,
        fd,
        { headers: { ...authHeaders(), "Content-Type": "multipart/form-data" } }
      );
      const avatarUrl = res.data?.avatarUrl as string | undefined;
      if (avatarUrl) {
        setProfile((prev) => (prev ? { ...prev, avatarUrl } : prev));
        setMsg("Photo updated.");
      }
    } catch (err: any) {
      setMsg(err?.response?.data?.error || "Failed to upload photo.");
    }
  };

  return (
    <section className="space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Advocate Profile</h1>
          <p className="text-sm text-slate-600 mt-2">
            Keep your profile complete — it improves client trust and helps admins verify credentials faster.
          </p>
          {msg && <div className="mt-2 text-sm text-amber-700">{msg}</div>}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="blue">
            <BadgeCheck size={14} /> Public Profile Enabled
          </Badge>

          <button
            type="button"
            onClick={toggleEdit}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm border transition
              ${editMode ? "bg-white border-slate-200 hover:bg-slate-50" : "bg-[#004aad] text-white border-[#004aad] hover:bg-[#003b82]"}`}
          >
            {editMode ? <X size={16} /> : <Pencil size={16} />}
            {editMode ? "Cancel Edit" : "Edit Profile"}
          </button>

          {editMode && (
            <button
              type="button"
              onClick={saveProfile}
              disabled={savingProfile}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition text-sm disabled:opacity-60"
            >
              {savingProfile ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              Save Profile
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-2 text-slate-700">
          <Loader2 className="animate-spin" size={16} />
          Loading profile…
        </div>
      )}

      {/* Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-6">
          {/* Avatar */}
          <div className="flex-shrink-0 flex flex-col items-center md:items-start">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt="Advocate"
                className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl border border-slate-200 shadow-md object-cover"
              />
            ) : (
              <UserAvatar
                name={uiProfile.name}
                role="advocate"
                size={144}
                className="rounded-2xl shadow-md"
              />
            )}

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white font-semibold hover:bg-[#003b82] transition text-sm"
              onClick={() => avatarInputRef.current?.click()}
            >
              <Upload size={16} />
              Update Photo
            </button>

            <div className="mt-4 flex items-center gap-2">
              <Badge variant="green">
                <Star size={14} /> {uiProfile.rating?.avg ?? 0} / 5
              </Badge>
              <span className="text-xs text-slate-500">{uiProfile.rating?.reviews ?? 0} reviews</span>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="w-full">
                {!editMode ? (
                  <>
                    <h2 className="text-2xl font-bold text-[#00142e]">{uiProfile.name}</h2>
                    <p className="text-slate-600 mt-1">{uiProfile.headline}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Practicing Advocate • {uiProfile.experienceYears}+ Years Experience
                    </p>
                  </>
                ) : (
                  <div className="grid md:grid-cols-2 gap-3">
                    <input
                      className="border rounded-xl p-3"
                      placeholder="Full Name *"
                      value={edit.name}
                      onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3"
                      placeholder="Headline (e.g., Civil & Family Law)"
                      value={edit.headline}
                      onChange={(e) => setEdit((p) => ({ ...p, headline: e.target.value }))}
                    />
                    <input
                      type="number"
                      className="border rounded-xl p-3"
                      placeholder="Experience Years"
                      value={edit.experienceYears}
                      min={0}
                      max={60}
                      onChange={(e) =>
                        setEdit((p) => ({ ...p, experienceYears: clampInt(Number(e.target.value), 0, 60) }))
                      }
                    />
                    <input
                      className="border rounded-xl p-3"
                      placeholder="Phone"
                      value={edit.phone}
                      onChange={(e) => setEdit((p) => ({ ...p, phone: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3"
                      placeholder="Bar Council ID"
                      value={edit.barCouncilId}
                      onChange={(e) => setEdit((p) => ({ ...p, barCouncilId: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3"
                      placeholder="City *"
                      value={edit.city}
                      onChange={(e) => setEdit((p) => ({ ...p, city: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3"
                      placeholder="Court *"
                      value={edit.court}
                      onChange={(e) => setEdit((p) => ({ ...p, court: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3 md:col-span-2"
                      placeholder="Languages (comma separated) e.g., Urdu, English"
                      value={edit.languagesCsv}
                      onChange={(e) => setEdit((p) => ({ ...p, languagesCsv: e.target.value }))}
                    />
                    <input
                      className="border rounded-xl p-3 md:col-span-2"
                      placeholder="Practice Areas (comma separated) e.g., Family, Civil, Criminal"
                      value={edit.practiceAreasCsv}
                      onChange={(e) => setEdit((p) => ({ ...p, practiceAreasCsv: e.target.value }))}
                    />
                    <textarea
                      className="border rounded-xl p-3 md:col-span-2 min-h-[110px]"
                      placeholder="Bio"
                      value={edit.bio}
                      onChange={(e) => setEdit((p) => ({ ...p, bio: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <Badge variant="blue">
                  <Briefcase size={14} /> {availability.mode}
                </Badge>
                <Badge variant="gray">
                  <CalendarDays size={14} /> Mon–Sun • Based on schedule
                </Badge>
                <Badge variant="amber">
                  <Clock size={14} /> Response time: —
                </Badge>
              </div>
            </div>

            {/* Contact + IDs */}
            <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Mail size={16} className="text-[#004aad]" /> Email
                </div>
                <p className="mt-1 text-slate-700">{uiProfile.email}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Phone size={16} className="text-[#004aad]" /> Phone
                </div>
                <p className="mt-1 text-slate-700">{uiProfile.phone}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <IdCard size={16} className="text-[#004aad]" /> Bar Council ID
                </div>
                <p className="mt-1 text-slate-700">{uiProfile.barCouncilId}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <MapPin size={16} className="text-[#004aad]" /> Location / Courts
                </div>
                <p className="mt-1 text-slate-700">
                  {uiProfile.city} • {uiProfile.court}
                </p>
              </div>
            </div>

            {/* Practice Areas + Languages */}
            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Gavel size={16} className="text-[#004aad]" /> Practice Areas
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(uiProfile.practiceAreas || []).length ? (
                    (uiProfile.practiceAreas || []).map((a) => (
                      <span
                        key={a}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs border border-slate-200 bg-slate-50 text-slate-700"
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Globe size={16} className="text-[#004aad]" /> Languages
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(uiProfile.languages || []).length ? (
                    (uiProfile.languages || []).map((l) => (
                      <span
                        key={l}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs border border-slate-200 bg-slate-50 text-slate-700"
                      >
                        {l}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* Bio */}
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <UserRound size={16} className="text-[#004aad]" /> About
              </div>
              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{uiProfile.bio}</p>
            </div>

            {/* Buttons */}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
                onClick={() => alert("Later: open public profile preview modal/page")}
              >
                <FileText size={16} className="text-[#004aad]" />
                View Public Profile (Client/Admin)
              </button>

              {!editMode && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white hover:bg-[#003b82] transition font-semibold text-sm"
                  onClick={toggleEdit}
                >
                  <Building2 size={16} />
                  Edit Profile
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Availability */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Availability & Slot Settings</h3>
            <p className="text-sm text-slate-600 mt-1">
              Set your working hours. Clients (and admin) will see your available slots.
            </p>
          </div>
          <Badge variant="blue">
            <CalendarDays size={14} /> Slot System
          </Badge>
        </div>

        <div className="mt-5 grid lg:grid-cols-3 gap-4">
          {/* Settings */}
          <div className="lg:col-span-1 rounded-2xl border border-slate-200 p-5 bg-slate-50">
            <div className="text-sm font-semibold text-slate-900">General Settings</div>

            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Mode</div>
                <select
                  value={availability.mode}
                  onChange={(e) => setAvailability((p) => ({ ...p, mode: e.target.value as SlotMode }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                >
                  <option value="Online">Online</option>
                  <option value="Court">Court</option>
                  <option value="Hybrid">Hybrid</option>
                </select>
              </label>

              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Slot Duration</div>
                <select
                  value={availability.slotMinutes}
                  onChange={(e) => setAvailability((p) => ({ ...p, slotMinutes: Number(e.target.value) as any }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                >
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </label>

              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Buffer Between Slots</div>
                <select
                  value={availability.bufferMinutes}
                  onChange={(e) => setAvailability((p) => ({ ...p, bufferMinutes: Number(e.target.value) as any }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                >
                  <option value={0}>0 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              </label>

              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Max Bookings / Day</div>
                <input
                  type="number"
                  value={availability.maxBookingsPerDay}
                  onChange={(e) =>
                    setAvailability((p) => ({ ...p, maxBookingsPerDay: clampInt(Number(e.target.value), 1, 30) }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                  min={1}
                  max={30}
                />
              </label>

              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Default Court / Location</div>
                <input
                  value={availability.defaultLocation ?? ""}
                  onChange={(e) => setAvailability((p) => ({ ...p, defaultLocation: e.target.value }))}
                  placeholder="e.g., District Court, Lahore"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                />
              </label>

              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Online Meeting Link (Optional)</div>
                <input
                  value={availability.meetingLink ?? ""}
                  onChange={(e) => setAvailability((p) => ({ ...p, meetingLink: e.target.value }))}
                  placeholder="https://meet.google.com/..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none"
                />
              </label>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Appointment Types</div>
              <div className="mt-2 space-y-2 text-sm">
                {(Object.keys(availability.appointmentTypes) as SlotType[]).map((t) => (
                  <label key={t} className="flex items-center justify-between gap-3">
                    <span className="text-slate-700">{t}</span>
                    <input
                      type="checkbox"
                      checked={availability.appointmentTypes[t]}
                      onChange={(e) =>
                        setAvailability((p) => ({
                          ...p,
                          appointmentTypes: { ...p.appointmentTypes, [t]: e.target.checked },
                        }))
                      }
                      className="h-4 w-4"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs text-slate-500 mb-1">Note to Clients</div>
              <textarea
                value={availability.notesToClients}
                onChange={(e) => setAvailability((p) => ({ ...p, notesToClients: e.target.value }))}
                className="w-full min-h-[92px] rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none text-sm"
                placeholder="Write instructions, rescheduling policy, required documents..."
              />
            </div>

            <button
              type="button"
              onClick={saveAvailability}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#004aad] text-white font-semibold hover:bg-[#003b82] transition text-sm disabled:opacity-50"
              disabled={savingAvailability}
            >
              {savingAvailability ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save Availability
            </button>

            <p className="mt-3 text-xs text-slate-500">
              Later: system will generate bookable slots & sync to calendar automatically.
            </p>
          </div>

          {/* Weekly schedule */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 p-5 bg-white">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-semibold text-slate-900">Weekly Schedule</div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Timer size={14} />
                Slot: {availability.slotMinutes}m • Buffer: {availability.bufferMinutes}m
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {DAYS.map((day) => {
                const d = availability.daySchedules[day];
                return (
                  <div key={day} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) =>
                            setAvailability((p) => ({
                              ...p,
                              daySchedules: {
                                ...p.daySchedules,
                                [day]: { ...p.daySchedules[day], enabled: e.target.checked },
                              },
                            }))
                          }
                          className="h-4 w-4"
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{dayLabel(day)}</div>
                          <div className="text-xs text-slate-500">{d.enabled ? "Available" : "Off day"}</div>
                        </div>
                      </label>

                      <div className="flex items-center gap-2">
                        <Badge variant={d.enabled ? "green" : "gray"}>
                          {d.enabled ? (
                            <>
                              <Users size={14} /> Accept bookings
                            </>
                          ) : (
                            <>
                              <X size={14} /> Closed
                            </>
                          )}
                        </Badge>

                        <button
                          type="button"
                          disabled={!d.enabled}
                          onClick={() => addWindow(day)}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition border
                            ${
                              d.enabled
                                ? "bg-white hover:bg-slate-50 border-slate-200"
                                : "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                            }`}
                        >
                          <Plus size={16} className="text-[#004aad]" />
                          Add Window
                        </button>
                      </div>
                    </div>

                    <div className={`mt-3 space-y-2 ${!d.enabled ? "opacity-50 pointer-events-none" : ""}`}>
                      {d.windows.map((w, idx) => (
                        <div key={`${day}-${idx}`} className="flex items-center gap-2 flex-wrap">
                          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <Clock size={14} className="text-[#004aad]" />
                            <span className="text-xs text-slate-500">From</span>
                            <input
                              type="time"
                              value={w.from}
                              onChange={(e) => updateWindow(day, idx, "from", e.target.value)}
                              className="bg-transparent outline-none text-sm text-slate-800"
                            />
                          </div>

                          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <Clock size={14} className="text-[#004aad]" />
                            <span className="text-xs text-slate-500">To</span>
                            <input
                              type="time"
                              value={w.to}
                              onChange={(e) => updateWindow(day, idx, "to", e.target.value)}
                              className="bg-transparent outline-none text-sm text-slate-800"
                            />
                          </div>

                          <div className="ml-auto flex items-center gap-2">
                            <Badge variant="blue">
                              {availability.mode === "Online" ? (
                                <>
                                  <Video size={14} /> Online
                                </>
                              ) : availability.mode === "Court" ? (
                                <>
                                  <Gavel size={14} /> Court
                                </>
                              ) : (
                                <>
                                  <Building size={14} /> Hybrid
                                </>
                              )}
                            </Badge>

                            <button
                              type="button"
                              onClick={() => removeWindow(day, idx)}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold"
                              title="Remove window"
                            >
                              <Trash2 size={16} className="text-rose-600" />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
                      Tip: Add multiple windows (e.g., 10–12 for court, 6–9 for meetings).
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Stats (still UI placeholders) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Cases"
          value={`${uiProfile.stats?.totalCases ?? 0}`}
          icon={<Briefcase size={18} className="text-[#004aad]" />}
        />
        <StatCard
          label="Ongoing"
          value={`${uiProfile.stats?.ongoing ?? 0}`}
          icon={<Gavel size={18} className="text-[#004aad]" />}
          accent="text-sky-600"
        />
        <StatCard
          label="Success Rate"
          value={`${uiProfile.stats?.successRate ?? "—"}`}
          icon={<BadgeCheck size={18} className="text-[#004aad]" />}
          accent="text-emerald-600"
        />
        <StatCard
          label="AI Insights"
          value={`${uiProfile.stats?.aiInsights ?? 0}`}
          icon={<ShieldCheck size={18} className="text-[#004aad]" />}
          accent="text-amber-600"
        />
      </div>

      {/* Verification Documents */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Verification Documents</h3>
            <p className="text-sm text-slate-600 mt-1">
              Upload CNIC, license and degree so Admin can verify. Verified documents increase trust for clients.
            </p>
          </div>
          <Badge variant="gray">
            <ShieldCheck size={14} /> Admin Verification
          </Badge>
        </div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          {documents.map((d) => {
            const isUploading = uploadingKey === d.key;
            const viewHref = d.fileUrl ? d.fileUrl : null;

            return (
              <div key={d.key} className="rounded-2xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <FileText size={16} className="text-[#004aad]" />
                      {d.label}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{d.hint}</div>

                    {d.note && <div className="text-xs text-slate-500 mt-1">{d.note}</div>}
                    {d.lastUpdated && <div className="text-xs text-slate-500 mt-2">Last updated: {d.lastUpdated}</div>}

                    {viewHref && (
                      <a
                        className="mt-2 inline-block text-xs font-semibold text-[#004aad]"
                        href={viewHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View uploaded file
                      </a>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {statusBadge(d.status)}
                    <label
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition
                        ${
                          isUploading
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-[#004aad] text-white hover:bg-[#003b82] cursor-pointer"
                        }`}
                      title="Upload document"
                    >
                      {isUploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                      Upload
                      <input
                        type="file"
                        className="hidden"
                        accept=".png,.jpg,.jpeg,.pdf"
                        disabled={isUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) handleUpload(d.key, f);
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-600 rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <span className="font-semibold">Note:</span> These files are only visible to Admin (and you). Clients
                  will only see “Verified” badge, not the raw documents.
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Work History + Education */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="text-xl font-bold text-slate-900">Work History</h3>
          <p className="text-sm text-slate-600 mt-1">Showcase relevant experience and responsibilities.</p>

          <div className="mt-4 space-y-4">
            {workHistory.length ? (
              workHistory.map((w) => (
                <div key={w.id} className="rounded-2xl border border-slate-200 p-5 bg-white">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{w.role}</div>
                      <div className="text-sm text-slate-700">{w.org}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {w.from_year ?? "—"} – {w.to_year ?? "Present"} • {w.location ?? "—"}
                      </div>
                    </div>
                    <Badge variant="blue">
                      <Briefcase size={14} /> Experience
                    </Badge>
                  </div>

                  <ul className="mt-3 list-disc pl-5 text-sm text-slate-700 space-y-1">
                    {(Array.isArray(w.highlights) ? w.highlights : []).map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">No work history added yet.</div>
            )}
          </div>

          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
            onClick={() => alert("Next step: add work history form + call POST /work-history")}
          >
            <Upload size={16} className="text-[#004aad]" />
            Add Work History
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="text-xl font-bold text-slate-900">Education</h3>
          <p className="text-sm text-slate-600 mt-1">Degrees and professional certifications.</p>

          <div className="mt-4 space-y-3">
            {education.length ? (
              education.map((e) => (
                <div key={e.id} className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                  <div className="text-sm font-bold text-slate-900">{e.degree}</div>
                  <div className="text-sm text-slate-700">{e.institute}</div>
                  <div className="text-xs text-slate-500 mt-1">Year: {e.year ?? "—"}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">No education added yet.</div>
            )}
          </div>

          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
            onClick={() => alert("Next step: add education form + call POST /education")}
          >
            <Upload size={16} className="text-[#004aad]" />
            Add Education / Certification
          </button>
        </div>
      </div>

      {/* Admin-facing info (UI only) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="text-xl font-bold text-slate-900">Admin Notes (Internal)</h3>
        <p className="text-sm text-slate-600 mt-1">
          This area is for admin verification notes and system flags (later role-based visibility).
        </p>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
            <div className="font-semibold text-slate-900">Verification Flags</div>
            <ul className="mt-2 text-sm text-slate-700 list-disc pl-5 space-y-1">
              <li>CNIC back side missing</li>
              <li>Degree uploaded — pending review</li>
              <li>License verified</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
            <div className="font-semibold text-slate-900">Account Status</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="green">
                <ShieldCheck size={14} /> Active
              </Badge>
              <Badge variant="amber">
                <CalendarDays size={14} /> KYC Pending
              </Badge>
            </div>
            <div className="mt-3 text-sm text-slate-700">
              Office: <span className="font-semibold">{uiProfile.city || "—"}</span>
            </div>
            <div className="text-sm text-slate-700">
              Member Since: <span className="font-semibold">—</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
