import { formatAiEnum } from "../common/formatStatus";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../../config";
import { RefreshCw, Sparkles, UserCheck, Users, BadgeCheck } from "lucide-react";

type QueueItem = {
  case_id: number;
  case_title_short?: string | null;
  case_display_label?: string | null;
  user_id: number;
  title: string | null;
  status: string;
  language: string | null;
  legal_domain: string | null;
  interview_completed: boolean;
  preferred_advocate_id: number | null;
  preferred_advocate_selected_at: string | null;
  updated_at: string;
  client_name: string | null;
  client_email: string;
  preferred_advocate_name: string | null;
  preferred_advocate_email: string | null;
  assigned_advocate_id: number | null;
  assigned_advocate_name: string | null;
  has_interview_results?: boolean;
  interview_completed_at?: string | null;
  interview_legal_domain?: string | null;
  interview_primary_issue?: string | null;
  latest_match_run_id: number | null;
  latest_match_run_at: string | null;
  shortlist_count: number;
};

type MatchCandidate = {
  id: number;
  rank_position: number;
  total_score: number;
  score_breakdown: {
    domainFit?: number;
    languageFit?: number;
    cityFit?: number;
    experienceBonus?: number;
    availabilityBonus?: number;
    workloadPenalty?: number;
  };
  reasons: string[];
  advocate_id: number;
  advocate_name: string | null;
  advocate_email: string;
};

type InterviewSummary = {
  primaryLanguage: string | null;
  legalDomain: string | null;
  issueSummary: string | null;
  urgency: string | null;
  urgencyReasoning: string | null;
  adrSuitable: boolean | null;
  adrReasoning: string | null;
  confidenceScore: number | null;
  keyEntities: {
    parties: string[];
    locations: string[];
    dates: string[];
    amounts: string[];
  };
};

type InterviewResult = {
  sessionId: number;
  meta: {
    mode: string | null;
    provider: string | null;
    status: string | null;
    language: string | null;
    completedAt: string | null;
    updatedAt: string | null;
    audioUrl: string | null;
    audioDuration: number | null;
    completionSource: string | null;
    resultHash: string | null;
    webhookReceivedAt: string | null;
    fallbackReceivedAt: string | null;
  };
  summary: InterviewSummary;
  transcript: string | null;
};

type CaseMeta = {
  case_id: number;
  case_title_short?: string | null;
  case_display_label?: string | null;
};

function authHeaders(): Headers {
  const h = new Headers();
  const token = localStorage.getItem("token");
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function safeJson(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function statusLabel(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "MATCHING_REVIEW") return "Matching Review";
  if (s === "ADVOCATE_ASSIGNED") return "Assigned (awaiting advocate)";
  if (s === "INTAKE_STARTED") return "Interview in progress";
  return s || "—";
}

function queuePriority(item: QueueItem): "high" | "medium" | "low" {
  const s = String(item.status || "").toUpperCase();
  if (s === "MATCHING_REVIEW" && item.preferred_advocate_id) return "high";
  if (s === "MATCHING_REVIEW") return "medium";
  if (s === "ADVOCATE_ASSIGNED") return "medium";
  return "low";
}

function priorityChip(priority: "high" | "medium" | "low") {
  if (priority === "high") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-rose-200 bg-rose-50 text-rose-800">
        High
      </span>
    );
  }
  if (priority === "medium") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800">
        Medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border border-slate-200 bg-slate-50 text-slate-700">
      Low
    </span>
  );
}

export default function AssignmentQueuePanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [selectedAdvocateId, setSelectedAdvocateId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<"matching" | "assigning" | null>(null);
  const [interview, setInterview] = useState<InterviewResult | null>(null);
  const [caseMeta, setCaseMeta] = useState<CaseMeta | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState<"all" | "ready" | "pending">("all");

  const selectedItem = useMemo(
    () => items.find((x) => x.case_id === selectedCaseId) || null,
    [items, selectedCaseId]
  );

  const filteredItems = useMemo(() => {
    if (summaryFilter === "ready") return items.filter((x) => !!x.has_interview_results);
    if (summaryFilter === "pending") return items.filter((x) => !x.has_interview_results);
    return items;
  }, [items, summaryFilter]);

  const summaryCounts = useMemo(() => {
    const ready = items.filter((x) => !!x.has_interview_results).length;
    const pending = items.length - ready;
    return { all: items.length, ready, pending };
  }, [items]);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/assignment-queue`, {
        headers: authHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to load assignment queue");
      const list = (data?.queue || []) as QueueItem[];
      setItems(list);
      if (!selectedCaseId && list.length > 0) setSelectedCaseId(list[0].case_id);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  };

  const loadCandidates = async (caseId: number) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/client-access/start-case/matching/candidates?caseId=${caseId}`,
        { headers: authHeaders() }
      );
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to load candidates");

      const list = (data?.candidates || []) as MatchCandidate[];
      setCandidates(list);
      setInterview((data?.interview || null) as InterviewResult | null);
      setCaseMeta((data?.caseMeta || null) as CaseMeta | null);
      setShowTranscript(false);
      if (selectedItem?.preferred_advocate_id) {
        setSelectedAdvocateId(Number(selectedItem.preferred_advocate_id));
      } else if (list.length > 0) {
        setSelectedAdvocateId(Number(list[0].advocate_id));
      }
    } catch {
      setCandidates([]);
      setInterview(null);
      setCaseMeta(null);
      setShowTranscript(false);
    }
  };

  const runMatching = async () => {
    if (!selectedCaseId) return;
    setActiveAction("matching");
    setBusy(true);
    setMsg("");
    try {
      const h = authHeaders();
      h.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/matching/run`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ caseId: selectedCaseId, shortlistSize: 5 }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to run matching");
      setMsg("Matching run complete");
      await Promise.all([loadQueue(), loadCandidates(selectedCaseId)]);
    } catch (e: any) {
      setMsg(e?.message || "Failed to run matching");
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  };

  const assignAdvocate = async () => {
    if (!selectedCaseId || !selectedAdvocateId) return;
    setActiveAction("assigning");
    setBusy(true);
    setMsg("");
    try {
      const h = authHeaders();
      h.set("Content-Type", "application/json");
      const res = await fetch(`${API_BASE_URL}/api/admin/client-access/start-case/assign-advocate`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ caseId: selectedCaseId, advocateId: selectedAdvocateId }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "Failed to assign advocate");
      setMsg("Advocate assigned");
      await loadQueue();
    } catch (e: any) {
      setMsg(e?.message || "Failed to assign advocate");
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  };

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    loadCandidates(selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  useEffect(() => {
    if (filteredItems.length === 0) return;
    if (!selectedCaseId || !filteredItems.some((x) => x.case_id === selectedCaseId)) {
      setSelectedCaseId(filteredItems[0].case_id);
    }
  }, [filteredItems, selectedCaseId]);

  return (
    <div className="grid lg:grid-cols-12 gap-4">
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="font-bold text-slate-900">Lawyer Assignment Queue</div>
          <div className="flex items-stretch gap-2">
            <select
              value={summaryFilter}
              onChange={(e) => setSummaryFilter(e.target.value as "all" | "ready" | "pending")}
              className="block h-10 min-w-[200px] text-sm border border-slate-200 rounded-xl px-3 py-0 bg-white leading-none"
              title="Filter by AI summary status"
            >
              <option value="all">All ({summaryCounts.all})</option>
              <option value="ready">AI summary ready ({summaryCounts.ready})</option>
              <option value="pending">AI summary pending ({summaryCounts.pending})</option>
            </select>
            <button
              type="button"
              onClick={loadQueue}
              disabled={loading || busy}
              className="h-10 min-w-[108px] inline-flex items-center justify-center gap-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {msg ? <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{msg}</div> : null}

        <div className="mb-3 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSummaryFilter("all")}
            className={`inline-flex items-center px-2 py-1 rounded-full border transition ${
              summaryFilter === "all"
                ? "border-slate-300 bg-slate-100 text-slate-900"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Total {summaryCounts.all}
          </button>
          <button
            type="button"
            onClick={() => setSummaryFilter("ready")}
            className={`inline-flex items-center px-2 py-1 rounded-full border transition ${
              summaryFilter === "ready"
                ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            }`}
          >
            Ready {summaryCounts.ready}
          </button>
          <button
            type="button"
            onClick={() => setSummaryFilter("pending")}
            className={`inline-flex items-center px-2 py-1 rounded-full border transition ${
              summaryFilter === "pending"
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            }`}
          >
            Pending {summaryCounts.pending}
          </button>
        </div>

        <div className="space-y-2 max-h-[620px] overflow-auto pr-1">
          {filteredItems.length === 0 ? (
            <div className="text-sm text-slate-600">No cases waiting for matching/assignment.</div>
          ) : (
            filteredItems.map((i) => {
              const displayLabel = i.case_display_label || `Case #${i.case_id}`;
              return (
                <button
                  key={i.case_id}
                  type="button"
                  onClick={() => setSelectedCaseId(i.case_id)}
                  className={`w-full text-left rounded-xl border p-3 transition ${
                    selectedCaseId === i.case_id ? "border-[#1E3A8A] bg-[#EEF2FF]" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">{displayLabel}</div>
                    {priorityChip(queuePriority(i))}
                  </div>
                  {i.title && i.title !== i.case_title_short ? (
                    <div className="text-xs text-slate-500 mt-1">{i.title}</div>
                  ) : null}
                  <div className="text-xs text-slate-600 mt-1">{i.client_name || "Client"} • {statusLabel(i.status)}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Interview {i.interview_completed ? "done" : "pending"} • Shortlist {i.shortlist_count}
                  </div>
                  {i.has_interview_results ? (
                    <div className="text-xs text-emerald-700 mt-1">
                      AI summary ready
                      {i.interview_legal_domain ? ` • ${i.interview_legal_domain}` : ""}
                      {i.interview_primary_issue ? ` • ${i.interview_primary_issue}` : ""}
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700 mt-1">AI summary pending</div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        {!selectedItem ? (
          <div className="text-sm text-slate-600">Select a case from queue.</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-bold text-slate-900">
                  {caseMeta?.case_display_label || selectedItem.case_display_label || `Case #${selectedItem.case_id}`}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {selectedItem.client_name || "Client"} ({selectedItem.client_email})
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Status: {statusLabel(selectedItem.status)} • Domain: {formatAiEnum("domain", selectedItem.legal_domain)} • Language: {selectedItem.language || "—"}
                </div>
                {selectedItem.preferred_advocate_id ? (
                  <div className="text-xs text-emerald-700 mt-1 font-semibold">
                    Client selected: {selectedItem.preferred_advocate_name || "Advocate"}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={runMatching}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white font-semibold disabled:opacity-60"
              >
                <Sparkles size={16} /> {busy && activeAction === "matching" ? "Running..." : "Run Matching"}
              </button>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-bold text-slate-900">AI Interview Summary</div>
                  {interview?.meta?.completedAt ? (
                    <div className="text-xs text-slate-500">
                      Completed {new Date(interview.meta.completedAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>

                {interview?.meta ? (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Source: <span className="font-semibold text-slate-700">{interview.meta.completionSource || "unknown"}</span>
                    {interview.meta.resultHash ? <span> • Hash: {interview.meta.resultHash.slice(0, 10)}</span> : null}
                  </div>
                ) : null}

                {!interview ? (
                  <div className="text-sm text-amber-700 mt-2">Interview results are not available yet.</div>
                ) : (
                  <div className="mt-2 space-y-2 text-xs text-slate-700">
                    <div>
                      <span className="font-semibold text-slate-900">Legal domain:</span> {formatAiEnum("domain", interview.summary?.legalDomain)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Issue summary:</span> {interview.summary?.issueSummary || "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Primary language:</span> {formatAiEnum("language", interview.summary?.primaryLanguage)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Urgency:</span> {formatAiEnum("urgency", interview.summary?.urgency)}
                      {interview.summary?.confidenceScore !== null && interview.summary?.confidenceScore !== undefined ? (
                        <span> • <span className="font-semibold text-slate-900">Confidence:</span> {(interview.summary.confidenceScore * 100).toFixed(0)}%</span>
                      ) : null}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Urgency reasoning:</span> {interview.summary?.urgencyReasoning || "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">ADR suitable:</span>{" "}
                      {interview.summary?.adrSuitable === true ? "Yes" : interview.summary?.adrSuitable === false ? "No" : "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">ADR reasoning:</span> {interview.summary?.adrReasoning || "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Parties:</span>{" "}
                      {Array.isArray(interview.summary?.keyEntities?.parties) && interview.summary.keyEntities.parties.length > 0
                        ? interview.summary.keyEntities.parties.join(" | ")
                        : "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Locations:</span>{" "}
                      {Array.isArray(interview.summary?.keyEntities?.locations) && interview.summary.keyEntities.locations.length > 0
                        ? interview.summary.keyEntities.locations.join(" | ")
                        : "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Dates:</span>{" "}
                      {Array.isArray(interview.summary?.keyEntities?.dates) && interview.summary.keyEntities.dates.length > 0
                        ? interview.summary.keyEntities.dates.join(" | ")
                        : "—"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Amounts:</span>{" "}
                      {Array.isArray(interview.summary?.keyEntities?.amounts) && interview.summary.keyEntities.amounts.length > 0
                        ? interview.summary.keyEntities.amounts.join(" | ")
                        : "—"}
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowTranscript((v) => !v)}
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold"
                      >
                        {showTranscript ? "Hide Transcript" : "View Transcript"}
                      </button>
                    </div>
                    {showTranscript ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 whitespace-pre-wrap">
                        {interview.transcript || "Transcript not available."}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {candidates.length === 0 ? (
                <div className="text-sm text-slate-600">No candidates yet. Run matching first.</div>
              ) : (
                candidates.map((c) => {
                  const active = selectedAdvocateId === Number(c.advocate_id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedAdvocateId(Number(c.advocate_id))}
                      className={`w-full text-left rounded-xl border p-3 transition ${
                        active ? "border-[#1E3A8A] bg-[#EEF2FF]" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            #{c.rank_position} {c.advocate_name || "Advocate"}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">{c.advocate_email}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Score</div>
                          <div className="text-lg font-extrabold text-slate-900">{Number(c.total_score || 0).toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{(c.reasons || []).join(" | ")}</div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-2">
              {String(selectedItem.status || "").toUpperCase() === "ADVOCATE_ASSIGNED" ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold opacity-70"
                  >
                    <BadgeCheck size={16} /> Assigned
                  </button>
                  {selectedItem.assigned_advocate_id ? (
                    <span className="text-xs text-slate-600 inline-flex items-center gap-1">
                      <Users size={14} />
                      to{" "}
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/advocates/${selectedItem.assigned_advocate_id}`)}
                        className="font-semibold text-[#004aad] hover:underline inline-flex items-center gap-0.5"
                      >
                        {selectedItem.assigned_advocate_name || "Advocate"}
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600 inline-flex items-center gap-1">
                      <Users size={14} /> Assigned to {selectedItem.assigned_advocate_name || "Advocate"}
                    </span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={assignAdvocate}
                  disabled={!selectedAdvocateId || busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-60"
                >
                  <UserCheck size={16} />
                  {busy && activeAction === "assigning" ? "Assigning..." : "Approve & Assign"}
                </button>
              )}
              <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                <Users size={14} /> Lawyer receives case after this admin approval.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
