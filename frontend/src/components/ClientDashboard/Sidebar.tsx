// Sidebar.tsx
import React, { useMemo, useState } from "react";
import {
  LayoutDashboard,
  FilePlus2,
  Bell,
  User,
  CreditCard,
  MessageSquare,
  Menu,
  X,
  BadgeCheck,
  FileSignature,
} from "lucide-react";
import { API_BASE_URL } from "../../config"; // adjust path if needed
import UserAvatar from "../common/UserAvatar";

export type SectionName =
  | "My Cases"
  | "Start Case"
  | "Case Details"
  | "Notifications"
  | "Billing"
  | "Feedback"
  | "Contract"
  | "Profile";

type ProfileStatus = "INCOMPLETE" | "PENDING_VERIFICATION" | "VERIFIED";

type ClientProfile = {
  fullName: string;
  email: string;
  avatarUrl: string;
  identityDocStatus: ProfileStatus;
};

interface SidebarProps {
  active: SectionName;
  setActive: (s: SectionName) => void;

  profile: ClientProfile | null;
  profileLoading: boolean;
  completeness: number;
  canStartCase: boolean;
}

export default function Sidebar({
  active,
  setActive,
  profile,
  profileLoading,
  completeness,
  canStartCase,
}: SidebarProps) {
  const [open, setOpen] = useState(false);

  // ✅ Build correct avatar URL (supports "/uploads/..." from backend)
  const avatar =
    profileLoading
      ? null
      : profile?.avatarUrl?.trim()
      ? profile.avatarUrl.startsWith("http")
        ? profile.avatarUrl
        : `${API_BASE_URL}${profile.avatarUrl}`
      : null;

  const displayName =
    profileLoading ? "Loading…" : profile?.fullName?.trim() || "Client";

  const displayEmail =
    profileLoading ? "" : profile?.email?.trim() || "Registered Client";

  const isVerified = profile?.identityDocStatus === "VERIFIED";

  // ✅ Profile placed directly under progress bar (top of menu)
  const sections: { name: SectionName; icon: React.ReactNode; locked?: boolean }[] =
    useMemo(
      () => [
        { name: "Profile", icon: <User size={18} /> },
        { name: "My Cases", icon: <LayoutDashboard size={18} /> },
        { name: "Start Case", icon: <FilePlus2 size={18} />, locked: !canStartCase },
        { name: "Case Details", icon: <LayoutDashboard size={18} /> },
        { name: "Notifications", icon: <Bell size={18} /> },
        { name: "Billing", icon: <CreditCard size={18} /> },
        { name: "Feedback", icon: <MessageSquare size={18} /> },
        { name: "Contract", icon: <FileSignature size={18} /> },
      ],
      [canStartCase]
    );

  const handleNav = (section: SectionName, locked?: boolean) => {
    if (locked) {
      setActive("Profile");
      setOpen(false);
      return;
    }
    setActive(section);
    setOpen(false);
  };

  return (
    <>
      {/* 📱 Mobile Toggle Button */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 bg-[#004aad] text-white rounded-md shadow-md"
        onClick={() => setOpen(!open)}
        aria-label="Toggle sidebar"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Mobile overlay so sidebar doesn't "break" layout & closes nicely */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-black/40 md:hidden transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-[#00142e] text-white transform
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          transition-transform duration-300 ease-in-out flex flex-col justify-between shadow-xl`}
      >
        <div>
          {/* 👤 Profile Box */}
          <div
            className="flex flex-col items-center py-8 border-b border-white/10 cursor-pointer"
            onClick={() => handleNav("Profile")}
          >
            <UserAvatar
              name={displayName}
              role="client"
              url={avatar}
              size={96}
              className="border-2 border-[#f5b301] shadow-md hover:scale-105 transition-transform"
            />

            <h2 className="text-lg font-bold mt-3 flex items-center gap-2">
              {displayName}
              {!profileLoading && isVerified ? (
                <BadgeCheck size={18} className="text-emerald-400" />
              ) : null}
            </h2>

            <p className="text-gray-400 text-sm">{displayEmail}</p>

            <div className="mt-3 w-[85%]">
              <div className="text-[11px] text-white/60 flex justify-between">
                <span>Profile</span>
                <span
                  className={canStartCase ? "text-emerald-300" : "text-amber-300"}
                >
                  {profileLoading ? "…" : `${completeness}%`}
                </span>
              </div>

              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-1">
                <div
                  className="h-2 bg-[#f5b301]"
                  style={{ width: `${profileLoading ? 0 : completeness}%` }}
                />
              </div>

              {!profileLoading && !canStartCase && (
                <div className="text-[11px] text-amber-300 mt-2">
                  Complete profile to enable Start Case
                </div>
              )}
            </div>
          </div>

          {/* 📌 Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2">
            {sections.map((section) => {
              const locked = !!section.locked;

              return (
                <button
                  key={section.name}
                  type="button"
                  onClick={() => handleNav(section.name, locked)}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg transition-all text-sm
                    ${
                      active === section.name
                        ? "bg-[#f5b301] text-[#00142e] font-semibold shadow-md"
                        : "hover:bg-[#002a66] text-gray-300"
                    }
                    ${locked ? "opacity-50" : ""}`}
                  title={locked ? "Complete profile to start case" : ""}
                >
                  {section.icon}
                  {section.name}
                  {locked ? (
                    <span className="ml-auto text-[10px] text-amber-300">
                      LOCKED
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ⚖Footer */}
        <div className="text-center text-xs text-gray-400 pb-6 border-t border-white/10 pt-4">
          <p>© {new Date().getFullYear()} Insafdaar</p>
          <p className="text-[#f5b301] font-semibold">Justice for Everyone</p>
        </div>
      </aside>
    </>
  );
}
