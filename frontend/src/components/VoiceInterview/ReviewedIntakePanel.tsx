import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../config";
import { ReviewedVoice } from "./reviewedVoice";
import { TRANSCRIPT_NOTICE_VERSION, TranscriptEntry, TranscriptStatus } from "./transcript";
import { SessionTranscript } from "./TranscriptView";
import { Loader2, Mic, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EditTarget, IntakeDetails, IntakeEditor, intakeCopy, ReviewedData, reviewedTextErrors } from "./IntakeDetails";
import { useModalFocus } from "../common/modalFocus";
import "./VoiceInterviewPanel.css";

type InterviewAllowance = { canStart: boolean; reason: null | "daily_limit" | "weekly_limit" | "platform_limit" | "active_interview" | "paused"; retryAt: string | null; hasPreviousInterview: boolean };
const admissionReasons: Record<string, NonNullable<InterviewAllowance["reason"]>> = { INTERVIEW_DAILY_LIMIT: "daily_limit", INTERVIEW_WEEKLY_LIMIT: "weekly_limit", INTERVIEW_PLATFORM_LIMIT: "platform_limit", INTERVIEW_ALREADY_ACTIVE: "active_interview", INTERVIEWS_PAUSED: "paused" };
function allowanceMessage(value: InterviewAllowance, urdu: boolean) {
  const headline = value.reason === "active_interview" ? (urdu ? "آپ کی ایک گفتگو جاری ہے یا بند ہو رہی ہے۔" : "An interview is already active or still closing.")
    : value.reason === "daily_limit" || value.reason === "weekly_limit" ? (urdu ? "آپ گفتگو کی مقررہ حد تک پہنچ گئے ہیں۔" : "Interview limit reached.")
    : urdu ? "فی الحال نئی گفتگو دستیاب نہیں ہے۔" : "Interviews are temporarily unavailable.";
  const time = typeof value.retryAt === "string" && Number.isFinite(Date.parse(value.retryAt)) ? new Date(value.retryAt).toLocaleString(urdu ? "ur-PK" : undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return headline + (time ? (urdu ? ` ${time} کے بعد دوبارہ کوشش کریں۔` : ` You can try again after ${time}.`) : "");
}

type Review = { enabled: boolean; protocol: string; status: string; caseVersion: number; submittedRevisionId: string | null; interviewAllowance?: InterviewAllowance;
  revision: { revisionId: string; contentHash: string; reviewedData: ReviewedData; modelSuggestions: unknown } | null;
  confirmation: { confirmationId: string; revisionId: string; contentHash: string } | null };
type Operation = "revisions" | "edits" | "confirmations" | "submissions";
type Intent = { operation: Operation; key: string; body: object };
type SavedRevision = Pick<NonNullable<Review["revision"]>, "revisionId" | "contentHash" | "reviewedData"> & { caseVersion: number };
type ConfirmationReceipt = NonNullable<Review["confirmation"]> & { caseVersion: number };
type SubmissionReceipt = ConfirmationReceipt & { status: string };
// Visibility only: submission authority remains the server revision/confirmation receipts.
export type IntakePresentationStage = "loading" | "ready" | "interview" | "preparing" | "review" | "editing" | "recovery" | "submitting" | "submitted" | "error";
type Props = { onPresentationStage?: (stage: IntakePresentationStage) => void; caseId: number | null; createCase?: () => Promise<{ caseId: number; created: boolean }>; language?: string; onSubmitted: () => void | Promise<void>; onManaged?: (managed: boolean) => void };
class IntakeRequestError extends Error {
  constructor(message: string, public status: number, public retryAt: string | null = null) { super(message); }
}
const caseBase = (id: number) => `${API_BASE_URL}/api/client/dashboard/start-case/${id}/intake-v2`;
const newIntent = (operation: Operation, body: Intent["body"]): Intent => ({ operation, body: structuredClone(body), key: crypto.randomUUID() });
const canStartInterview = (review: Review, newInterview = false) => review.enabled === true && Number.isSafeInteger(review.caseVersion) && review.caseVersion >= 0 &&
  ["legacy", "live_v2"].includes(review.protocol) && (review.status === "DRAFT" || (review.protocol === "live_v2" && review.status === "INTAKE_STARTED")) &&
  !review.submittedRevisionId && (!review.interviewAllowance || review.interviewAllowance.canStart === true) &&
  (newInterview || (!review.revision && !review.confirmation && review.interviewAllowance?.hasPreviousInterview !== true));
const stepNames: Record<Operation, string> = { revisions: "summary save", edits: "changes save", confirmations: "review confirmation", submissions: "submission" };

const voiceFailureHelp = (stage: string, reason: string) => {
  const stages: Record<string, string> = {
    "media-preload": "Voice media could not be loaded. No microphone connection was completed.",
    "device-init": "The microphone could not be initialized.",
    "microphone-check": "The microphone was not ready for this interview.",
    signaling: "The voice connection could not be established.",
  };
  const reasons: Record<string, string> = {
    NotAllowedError: "Check microphone permission in your browser.", permissions: "Check microphone permission in your browser.",
    NotFoundError: "No microphone was found.", "not-found": "No microphone was found.",
    NotReadableError: "The microphone may be unavailable or in use.", "in-use": "The microphone may be unavailable or in use.",
  };
  return stages[stage] ? ` ${stages[stage]}${(stage === "device-init" || stage === "microphone-check") && reasons[reason] ? ` ${reasons[reason]}` : ""} No automatic retry was attempted.` : "";
};

// A case change owns a new component, so late receipts cannot advance the next case.
export default function ReviewedIntakePanel(props: Props) {
  const [actor, setActor] = useState(localStorage.getItem("token"));
  useEffect(() => { const changed = () => setActor(localStorage.getItem("token")); window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); }, []);
  return <CaseIntakePanel key={`${props.caseId ?? "new"}:${actor}`} {...props} />;
}
function CaseIntakePanel({ caseId, createCase, onSubmitted, onManaged, onPresentationStage }: Props) {
  const { i18n } = useTranslation();
  const urdu = i18n.language?.startsWith("ur") || false;
  const copy = intakeCopy(urdu);
  const [editTarget, setEditTarget] = useState<EditTarget>("all");
  const [expanded, setExpanded] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState<ReviewedData | null>(null);
  const draftTooLong = !!draft && Object.keys(reviewedTextErrors(draft)).length > 0;
  const [failure, setFailure] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const finishStarted = useRef(false);
  const finishCurrent = useRef<() => Promise<void>>(async () => {});
  const editor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null), editButton = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [active, setActive] = useState(false), [used, setUsed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>();
  const [transcriptSession, setTranscriptSession] = useState("");
  const [transcriptUnavailable, setTranscriptUnavailable] = useState(false);
  const [transcriptBoundary, setTranscriptBoundary] = useState(0);
  const [transcriptDisplayEndsAt, setTranscriptDisplayEndsAt] = useState<number>();
  const [playBlocked, setPlayBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement>(null), voice = useRef<ReviewedVoice | undefined>(undefined);
  const session = useRef<{ sessionId: string; caseVersion: number } | undefined>(undefined);
  const intent = useRef<Intent | undefined>(undefined), alive = useRef(false), running = useRef(false);
  const continuation = useRef(0), readSequence = useRef(0);
  const callbacks = useRef({ onManaged, onSubmitted, onPresentationStage });
  callbacks.current = { onManaged, onSubmitted, onPresentationStage };
  const ownedCase = useRef(caseId);
  const [creating, setCreating] = useState(false);
  const [restarting, setRestarting] = useState(false), [restartPrompt, setRestartPrompt] = useState(false);
  const voiceGeneration = useRef(0), conversationStarted = useRef(false);
  const closeRestart = useCallback(() => setRestartPrompt(false), []);
  const restartDialog = useModalFocus<HTMLDivElement>(restartPrompt, closeRestart);
  const creationAttempted = useRef(false);
  const headers = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("AUTHENTICATION_REQUIRED");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);
  const request = useCallback(async (suffix: string, body?: object, key?: string) => {
    if (!ownedCase.current) throw new Error("CASE_REQUIRED");
    const response = await fetch(caseBase(ownedCase.current) + suffix, { method: body === undefined ? "GET" : "POST",
      headers: { ...headers(), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    if (!response.ok) throw new IntakeRequestError(typeof data.code === "string" ? data.code : "INTAKE_REQUEST_FAILED", response.status,
      typeof data.retryAt === "string" && Number.isFinite(Date.parse(data.retryAt)) ? data.retryAt : null);
    return data;
  }, [headers]);
  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    running.current = true; setBusy(true); setFailure(false);
    try {
      const result: Review = await request("/review");
      if (!alive.current || sequence !== readSequence.current) return;
      setReview(result); setDraft(result.revision ? structuredClone(result.revision.reviewedData) : null); setEditing(false);
      callbacks.current.onManaged?.(result.protocol === "live_v2");
    } finally {
      if (alive.current && sequence === readSequence.current) { running.current = false; setBusy(false); }
    }
  }, [request]);
  useEffect(() => {
    alive.current = true;
    if (ownedCase.current) void load().catch(() => { if (alive.current) { setFailure(true); setMessage("We couldn’t load your case details. Please try again."); } });
    const hide = () => { continuation.current++; void voice.current?.stop(); };
    window.addEventListener("pagehide", hide);
    return () => { alive.current = false; continuation.current++; readSequence.current++; window.removeEventListener("pagehide", hide); void voice.current?.stop(); };
  }, [load]);
  const eligible = !!review && (review.status === "DRAFT" || (review.protocol === "live_v2" && review.status === "INTAKE_STARTED"));
  const frozen = !!review?.submittedRevisionId;
  const selected = review?.revision;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(selected?.reviewedData);
  const fieldsDisabled = busy || pending || frozen || active || !review?.enabled || !eligible;
  const hasPreviousInterview = used || !!selected || review?.interviewAllowance?.hasPreviousInterview === true;
  const connect = (authorized: Review, newInterview = false) => {
    if (!alive.current || voice.current || !audio.current || !ownedCase.current || !canStartInterview(authorized, newInterview)) return;
    const generation = ++voiceGeneration.current, owner = localStorage.getItem("token");
    const current = () => alive.current && voiceGeneration.current === generation && localStorage.getItem("token") === owner;
    const base = caseBase(ownedCase.current);
    setUsed(true); setActive(true); setMessage("Connecting your interview…");
    const key = crypto.randomUUID();
    voice.current = new ReviewedVoice({ audio: audio.current,
      admit: async () => {
        try { return await request("/sessions", { expectedVersion: authorized.caseVersion, processingConsent: true, transcriptNoticeVersion: TRANSCRIPT_NOTICE_VERSION, ...(newInterview ? { newInterview: true } : {}) }, key); }
        catch (error) {
          if (current() && error instanceof IntakeRequestError) {
            const reason = admissionReasons[error.message];
            if (reason) setReview(r => r && ({ ...r, interviewAllowance: { canStart: false, reason, retryAt: error.retryAt, hasPreviousInterview: !!r.revision || r.interviewAllowance?.hasPreviousInterview === true } }));
            else if (error.message === "NEW_INTERVIEW_CONFIRMATION_REQUIRED") setReview(r => r && ({ ...r, interviewAllowance: { canStart: true, reason: null, retryAt: null, hasPreviousInterview: true } }));
          }
          throw error;
        }
      }, request,
      offer: id => {
        const auth = new Headers(headers());
        return { endpoint: new Request(`${base}/sessions/${id}/webrtc/offer`, { method: "POST", headers: auth, redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), headers: auth, timeout: 15000 };
      },
      onAdmitted: admitted => { if (current()) { session.current = admitted; setTranscriptDisplayEndsAt(Date.now() + 90 * 86400000); setTranscriptSession(admitted.sessionId); setTranscriptUnavailable(admitted.transcriptSaving === "unavailable"); callbacks.current.onManaged?.(true); setReview(r => r && ({ ...r, protocol: "live_v2", status: "INTAKE_STARTED", caseVersion: admitted.caseVersion, confirmation: null })); } },
      onConnected: () => { if (current()) { conversationStarted.current = true; setConnected(true); setMessage("Interview connected. Speak naturally; choose End interview when you are ready."); } },
      onPrepared: () => { if (current()) setTranscriptBoundary(n => n + 1); },
      onTranscript: (entries, status) => { if (current()) { setTranscript(entries); setTranscriptStatus(status); } },
      onInterviewFinished: () => { if (current()) void finishCurrent.current(); },
      onStopped: () => { if (current()) { setActive(false); setConnected(false); setPlayBlocked(false); setTranscriptBoundary(n => n + 1); } },
      onFailure: (stage, reason) => { if (current()) {
        if (admissionReasons[reason]) { setFailure(false); setMessage(""); }
        else if (reason === "NEW_INTERVIEW_CONFIRMATION_REQUIRED") { setFailure(false); setMessage("Choose Start a new interview to continue."); }
        else { setFailure(true); setMessage((reason === "LIVE_ADMISSION_RATE_LIMITED"
          ? "We couldn’t start the interview. Please wait a minute, then refresh the page before trying again."
          : stage === "prepare" ? authorized.revision ? "We couldn’t prepare a new summary. Your saved summary is unchanged." : "We couldn’t prepare your summary. Recent details may not have been captured. It has not been saved here."
          : "Your interview stopped unexpectedly. Unsaved details may be lost.") + voiceFailureHelp(stage, reason)); }
      } },
      onPlaybackBlocked: () => { if (current()) setPlayBlocked(true); },
    });
    void voice.current.start();
  };
  const start = async () => {
    if (!alive.current || voice.current || running.current || intent.current || used) return;
    if (ownedCase.current) {
      if (!review || !canStartInterview(review)) return;
      connect(review);
      return;
    }
    if (!createCase || creationAttempted.current) return;
    // Reserve synchronously: a second click cannot create or admit another call.
    creationAttempted.current = true;
    running.current = true;
    setCreating(true); setBusy(true); setMessage("Creating your interview draft…");
    const generation = continuation.current;
    try {
      const created = await createCase();
      if (!alive.current) return;
      if (!Number.isSafeInteger(created.caseId) || created.caseId <= 0) throw new Error("INVALID_CASE_RECEIPT");
      ownedCase.current = created.caseId;
      if (generation !== continuation.current) return;
      const authorized: Review = await request("/review");
      if (!alive.current || generation !== continuation.current) return;
      setReview(authorized); setDraft(authorized.revision ? structuredClone(authorized.revision.reviewedData) : null);
      callbacks.current.onManaged?.(authorized.protocol === "live_v2");
      const fresh = created.created && authorized.status === "DRAFT" && canStartInterview(authorized);
      if (fresh) connect(authorized);
      else setMessage("Saved case loaded. No call was started. Review its state before choosing your next step.");
    } catch {
      if (alive.current && generation === continuation.current) {
        setFailure(true);
        setMessage("Draft creation failed or its saved outcome could not be confirmed. Reload to check saved state before starting again. No call was started; no automatic retry.");
      }
    } finally {
      running.current = false;
      if (alive.current) { setCreating(false); setBusy(false); }
    }
  };
  const startNewInterview = async () => {
    if (!alive.current || running.current || intent.current || active || editing || dirty || frozen || !review || !canStartInterview(review, true)) return;
    const generation = ++continuation.current;
    ++voiceGeneration.current;
    running.current = true; setBusy(true); setRestarting(true); setRestartPrompt(false); setFailure(false); setMessage("");
    try {
      await voice.current?.stop();
      if (!alive.current || generation !== continuation.current) return;
      const fresh: Review = await request("/review");
      if (!alive.current || generation !== continuation.current) return;
      setReview(fresh); setDraft(fresh.revision ? structuredClone(fresh.revision.reviewedData) : null);
      if (!canStartInterview(fresh, true)) return;
      voice.current = undefined; session.current = undefined; finishStarted.current = false;
      conversationStarted.current = false;
      setUsed(false); setConnected(false); setPlayBlocked(false); setPreparing(false);
      setTranscript([]); setTranscriptStatus(undefined); setTranscriptSession(""); setTranscriptUnavailable(false); setTranscriptBoundary(0); setTranscriptDisplayEndsAt(undefined);
      connect(fresh, true);
    } catch {
      if (alive.current && generation === continuation.current) { setFailure(!selected); setMessage("We couldn’t start a new interview. Your saved case details have not been changed."); }
    } finally {
      running.current = false;
      if (alive.current) { setBusy(false); setRestarting(false); }
    }
  };
  const checkAvailability = () => {
    if (running.current || intent.current || active || editing) return;
    setMessage("");
    void load().catch(() => { if (alive.current) setMessage("We couldn’t check interview availability. Please try again."); });
  };
  const findLawyers = async () => {
    try {
      await callbacks.current.onSubmitted();
      if (alive.current) setMessage("Your case has been submitted.");
    } catch { if (alive.current) setMessage("Your intake is submitted, but lawyers could not be loaded. Try Find lawyers again."); }
  };
  // Only committed receipts advance this chain. Never reload and adopt another tab's selection.
  const sendIntent = async (first: Intent, generation: number) => {
    let current: Intent | undefined = first;
    try {
      while (current && alive.current) {
        const receipt = await request(`/${current.operation}`, current.body, current.key);
        if (!alive.current) return;
        let next: Intent | undefined;
        if (current.operation === "revisions" || current.operation === "edits") {
          const saved = receipt as SavedRevision;
          setReview(r => r && ({ ...r, caseVersion: saved.caseVersion, revision: { ...saved, modelSuggestions: null }, confirmation: null }));
          setDraft(structuredClone(saved.reviewedData)); setEditing(false); setPreparing(false);
          if (current.operation === "revisions") {
            // Saving is durable before the call is stopped; Stop itself is not a save.
            void voice.current?.stop();
            setMessage("Draft summary saved. Review and correct the facts before finding a lawyer.");
          } else setMessage("Changes saved. Review your details before confirming.");
        } else if (current.operation === "confirmations") {
          const confirmed = receipt as ConfirmationReceipt;
          setReview(r => r && ({ ...r, caseVersion: confirmed.caseVersion, confirmation: confirmed }));
          next = newIntent("submissions", { expectedVersion: confirmed.caseVersion, revisionId: confirmed.revisionId, confirmationId: confirmed.confirmationId });
        } else {
          const submitted = receipt as SubmissionReceipt;
          setReview(r => r && ({ ...r, caseVersion: submitted.caseVersion, status: submitted.status, submittedRevisionId: submitted.revisionId }));
          setMessage("Your case has been submitted.");
        }
        intent.current = next; setPending(!!next);
        if (generation !== continuation.current) {
          if (next) setMessage("Your last step was saved. Choose Check status to continue when you’re ready.");
          return;
        }
        if (current.operation === "submissions") await findLawyers();
        current = next;
      }
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof IntakeRequestError && error.status < 500) {
        intent.current = undefined; setPending(false);
        setFailure(true); setMessage("Request rejected. Your saved intake changed or this step could not be accepted. Nothing else was sent.");
      } else setMessage(`We couldn’t confirm the ${stepNames[current!.operation]}. Choose Check status before continuing.`);
    } finally { running.current = false; if (alive.current) { setBusy(false); setPreparing(false); } }
  };
  const run = (next: Intent) => {
    if (running.current || !alive.current) return;
    setFailure(false);
    running.current = true; intent.current = next; setPending(true); setBusy(true);
    void sendIntent(next, continuation.current);
  };
  const finish = async () => {
    if (!alive.current || finishStarted.current || running.current || intent.current || !connected || !active || !session.current) return;
    finishStarted.current = true; setPreparing(true); setFailure(false);
    running.current = true; setBusy(true);
    const generation = continuation.current;
    setMessage("Preparing your draft summary, then saving it. Recent audio may be missing; you will review it next.");
    const prepared = await voice.current?.prepare();
    if (!alive.current || generation !== continuation.current || !prepared) {
      running.current = false; if (alive.current) { setBusy(false); setPreparing(false); } return;
    }
    const next = newIntent("revisions", { sessionId: session.current.sessionId, expectedVersion: session.current.caseVersion });
    intent.current = next; setPending(true);
    await sendIntent(next, generation);
  };
  finishCurrent.current = finish;
  const confirmAndSubmit = () => {
    if (!review || !selected || !draft || fieldsDisabled || intent.current || running.current) return;
    if (editing || dirty) return;
    run(newIntent("confirmations", { expectedVersion: review.caseVersion, revisionId: selected.revisionId, acknowledgeReview: true, acknowledgmentVersion: "review-v1" }));
  };
  const stop = () => {
    continuation.current++;
    void voice.current?.stop(); // Synchronously suppress capture/playback, even while HTTP is pending.
    setPreparing(false);
    setMessage("Interview stopped. Unsaved details may be lost. A save already in progress may still finish.");
  };
  const reload = () => {
    if (running.current || intent.current || active) return;
    void load().then(() => { if (alive.current) setMessage("Your case details are up to date. Please review them before continuing."); })
      .catch(() => { if (alive.current) { setFailure(true); setMessage("We couldn’t load your case details. Please try again."); } });
  };
  const phase = creating || restarting ? "connecting" : preparing ? "preparing" : busy && (intent.current?.operation === "confirmations" || intent.current?.operation === "submissions") ? "submitting" : pending && !busy ? "recovery" : editing ? "editing" : failure && review ? "error" : frozen ? "submitted" : active ? connected ? "connected" : "connecting" : selected ? "review" : review ? "ready" : failure ? "load-failed" : caseId ? "loading" : "ready";
  const presentationStage: IntakePresentationStage = frozen ? "submitted" : preparing ? "preparing" : active ? "interview" :
    phase === "connecting" || phase === "connected" ? "interview" : phase === "load-failed" ? "error" : phase;
  useEffect(() => { callbacks.current.onPresentationStage?.(presentationStage); }, [presentationStage]);
  const openEditor = (target: EditTarget) => {
    if (fieldsDisabled || intent.current || !selected) return;
    setExpanded(!!panel.current?.querySelector<HTMLDetailsElement>(".intake-additional")?.open);
    setEditTarget(target); setDraft(structuredClone(selected.reviewedData)); setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(structuredClone(selected!.reviewedData)); setFailure(false);
    setMessage("Unsaved changes discarded. Review your saved details."); setEditing(false);
    setTimeout(() => {
      const origin = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("[data-edit-target]") || []).find(button => button.dataset.editTarget === editTarget);
      (origin || editButton.current)?.focus();
    }, 0);
  };
  const journeyStep = frozen ? 2 : active || restarting || preparing ? 0 : selected || editing || phase === "submitting" ? 1 : 0;
  const canOfferNewInterview = !!ownedCase.current && hasPreviousInterview && !!review?.enabled && eligible && !frozen && !active && !busy && !pending && !editing && !restarting;
  const admissionBlocked = !!review?.interviewAllowance && review.interviewAllowance.canStart !== true;
  useEffect(() => {
    if (phase === "editing") editor.current?.querySelector<HTMLElement>("textarea, select")?.focus();
    else heading.current?.focus();
  }, [phase]);
  return <section ref={panel} dir={urdu ? "rtl" : "ltr"} className="reviewed-intake review-first rounded-2xl border border-slate-200 bg-white" aria-label="Reviewed voice intake">
    <ol className="intake-stepper" aria-label={copy.progress}>{[copy.story, copy.review, copy.find].map((label, index) => <li key={label} aria-current={journeyStep === index ? "step" : undefined} className={journeyStep === index ? "current" : ""}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
    <audio ref={audio} autoPlay />
    <h3 tabIndex={-1} ref={heading}>{phase === "preparing" ? copy.preparing : phase === "submitting" ? "Submitting your case…" : phase === "recovery" ? "Check your progress" : phase === "editing" ? copy.editTitle : phase === "submitted" ? copy.submitted : phase === "review" ? copy.reviewTitle : phase === "connecting" ? "Connecting…" : phase === "connected" ? copy.connected : phase === "loading" ? "Loading your case…" : phase === "load-failed" ? "We couldn’t load your case" : phase === "error" ? used && !selected && !finishStarted.current ? "Your interview could not continue" : "We couldn’t finish this step" : hasPreviousInterview ? copy.continueCase : copy.ready}</h3>
    <div className="intake-workspace"><div className="intake-main">
    {preparing && <div aria-busy="true" className="intake-preparing"><Loader2 aria-hidden="true" className="intake-spinner" /><p>{copy.preparingHelp}</p></div>}
    {((!preparing && !failure && !finishStarted.current && !selected && (review || (!caseId && !creationAttempted.current)) && ((!used && !hasPreviousInterview) || active)) || active || transcript.length > 0 || (conversationStarted.current && !!transcriptSession && !selected)) && <div className="reviewed-voice-session" role="region" aria-label="Interview conversation">
      <header className="conversation-header"><div className="assistant-identity"><span className="assistant-emblem" aria-hidden="true">I</span><div><strong>Insafdaar assistant</strong></div></div>{(active || used) && <span className="connection-state">{active ? connected ? "Connected" : "Connecting" : "Ended"}</span>}</header>
      {!used && <div className="interview-welcome"><p>{copy.speak}</p></div>}
      {!used && <>
        <p className="voice-consent" id="transcript-processing-notice">{copy.consent}</p>
        <button type="button" className="voice-start" aria-describedby="transcript-processing-notice" disabled={busy || pending || (review ? !canStartInterview(review) : !createCase)} onClick={start}>{copy.start}</button>
      </>}
      {used && !transcriptSession && active && <p role="status">Connecting — conversation text will appear here.</p>}
      {!!ownedCase.current && transcriptSession && <SessionTranscript caseId={ownedCase.current} sessionId={transcriptSession} liveEntries={transcript} liveStatus={transcriptStatus} reconcile={transcriptBoundary} savingUnavailable={transcriptUnavailable} displayEndsAt={transcriptDisplayEndsAt} interviewState={preparing ? "preparing" : failure ? "disconnected" : active ? connected ? "listening" : "connecting" : "ended"} />}
      <div className="conversation-controls" role="group" aria-label="Interview controls">{active && <span className="microphone-state"><Mic size={16} aria-hidden="true" />{connected && !preparing ? "Microphone connected" : preparing ? "Ending interview" : "Connecting microphone"}</span>}
      {active && connected && !preparing && !finishStarted.current && <button type="button" className="voice-start" disabled={busy || pending} onClick={() => { void finish(); }}>{copy.end}</button>}
      {active && <div className="intake-safety-controls"><button type="button" className="voice-stop" onClick={stop}><Square size={18} aria-hidden="true" />{copy.stopNow}</button><span>{copy.stopHelp}</span></div>}
      </div>
      {playBlocked && <button type="button" onClick={() => { setPlayBlocked(false); void voice.current?.play(); }}>Play assistant audio</button>}
    </div>}
    <p role={failure ? "alert" : "status"} className={preparing || (active && !failure) || (pending && !busy) ? "sr-only" : "intake-status"}>{preparing ? copy.preparing : message}</p>
    {!active && (busy || pending) && <div className="intake-safety-controls"><button type="button" className="voice-stop" onClick={stop}><Square size={18} aria-hidden="true" />{active || preparing ? copy.stopNow : copy.stop}</button><span>{copy.stopHelp}</span></div>}
    {pending && !busy && <div className="intake-recovery" role="alert"><p>We couldn’t confirm the last step. Check its status before continuing.</p><button type="button" onClick={() => { if (intent.current) run(intent.current); }}>Check status</button></div>}
    {selected && draft && !preparing && !active && !restarting && <div className="intake-review">
      <p className="intake-review-help">{copy.reviewHelp}</p>
      {editing ? <div ref={editor} className="intake-editor">
        <IntakeEditor draft={draft} target={editTarget} disabled={fieldsDisabled} urdu={urdu} onChange={setDraft} />
        <div className="intake-actions"><button type="button" className="intake-confirm" disabled={fieldsDisabled || draftTooLong} onClick={() => {
          if (Object.keys(reviewedTextErrors(draft)).length) return;
          run(newIntent("edits", { expectedVersion: review!.caseVersion, revisionId: selected.revisionId, reviewedData: draft }));
        }}>{copy.save}</button>
        <button type="button" disabled={busy || pending} onClick={cancelEdit}>{copy.cancel}</button></div>
      </div> : <>
        <IntakeDetails data={selected.reviewedData} urdu={urdu} canEdit={phase === "review" && !fieldsDisabled} expanded={expanded} onExpanded={setExpanded} onEdit={openEditor} />
        {!frozen && phase === "review" && <div className="intake-review-actions"><p>{copy.confirmHelp}</p><div className="intake-actions"><button type="button" className="intake-confirm" disabled={fieldsDisabled} onClick={confirmAndSubmit}>{copy.confirm}</button><button type="button" ref={editButton} data-edit-target="all" disabled={fieldsDisabled} onClick={() => openEditor("all")}>{copy.edit}</button></div></div>}
        {frozen && <div className="intake-review-actions"><p>Your submitted case details can no longer be edited.</p><button type="button" disabled={busy || pending} onClick={() => { if (running.current || intent.current) return; running.current = true; setBusy(true); void findLawyers().finally(() => { running.current = false; if (alive.current) setBusy(false); }); }}>Find lawyers</button></div>}
      </>}
    </div>}
    {!!ownedCase.current && !busy && !pending && !active && !editing && (!review || (used && !selected) || (failure && !!selected)) && <button type="button" onClick={reload}>{!review ? "Try again" : selected ? "Refresh details" : "Check for a saved summary"}</button>}
    {selected && failure && !active && !busy && !pending && !editing && <button type="button" onClick={() => { setFailure(false); setMessage(""); }}>{copy.reviewSaved}</button>}
    {canOfferNewInterview && <div className="intake-restart"><button type="button" className="intake-edit-link" disabled={admissionBlocked} onClick={() => setRestartPrompt(true)}>{copy.newInterview}</button></div>}
    {!active && !busy && !pending && !editing && admissionBlocked && <div className="intake-interview-limit"><p role="status">{allowanceMessage(review!.interviewAllowance!, urdu)}</p><button type="button" className="intake-edit-link" onClick={checkAvailability}>{copy.checkAvailability}</button></div>}
    </div></div>
    {restartPrompt && <div ref={restartDialog} className="intake-restart-overlay" role="dialog" aria-modal="true" aria-labelledby="restart-interview-title" aria-describedby="restart-interview-help transcript-processing-notice" onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement?.id === "restart-interview-title")) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className="intake-restart-dialog"><h3 tabIndex={-1} id="restart-interview-title">{copy.restartTitle}</h3><p id="restart-interview-help">{selected ? copy.restartHelp : copy.restartNoSummary}</p><p className="voice-consent" id="transcript-processing-notice">{copy.consent}</p><div className="intake-actions"><button type="button" onClick={closeRestart}>{selected ? copy.keepSummary : copy.cancel}</button><button type="button" className="intake-confirm" aria-describedby="transcript-processing-notice" onClick={() => { void startNewInterview(); }}>{copy.confirmRestart}</button></div></div></div>}
  </section>;
}
