import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../../../config";

type Notification = { id: number; case_id: number | null; title: string; description: string | null; type: string; priority: string; is_read: boolean; created_at: string };
const API_URL = `${API_BASE_URL}/api/client/dashboard/notifications`;

export function notificationDestination(item: Pick<Notification, "type" | "case_id">) {
  if (item.type === "Profile") return "/client-dashboard?section=Profile";
  if (!Number.isSafeInteger(item.case_id) || Number(item.case_id) <= 0) return null;
  const query = new URLSearchParams({ section: "Case Details", caseId: `CASE-${item.case_id}` });
  if (item.type === "Payment") query.set("view", "Agreement & Payments");
  if (item.type === "Meeting" || item.type === "Hearing") query.set("view", "Schedule");
  if (item.type === "Document") query.set("view", "Intake & Documents");
  return `/client-dashboard?${query}`;
}

export default function NotificationsSection({ onUnreadChange }: { onUnreadChange?: (unread: boolean) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const token = useRef(localStorage.getItem("token")).current;
  const current = useCallback(() => alive.current && token === localStorage.getItem("token"), [token]);
  const headers = useCallback(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(API_URL, { headers: headers(), cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (!Array.isArray(data.notifications)) throw new Error("Unavailable");
      if (current()) { setItems(data.notifications); onUnreadChange?.(data.notifications.some((n: Notification) => !n.is_read)); }
    } catch { if (current()) setError("We couldn’t load your notifications. Please try again."); }
    finally { if (current()) setLoading(false); }
  }, [current, headers, onUnreadChange]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const update = async (path: string, method: string, body?: object) => {
    if (busy || !current()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API_URL}/${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) throw new Error("Unavailable");
      if (current()) await load();
    } catch { if (current()) setError("We couldn’t update your notifications. Please try again."); }
    finally { if (current()) setBusy(false); }
  };
  const filtered = items.filter(n => `${n.title} ${n.description || ""} ${n.case_id || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="space-y-5">
    <h1 className="text-3xl font-bold text-[#004aad]">Notifications</h1>
    <div className="flex gap-3 flex-wrap items-center">
      <input aria-label="Search notifications" placeholder="Search notifications" value={query} onChange={event => setQuery(event.target.value)} className="min-h-[44px] min-w-0 border px-3 py-2 rounded-xl" />
      <button type="button" disabled={busy || loading || !items.some(n => !n.is_read)} onClick={() => update("mark-all-read", "PATCH")} className="min-h-[44px] rounded-xl border px-3 py-2 disabled:opacity-50">Mark all read</button>
      <button type="button" disabled={busy || loading || !items.some(n => n.is_read)} onClick={() => { if (window.confirm("Remove read notifications? Your case records will not be deleted.")) void update("clear-read", "DELETE"); }} className="min-h-[44px] rounded-xl border px-3 py-2 disabled:opacity-50">Remove read notifications</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p>{error}</p><button type="button" onClick={load} disabled={loading || busy} className="min-h-[44px] text-[#004aad] underline">Try again</button></div>}
    {loading && <p role="status">Loading notifications…</p>}
    {!loading && !error && !filtered.length && <p className="rounded-xl border bg-white p-5">{query ? "No notifications match your search." : "You have no notifications yet."}</p>}
    <div className="space-y-3">{filtered.map(n => {
      const destination = notificationDestination(n);
      return <article key={n.id} className={`rounded-xl border bg-white p-4 space-y-2 ${n.is_read ? "border-slate-200" : "border-blue-300"}`}>
        <div className="flex gap-3 justify-between flex-wrap"><h2 className="font-semibold text-slate-900">{n.title}</h2>{!n.is_read && <span className="text-xs font-semibold text-[#004aad]">New</span>}</div>
        {n.description && <p className="text-sm text-slate-700">{n.description}</p>}
        <p className="text-xs text-slate-600">{Number.isSafeInteger(n.case_id) && Number(n.case_id) > 0 ? `Case ${n.case_id} · ` : ""}{new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        <div className="flex items-center gap-4 flex-wrap">
          {destination && <Link to={destination} className="inline-flex items-center min-h-[44px] font-semibold text-[#004aad] underline">{n.type === "Profile" ? "Open profile" : n.type === "Payment" ? "View agreement & payments" : n.type === "Meeting" || n.type === "Hearing" ? "View schedule" : n.type === "Document" ? "View documents" : "Open case"}</Link>}
          <button type="button" disabled={busy || loading} onClick={() => update(`${n.id}/read`, "PATCH", { read: !n.is_read })} className="min-h-[44px] text-sm text-slate-700 underline disabled:opacity-50">{n.is_read ? "Mark unread" : "Mark read"}</button>
        </div>
      </article>;
    })}</div>
  </section>;
}
