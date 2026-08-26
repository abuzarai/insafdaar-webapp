import React, { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";

function getStoredUser() {
  const raw = localStorage.getItem("user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const name = String(parsed?.name || "").trim();
    const email = String(parsed?.email || "").trim();
    const role = String(parsed?.role || "").trim();
    return { name, email, role };
  } catch (_err) {
    return null;
  }
}

function getUserInitials(nameOrEmail: string) {
  const parts = nameOrEmail
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

export default function Header() {
  const [showRegisterMenu, setShowRegisterMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileRegisterOpen, setMobileRegisterOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const user = token ? getStoredUser() : null;
  const profileLabel = user?.name || user?.email || "User";
  const profileRole = user?.role || "ACCOUNT";

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  const getDashboardPath = () => {
    const role = String(profileRole).toUpperCase();
    if (role === "ADMIN") return "/admin";
    if (role === "ADVOCATE") return "/advocate-dashboard";
    return "/client-dashboard";
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative px-3 py-2 font-medium transition-all duration-300 ${
      isActive
        ? "text-[#004aad] after:absolute after:w-full after:h-[2px] after:bg-[#004aad] after:bottom-0 after:left-0"
        : "text-gray-700 hover:text-[#f5b301]"
    }`;

  const openMenu = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowRegisterMenu(true);
  };

  const closeMenu = () => {
    timerRef.current = setTimeout(() => setShowRegisterMenu(false), 150);
  };

  const toggleLang = () => {
    const newLang = i18n.language === "en" ? "ur" : "en";
    i18n.changeLanguage(newLang);
    localStorage.setItem("lang", newLang);
    document.dir = newLang === "ur" ? "rtl" : "ltr";
    navigate(0);
  };

  useEffect(() => {
    document.dir = i18n.language === "ur" ? "rtl" : "ltr";
  }, [i18n.language]);

  useEffect(() => {
    if (mobileOpen) {
      setMobileOpen(false);
      setMobileRegisterOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current) return;
      if (profileMenuRef.current.contains(event.target as Node)) return;
      setShowProfileMenu(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-lg border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          to="/"
          className="text-2xl font-extrabold tracking-tight text-[#004aad] flex items-center gap-1"
          onClick={() => setMobileOpen(false)}
        >
          {t("appName")}
          <span className="text-[#f5b301]">.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 relative">
          <NavLink to="/" className={linkClass}>
            {t("home")}
          </NavLink>

          {/* Meet Advocates */}
          <NavLink to="/meet-advocates" className={linkClass}>
            Meet Advocates
          </NavLink>

          {/* NEW: How it Works */}
          <NavLink to="/how-it-works" className={linkClass}>
            How It Works
          </NavLink>

          {!token ? (
            <>
              <NavLink to="/login" className={linkClass}>
                {t("login")}
              </NavLink>

              <div
                className="relative"
                onMouseEnter={openMenu}
                onMouseLeave={closeMenu}
              >
                <button
                  className="flex items-center gap-1 text-gray-700 hover:text-[#f5b301] transition"
                  onClick={() => setShowRegisterMenu((v) => !v)}
                  type="button"
                >
                  {t("register")} <ChevronDown size={16} />
                </button>

                {showRegisterMenu && (
                  <div
                    className="absolute right-0 mt-2 bg-white text-gray-800 rounded-lg shadow-xl w-48 border border-gray-200 overflow-hidden"
                    onMouseEnter={openMenu}
                    onMouseLeave={closeMenu}
                  >
                    <Link
                      to="/register-client"
                      className="block px-4 py-2 hover:bg-gray-100"
                      onClick={() => setShowRegisterMenu(false)}
                    >
                      {t("registerAsClient")}
                    </Link>
                    <Link
                      to="/register-advocate"
                      className="block px-4 py-2 hover:bg-gray-100"
                      onClick={() => setShowRegisterMenu(false)}
                    >
                      {t("registerAsAdvocate")}
                    </Link>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setShowProfileMenu((prev) => !prev)}
                className="rounded-full border border-[#d4dff2] bg-[#f4f8ff] px-2.5 py-1.5 flex items-center gap-2 hover:bg-[#edf4ff]"
              >
                <span className="h-7 w-7 rounded-full bg-[#004aad] text-white text-[11px] font-bold flex items-center justify-center">
                  {getUserInitials(profileLabel)}
                </span>
                <span className="leading-tight text-left">
                  <span className="block text-[11px] font-semibold text-[#0f172a] max-w-[110px] truncate">
                    {profileLabel}
                  </span>
                  <span className="block text-[10px] text-slate-500 uppercase">{profileRole}</span>
                </span>
                <ChevronDown size={14} className="text-slate-500" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      navigate(getDashboardPath());
                      setShowProfileMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    My Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("/legal-assistant");
                      setShowProfileMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Legal Assistant
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleLogout();
                      setShowProfileMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={toggleLang}
            className="ml-4 px-4 py-1.5 bg-[#f5b301] text-[#00142e] rounded-md font-semibold hover:bg-[#ffd84d] transition"
            type="button"
          >
            {i18n.language === "en" ? "اردو" : "English"}
          </button>
        </nav>

        <button
          className="md:hidden p-2 rounded-md text-gray-700 hover:text-[#004aad]"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
          type="button"
        >
          {mobileOpen ? <X size={26} /> : <Menu size={26} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white/95 backdrop-blur-lg">
          <nav className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-2">
            <NavLink
              to="/"
              className={linkClass}
              onClick={() => setMobileOpen(false)}
            >
              {t("home")}
            </NavLink>

            {/* Meet Advocates */}
            <NavLink
              to="/meet-advocates"
              className={linkClass}
              onClick={() => setMobileOpen(false)}
            >
              Meet Advocates
            </NavLink>

            {/* NEW: How it Works */}
            <NavLink
              to="/how-it-works"
              className={linkClass}
              onClick={() => setMobileOpen(false)}
            >
              How It Works
            </NavLink>

            {!token ? (
              <>
                <NavLink
                  to="/login"
                  className={linkClass}
                  onClick={() => setMobileOpen(false)}
                >
                  {t("login")}
                </NavLink>

                <button
                  type="button"
                  onClick={() => setMobileRegisterOpen((v) => !v)}
                  className="flex items-center justify-between px-3 py-2 font-medium text-gray-700 hover:text-[#f5b301] transition"
                >
                  <span className="flex items-center gap-2">{t("register")}</span>
                  <ChevronDown
                    size={18}
                    className={`transition ${
                      mobileRegisterOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {mobileRegisterOpen && (
                  <div className="ml-3 border-l border-gray-200 pl-3 flex flex-col">
                    <Link
                      to="/register-client"
                      className="px-3 py-2 text-gray-700 hover:bg-gray-50 rounded-md"
                      onClick={() => {
                        setMobileOpen(false);
                        setMobileRegisterOpen(false);
                      }}
                    >
                      {t("registerAsClient")}
                    </Link>
                    <Link
                      to="/register-advocate"
                      className="px-3 py-2 text-gray-700 hover:bg-gray-50 rounded-md"
                      onClick={() => {
                        setMobileOpen(false);
                        setMobileRegisterOpen(false);
                      }}
                    >
                      {t("registerAsAdvocate")}
                    </Link>
                  </div>
                )}
              </>
            ) : (
              <>
                <Link
                  to={getDashboardPath()}
                  className="mx-1 rounded-xl border border-[#d4dff2] bg-[#f4f8ff] px-3 py-2 flex items-center gap-2"
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="h-7 w-7 rounded-full bg-[#004aad] text-white text-[11px] font-bold flex items-center justify-center">
                    {getUserInitials(profileLabel)}
                  </span>
                  <span className="leading-tight">
                    <span className="block text-xs font-semibold text-[#0f172a] max-w-[180px] truncate">
                      {profileLabel}
                    </span>
                    <span className="block text-[10px] text-slate-500 uppercase">{profileRole}</span>
                  </span>
                </Link>

                <Link
                  to="/legal-assistant"
                  className="px-3 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 rounded-md"
                  onClick={() => setMobileOpen(false)}
                >
                  Legal Assistant
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    handleLogout();
                    setMobileOpen(false);
                  }}
                  className="mt-1 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-gray-50 rounded-md"
                >
                  Logout
                </button>
              </>
            )}

            <button
              onClick={toggleLang}
              className="mt-2 w-full px-4 py-2 bg-[#f5b301] text-[#00142e] rounded-md font-semibold hover:bg-[#ffd84d] transition"
              type="button"
            >
              {i18n.language === "en" ? "اردو" : "English"}
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
