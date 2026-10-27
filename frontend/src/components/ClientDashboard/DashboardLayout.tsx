// DashboardLayout.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  FeedbackSection,
} from "./Sections";

import type { CaseSummary } from "./Sections/MyCasesSection";
import { profileProgress } from "./utils/profileProgress";

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
  documentsCompleted?: boolean; // allow missing for older payloads
  avatarUrl: string;
  joined: string;
};

const CLIENT_BASE = `${API_BASE_URL}/api/client`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function calcCompleteness(p: ClientProfile) {
  return profileProgress(p).percent;
}

function parseCaseDbId(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = /^(?:CASE-)?([0-9]+)$/.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export default function DashboardLayout() {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const syncSession = () => setToken(localStorage.getItem("token"));
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === "token" || event.key === null) syncSession(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  if (!token) return <main role="alert">Please sign in again to view your dashboard. <a href="/login">Sign in</a></main>;
  return <DashboardContent key={token} sessionToken={token} onSessionChange={syncSession} />;
}

function DashboardContent({ sessionToken, onSessionChange }: { sessionToken: string; onSessionChange: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  const activeSection = useMemo<SectionName>(() => {
    const q = new URLSearchParams(location.search || "");
    const s = String(q.get("section") || "").trim();
    const allowed: SectionName[] = [
      "My Cases",
      "Start Case",
      "Notifications",
      "Feedback",
      "Profile",
    ];
    if (["Case Details", "Billing", "Contract"].includes(s)) return "Case Details";
    return (allowed.includes(s as SectionName) ? (s as SectionName) : "My Cases");
  }, [location.search]);

  const selectedCaseRef = new URLSearchParams(location.search).get("caseId");
  const selectedCaseId = parseCaseDbId(selectedCaseRef);

  // The URL owns selection so refresh and browser history cannot reuse another case.
  const navigateSection = (section: SectionName, caseRef?: string) => {
    const query = new URLSearchParams(location.search);
    query.set("section", section);
    query.delete("caseId");
    if (caseRef) query.set("caseId", caseRef);
    navigate({ pathname: location.pathname, search: `?${query.toString()}` });
  };

  // ✅ real logged-in profile
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileOpened, setProfileOpened] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  useEffect(() => {
    if (!profile) { setHasUnreadNotifications(false); return; }
    let current = true;
    const token = localStorage.getItem("token");
    void axios.get(`${CLIENT_BASE}/dashboard/notifications`, { headers: authHeaders() }).then(response => {
      if (current && token === localStorage.getItem("token") && Array.isArray(response.data?.notifications)) setHasUnreadNotifications(response.data.notifications.some((n: { is_read: boolean }) => !n.is_read));
    }).catch(() => {});
    return () => { current = false; };
  }, [!!profile]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const profileSequence = useRef(0);
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
    const sequence = ++profileSequence.current;
    try {
      setProfileLoading(true);
      setProfileError(false);
      setTopMsg("");

      const token = localStorage.getItem("token");
      if (!token) {
        setTopMsg("You are not logged in. Please login again.");
        setProfileError(true);
        setProfile(null);
        return;
      }

      // ✅ FIX URL: backend is mounted at /api/client (NOT /api/client/profile)
      const res = await axios.get(`${CLIENT_BASE}/`, {
        headers: authHeaders(),
      });

      if (sequence !== profileSequence.current) return;
      if (sessionToken !== localStorage.getItem("token")) { onSessionChange(); return; }
      const p = res.data?.profile ?? res.data?.data?.profile ?? null;
      setProfile(p);
      if (!p) {
        setProfileError(true);
        setTopMsg("Profile response missing 'profile'. Use Refresh to retry.");
      }
    } catch (e: any) {
      if (sequence !== profileSequence.current) return;
      if (sessionToken !== localStorage.getItem("token")) { onSessionChange(); return; }
      setProfileError(true);
      const accessDenied = e?.response?.status === 401 || e?.response?.status === 403;
      if (accessDenied) setProfile(null);
      setTopMsg(accessDenied
        ? e?.response?.data?.error || "Your session could not be authorized. Please login again."
        : profile
          ? "Failed to refresh profile. Your previous profile is still shown. Use Refresh to retry."
          : "Failed to load profile. Use Refresh to retry.");
    } finally {
      if (sequence === profileSequence.current && sessionToken === localStorage.getItem("token")) setProfileLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    return () => { profileSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showProfile = activeSection === "Profile" || (activeSection === "Start Case" && !!profile && !canStartCase);
  useEffect(() => { if (showProfile) setProfileOpened(true); }, [showProfile]);

  const openCaseDetails = (c: CaseSummary) => {
    navigateSection("Case Details", c.id);
  };

  const goBackToMyCases = () => navigateSection("My Cases");

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
      navigateSection("Profile");
      setTopMsg("Please complete your profile before starting a case.");
      return;
    }

    navigateSection(next);
  };

  const renderSection = () => {
    switch (activeSection) {
      case "My Cases":
        return <MyCasesSection onOpenCase={openCaseDetails} onContinueCase={c => navigateSection("Start Case", c.id)} onStartCase={() => guardedSetSection("Start Case")} />;

      case "Start Case":
        // A deep link must honor the same profile policy as sidebar navigation.
        // Background refresh must not unmount unsaved profile or interview state.
        if (!profile && profileLoading) return <p role="status">Checking your profile before opening the interview...</p>;
        if (!profile && profileError) return <p role="alert">Your profile could not be checked. Use Refresh profile to retry.</p>;
        if (!canStartCase) return <p className="text-sm text-amber-700 mb-4">Please finish the required profile details and documents before starting a case.</p>;
        if (selectedCaseRef && selectedCaseId === null) return <p role="alert">This case link is not valid. Choose a case from My Cases.</p>;
        return <StartCaseSection key={selectedCaseId || "active"} requestedCaseId={selectedCaseId || undefined} />;

      case "Case Details": {
        if (selectedCaseId === null) return (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold text-[#004aad]">Choose a case</h2>
            <p>Select a case from My Cases to view its details, billing and contract.</p>
            <button type="button" onClick={goBackToMyCases} className="rounded-xl bg-[#004aad] text-white px-4 py-2">
              Go to My Cases
            </button>
          </section>
        );
        return (
          <CaseDetailsSection key={selectedCaseId} caseId={selectedCaseId} caseRef={selectedCaseRef || undefined} initialTab={new URLSearchParams(location.search).get("view") || undefined} onBack={goBackToMyCases} onContinue={() => navigateSection("Start Case", selectedCaseRef || String(selectedCaseId))} />
        );
      }

      case "Notifications":
        return <NotificationsSection onUnreadChange={setHasUnreadNotifications} />;

      case "Feedback":
        return <FeedbackSection />;

      case "Profile":
        if (!profile) return <p role={profileError ? "alert" : "status"}>{profileError ? "Your profile could not be checked. Use Refresh profile to retry." : "Loading your profile…"}</p>;
        return null;

      default:
        return <MyCasesSection onOpenCase={openCaseDetails} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f9fafb] text-[#00142e]">
      <Sidebar
        active={activeSection === "Case Details" ? "My Cases" : activeSection}
        setActive={guardedSetSection}
        profile={profile}
        profileLoading={profileLoading}
        completeness={completeness}
        canStartCase={canStartCase} hasUnreadNotifications={hasUnreadNotifications}
      />

      {/* Responsive fix: on mobile, push content below burger by adding left padding */}
      <div className="flex-1 flex flex-col w-full min-w-0">
        <header className="sticky top-0 z-20 w-full bg-white/95 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-3 md:py-4">
          <div className="w-full flex items-start sm:items-center justify-between gap-5 sm:gap-3 flex-col sm:flex-row">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[#004aad] tracking-tight pl-14 md:pl-0">
              Client Dashboard
            </h1>
            {topMsg && <p className="text-sm text-amber-700 mt-1">{topMsg}</p>}
          </div>

            <div className="flex items-center gap-2 shrink-0">
              <button aria-label="Open home"
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Go to Home"
              >
                <Home size={18} className="text-slate-700" />
              </button>

              <button aria-label="Open legal assistant"
                type="button"
                onClick={() => navigate("/legal-assistant")}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Open Legal Assistant"
              >
                <Bot size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={refreshTop}
                disabled={topRefreshing || profileLoading}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-60"
                title="Refresh profile" aria-label="Refresh profile"
              >
                <RefreshCw size={18} className={topRefreshing ? "animate-spin" : ""} style={{ color: "#1E3A8A" }} /><span className="text-sm ml-2">Refresh profile</span>
              </button>

              <button
                type="button"
                onClick={doLogout}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 transition"
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

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {renderSection()}
          {profile && (showProfile || profileOpened) && <div hidden={!showProfile}>
            <ClientProfileSection key={localStorage.getItem("token")} onProfileUpdated={loadProfile} />
          </div>}
        </main>

        <footer className="bg-white border-t border-gray-200 py-4 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Insafdaar — All Rights Reserved.
        </footer>
      </div>
    </div>
  );
}
