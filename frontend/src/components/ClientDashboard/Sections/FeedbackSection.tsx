import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../config";

type Audience = "Website/App" | "Admin Team" | "Advocate";
type CaseOption = { id: string; title: string; advocate?: { assigned: boolean; name?: string } };
type Feedback = { id: number; audience: string; message: string; created_at: string; case_id?: number | null };
const ratingFields: Record<Audience, [string, string][]> = {
  "Website/App": [["websiteUX", "Ease of use"], ["websiteSpeed", "Speed"]],
  "Admin Team": [["adminHelpfulness", "Helpfulness"], ["adminResponse", "Response time"]],
  Advocate: [["advocateKnowledge", "Legal knowledge"], ["advocateResponsiveness", "Communication"], ["advocateAvailability", "Availability"], ["advocateCaseHandling", "Case handling"]],
};
const BASE = `${API_BASE_URL}/api/client/dashboard/feedback`;

export default function FeedbackSection() {
  const token = useRef(localStorage.getItem("token")).current;
  const alive = useRef(true), running = useRef(false);
  const current = useCallback(() => alive.current && token === localStorage.getItem("token"), [token]);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [audience, setAudience] = useState<Audience>("Website/App");
  const [caseId, setCaseId] = useState("");
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [casesError, setCasesError] = useState(false);
  const [casesLoading, setCasesLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [contactPref, setContactPref] = useState("No need");
  const [contactValue, setContactValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Feedback[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const loadCases = useCallback(async () => {
    setCasesLoading(true); setCasesError(false);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/client/dashboard/cases`, { headers: headers() });
      if (current()) setCases(Array.isArray(response.data?.cases) ? response.data.cases : []);
    } catch { if (current()) setCasesError(true); }
    finally { if (current()) setCasesLoading(false); }
  }, [current, headers]);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError(false);
    try {
      const response = await axios.get(`${BASE}/mine`, { headers: headers() });
      if (current()) setHistory(response.data?.feedback || []);
    } catch { if (current()) setHistoryError(true); }
    finally { if (current()) setHistoryLoading(false); }
  }, [current, headers]);
  useEffect(() => { alive.current = true; void loadCases(); void loadHistory(); return () => { alive.current = false; }; }, [loadCases, loadHistory]);
  const availableCases = cases.filter(c => audience !== "Advocate" || c.advocate?.assigned);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (running.current || !current()) return;
    setError(""); setNotice("");
    if (!message.trim()) { setError("Please write your feedback."); return; }
    if (audience === "Advocate" && !caseId) { setError("Choose a case with an assigned lawyer."); return; }
    if (caseId && !availableCases.some(c => c.id === caseId)) { setError("Please choose an available case."); return; }
    if (contactPref !== "No need" && !contactValue.trim()) { setError("Enter your contact details or choose No follow-up requested."); return; }
    running.current = true; setBusy(true);
    try {
      await axios.post(BASE, { audience, caseId: caseId || null, category: "General", sentiment: "Neutral", message: message.trim(),
        contactPref, contactValue: contactPref === "No need" ? null : contactValue.trim(),
        ratings: Object.fromEntries(ratingFields[audience].filter(([key]) => ratings[key]).map(([key]) => [key, ratings[key]])),
      }, { headers: headers(), timeout: 15000 });
      if (!current()) return;
      setMessage(""); setRatings({}); setContactPref("No need"); setContactValue("");
      setNotice("Thank you. Your feedback has been saved.");
      await loadHistory();
    } catch { if (current()) setError("We couldn’t confirm that your feedback was saved. Check your feedback history before trying again. Your message is still here."); }
    finally { running.current = false; if (current()) setBusy(false); }
  };
  return <section className="space-y-6">
    <div><h1 className="text-3xl font-bold text-[#004aad]">Feedback</h1><p className="mt-2 text-sm text-slate-600">Tell us what worked or what could be better. Feedback does not submit or change your case details.</p></div>
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</p>}
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <fieldset disabled={busy} className="space-y-5">
        <div><label htmlFor="feedback-message" className="block font-semibold mb-2">Your feedback</label><textarea id="feedback-message" required rows={4} value={message} onChange={e => { setMessage(e.target.value); setNotice(""); }} className="w-full rounded-xl border border-slate-300 p-3" /></div>
        <div><label htmlFor="feedback-audience" className="block text-sm font-semibold mb-2">What is your feedback about?</label><select id="feedback-audience" value={audience} onChange={e => { setAudience(e.target.value as Audience); setCaseId(""); }} className="w-full min-h-[44px] rounded-xl border p-3"><option value="Website/App">Website</option><option value="Admin Team">Service team</option><option value="Advocate">Your lawyer</option></select></div>
        <div><label htmlFor="feedback-case" className="block text-sm font-semibold mb-2">{audience === "Advocate" ? "Choose the case and lawyer" : "Related case (optional)"}</label>
          <select id="feedback-case" value={caseId} onChange={e => setCaseId(e.target.value)} disabled={casesLoading || casesError} className="w-full min-h-[44px] rounded-xl border p-3"><option value="">{casesLoading ? "Loading cases…" : audience === "Advocate" ? "Choose a case" : "Not about a particular case"}</option>{availableCases.map(c => <option key={c.id} value={c.id}>{c.title}{c.advocate?.assigned ? ` — ${c.advocate.name || "Assigned lawyer"}` : ""}</option>)}</select>
          {casesError && <p role="alert" className="text-sm mt-2">We couldn’t load your cases. <button type="button" onClick={loadCases} className="min-h-[44px] text-[#004aad] underline">Try again</button></p>}
          {!casesLoading && !casesError && audience === "Advocate" && !availableCases.length && <p className="text-sm text-slate-600 mt-2">No case with an assigned lawyer is available.</p>}
        </div>
        <details className="rounded-xl border p-3"><summary className="min-h-[44px] cursor-pointer font-semibold">Ratings and follow-up (optional)</summary><div className="space-y-4 mt-3">
          {ratingFields[audience].map(([key, label]) => <div key={key} role="group" aria-label={label}><p className="text-sm font-semibold mb-2">{label}</p><div className="flex gap-1 flex-wrap">{[1,2,3,4,5].map(value => <button key={value} type="button" aria-label={`${label}: ${value} out of 5`} aria-pressed={ratings[key] === value} onClick={() => setRatings(previous => ({ ...previous, [key]: previous[key] === value ? 0 : value }))} className={`min-h-[44px] min-w-[44px] border rounded-lg ${ratings[key] === value ? "bg-[#004aad] text-white" : "bg-white text-slate-700"}`}>{value}</button>)}</div></div>)}
          <div><label htmlFor="feedback-contact" className="block text-sm font-semibold mb-2">Follow-up preference</label><select id="feedback-contact" value={contactPref} onChange={e => setContactPref(e.target.value)} className="w-full min-h-[44px] rounded-xl border p-3"><option value="No need">No follow-up requested</option><option value="Email">Email</option><option value="Phone call">Phone call</option></select></div>
          {contactPref !== "No need" && <div><label htmlFor="feedback-contact-value" className="block text-sm font-semibold mb-2">{contactPref === "Email" ? "Email address" : "Phone number"}</label><input id="feedback-contact-value" type={contactPref === "Email" ? "email" : "tel"} value={contactValue} onChange={e => setContactValue(e.target.value)} className="w-full min-h-[44px] rounded-xl border p-3" /></div>}
        </div></details>
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-[#004aad] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Send feedback"}</button>
      </fieldset>
    </form>
    <section aria-label="Your feedback history" className="space-y-3"><div className="flex flex-wrap gap-3 justify-between items-center"><h2 className="text-xl font-bold">Your feedback</h2><button type="button" onClick={loadHistory} disabled={historyLoading || busy} className="min-h-[44px] text-[#004aad] underline">Refresh feedback history</button></div>
      {historyLoading ? <p role="status">Loading feedback…</p> : historyError ? <p role="alert">We couldn’t load your feedback history. Use Refresh feedback history to try again.</p> : !history.length ? <p className="text-sm text-slate-600">You have not sent any feedback yet.</p> : history.map(row => <article key={row.id} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-600">{new Date(row.created_at).toLocaleDateString()}</p><p className="mt-2 whitespace-pre-wrap break-words">{row.message}</p></article>)}
    </section>
  </section>;
}
