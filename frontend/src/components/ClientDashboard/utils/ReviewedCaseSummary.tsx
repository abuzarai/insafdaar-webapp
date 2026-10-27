import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../../../config";
import { IntakeDetails, ReviewedData } from "../../VoiceInterview/IntakeDetails";
import "../../VoiceInterview/VoiceInterviewPanel.css";

type Snapshot = { caseId: number; submittedRevisionId: string | null; revision: { revisionId: string; reviewedData: ReviewedData } | null };

export default function ReviewedCaseSummary({ caseId }: { caseId: number }) {
  const token = useRef(localStorage.getItem("token")).current;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { i18n } = useTranslation();
  useEffect(() => {
    const attempt = ++generation.current;
    const controller = new AbortController();
    const current = () => generation.current === attempt && token === localStorage.getItem("token");
    setLoading(true); setError(false); setSnapshot(null);
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/client/dashboard/start-case/${caseId}/intake-v2/review`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Summary unavailable");
        const data: Snapshot = await response.json();
        if (data.caseId !== caseId || (data.submittedRevisionId && data.revision?.revisionId !== data.submittedRevisionId)) throw new Error("Summary identity mismatch");
        if (current()) setSnapshot(data);
      } catch { if (current()) setError(true); }
      finally { if (current()) setLoading(false); }
    })();
    return () => { generation.current++; controller.abort(); };
  }, [caseId, token, reload]);
  return <section className="review-first [&_summary]:!min-h-[44px] rounded-2xl border border-slate-200 bg-white p-5" aria-label="Your case summary">
    <h2 className="text-xl font-bold text-slate-900">Your case summary</h2>
    {loading ? <p role="status">Loading your saved summary…</p> : error ? <div role="alert"><p>We couldn’t load your saved summary.</p><button type="button" onClick={() => setReload(n => n + 1)} className="min-h-[44px] text-[#004aad] underline">Try again</button></div> : snapshot?.revision ? <>
      <p className="text-sm text-slate-600 my-3">{snapshot.submittedRevisionId ? "These are the details you approved and submitted. This copy is read-only." : "These details are saved but have not been submitted. Continue this case to review or make changes."}</p>
      <IntakeDetails data={snapshot.revision.reviewedData} urdu={!!i18n.language?.startsWith("ur")} canEdit={false} expanded={expanded} onExpanded={setExpanded} onEdit={() => {}} />
    </> : <p className="text-sm text-slate-600 mt-3">No reviewed summary is saved for this case yet.</p>}
  </section>;
}
