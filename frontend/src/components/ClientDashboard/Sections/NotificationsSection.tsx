import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
} from "lucide-react";

type NotificationType =
  | "Hearing"
  | "Document"
  | "Payment"
  | "Meeting"
  | "Profile"
  | "System";

type Priority = "High" | "Medium" | "Low";

type ApiNotification = {
  id: number;
  case_id: number | null;
  title: string;
  description: string | null;
  type: NotificationType;
  priority: Priority;
  is_read: boolean;
  created_at: string;
};

type NotificationItem = {
  id: string;
  title: string;
  description?: string;
  time: string;
  type: NotificationType;
  priority: Priority;
  caseId?: string;
  read: boolean;
};

const API_URL = "http://localhost:5000/api/client/dashboard/notifications";

/**
 * ✅ SAFE headers builder (TS compatible)
 */
const buildHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const token = localStorage.getItem("token");
  if (token) {
    (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  return headers;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export default function NotificationsSection() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"All" | NotificationType>("All");
  const [readFilter, setReadFilter] = useState<"All" | "Unread" | "Read">("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔹 FETCH
  const fetchNotifications = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(API_URL, {
        headers: buildHeaders(),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");

      const mapped: NotificationItem[] = data.notifications.map(
        (n: ApiNotification) => ({
          id: String(n.id),
          title: n.title,
          description: n.description || undefined,
          time: timeAgo(n.created_at),
          type: n.type,
          priority: n.priority,
          caseId: n.case_id ? `CASE-${n.case_id}` : undefined,
          read: n.is_read,
        })
      );

      setItems(mapped);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // 🔹 ACTIONS (BACKEND CONNECTED)
  const toggleRead = async (id: string, read: boolean) => {
    await fetch(`${API_URL}/${id}/read`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify({ read }),
    });
    fetchNotifications();
  };

  const markAllRead = async () => {
    await fetch(`${API_URL}/mark-all-read`, {
      method: "PATCH",
      headers: buildHeaders(),
    });
    fetchNotifications();
  };

  const clearRead = async () => {
    await fetch(`${API_URL}/clear-read`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    fetchNotifications();
  };

  const unreadCount = items.filter((x) => !x.read).length;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return items
      .filter((x) => (typeFilter === "All" ? true : x.type === typeFilter))
      .filter((x) =>
        readFilter === "All"
          ? true
          : readFilter === "Unread"
          ? !x.read
          : x.read
      )
      .filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          (x.description || "").toLowerCase().includes(q)
      );
  }, [items, query, typeFilter, readFilter]);

  return (
    <section className="space-y-6">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-[#004aad]">Notifications</h1>
        <span className="text-sm font-semibold">
          <Bell size={14} /> Unread: {unreadCount}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        <input
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border px-3 py-2 rounded-xl"
        />

        <button onClick={markAllRead} className="btn">
          Mark all read
        </button>

        <button onClick={clearRead} className="btn">
          Clear read
        </button>
      </div>

      <div className="bg-white rounded-xl border">
        {loading ? (
          <p className="p-6">Loading…</p>
        ) : error ? (
          <p className="p-6 text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6">No notifications</p>
        ) : (
          filtered.map((n) => (
            <div key={n.id} className="p-4 border-b flex justify-between">
              <div>
                <p className={`font-semibold ${n.read ? "text-gray-600" : ""}`}>
                  {n.title}
                </p>
                {n.description && (
                  <p className="text-sm text-gray-500">{n.description}</p>
                )}
                <span className="text-xs text-gray-400">{n.time}</span>
              </div>

              <button
                onClick={() => toggleRead(n.id, !n.read)}
                className="text-sm underline"
              >
                {n.read ? "Mark unread" : "Mark read"}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-slate-500">
        Notifications are fully synced with the server.
      </p>
    </section>
  );
}
