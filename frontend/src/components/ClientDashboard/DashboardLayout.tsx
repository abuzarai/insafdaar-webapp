// DashboardLayout.tsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Sidebar, { type SectionName } from "./Sidebar";
import { API_BASE_URL } from "../../config";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Bot, RefreshCw, LogOut } from "lucide-react";

import {
  MyCasesSection,
  StartCaseSection,
  CaseDetailsSection,
  NotificationsSection,
  ClientProfileSection,
  BillingSection,
  FeedbackSection,
  ContractSection,
} from "./Sections";

import type { CaseSummary } from "./Sections/MyCasesSection";

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
  documentsCompleted?: boolean; // ✅ allow missing for older payloads
  avatarUrl: string;
  joined: string;
};

const CLIENT_BASE = `${API_BASE_URL}/api/client`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function calcCompleteness(p: ClientProfile) {
  const required = [
    p.fullName,
    p.email,
    p.phone,
    p.cnic,
    p.city,
    p.address,
    p.location,
    p.emergencyContactName,
    p.emergencyContactPhone,
  ];
  const filled = required.filter((x) => (x || "").trim().length > 0).length;
  return Math.round((filled / required.length) * 100);
}

function parseCaseDbId(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("CASE-") ? raw.split("-")[1] : raw;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const initialSection = useMemo<SectionName>(() => {
    const q = new URLSearchParams(location.search || "");
    const s = String(q.get("section") || "").trim();
    const allowed: SectionName[] = [
      "My Cases",
      "Start Case",
      "Case Details",
      "Notifications",
      "Billing",
      "Feedback",
      "Contract",
      "Profile",
    ];
    return (allowed.includes(s as SectionName) ? (s as SectionName) : "My Cases");
  }, [location.search]);

  const [activeSection, setActiveSection] = useState<SectionName>(initialSection);
  const [selectedCase, setSelectedCase] = useState<CaseSummary | null>(null);

  // ✅ IMPORTANT: fallback must be numeric (DB id)
  const fallbackCaseId = useMemo(() => 1, []);

  // ✅ real logged-in profile
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [topRefreshing, setTopRefreshing] = useState(false);
  const [topMsg, setTopMsg] = useState<string>("");

  const completeness = useMemo(() => {
    if (!profile) return 0;
    return calcCompleteness(profile);
  }, [profile]);

  // ✅ match your profile page logic: needs docs completed too (if provided)
  const canStartCase = useMemo(() => {
    if (!profile) return false;
    const isComplete = completeness === 100;
    const docsOk = profile.documentsCompleted === undefined ? true : !!profile.documentsCompleted;
    return isComplete && docsOk;
  }, [profile, completeness]);

  const loadProfile = async () => {
    try {
      setProfileLoading(true);
      setTopMsg("");

      const token = localStorage.getItem("token");
      if (!token) {
        setTopMsg("⚠️ You are not logged in. Please login again.");
        setProfile(null);
        return;
      }

      // ✅ FIX URL: backend is mounted at /api/client (NOT /api/client/profile)
      const res = await axios.get(`${CLIENT_BASE}/`, {
        headers: authHeaders(),
      });

      const p = res.data?.profile ?? res.data?.data?.profile ?? null;
      setProfile(p);
    } catch (e: any) {
      setProfile(null);
      setTopMsg(e?.response?.data?.error || "Failed to load profile. Please login again.");
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCaseDetails = (c: CaseSummary) => {
    setSelectedCase(c);
    setActiveSection("Case Details");
  };

  const goBackToMyCases = () => setActiveSection("My Cases");

  const refreshTop = async () => {
    try {
      setTopRefreshing(true);
      await loadProfile();
    } finally {
      setTopRefreshing(false);
    }
  };

  const doLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("role");
    navigate("/login", { replace: true });
  };

  // ✅ central navigation guard
  const guardedSetSection = (next: SectionName) => {
    setTopMsg("");

    if (next === "Start Case" && !canStartCase) {
      setActiveSection("Profile");
      setTopMsg("⚠️ Please complete your profile before starting a case.");
      return;
    }

    setActiveSection(next);
  };

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const renderSection = () => {
    switch (activeSection) {
      case "My Cases":
        return <MyCasesSection onOpenCase={openCaseDetails} />;

      case "Start Case":
        return <StartCaseSection />;

      case "Case Details": {
        const numericId = parseCaseDbId(selectedCase?.id) ?? fallbackCaseId;
        return (
          <CaseDetailsSection caseId={numericId} caseRef={selectedCase?.id || undefined} onBack={goBackToMyCases} />
        );
      }

      case "Notifications":
        return <NotificationsSection />;

      case "Billing":
        return <BillingSection />;

      case "Feedback":
        return <FeedbackSection />;

      case "Contract":
        return <ContractSection />;

      case "Profile":
        return <ClientProfileSection onProfileUpdated={loadProfile} />;

      default:
        return <MyCasesSection onOpenCase={openCaseDetails} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f9fafb] text-[#00142e]">
      <Sidebar
        active={activeSection}
        setActive={guardedSetSection}
        profile={profile}
        profileLoading={profileLoading}
        completeness={completeness}
        canStartCase={canStartCase}
      />

      {/* ✅ Responsive fix: on mobile, push content below burger by adding left padding */}
      <div className="flex-1 flex flex-col w-full min-w-0">
        <header className="sticky top-0 z-20 w-full bg-white/95 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-3 md:py-4">
          <div className="w-full flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[#004aad] tracking-tight">
              Client Dashboard
            </h1>
            {topMsg && <p className="text-sm text-amber-700 mt-1">{topMsg}</p>}
          </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Go to Home"
              >
                <Home size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={() => navigate("/legal-assistant")}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Open Legal Assistant"
              >
                <Bot size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={refreshTop}
                disabled={topRefreshing || profileLoading}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-60"
                title="Refresh"
              >
                <RefreshCw size={18} className={topRefreshing ? "animate-spin" : ""} style={{ color: "#1E3A8A" }} />
              </button>

              <button
                type="button"
                onClick={doLogout}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 transition"
                title="Logout"
              >
                <LogOut size={18} className="text-rose-800" />
              </button>

              <div className="text-sm text-slate-600 whitespace-nowrap hidden lg:block ml-1">
              {profileLoading ? (
                "Loading…"
              ) : (
                <span>
                  Profile:{" "}
                  <b className={canStartCase ? "text-emerald-700" : "text-amber-700"}>
                    {completeness}%
                  </b>
                </span>
              )}
            </div>
          </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">{renderSection()}</main>

        <footer className="bg-white border-t border-gray-200 py-4 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Insafdaar — All Rights Reserved.
        </footer>
      </div>
    </div>
  );
}
