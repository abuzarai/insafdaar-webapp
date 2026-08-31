import { useEffect, useMemo, useState } from "react";
import UserAvatar from "../common/UserAvatar";
import {
  Menu,
  X,
  FileText,
  Gavel,
  Briefcase,
  CheckCircle,
  MessageSquareText,
  Bell,
  ClipboardCheck,
  FileSignature,
  Receipt,
} from "lucide-react";
import { API_BASE_URL } from "../../config";

interface SidebarProps {
  active: string;
  setActive: (section: string) => void;
}

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!ct.includes("application/json")) throw new Error("Expected JSON response");
  return (text ? JSON.parse(text) : null) as T;
}

export default function Sidebar({ active, setActive }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const [assignedCount, setAssignedCount] = useState<number>(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);
  const [profileInfo, setProfileInfo] = useState<{
    name: string;
    practiceAreas: string[];
    experienceYears: number;
  } | null>(null);

  const fetchProfileInfo = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/profile/`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<any>(res);
      if (!res.ok) return;
      const p = data?.profile || data || {};
      setProfileInfo({
        name: p.name || "Advocate",
        practiceAreas: Array.isArray(p.practiceAreas) ? p.practiceAreas : [],
        experienceYears: Number(p.experienceYears) || 0,
      });
    } catch {
      // ignore — sidebar falls back to generic labels
    }
  };

  const fetchAssignedCount = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/cases/assigned`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<{ cases?: any[] }>(res);
      if (!res.ok) return;
      setAssignedCount(Array.isArray(data?.cases) ? data.cases.length : 0);
    } catch {
      // ignore
    }
  };

  const fetchUnreadNotifCount = async () => {
    try {
      // backend returns { ok:true, total, unread, items }
      const res = await fetch(`${API_BASE_URL}/api/advocate/dashboard/notifications?limit=1&offset=0`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<{ unread?: number }>(res);
      if (!res.ok) return;
      setUnreadNotifCount(Number(data?.unread || 0));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchAssignedCount();
    fetchUnreadNotifCount();
    fetchProfileInfo();

    const t = setInterval(() => {
      fetchAssignedCount();
      fetchUnreadNotifCount();
    }, 30000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Updated order (as you requested)
  const sections = useMemo(
    () => [
      { name: "Case Intake", icon: <FileText size={18} /> },

      {
        name: "Case Discussion",
        icon: <MessageSquareText size={18} />,
        badge: assignedCount > 0 ? assignedCount : null,
      },

      { name: "Case Preparation", icon: <Gavel size={18} /> },
      { name: "Case Hearing", icon: <Briefcase size={18} /> },

      // ✅ Added: Stages Tracking
      { name: "Stages Tracking", icon: <ClipboardCheck size={18} /> },

      {
        name: "Notifications",
        icon: <Bell size={18} />,
        badge: unreadNotifCount > 0 ? unreadNotifCount : null,
      },

      { name: "Case Closure", icon: <CheckCircle size={18} /> },
      { name: "Contract", icon: <FileSignature size={18} /> },
      { name: "Vouchers", icon: <Receipt size={18} /> },
    ],
    [assignedCount, unreadNotifCount]
  );

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="md:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 bg-[#004aad] text-white rounded-md shadow-md hover:bg-[#003b82] transition"
        >
          {isOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar Container */}
      <aside
        className={`fixed md:static top-0 left-0 h-full md:h-auto w-72 bg-[#00142e] text-white border-r border-white/10 flex flex-col justify-between transform transition-transform duration-300 ease-in-out z-40
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Advocate Info */}
        <div>
          <div
            className="flex flex-col items-center py-8 border-b border-white/10 cursor-pointer"
            onClick={() => {
              setActive("Advocate Profile");
              setIsOpen(false);
            }}
          >
            <UserAvatar
              name={profileInfo?.name || "Advocate"}
              role="advocate"
              size={80}
              className="border-2 border-[#f5b301] hover:scale-105 transition-transform"
            />
            <h2 className="text-lg font-bold mt-3 hover:text-[#f5b301] transition-colors">
              {profileInfo?.name ? `Adv. ${profileInfo.name}` : "Advocate"}
            </h2>
            <p className="text-gray-400 text-sm">
              {(profileInfo?.practiceAreas?.length ?? 0) > 0
                ? profileInfo!.practiceAreas.slice(0, 2).join(", ")
                : "Civil & Family Law"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {(profileInfo?.experienceYears ?? 0) > 0
                ? `${profileInfo!.experienceYears}+ Years Experience`
                : "Verified Advocate"}
            </p>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setActive("Advocate Profile");
                setIsOpen(false);
              }}
              className="mt-4 px-4 py-1.5 bg-[#f5b301] text-[#00142e] text-sm font-semibold rounded-lg hover:bg-[#ffd84d] transition"
            >
              View Profile
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto max-h-[60vh] md:max-h-none">
            {sections.map((section) => (
              <button
                key={section.name}
                onClick={() => {
                  setActive(section.name);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between gap-3 w-full px-4 py-2.5 rounded-lg transition-all text-left ${
                  active === section.name
                    ? "bg-[#f5b301] text-[#00142e] font-semibold"
                    : "hover:bg-[#002a66] text-gray-300"
                }`}
              >
                <span className="flex items-center gap-3">
                  {section.icon}
                  {section.name}
                </span>

                {typeof (section as any).badge === "number" && (section as any).badge > 0 ? (
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      active === section.name ? "bg-white/90 text-[#00142e]" : "bg-white/10 text-white"
                    }`}
                    title={section.name === "Notifications" ? "Unread notifications" : "Assigned cases"}
                  >
                    {(section as any).badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-6 border-t border-white/10 pt-4">
          <p>© {new Date().getFullYear()} Insafdaar</p>
          <p className="text-[#f5b301] font-semibold">AI-Powered Justice</p>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setIsOpen(false)}></div>
      )}
    </>
  );
}
