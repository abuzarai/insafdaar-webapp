import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Search,
  Filter,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Circle,
  MailOpen,
  Mail,
} from "lucide-react";

import { API_BASE_URL } from "../../config";

/* ================= Types ================= */

type AdvocateNotification = {
  id: number;
  advocate_id: number;
  title: string;
  description: string;
  type: string | null;
  priority: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
};

type NotificationsResponse = {
  ok?: boolean;
  total: number;
  unread: number;
  items: AdvocateNotification[];
  error?: string;
  message?: string;
};

type Props = {
  /** "page" shows full notifications UI, "bell" shows only bell + unread badge */
  variant?: "page" | "bell";
  /** optional click handler (useful for bell in header) */
  onGoToNotifications?: () => void;
  /** optional polling for bell/page counts (ms). default 30000 */
  pollMs?: number;
};

/* ================= Helpers ================= */

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!ct.includes("application/json")) {
    throw new Error(`Expected JSON but got "${ct}". Response starts: ${text.slice(0, 120)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function fmtPKT(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
  } catch {
    return iso;
  }
}

function normalizePriority(p?: string | null) {
  const v = (p || "").toString().trim().toUpperCase();
  if (v === "HIGH") return { label: "High", variant: "red" as const };
  if (v === "MEDIUM") return { label: "Medium", variant: "amber" as const };
  if (v === "LOW") return { label: "Low", variant: "gray" as const };
  return { label: p || "—", variant: "gray" as const };
}

function normalizeType(t?: string | null) {
  const v = (t || "").toString().trim();
  return v || "General";
}

/* ================= UI bits ================= */

function Pill({
  children,
  variant = "gray",
}: {
  children: React.ReactNode;
  variant?: "gray" | "blue" | "amber" | "green" | "red";
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

function Toast({ msg, type }: { msg: string; type: "ok" | "err" }) {
  return (
    <div
      className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold ${
        type === "ok"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-red-50 border-red-200 text-red-800"
      }`}
    >
      {msg}
    </div>
  );
}

/* ================= Component ================= */

export default function AdvocateNotifications({
  variant = "page",
  onGoToNotifications,
  pollMs = 30000,
}: Props) {
  const ADV_NOTIF_BASE = `${API_BASE_URL}/api/advocate/dashboard`;

  const [items, setItems] = useState<AdvocateNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);

  const hasMore = items.length < total;

  const fetchNotifications = async (opts?: { reset?: boolean; silent?: boolean }) => {
    const reset = !!opts?.reset;
    const silent = !!opts?.silent;

    if (!silent) setLoading(true);
    try {
      const nextOffset = reset ? 0 : offset;

      const url = new URL(`${ADV_NOTIF_BASE}/notifications`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(nextOffset));
      url.searchParams.set("unreadOnly", String(unreadOnly));

      const res = await fetch(url.toString(), { method: "GET", headers: authHeaders() });
      const data = await safeJson<NotificationsResponse>(res);

      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to fetch notifications");

      setTotal(Number(data?.total || 0));
      setUnread(Number(data?.unread || 0));

      const newItems = Array.isArray(data?.items) ? data.items : [];

      if (reset) {
        setItems(newItems);
        setOffset(newItems.length);
      } else {
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const merged = [...prev];
          for (const n of newItems) {
            if (!seen.has(n.id)) merged.push(n);
          }
          return merged;
        });
        setOffset((prev) => prev + newItems.length);
      }
    } catch (e: any) {
      if (!silent && variant === "page") setToast({ msg: e?.message || "Failed to load notifications.", type: "err" });
      if (reset) {
        setItems([]);
        setTotal(0);
        setUnread(0);
        setOffset(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchUnreadOnlyCount = async () => {
    try {
      const res = await fetch(`${ADV_NOTIF_BASE}/notifications?limit=1&offset=0`, {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await safeJson<NotificationsResponse>(res);
      if (!res.ok) return;
      setUnread(Number(data?.unread || 0));
      setTotal(Number(data?.total || 0));
    } catch {
      // ignore
    }
  };

  // If it's bell variant: just keep unread count updated
  useEffect(() => {
    if (variant !== "bell") return;

    fetchUnreadOnlyCount();
    const t = setInterval(fetchUnreadOnlyCount, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, pollMs]);

  // Page variant: initial fetch + refetch on unreadOnly
  useEffect(() => {
    if (variant !== "page") return;
    fetchNotifications({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  useEffect(() => {
    if (variant !== "page") return;
    fetchNotifications({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  const loadMore = async () => {
    if (loadingMore || loading) return;
    if (!hasMore) return;

    setLoadingMore(true);
    try {
      await fetchNotifications({ reset: false });
    } finally {
      setLoadingMore(false);
    }
  };

  const markOneRead = async (id: number) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));

    try {
      const res = await fetch(`${ADV_NOTIF_BASE}/notifications/${id}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await safeJson<any>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to mark read");
      await fetchNotifications({ reset: true, silent: true });
    } catch (e: any) {
      setToast({ msg: e?.message || "Failed to mark read.", type: "err" });
      await fetchNotifications({ reset: true });
    }
  };

  const markAllRead = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${ADV_NOTIF_BASE}/notifications/read-all`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await safeJson<any>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to mark all read");

      setToast({ msg: "All notifications marked as read.", type: "ok" });
      await fetchNotifications({ reset: true, silent: true });
    } catch (e: any) {
      setToast({ msg: e?.message || "Failed to mark all read.", type: "err" });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    return items.filter((n) => {
      const t = (n.title || "").toLowerCase();
      const d = (n.description || "").toLowerCase();
      const ty = (n.type || "").toLowerCase();
      const pr = (n.priority || "").toLowerCase();
      return (
        String(n.id).includes(q) ||
        t.includes(q) ||
        d.includes(q) ||
        ty.includes(q) ||
        pr.includes(q)
      );
    });
  }, [items, query]);

  /* ================= Bell Variant ================= */
  if (variant === "bell") {
    return (
      <button
        type="button"
        onClick={() => onGoToNotifications?.()}
        className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
        title="Notifications"
      >
        <Bell size={18} className="text-[#004aad]" />

        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
    );
  }

  /* ================= Page Variant ================= */
  return (
    <section className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]"
          >
            <Toast msg={toast.msg} type={toast.type} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#004aad] border-b pb-2">Notifications</h1>
          <p className="text-sm text-slate-600 mt-2">Your advocate notifications from the dashboard (latest first).</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Pill variant="blue">
            <Bell size={14} /> {loading ? "Loading..." : `${total} total`}
          </Pill>
          <Pill variant={unread > 0 ? "amber" : "green"}>
            {unread > 0 ? <Mail size={14} /> : <MailOpen size={14} />} {unread} unread
          </Pill>

          <button
            type="button"
            onClick={() => fetchNotifications({ reset: true })}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>

          <button
            type="button"
            onClick={markAllRead}
            disabled={loading || unread === 0}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-semibold text-sm transition ${
              loading || unread === 0
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-[#004aad] text-white hover:bg-[#003b82]"
            }`}
          >
            <CheckCircle2 size={16} />
            Mark all read
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
          <Search size={16} className="text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, description, type, priority, or id..."
            className="bg-transparent outline-none w-full text-sm text-slate-800"
          />
          {query ? (
            <button
              type="button"
              className="p-1 rounded-lg hover:bg-slate-200/60 transition"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={16} className="text-slate-600" />
            </button>
          ) : null}
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold">
          <Filter size={16} className="text-[#004aad]" />
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-[#004aad]"
            />
            Unread only
          </label>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="space-y-3">
          {!loading && filtered.length === 0 ? (
            <div className="text-sm text-slate-700">
              No notifications found.
              <div className="text-xs text-slate-500 mt-1">Try turning off “Unread only” or clear search.</div>
            </div>
          ) : (
            filtered.map((n) => {
              const pr = normalizePriority(n.priority);
              return (
                <div
                  key={n.id}
                  className={`border rounded-2xl p-4 transition ${
                    n.is_read ? "border-slate-200 bg-white" : "border-[#004aad]/30 bg-blue-50/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs text-slate-500">#{n.id}</div>

                        <Pill variant={pr.variant}>
                          <Circle size={10} /> {pr.label}
                        </Pill>

                        <Pill variant="gray">{normalizeType(n.type)}</Pill>

                        {!n.is_read ? (
                          <Pill variant="blue">
                            <Mail size={14} /> Unread
                          </Pill>
                        ) : (
                          <Pill variant="green">
                            <MailOpen size={14} /> Read
                          </Pill>
                        )}
                      </div>

                      <div className="text-sm md:text-base font-bold text-slate-900 mt-2">{n.title || "—"}</div>

                      {n.description ? (
                        <div className="text-sm text-slate-700 mt-1 whitespace-pre-line">{n.description}</div>
                      ) : null}

                      <div className="text-xs text-slate-500 mt-2">
                        Created: <span className="font-semibold">{fmtPKT(n.created_at)}</span>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {!n.is_read ? (
                        <button
                          type="button"
                          onClick={() => markOneRead(n.id)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl font-semibold bg-[#004aad] text-white hover:bg-[#003b82] transition"
                        >
                          <CheckCircle2 size={16} />
                          Mark read
                        </button>
                      ) : (
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <AlertTriangle size={14} className="text-emerald-500" />
                          Already read
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-500">
            Showing <span className="font-semibold">{items.length}</span> of{" "}
            <span className="font-semibold">{total}</span>
            {unreadOnly ? " (unread only)" : ""}
          </div>

          <button
            type="button"
            onClick={loadMore}
            disabled={loading || loadingMore || !hasMore || unreadOnly}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-semibold text-sm transition ${
              loading || loadingMore || !hasMore || unreadOnly
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-white border border-slate-200 hover:bg-slate-50"
            }`}
            title={unreadOnly ? "Load more disabled in Unread only mode" : "Load more"}
          >
            <RefreshCw size={16} className={loadingMore ? "animate-spin" : ""} />
            {loadingMore ? "Loading..." : hasMore ? "Load more" : "No more"}
          </button>
        </div>

        {unreadOnly ? (
          <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            Load more is disabled for Unread only (because backend pagination is filtered). Turn it off to paginate all.
          </div>
        ) : null}
      </div>
    </section>
  );
}

