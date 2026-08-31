import { formatStatus, formatAiEnum } from "../../common/formatStatus";
import React, { useMemo, useRef, useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../config";
import AuthedLink from "../../common/AuthedLink";
import AuthedAudio from "../../common/AuthedAudio";
import { VoiceInterviewPanel, InterviewResult } from "../../VoiceInterview";
import {
  Mic,
  Send,
  Loader2,
  ShieldCheck,
  FileUp,
  Sparkles,
  X,
  CheckCircle2,
  Globe,
  Play,
  Pause,
  Timer,
  List,
  UploadCloud,
  Radio,
  CircleStop,
  RefreshCw,
  AudioLines,
} from "lucide-react";

type LanguageOption = { label: string; value: string };
const LANGUAGES: LanguageOption[] = [
  { label: "English", value: "English" },
  { label: "Urdu", value: "Urdu" },
  { label: "Punjabi", value: "Punjabi" },
  { label: "Pashto", value: "Pashto" },
  { label: "Sindhi", value: "Sindhi" },
  { label: "Balochi", value: "Balochi" },
  { label: "Other", value: "Other" },
];

const STORAGE_KEY = "start_case_state_v2";

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
  city?: string | null;
  languages?: string[] | null;
  practice_areas?: string[] | null;
  experience_years?: number | null;
};

type MatchingCaseMeta = {
  case_title_short?: string | null;
  case_display_label?: string | null;
};

type PersistedInterviewSummary = {
  primaryLanguage?: string | null;
  legalDomain?: string | null;
  issueSummary?: string | null;
  urgency?: string | null;
  urgencyReasoning?: string | null;
  adrSuitable?: boolean | null;
  adrReasoning?: string | null;
  confidenceScore?: number | null;
};

type PersistedInterviewResult = {
  meta?: {
    completedAt?: string | null;
    completionSource?: string | null;
  };
  summary?: PersistedInterviewSummary;
  transcript?: string | null;
};

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Modal({
  title,
  children,
  onClose,
  size = "lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: "md" | "lg" | "stage";
}) {
  const maxW =
    size === "stage" ? "max-w-6xl" : size === "lg" ? "max-w-lg" : "max-w-md";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`relative w-full rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden ${maxW}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button aria-label="Close"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 transition"
          ><X size={18} className="text-slate-700"  aria-hidden="true" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** waveform helpers */
function rmsFromTimeDomain(data: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function StartCaseSection() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [caseId, setCaseId] = useState<number | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [showLangModal, setShowLangModal] = useState(true);
  const [description, setDescription] = useState("");

  // AI Interview (handled by VoiceInterviewPanel)
  const [interviewStarted, setInterviewStarted] = useState(false);

  // Voice Recording
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string>("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const [documents, setDocuments] = useState<any[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<any[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [matchingBusy, setMatchingBusy] = useState(false);
  const [matchingCandidates, setMatchingCandidates] = useState<MatchCandidate[]>([]);
  const [selectedAdvocateId, setSelectedAdvocateId] = useState<number | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [interviewSessionId, setInterviewSessionId] = useState<string>("");
  const [matchingCaseMeta, setMatchingCaseMeta] = useState<MatchingCaseMeta | null>(null);
  const [latestInterview, setLatestInterview] = useState<PersistedInterviewResult | null>(null);
  const [interviewPanelVersion, setInterviewPanelVersion] = useState(0);

  // analyser
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const BARS = 84;
  const [bars, setBars] = useState<number[]>(
    () => Array.from({ length: BARS }, () => 8)
  );
  const [level, setLevel] = useState(0);

  const minChars = 20;
  const maxChars = 1200;

  const isAiMode = selectedLanguage === "English" || selectedLanguage === "Urdu";
  const hasLang = !!selectedLanguage;
  const meterPct = clamp(level * 150, 0, 100);

  const persistLocal = (
    next: Partial<{ caseId: number | null; selectedLanguage: string; description: string }>
  ) => {
    try {
      const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...next }));
    } catch { }
  };

  const restoreLocal = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const validation = useMemo(() => {
    const trimmed = description.trim();
    if (!trimmed) return { ok: false, msg: "Please write a short description first." };
    if (trimmed.length < minChars) return { ok: false, msg: `Write at least ${minChars} characters.` };
    if (trimmed.length > maxChars) return { ok: false, msg: `Maximum ${maxChars} characters allowed.` };
    return { ok: true, msg: "" };
  }, [description]);

  const refreshLists = async (id: number) => {
    setListError(null);
    try {
      const [docsRes, voiceRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/client/dashboard/start-case/documents?caseId=${id}`, {
          headers: authHeaders(),
        }),
        axios.get(`${API_BASE_URL}/api/client/dashboard/start-case/voice?caseId=${id}`, {
          headers: authHeaders(),
        }),
      ]);
      setDocuments(docsRes.data?.documents || []);
      setVoiceNotes(voiceRes.data?.voiceNotes || []);
    } catch (e: any) {
      console.error("Failed to load documents/voice notes", e);
      setListError("Could not load documents and voice notes.");
    }
  };

  const loadMatching = async (id?: number | null) => {
    const cid = id || caseId;
    if (!cid) return;

    try {
      setMatchingBusy(true);
      const res = await axios.get(
        `${API_BASE_URL}/api/client/dashboard/start-case/matching?caseId=${cid}`,
        { headers: authHeaders() }
      );

      const candidates = Array.isArray(res.data?.candidates) ? res.data.candidates : [];
      setMatchingCandidates(candidates);
      setSelectedAdvocateId(res.data?.selectedAdvocateId ? Number(res.data.selectedAdvocateId) : null);
      setSubmitted(res.data?.selectedAdvocateId ? true : false);
      setMatchingCaseMeta({
        case_title_short: res.data?.case_title_short || null,
        case_display_label: res.data?.case_display_label || null,
      });
      setLatestInterview((res.data?.interview || null) as PersistedInterviewResult | null);
    } catch (e: any) {
      setMatchingCandidates([]);
      setMatchingCaseMeta(null);
      setLatestInterview(null);
      if (e?.response?.data?.error) {
        setMsg(`${e.response.data.error}`);
      }
    } finally {
      setMatchingBusy(false);
    }
  };

  const chooseAdvocate = async () => {
    if (!caseId || !selectedAdvocateId) return;
    try {
      setSelectionBusy(true);
      await axios.post(
        `${API_BASE_URL}/api/client/dashboard/start-case/matching/select`,
        {
          caseId,
          advocateId: selectedAdvocateId,
        },
        { headers: authHeaders() }
      );
      setMsg("Preferred advocate selected. Waiting for admin approval.");
      setSubmitted(true);
      await loadMatching(caseId);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Failed to select advocate.");
    } finally {
      setSelectionBusy(false);
    }
  };

  // ✅ ON LOAD: restore from backend active case, else localStorage
  useEffect(() => {
    const boot = async () => {
      setBusy(true);
      try {
        const active = await axios.get(
          `${API_BASE_URL}/api/client/dashboard/start-case/active`,
          { headers: authHeaders() }
        );

        const c = active.data?.case;

        if (c?.id) {
          setCaseId(c.id);
          setSelectedLanguage(c.language || "");
          setDescription(c.description || "");

          persistLocal({
            caseId: c.id,
            selectedLanguage: c.language || "",
            description: c.description || "",
          });

          await refreshLists(c.id);
          await loadMatching(c.id);

          // ✅ IMPORTANT FIX: do NOT show modal if language already saved
          setShowLangModal(!c.language);

          return;
        }

        // fallback local
        const local = restoreLocal();
        if (local?.caseId) {
          setCaseId(local.caseId);
          setSelectedLanguage(local.selectedLanguage || "");
          setDescription(local.description || "");
          setShowLangModal(!local.selectedLanguage);

          // ✅ IMPORTANT FIX: load lists on fallback too
          await refreshLists(local.caseId);
          await loadMatching(local.caseId);
        } else {
          setShowLangModal(true);
        }
      } catch {
        const local = restoreLocal();
        if (local?.caseId) {
          setCaseId(local.caseId);
          setSelectedLanguage(local.selectedLanguage || "");
          setDescription(local.description || "");
          setShowLangModal(!local.selectedLanguage);
          await refreshLists(local.caseId);
          await loadMatching(local.caseId);
        } else {
          setShowLangModal(true);
        }
      } finally {
        setBusy(false);
      }
    };

    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // local sync
  useEffect(() => {
    persistLocal({ caseId, selectedLanguage, description });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, selectedLanguage, description]);

  // timer
  useEffect(() => {
    if (!isRecording || isPaused) return;
    const t = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording, isPaused]);

  // cleanup
  useEffect(() => {
    return () => {
      try {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      } catch { }
      try {
        analyserRef.current?.disconnect();
        sourceRef.current?.disconnect();
      } catch { }
      try {
        audioCtxRef.current?.close();
      } catch { }
      try {
        streamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch { }
    };
  }, []);

  // ✅ IMPORTANT FIX: always “update same draft” when caseId exists
  const saveDraft = async (payload: { description: string; language: string }) => {
    const res = await axios.post(
      `${API_BASE_URL}/api/client/dashboard/start-case/draft`,
      {
        caseId: caseId || undefined,
        title: null,
        description: payload.description,
        language: payload.language,
      },
      { headers: authHeaders() }
    );

    const id = res.data?.case?.id;
    if (id) setCaseId(id);
    return id;
  };

  const ensureDraftCase = async () => {
    if (caseId) return caseId;
    const id = await saveDraft({
      description: description.trim() || "Draft created for interview/voice recording.",
      language: selectedLanguage || "English",
    });
    return id;
  };

  const completeInterviewForCase = async (id: number, result?: InterviewResult) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/client/dashboard/start-case/interview/complete`,
      {
        caseId: id,
        legalDomain: result?.analysis?.legal_domain || null,
      },
      { headers: authHeaders() }
    );
    await loadMatching(id);
    return response;
  };

  const startNewAiInterview = async () => {
    if (!isAiMode) {
      setMsg("AI interview is available only for English/Urdu.");
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      const id = caseId || (await ensureDraftCase());
      if (!id) {
        setMsg("Could not resolve case. Please refresh and try again.");
        return;
      }

      await axios.post(
        `${API_BASE_URL}/api/client/dashboard/start-case/ai/start`,
        { caseId: id, provider: "gcp", providerSessionId: null },
        { headers: authHeaders() }
      );

      setInterviewSessionId("");
      setInterviewStarted(true);
      setInterviewPanelVersion((v) => v + 1);
      setMsg("New AI interview session is ready.");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Could not start a new interview session.");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmLanguage = async () => {
    setMsg("");
    if (!selectedLanguage) return setMsg("Please select a language first.");

    try {
      setBusy(true);
      const id = await saveDraft({
        description: description.trim() || "Draft created for interview/voice recording.",
        language: selectedLanguage,
      });

      if (!id) {
        setMsg("Could not create case draft. Please try again.");
        return;
      }

      await refreshLists(id);
      await loadMatching(id);

      setShowLangModal(false);

      if (selectedLanguage === "English" || selectedLanguage === "Urdu") {
        await axios.post(
          `${API_BASE_URL}/api/client/dashboard/start-case/ai/start`,
          { caseId: id, provider: "gcp", providerSessionId: null },
          { headers: authHeaders() }
        );
        setInterviewSessionId("");
        setInterviewStarted(true);
        setMsg("AI interview ready");
        return;
      }

      setMsg("Voice note ready → Record → Preview → Upload");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const saveDescription = async () => {
    if (!validation.ok || busy) return;
    try {
      setBusy(true);
      const id = await saveDraft({
        description: description.trim(),
        language: selectedLanguage || "English",
      });
      if (id) await refreshLists(id);
      if (id) await loadMatching(id);
      setMsg("Description saved");
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // sendInterviewMessage removed — now handled by VoiceInterviewPanel

  const startAnalyser = (stream: MediaStream) => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch { }
    try {
      analyserRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch { }
    try {
      audioCtxRef.current?.close();
    } catch { }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.86;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    const loop = () => {
      const paused = recorderRef.current?.state === "paused";

      if (!paused) {
        analyser.getByteTimeDomainData(data);

        const seg = Math.floor(data.length / BARS);
        const nextBars: number[] = new Array(BARS);

        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          const start = i * seg;
          const end = i === BARS - 1 ? data.length : start + seg;
          for (let j = start; j < end; j++) sum += Math.abs(data[j] - 128);
          const avg = sum / (end - start);
          nextBars[i] = clamp(6 + (avg / 128) * 40, 6, 52);
        }

        const rms = rmsFromTimeDomain(data);
        setLevel(rms);
        setBars(nextBars);
      } else {
        setLevel((l) => l * 0.92);
        setBars((prev) => prev.map((h) => Math.max(6, h * 0.95)));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  };

  const stopAnalyser = async () => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch { }
    rafRef.current = null;

    try {
      analyserRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch { }

    analyserRef.current = null;
    sourceRef.current = null;

    try {
      await audioCtxRef.current?.close();
    } catch { }
    audioCtxRef.current = null;

    setBars(Array.from({ length: BARS }, () => 8));
    setLevel(0);
  };

  const startRecording = async () => {
    setMsg("");
    setRecordedBlob(null);
    setRecordSeconds(0);
    recordedChunksRef.current = [];
    setAudioPreviewUrl("");
    setPlaying(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      startAnalyser(stream);

      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      rec.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));

        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch { }
        streamRef.current = null;

        await stopAnalyser();
        setMsg("Recording finished. Preview & upload when ready.");
      };

      rec.start();
      setIsRecording(true);
      setIsPaused(false);
    } catch {
      setMsg("Microphone access denied. Please allow microphone permission.");
      await stopAnalyser();
    }
  };

  const pauseRecording = () => {
    recorderRef.current?.pause();
    setIsPaused(true);
  };

  const resumeRecording = () => {
    recorderRef.current?.resume();
    setIsPaused(false);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
    setIsPaused(false);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const uploadVoice = async () => {
    if (!recordedBlob) return setMsg("Please record something first.");

    try {
      setBusy(true);
      const id = await ensureDraftCase();

      const fd = new FormData();
      fd.append("caseId", String(id));
      fd.append("language", selectedLanguage || "Other");
      fd.append("notes", "");
      fd.append("audio", recordedBlob, "voice.webm");

      await axios.post(`${API_BASE_URL}/api/client/dashboard/start-case/voice/upload`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });

      setMsg("Voice note uploaded");
      await refreshLists(id);
      await loadMatching(id);

      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl("");
      setRecordedBlob(null);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (file: File, docType: string) => {
    try {
      setBusy(true);
      const id = await ensureDraftCase();

      const fd = new FormData();
      fd.append("caseId", String(id));
      fd.append("docType", docType);
      if (selectedLanguage) fd.append("language", selectedLanguage);
      fd.append("file", file);

      await axios.post(`${API_BASE_URL}/api/client/dashboard/start-case/documents/upload`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });

      setMsg(`${docType.replace("_", " ")} uploaded`);
      await refreshLists(id);
      await loadMatching(id);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const resetLocalSession = async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { }

    setCaseId(null);
    setSelectedLanguage("");
    setDescription("");
    setDocuments([]);
    setVoiceNotes([]);
    setRecordedBlob(null);

    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioPreviewUrl("");

    setShowLangModal(true);
    setMsg("Reset done. Please select language again.");
  };

  return (
    <section className="space-y-6 pb-12">
      <style>{`
        @keyframes blink-dot { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
        .animate-blink-dot { animation: blink-dot 1.05s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Start a New Case</h1>
          <p className="mt-1 text-sm text-slate-600">
            Choose language → AI conversation (English/Urdu) or Voice note (others)
          </p>
          {msg && <p className="mt-2 text-sm text-amber-700">{msg}</p>}
          {caseId && <p className="mt-1 text-xs text-slate-500">Case ID: {caseId}</p>}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
            <ShieldCheck size={14} className="text-emerald-600" />
            Your data is protected
          </div>

          <button
            type="button"
            onClick={resetLocalSession}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 transition"
            title="Reset (for testing)"
          >
            <RefreshCw size={14} />
            Reset
          </button>
        </div>
      </div>

      {/* Language + Documents */}
      <div className="grid md:grid-cols-2 gap-5">
        <button
          type="button"
          onClick={() => setShowLangModal(true)}
          className="text-left bg-white rounded-2xl p-6 shadow hover:shadow-md transition border border-slate-200"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700 border border-blue-200">
            <Globe size={14} /> Language
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">Interview / Voice</h2>
          <p className="mt-2 text-sm text-slate-600">
            English/Urdu → AI conversation<br />Other languages → Voice note
          </p>
          <div className="mt-4 text-sm font-semibold text-[#004aad]">
            Current: {selectedLanguage || "Not selected"}
          </div>
        </button>

        <div className="bg-white rounded-2xl p-6 shadow border border-slate-200">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700 border border-amber-200">
            <UploadCloud size={14} /> Upload
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">Supporting Documents</h2>
          <p className="mt-2 text-sm text-slate-600">Add documents one by one</p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {(["CNIC_FRONT", "CNIC_BACK", "ADDRESS_PROOF", "EVIDENCE", "OTHER"] as const).map((t) => (
              <label
                key={t}
                className="border rounded-xl p-4 cursor-pointer hover:bg-slate-50 transition text-sm flex items-center justify-between"
              >
                <span className="font-medium">{t.replace("_", " ")}</span>
                <FileUp size={18} className="text-[#004aad]" />
                <input
                  type="file"
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadDocument(file, t);
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* AI Voice Interview */}
      {hasLang && isAiMode && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">AI Interview</div>
              <div className="text-xs text-slate-500">
                You can start a fresh interview anytime. Latest completed summary stays visible below.
              </div>
            </div>
            <button
              type="button"
              onClick={startNewAiInterview}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Start a new AI interview"
            >
              <RefreshCw size={14} /> Start New Interview
            </button>
          </div>
        <VoiceInterviewPanel
          key={`voice-panel-${caseId || "new"}-${interviewPanelVersion}`}
          caseId={caseId}
          language={selectedLanguage as "English" | "Urdu"}
          onSessionCreated={(sessionId: string) => {
            setInterviewSessionId(sessionId || "");
          }}
          onComplete={(result: InterviewResult) => {
            setMsg("Interview complete! Analysis saved.");
            console.log("Interview result:", result);
            const finalize = async () => {
              const id = caseId || (await ensureDraftCase());
              if (!id) {
                setMsg("Interview finished but case could not be resolved. Please refresh and try again.");
                return;
              }

              await completeInterviewForCase(id, result);
            };

            finalize().catch((e: any) => {
              const details = e?.response?.data?.error || e?.message || "Failed to finalize interview.";
              setMsg(`Interview completed but final save failed: ${details}`);
            });
          }}
          onError={(error: string) => {
            if (interviewSessionId) {
              setMsg(
                `Interview ended with issue: ${error}. Session ${interviewSessionId} may still be processing, please refresh in a few seconds.`
              );
              return;
            }
            setMsg(`Interview error: ${error}`);
          }}
        />
        </div>
      )}

      {/* Voice UI */}
      {hasLang && !isAiMode && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow overflow-hidden">
          <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AudioLines size={20} className="text-blue-300" />
              <div>
                <div className="text-base font-semibold">Voice Note</div>
                <div className="text-xs text-white/70">{selectedLanguage} • Record and upload</div>
              </div>

              {isRecording && !isPaused ? (
                <span className="ml-2 inline-flex items-center gap-2 text-xs bg-red-500/20 border border-red-300/20 rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-blink-dot" />
                  REC
                </span>
              ) : isPaused ? (
                <span className="ml-2 inline-flex items-center gap-2 text-xs bg-amber-500/20 border border-amber-300/20 rounded-full px-3 py-1">
                  Paused
                </span>
              ) : recordedBlob ? (
                <span className="ml-2 inline-flex items-center gap-2 text-xs bg-emerald-500/15 border border-emerald-300/15 rounded-full px-3 py-1">
                  Ready to upload
                </span>
              ) : null}
            </div>

            <div className="inline-flex items-center gap-2 text-sm bg-white/10 border border-white/15 rounded-full px-4 py-1">
              <Timer size={16} />
              {fmtTime(recordSeconds)}
            </div>
          </div>

          <div className="p-6 md:p-8">
            <div className="rounded-3xl border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-b from-slate-50 to-white p-6 md:p-8">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">Live waveform</div>
                  <div className="text-xs text-slate-500">Level: {Math.round(meterPct)}%</div>
                </div>

                <div className="h-24 md:h-28 flex items-end gap-[4px]">
                  {bars.map((h, i) => {
                    const active = isRecording && !isPaused;
                    return (
                      <div
                        key={i}
                        className={`flex-1 rounded-full transition-[height,opacity] duration-150 ${active
                            ? "bg-gradient-to-t from-indigo-600 to-blue-400"
                            : recordedBlob
                              ? "bg-slate-300"
                              : "bg-slate-200"
                          }`}
                        style={{
                          height: `${h}px`,
                          opacity: active ? 0.6 + (i % 8) * 0.04 : 0.55,
                        }}
                      />
                    );
                  })}
                </div>

                {!isRecording && !recordedBlob && (
                  <div className="mt-3 text-center text-xs text-slate-500 italic">
                    Press Record to start (pause/resume supported)
                  </div>
                )}
              </div>

              <div className="bg-white border-t border-slate-200 p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        disabled={busy}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#004aad] text-white font-semibold hover:bg-[#003b82] transition"
                      >
                        <Mic size={18} />
                        Record
                      </button>
                    ) : (
                      <>
                        {!isPaused ? (
                          <button
                            onClick={pauseRecording}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 transition"
                          >
                            <Pause size={18} />
                            Pause
                          </button>
                        ) : (
                          <button
                            onClick={resumeRecording}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition"
                          >
                            <Play size={18} />
                            Resume
                          </button>
                        )}

                        <button
                          onClick={stopRecording}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-rose-600 text-white font-semibold hover:bg-rose-700 transition"
                        >
                          <CircleStop size={18} />
                          Stop
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    onClick={uploadVoice}
                    disabled={!recordedBlob || busy}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold transition ${recordedBlob && !busy
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                  >
                    {busy ? <Loader2 className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                    Upload
                  </button>
                </div>

                {audioPreviewUrl && (
                  <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="font-medium text-slate-800">Preview</div>
                      <button
                        onClick={togglePlay}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition"
                      >
                        {playing ? <Pause size={16} /> : <Play size={16} />}
                        {playing ? "Pause" : "Play"}
                      </button>
                    </div>

                    <audio
                      ref={audioRef}
                      src={audioPreviewUrl}
                      onEnded={() => setPlaying(false)}
                      className="w-full"
                      controls
                    />
                  </div>
                )}

                <p className="text-center text-xs text-slate-500 mt-3">
                  Tip: 30–90 seconds is usually enough. Speak clearly and calmly.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Optional: Write a short description</h3>
          <p className="text-xs text-slate-600 mt-1">
            This will help later for cosine similarity advocate assignment.
          </p>
        </div>

        <div className="p-6 space-y-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white p-4"
            rows={5}
            placeholder="Write 3–5 lines about your issue..."
          />
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{description.trim().length}/{maxChars}</span>
            {!validation.ok ? (
              <span className="text-red-600">{validation.msg}</span>
            ) : (
              <span className="text-emerald-700 flex items-center gap-1">
                <CheckCircle2 size={14} /> Ready
              </span>
            )}
          </div>

          <button
            onClick={saveDescription}
            disabled={!validation.ok || busy}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${!validation.ok || busy
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-[#004aad] text-white hover:bg-[#003b82]"
              }`}
          >
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            Save description
          </button>
        </div>
      </div>

      {/* Uploaded content */}
      {caseId && (
        <div className="grid md:grid-cols-2 gap-4">
          {listError && (
            <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{listError}</span>
              <button
                type="button"
                onClick={() => refreshLists(caseId)}
                className="font-semibold underline hover:text-red-900"
              >
                Retry
              </button>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <List size={16} className="text-[#004aad]" />
              <h3 className="text-sm font-semibold text-slate-900">Uploaded Documents</h3>
            </div>
            <div className="p-6">
              {documents.length === 0 ? (
                <p className="text-sm text-slate-600">No documents uploaded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {documents.map((d) => (
                    <li key={d.id} className="border rounded-xl p-3 flex items-center justify-between text-sm">
                      <span>
                        <b>{d.doc_type}</b> — {formatStatus(d.status)}
                      </span>
                      <AuthedLink className="text-[#004aad] font-semibold" url={d.file_url}>
                        View
                      </AuthedLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <Mic size={16} className="text-[#004aad]" />
              <h3 className="text-sm font-semibold text-slate-900">Uploaded Voice Notes</h3>
            </div>
            <div className="p-6">
              {voiceNotes.length === 0 ? (
                <p className="text-sm text-slate-600">No voice uploaded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {voiceNotes.map((v) => (
                    <li key={v.id} className="border rounded-xl p-3">
                      <div className="text-sm">
                        <b>{v.language}</b>{" "}
                        <span className="text-xs text-slate-500">— {new Date(v.created_at).toLocaleString()}</span>
                      </div>
                      <AuthedAudio className="w-full mt-2" src={v.audio_url} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {caseId && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#004aad]" />
              <h3 className="text-sm font-semibold text-slate-900">Matched Lawyers (Top 5)</h3>
            </div>
            <button
              type="button"
              onClick={() => loadMatching(caseId)}
              disabled={matchingBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold"
            >
              <RefreshCw size={14} className={matchingBusy ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          <div className="p-6">
            {matchingCaseMeta?.case_display_label ? (
              <div className="mb-3 text-xs text-slate-500">{matchingCaseMeta.case_display_label}</div>
            ) : null}
            {latestInterview?.summary ? (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <div className="font-semibold">Latest AI Interview Summary</div>
                {latestInterview?.meta?.completedAt ? (
                  <div className="mt-1 text-emerald-800/80">
                    Completed {new Date(latestInterview.meta.completedAt).toLocaleString()}
                    {latestInterview.meta.completionSource ? ` • ${latestInterview.meta.completionSource}` : ""}
                  </div>
                ) : null}
                <div className="mt-2 space-y-1">
                  <div><span className="font-semibold">Legal domain:</span> {formatAiEnum("domain", latestInterview.summary.legalDomain)}</div>
                  <div><span className="font-semibold">Issue:</span> {latestInterview.summary.issueSummary || "—"}</div>
                  <div><span className="font-semibold">Language:</span> {formatAiEnum("language", latestInterview.summary.primaryLanguage)}</div>
                  <div><span className="font-semibold">Urgency:</span> {formatAiEnum("urgency", latestInterview.summary.urgency)}</div>
                </div>
                {latestInterview.transcript ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-semibold">View previous transcript</summary>
                    <div className="mt-2 max-h-40 overflow-auto rounded border border-emerald-200 bg-white/80 p-2 whitespace-pre-wrap text-[11px] text-slate-700">
                      {latestInterview.transcript}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
            {matchingBusy ? (
              <div className="text-sm text-slate-500">Loading shortlist...</div>
            ) : matchingCandidates.length === 0 ? (
              <div className="text-sm text-slate-600">
                No shortlisted advocates yet. Complete interview and refresh in a few seconds.
              </div>
            ) : (
              <div className="space-y-3">
                {matchingCandidates.map((c) => {
                  const isSelected = selectedAdvocateId === Number(c.advocate_id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSubmitted(false);
                        setSelectedAdvocateId(Number(c.advocate_id));
                      }}
                      className={`w-full text-left rounded-xl border p-4 transition ${
                        isSelected
                          ? "border-[#004aad] bg-[#004aad]/5 ring-1 ring-[#004aad]/30"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              #{c.rank_position} {c.advocate_name || "Advocate"}
                            </span>
                            {isSelected ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#004aad] bg-[#004aad]/10 px-2 py-0.5 rounded-full">
                                <CheckCircle2 size={12} /> Selected
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            {c.advocate_email} • {c.city || "City —"} • Exp {c.experience_years ?? 0}y
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Languages: {Array.isArray(c.languages) && c.languages.length ? c.languages.join(", ") : "—"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Match Score</div>
                          <div className="text-lg font-extrabold text-slate-900">{Number(c.total_score || 0).toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{(c.reasons || []).join(" | ")}</div>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={chooseAdvocate}
                  disabled={!selectedAdvocateId || selectionBusy}
                  className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                    !selectedAdvocateId || selectionBusy || submitted
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-[#004aad] text-white hover:bg-[#003b82]"
                  }`}
                >
                  {selectionBusy ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : submitted ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  {selectionBusy
                    ? "Submitting..."
                    : submitted
                    ? "Awaiting Admin Approval"
                    : "Select This Lawyer"}
                </button>
                <p className="text-xs text-slate-500">
                  Your selection is sent to admin for approval. Lawyer receives case details only after admin approval.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Language Modal */}
      {showLangModal && (
        <Modal title="Select Language" onClose={() => setShowLangModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              English/Urdu → AI Interview UI. Other languages → Voice note UI.
            </p>

            <div className="grid grid-cols-1 gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition ${selectedLanguage === l.value
                      ? "border-[#004aad] bg-[#004aad]/10 text-[#004aad] font-semibold"
                      : "border-slate-200 hover:bg-slate-50"
                    }`}
                  onClick={() => setSelectedLanguage(l.value)}
                  type="button"
                >
                  {l.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onConfirmLanguage}
              disabled={busy}
              className="w-full rounded-xl bg-[#004aad] text-white py-2.5 text-sm font-semibold hover:bg-[#003b82] disabled:opacity-60"
            >
              {busy ? "Starting..." : "Continue"}
            </button>

            <div className="text-xs text-slate-500">If something fails: logout and login again.</div>
          </div>
        </Modal>
      )}
    </section>
  );
}
