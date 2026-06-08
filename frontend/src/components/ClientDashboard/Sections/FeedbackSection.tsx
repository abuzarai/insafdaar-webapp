import React, { useMemo, useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../config";

import {
  MessageSquare,
  Globe,
  Briefcase,
  User,
  Timer,
  ShieldCheck,
  Bug,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  Send,
  CheckCircle2,
  Loader2,
  Star,
  List,
} from "lucide-react";

type Audience = "Website/App" | "Admin Team" | "Advocate";
type CaseArea =
  | "General"
  | "Communication"
  | "Responsiveness"
  | "Availability"
  | "Professionalism"
  | "Case Handling"
  | "Payments"
  | "Documentation"
  | "Support"
  | "Bug/Issue";

type ContactPref = "No need" | "Email" | "Phone call";

type FeedbackRow = {
  id: number;
  audience: Audience;
  category: CaseArea;
  sentiment: "Positive" | "Neutral" | "Negative";
  message: string;
  case_id?: number | null;
  case_ref?: string | null;
  advocate_id?: number | null;
  contact_pref?: string | null;
  contact_value?: string | null;
  created_at: string;

  // ratings (optional)
  website_ux?: number | null;
  website_speed?: number | null;

  admin_helpfulness?: number | null;
  admin_response?: number | null;

  advocate_knowledge?: number | null;
  advocate_responsiveness?: number | null;
  advocate_availability?: number | null;
  advocate_case_handling?: number | null;
};

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function StarRating({
  value,
  onChange,
  label,
  hint,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>

      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            type="button"
            key={star}
            onClick={() => onChange(star)}
            className={`text-2xl leading-none transition ${
              star <= value ? "text-[#f5b301]" : "text-slate-300 hover:text-[#f5b301]"
            }`}
            aria-label={`${label}: ${star} star`}
            title={`${star} star`}
          >
            ★
          </button>
        ))}
        <span className="text-sm text-slate-600 ml-2">
          {value === 0 ? "Not rated" : `${value}/5`}
        </span>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
        active
          ? "bg-[#004aad] text-white border-transparent"
          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SentimentBadge({ s }: { s: "Positive" | "Neutral" | "Negative" }) {
  const cls =
    s === "Positive"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "Neutral"
      ? "bg-slate-50 text-slate-700 border-slate-200"
      : "bg-red-50 text-red-700 border-red-200";

  return <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full border ${cls}`}>{s}</span>;
}

function ratingRow(label: string, value?: number | null) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between text-xs text-slate-600">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
        <Star size={14} className="text-[#f5b301]" />
        {value}/5
      </span>
    </div>
  );
}

export default function FeedbackSection() {
  const [audience, setAudience] = useState<Audience>("Website/App");
  const [caseId, setCaseId] = useState(""); // optional (string allowed)
  const [advocateId, setAdvocateId] = useState(""); // optional (only for Advocate)
  const [category, setCategory] = useState<CaseArea>("General");

  const [websiteUX, setWebsiteUX] = useState(0);
  const [websiteSpeed, setWebsiteSpeed] = useState(0);

  const [adminHelpfulness, setAdminHelpfulness] = useState(0);
  const [adminResponse, setAdminResponse] = useState(0);

  const [advocateKnowledge, setAdvocateKnowledge] = useState(0);
  const [advocateResponsiveness, setAdvocateResponsiveness] = useState(0);
  const [advocateAvailability, setAdvocateAvailability] = useState(0);
  const [advocateCaseHandling, setAdvocateCaseHandling] = useState(0);

  const [sentiment, setSentiment] = useState<"Positive" | "Neutral" | "Negative">("Positive");
  const [message, setMessage] = useState("");

  const [contactPref, setContactPref] = useState<ContactPref>("No need");
  const [contactValue, setContactValue] = useState("");

  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // history
  const [historyBusy, setHistoryBusy] = useState(false);
  const [myFeedback, setMyFeedback] = useState<FeedbackRow[]>([]);

  const tags = useMemo(
    () => [
      { key: "General" as CaseArea, icon: <MessageSquare size={16} className="text-[#004aad]" /> },
      { key: "Communication" as CaseArea, icon: <MessageSquare size={16} className="text-[#004aad]" /> },
      { key: "Responsiveness" as CaseArea, icon: <Timer size={16} className="text-[#004aad]" /> },
      { key: "Availability" as CaseArea, icon: <Timer size={16} className="text-[#004aad]" /> },
      { key: "Professionalism" as CaseArea, icon: <ShieldCheck size={16} className="text-[#004aad]" /> },
      { key: "Case Handling" as CaseArea, icon: <Briefcase size={16} className="text-[#004aad]" /> },
      { key: "Payments" as CaseArea, icon: <ShieldCheck size={16} className="text-[#004aad]" /> },
      { key: "Documentation" as CaseArea, icon: <ShieldCheck size={16} className="text-[#004aad]" /> },
      { key: "Support" as CaseArea, icon: <User size={16} className="text-[#004aad]" /> },
      { key: "Bug/Issue" as CaseArea, icon: <Bug size={16} className="text-[#004aad]" /> },
    ],
    []
  );

  const reset = () => {
    setAudience("Website/App");
    setCaseId("");
    setAdvocateId("");
    setCategory("General");

    setWebsiteUX(0);
    setWebsiteSpeed(0);

    setAdminHelpfulness(0);
    setAdminResponse(0);

    setAdvocateKnowledge(0);
    setAdvocateResponsiveness(0);
    setAdvocateAvailability(0);
    setAdvocateCaseHandling(0);

    setSentiment("Positive");
    setMessage("");

    setContactPref("No need");
    setContactValue("");

    setSubmitted(false);
    setMsg("");
  };

  const validate = () => {
    if (!message.trim()) return "Please write feedback details before submitting.";
    if (contactPref !== "No need" && !contactValue.trim())
      return "Please enter your contact (email/phone) or select 'No need'.";

    if (audience === "Advocate" && advocateId && !/^\d+$/.test(advocateId)) {
      return "Advocate ID must be a number (optional).";
    }

    // optional: ensure at least one rating for selected audience
    if (audience === "Website/App" && websiteUX === 0 && websiteSpeed === 0) return "Please rate at least 1 field.";
    if (audience === "Admin Team" && adminHelpfulness === 0 && adminResponse === 0) return "Please rate at least 1 field.";
    if (
      audience === "Advocate" &&
      advocateKnowledge === 0 &&
      advocateResponsiveness === 0 &&
      advocateAvailability === 0 &&
      advocateCaseHandling === 0
    )
      return "Please rate at least 1 field.";

    return null;
  };

  const fetchMyFeedback = async () => {
    try {
      setHistoryBusy(true);
      const r = await axios.get(`${API_BASE_URL}/api/client/dashboard/feedback/my`, {
        headers: authHeaders(),
      });
      setMyFeedback(r.data?.feedback || []);
    } catch (e: any) {
      // if endpoint not ready, keep UI stable
      setMyFeedback([]);
    } finally {
      setHistoryBusy(false);
    }
  };

  useEffect(() => {
    fetchMyFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const err = validate();
    if (err) {
      setMsg(`⚠️ ${err}`);
      return;
    }

    try {
      setBusy(true);
      setMsg("");

      const payload: any = {
        audience,
        category,
        sentiment,
        message: message.trim(),
        caseRef: caseId.trim() || null, // keep as string; backend can resolve later
        contactPref,
        contactValue: contactPref === "No need" ? null : contactValue.trim(),

        ratings: {
          websiteUX,
          websiteSpeed,
          adminHelpfulness,
          adminResponse,
          advocateKnowledge,
          advocateResponsiveness,
          advocateAvailability,
          advocateCaseHandling,
        },
      };

      if (audience === "Advocate" && advocateId.trim()) payload.advocateId = Number(advocateId.trim());

      await axios.post(`${API_BASE_URL}/api/client/dashboard/feedback`, payload, {
        headers: authHeaders(),
      });

      setSubmitted(true);
      setMsg("✅ Thank you! Your feedback has been submitted.");
      setTimeout(() => setSubmitted(false), 1400);

      // refresh list
      await fetchMyFeedback();

      // (optional) reset form after submit
      reset();
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "❌ Failed to submit feedback.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[#004aad] border-b pb-2">Feedback Center</h1>
          <p className="text-sm text-slate-600 mt-2">
            Share feedback about the website/app, admin team, or advocate performance. Your ratings help improve service
            quality (responsiveness, availability, case handling, and overall experience).
          </p>
          {msg && <p className="mt-2 text-sm text-amber-700">{msg}</p>}
        </div>

        {submitted && (
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            <CheckCircle2 size={14} />
            Submitted
          </div>
        )}
      </div>

      {/* Audience */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="text-lg font-bold text-slate-900">Who is this feedback for?</div>

        <div className="flex flex-wrap gap-2">
          <Pill
            active={audience === "Website/App"}
            onClick={() => setAudience("Website/App")}
            icon={<Globe size={16} />}
            label="Website / App"
          />
          <Pill
            active={audience === "Admin Team"}
            onClick={() => setAudience("Admin Team")}
            icon={<User size={16} />}
            label="Admin Team"
          />
          <Pill
            active={audience === "Advocate"}
            onClick={() => setAudience("Advocate")}
            icon={<Briefcase size={16} />}
            label="Advocate"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 font-semibold">Case ID (optional)</label>
            <input
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              placeholder="e.g. 1 or CASE-001"
              className="mt-2 w-full border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-[#004aad]"
            />
            <p className="text-xs text-slate-500 mt-2">
              If this feedback is about a specific case, add Case ID so Admin can review faster.
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-500 font-semibold">Category</label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {tags.slice(0, 9).map((t) => (
                <button
                  type="button"
                  key={t.key}
                  onClick={() => setCategory(t.key)}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition inline-flex items-center gap-2 justify-center ${
                    category === t.key
                      ? "bg-[#004aad] text-white border-transparent"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {t.icon}
                  {t.key}
                </button>
              ))}
            </div>
          </div>
        </div>

        {audience === "Advocate" && (
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-semibold">Advocate ID (optional)</label>
              <input
                value={advocateId}
                onChange={(e) => setAdvocateId(e.target.value)}
                placeholder="e.g. 12"
                className="mt-2 w-full border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-[#004aad]"
              />
              <p className="text-xs text-slate-500 mt-2">
                Later you’ll pick advocate from a list. For now, you can enter Advocate ID (optional).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Ratings */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="text-lg font-bold text-slate-900">Ratings</div>

        {audience === "Website/App" && (
          <div className="grid md:grid-cols-2 gap-5">
            <StarRating value={websiteUX} onChange={setWebsiteUX} label="Design & Usability" hint="Navigation, clarity, ease of use" />
            <StarRating value={websiteSpeed} onChange={setWebsiteSpeed} label="Speed & Performance" hint="Loading, responsiveness, stability" />
          </div>
        )}

        {audience === "Admin Team" && (
          <div className="grid md:grid-cols-2 gap-5">
            <StarRating value={adminHelpfulness} onChange={setAdminHelpfulness} label="Helpfulness & Support" hint="Guidance, clarity, problem-solving" />
            <StarRating value={adminResponse} onChange={setAdminResponse} label="Response Time" hint="How quickly the admin responds" />
          </div>
        )}

        {audience === "Advocate" && (
          <div className="grid md:grid-cols-2 gap-5">
            <StarRating value={advocateKnowledge} onChange={setAdvocateKnowledge} label="Legal Knowledge" hint="Understanding, strategy, correctness" />
            <StarRating value={advocateCaseHandling} onChange={setAdvocateCaseHandling} label="Case Handling Capability" hint="Planning, documentation, court readiness" />
            <StarRating value={advocateResponsiveness} onChange={setAdvocateResponsiveness} label="Responsiveness" hint="Replies, follow-ups, communication" />
            <StarRating value={advocateAvailability} onChange={setAdvocateAvailability} label="Availability" hint="Meeting availability, accessibility" />
          </div>
        )}

        {/* Sentiment */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">Overall sentiment</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill active={sentiment === "Positive"} onClick={() => setSentiment("Positive")} icon={<ThumbsUp size={16} />} label="Positive" />
            <Pill active={sentiment === "Neutral"} onClick={() => setSentiment("Neutral")} icon={<MessageSquare size={16} />} label="Neutral" />
            <Pill active={sentiment === "Negative"} onClick={() => setSentiment("Negative")} icon={<ThumbsDown size={16} />} label="Negative" />
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="text-lg font-bold text-slate-900">Write details</div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Lightbulb size={18} className="text-[#004aad]" />
            Helpful format (recommended)
          </div>
          <ul className="mt-2 text-sm text-slate-700 space-y-1 list-disc pl-5">
            <li>What happened? (short)</li>
            <li>Which case / date? (if applicable)</li>
            <li>What should improve? (clear action)</li>
            <li>Any evidence? (screenshots / messages)</li>
          </ul>
        </div>

        <textarea
          className="w-full border border-slate-200 rounded-2xl p-4 min-h-[140px] focus:ring-2 focus:ring-[#004aad] outline-none"
          placeholder="Write your feedback here..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        {/* Contact */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 font-semibold">Can we contact you?</label>
            <select
              value={contactPref}
              onChange={(e) => setContactPref(e.target.value as ContactPref)}
              className="mt-2 w-full border border-slate-200 rounded-xl p-3 bg-white outline-none focus:ring-2 focus:ring-[#004aad]"
            >
              <option value="No need">No need</option>
              <option value="Email">Email</option>
              <option value="Phone call">Phone call</option>
            </select>
            <p className="text-xs text-slate-500 mt-2">
              If you report an issue, contact helps us resolve faster (optional).
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-500 font-semibold">
              {contactPref === "Email" ? "Email" : contactPref === "Phone call" ? "Phone" : "Contact (optional)"}
            </label>
            <input
              value={contactValue}
              onChange={(e) => setContactValue(e.target.value)}
              disabled={contactPref === "No need"}
              placeholder={contactPref === "Email" ? "you@email.com" : contactPref === "Phone call" ? "+92..." : "—"}
              className={`mt-2 w-full border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-[#004aad] ${
                contactPref === "No need" ? "bg-slate-50 text-slate-400" : "bg-white"
              }`}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm"
            disabled={busy}
          >
            Reset
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-[#004aad] text-white font-semibold hover:bg-[#003b82] transition disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Submit Feedback
          </button>
        </div>

        <p className="text-xs text-slate-500">
           This feedback will also be used later on Advocate profile + Website ratings.
        </p>
      </div>

      {/* My Feedback History */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 text-lg font-bold text-slate-900">
            <List size={18} className="text-[#004aad]" />
            My Submitted Feedback
          </div>

          <button
            onClick={fetchMyFeedback}
            disabled={historyBusy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition font-semibold text-sm disabled:opacity-60"
          >
            {historyBusy ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} className="text-[#004aad]" />}
            Refresh
          </button>
        </div>

        {historyBusy ? (
          <div className="text-sm text-slate-600">Loading...</div>
        ) : myFeedback.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            No feedback submitted yet.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {myFeedback.map((f) => (
              <div key={f.id} className="rounded-2xl border border-slate-200 p-5 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Audience</div>
                    <div className="text-sm font-bold text-slate-900">{f.audience}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(f.created_at).toLocaleString()}
                    </div>
                  </div>
                  <SentimentBadge s={f.sentiment} />
                </div>

                <div className="mt-3 inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                  {f.category}
                </div>

                {(f.case_ref || f.case_id) && (
                  <div className="mt-2 text-xs text-slate-600">
                    Case: <span className="font-semibold text-slate-900">{f.case_ref || f.case_id}</span>
                  </div>
                )}

                {f.advocate_id && (
                  <div className="mt-1 text-xs text-slate-600">
                    Advocate ID: <span className="font-semibold text-slate-900">{f.advocate_id}</span>
                  </div>
                )}

                <div className="mt-3 text-sm text-slate-800 leading-relaxed">
                  {f.message}
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                  {ratingRow("Website UX", f.website_ux)}
                  {ratingRow("Website Speed", f.website_speed)}
                  {ratingRow("Admin Helpfulness", f.admin_helpfulness)}
                  {ratingRow("Admin Response", f.admin_response)}
                  {ratingRow("Advocate Knowledge", f.advocate_knowledge)}
                  {ratingRow("Advocate Case Handling", f.advocate_case_handling)}
                  {ratingRow("Advocate Responsiveness", f.advocate_responsiveness)}
                  {ratingRow("Advocate Availability", f.advocate_availability)}
                  {!f.website_ux &&
                    !f.website_speed &&
                    !f.admin_helpfulness &&
                    !f.admin_response &&
                    !f.advocate_knowledge &&
                    !f.advocate_case_handling &&
                    !f.advocate_responsiveness &&
                    !f.advocate_availability && (
                      <div className="text-xs text-slate-500">No ratings provided.</div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
