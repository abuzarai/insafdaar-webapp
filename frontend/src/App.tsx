// src/App.tsx
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import Header from "./header";
import Footer from "./footer";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import ClientRegisterPage from "./pages/ClientRegisterPage";
import AdvocateRegisterPage from "./pages/AdvocateRegisterPage";
import VerifyOtpPage from "./pages/VerifyOtpPage";

import NotFoundPage from "./pages/NotFoundPage";
import RequireAuth from "./routes/RequireAuth";
import AdvocateDashboardPage from "./pages/AdvocateDashboardPage";
import ClientDashboardPage from "./pages/ClientDashboardPage";

// Admin page
import AdminDashboardPage from "./pages/AdminDashboardPage";

// Admin profiles
import AdminClientProfile from "./components/AdminDashboard/AdminClientProfile";
import AdminAdvocateProfile from "./components/AdminDashboard/AdminAdvocateProfile";

import LegalAssistantPage from "./pages/LegalAssistantPage";

// Floating Chat Button
import FloatingChatWidget from "./components/LegalAssistantChat/FloatingChatWidget";

// ✅ Meet Advocates page
import MeetOurAdvocatesPage from "./pages/MeetOurAdvocatesPage";

// ✅ NEW: How it Works page (create this file in src/pages/HowItWorksPage.tsx)
import HowItWorksPage from "./pages/HowItWorksPage";

 
/* ================= Layout Wrapper ================= */

function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const isDashboard =
    location.pathname.startsWith("/advocate-dashboard") ||
    location.pathname.startsWith("/client-dashboard") ||
    location.pathname.startsWith("/admin");

  const isFullPageBot = location.pathname === "/legal-assistant";

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb] text-gray-800">
      {!isDashboard && !isFullPageBot && <Header />}

      <main className="flex-1 w-full">{children}</main>

      {!isDashboard && !isFullPageBot && <FloatingChatWidget />}

      {!isDashboard && !isFullPageBot && <Footer />}
    </div>
  );
}

/* ================= Corner Button ================= */

function CornerIconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      type="button"
      className="absolute top-4 right-6 z-50
                 w-10 h-10 inline-flex items-center justify-center
                 rounded-xl border border-slate-200 bg-white
                 hover:bg-slate-50 transition
                 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
    >
      {children}
    </button>
  );
}

/* ================= Dashboard Wrappers ================= */

function AdvocateDashboardWithBackButton() {
  return <AdvocateDashboardPage />;
}

function ClientDashboardWithBackButton() {
  return <ClientDashboardPage />;
}

function AdminDashboardWithBackButton() {
  return (
    <div className="relative">
      <AdminDashboardPage />
    </div>
  );
}

/* ================= Admin Profile Wrappers ================= */

function AdminClientProfileWithBackButton() {
  const navigate = useNavigate();

  return (
    <div className="relative">
      <CornerIconButton onClick={() => navigate("/admin")} title="Back to Admin">
        <ArrowLeft size={18} className="text-slate-700" />
      </CornerIconButton>

      <AdminClientProfile />
    </div>
  );
}

function AdminAdvocateProfileWithBackButton() {
  const navigate = useNavigate();

  return (
    <div className="relative">
      <CornerIconButton onClick={() => navigate("/admin")} title="Back to Admin">
        <ArrowLeft size={18} className="text-slate-700" />
      </CornerIconButton>

      <AdminAdvocateProfile />
    </div>
  );
}

/* ================= App ================= */

export default function App() {
  return (
    <Router>
      <LayoutWrapper>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route path="/register-client" element={<ClientRegisterPage />} />
          <Route path="/register-advocate" element={<AdvocateRegisterPage />} />

          <Route path="/verify-otp" element={<VerifyOtpPage />} />

          {/* Meet Advocates */}
          <Route path="/meet-advocates" element={<MeetOurAdvocatesPage />} />

          {/* NEW: How it Works */}
          <Route path="/how-it-works" element={<HowItWorksPage />} />

          {/* Legal Assistant */}
          <Route path="/legal-assistant" element={<LegalAssistantPage />} />

          {/* Dashboards */}
          <Route element={<RequireAuth />}>
            <Route
              path="/client-dashboard"
              element={<ClientDashboardWithBackButton />}
            />
          </Route>
          <Route element={<RequireAuth roles={["ADVOCATE"]} />}>
            <Route
              path="/advocate-dashboard"
              element={<AdvocateDashboardWithBackButton />}
            />
          </Route>

          {/* Admin */}
          <Route element={<RequireAuth roles={["ADMIN"]} />}>
            <Route path="/admin" element={<AdminDashboardWithBackButton />} />
            <Route
              path="/admin/clients/:id"
              element={<AdminClientProfileWithBackButton />}
            />
            <Route
              path="/admin/advocates/:id"
              element={<AdminAdvocateProfileWithBackButton />}
            />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </LayoutWrapper>
    </Router>
  );
}
