import { formatAiEnum } from "../common/formatStatus";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { VOICE_SERVICE_URL, API_BASE_URL } from "../../config";
import {
    Mic,
    MicOff,
    Loader2,
    CheckCircle2,
    AlertCircle,
    MessageSquare,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import "./VoiceInterviewPanel.css";

/* ─── Types ───────────────────────────────────────────────────── */

export type InterviewResult = {
    session_id: string;
    transcript: string;
    analysis: {
        primary_language?: string;
        legal_domain?: string;
        confidence_score?: number;
        key_entities?: {
            parties?: string[];
            locations?: string[];
            dates?: string[];
            amounts?: string[];
        };
        issue_summary?: string;
        adr_suitable?: boolean;
        adr_reasoning?: string;
        urgency?: string;
        urgency_reasoning?: string;
    };
    audio_url?: string;
    audio_duration_seconds?: number;
};

type Message = {
    id: string;
    role: "agent" | "user" | "system";
    text: string;
    isUrdu?: boolean;
};

type AgentState = "idle" | "speaking" | "listening" | "thinking" | "complete";

type Props = {
    caseId: number | null;
    clientId?: number;
    language: "English" | "Urdu";
    onComplete?: (result: InterviewResult) => void;
    onError?: (error: string) => void;
    onSessionCreated?: (sessionId: string) => void;
};

/* ─── Helpers (identical to test_ui.html) ─────────────────────── */

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
}

/* ─── Voice-activity constants (EXACTLY from test_ui.html) ────── */

const SPEECH_THRESHOLD = 6;    // Volume level to detect speech (lowered to catch quiet speakers)
const SILENCE_THRESHOLD = 3;   // Volume level considered silence
const SILENCE_DURATION = 1500; // 1.5 seconds of silence after speaking = done
const NOISE_FLOOR_ALPHA = 0.08; // EMA for background noise tracking

/* ─── Component ───────────────────────────────────────────────── */

export default function VoiceInterviewPanel({
    caseId,
    clientId,
    language,
    onComplete,
    onError,
    onSessionCreated,
}: Props) {
    /* ─── React state (UI only) ─────────────────────── */
    const [status, setStatus] = useState<"idle" | "connecting" | "active" | "complete" | "error">("idle");
    const [statusText, setStatusText] = useState("Click Start to begin the interview");
    const [messages, setMessages] = useState<Message[]>([]);
    const [agentState, setAgentState] = useState<AgentState>("idle");
    const [result, setResult] = useState<InterviewResult | null>(null);
    const [showChat, setShowChat] = useState(false);
    const [micVolume, setMicVolume] = useState(0);

    /* ─── Mutable state (refs — mirrors test_ui.html's plain vars) ── */
    // WebSocket & session
    const wsRef = useRef<WebSocket | null>(null);
    const sessionIdRef = useRef<string | null>(null);

    // Audio playback
    const agentAudioRef = useRef<HTMLAudioElement | null>(null);
    const agentIsPlayingRef = useRef(false); // mirrors: let agentIsPlaying = false

    // Recording
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const isRecordingRef = useRef(false);   // mirrors: let isRecording = false
    const canSpeakRef = useRef(false);      // mirrors: let canSpeak = false

    // VAD (voice activity detection)
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const silenceCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hasUserStartedSpeakingRef = useRef(false);
    const silenceStartRef = useRef<number | null>(null);
    const noiseFloorRef = useRef<number | null>(null);

    // UI
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const hasDeliveredResultRef = useRef(false);
    const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /* ─── Auto-scroll ───────────────────────────────── */
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    /* ─── Cleanup on unmount ────────────────────────── */
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }
            if (wsRef.current) {
                try { wsRef.current.close(); } catch { /* ignore */ }
            }
            if (finalizeTimerRef.current) {
                clearTimeout(finalizeTimerRef.current);
                finalizeTimerRef.current = null;
            }
            cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addMsg = useCallback(
        (role: Message["role"], text: string, isUrdu = false) => {
            setMessages((prev) => [
                ...prev,
                { id: `${role}-${Date.now()}-${Math.random()}`, role, text, isUrdu },
            ]);
        },
        []
    );

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const completeFromPersistedSession = useCallback(
        async (sessionId: string) => {
            const res = await fetch(`${API_BASE_URL}/api/interviews/${sessionId}`, {
                method: "GET",
                headers: { "Content-Type": "application/json", ...authHeaders() },
            });

            if (!res.ok) {
                throw new Error(`Unable to load interview results (${res.status})`);
            }

            const data = await res.json();
            const transcript = typeof data?.transcript === "string" ? data.transcript : "";
            const analysis = data?.analysis && typeof data.analysis === "object" ? data.analysis : {};
            const hasMeaningfulResult = transcript.trim().length > 0 || Object.keys(analysis).length > 0;

            if (!hasMeaningfulResult) {
                throw new Error("Interview ended but final analysis is still processing.");
            }

            const fallbackResult: InterviewResult = {
                session_id: sessionId,
                transcript,
                analysis,
                audio_url: data?.audio_url,
                audio_duration_seconds: data?.audio_duration_seconds,
            };

            setResult(fallbackResult);
            setStatus("complete");
            setStatusText("Interview complete!");
            addMsg("system", "Interview complete! Loaded latest results.");

            if (!hasDeliveredResultRef.current) {
                hasDeliveredResultRef.current = true;
                onComplete?.(fallbackResult);
            }
        },
        [addMsg, onComplete]
    );

    const pollAndRecoverResults = useCallback(
        async (sessionId: string) => {
            for (let attempt = 1; attempt <= 4; attempt += 1) {
                if (hasDeliveredResultRef.current) return;
                try {
                    await completeFromPersistedSession(sessionId);
                    return;
                } catch {
                    if (attempt < 4) {
                        await sleep(2000);
                    }
                }
            }

            if (!hasDeliveredResultRef.current) {
                setStatus("error");
                setStatusText("Interview ended, but results are still being processed. Please retry shortly.");
                onError?.("Interview ended but final analysis is still processing.");
            }
        },
        [completeFromPersistedSession, onError]
    );

    const scheduleFallbackFinalize = useCallback(() => {
        const sid = sessionIdRef.current;
        if (!sid) return;

        if (finalizeTimerRef.current) {
            clearTimeout(finalizeTimerRef.current);
            finalizeTimerRef.current = null;
        }

        finalizeTimerRef.current = setTimeout(() => {
            if (!hasDeliveredResultRef.current) {
                pollAndRecoverResults(sid);
            }
        }, 12000);
    }, [pollAndRecoverResults]);

    /* ================================================================
       EXACTLY MATCHING test_ui.html FLOW
       ================================================================ */

    /* ─── cleanup() — from test_ui.html line 863 ───── */

    const cleanup = () => {
        if (silenceCheckIntervalRef.current) {
            clearInterval(silenceCheckIntervalRef.current);
            silenceCheckIntervalRef.current = null;
        }
        if (audioCtxRef.current) {
            try { audioCtxRef.current.close(); } catch { /* ignore */ }
            audioCtxRef.current = null;
        }
        analyserRef.current = null;
    };

    /* ─── startInterview() — from test_ui.html line 465 ─ */

    const startInterview = async () => {
        setStatus("connecting");
        setStatusText("Creating session...");
        setMessages([]);
        setResult(null);
        hasDeliveredResultRef.current = false;

        if (finalizeTimerRef.current) {
            clearTimeout(finalizeTimerRef.current);
            finalizeTimerRef.current = null;
        }

        try {
            addMsg("system", "Creating session...");

            // Create session — EXACTLY like test_ui.html (with a hard timeout)
            const response = await fetchWithTimeout(
                `${VOICE_SERVICE_URL}/api/v1/sessions`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        client_id: clientId?.toString() || caseId?.toString() || `web_${Date.now()}`,
                        metadata: {
                            language: language,
                            source: "webapp",
                        },
                    }),
                },
                20000
            );

            if (!response.ok) throw new Error(`Voice service returned ${response.status}`);
            const data = await response.json();
            const sessionId = data.session_id;
            sessionIdRef.current = sessionId;
            onSessionCreated?.(sessionId);

            addMsg("system", "Session created! Connecting to WebSocket...");

            // Store session in backend (non-blocking) — extra for webapp
            fetch(`${API_BASE_URL}/api/interviews/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ sessionId, caseId, wsUrl: data.ws_url, language }),
            }).catch((e) => console.warn("Failed to store session:", e));

            // Connect WebSocket — EXACTLY like test_ui.html
            // test_ui.html constructs URL itself: `${WS_BASE}/api/v1/ws/${sessionId}`
            // we do the same using VOICE_SERVICE_URL
            const wsBase = VOICE_SERVICE_URL.replace("https://", "wss://").replace("http://", "ws://");
            const wsUrl = `${wsBase}/api/v1/ws/${sessionId}`;
            console.log("[WS] Connecting to:", wsUrl);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            // Bootstrap guard: a dead service must not leave the UI on
            // "Connecting…" forever.
            const bootstrapTimer = setTimeout(() => {
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.close(4000, "connection timeout");
                    setStatus("error");
                    setStatusText("Voice service did not respond. Please try again.");
                    addMsg("system", "Connection timed out. Check if the voice service is reachable.");
                }
            }, 10000);

            ws.onopen = () => {
                clearTimeout(bootstrapTimer);
                // test_ui.html sends a ping on open
                console.log("WS open, sending ping test");
                ws.send(JSON.stringify({ type: "ping_from_client", t: Date.now() }));
                setStatus("active");
                setStatusText("Connected — waiting for agent...");
                addMsg("system", "Connected! Waiting for agent...");
            };

            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    console.log("Received:", msg);
                    handleWebSocketMessage(msg);
                } catch (e) {
                    console.error("WS message parse error:", e);
                }
            };

            ws.onerror = () => {
                clearTimeout(bootstrapTimer);
                setStatus("error");
                setStatusText("WebSocket connection error");
                addMsg("system", "Connection error! Check if voice service is running.");
            };

            ws.onclose = () => {
                if (status === "active") setStatusText("Connection closed");
                if (!hasDeliveredResultRef.current && sessionIdRef.current) {
                    scheduleFallbackFinalize();
                }
            };
        } catch (e: any) {
            console.error("Failed to start interview:", e);
            setStatus("error");
            setStatusText(e?.message || "Failed to connect to voice service");
            onError?.(e?.message || "Connection failed");
        }
    };

    /* ─── handleWebSocketMessage() — from test_ui.html line 525 ─ */

    const handleWebSocketMessage = (msg: any) => {
        switch (msg.type) {
            case "agent_speech":
                handleAgentSpeech(msg);
                break;

            case "conversation_status":
                handleConversationStatus(msg);
                break;

            case "transcript":
                if (msg.is_final) {
                    addMsg("user", msg.text);
                }
                break;

            case "results":
                handleResults(msg);
                break;

            case "error":
                addMsg("system", `Error: ${msg.message_en || msg.message_ur || "Unknown"}`);
                setStatus("error");
                setStatusText(msg.message_en || "Error occurred");
                onError?.(msg.message_en || "Error");
                break;

            case "status":
                addMsg("system", msg.message_en || msg.message_ur || "");
                break;

            default:
                console.log("Unknown WS type:", msg.type, msg);
        }
    };

    /* ─── handleAgentSpeech() — EXACTLY from test_ui.html line 559 ─ */
    // NO queue. NO safety timeout. Just play directly.

    const handleAgentSpeech = (msg: any) => {
        // Display text
        addMsg("agent", msg.text, msg.language === "ur-PK");

        // Play audio
        if (msg.audio) {
            try {
                agentIsPlayingRef.current = true; // Block recording while playing
                const audioBlob = base64ToBlob(msg.audio, "audio/mpeg");
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = agentAudioRef.current!;
                audio.src = audioUrl;

                // When audio finishes, allow recording
                audio.onended = () => {
                    agentIsPlayingRef.current = false;
                    URL.revokeObjectURL(audioUrl);
                    console.log("Agent finished speaking, ready to listen");
                };

                audio.play().catch((e) => {
                    console.log("Audio autoplay blocked:", e);
                    agentIsPlayingRef.current = false; // Reset if play fails
                });
            } catch (e) {
                console.error("Error playing audio:", e);
                agentIsPlayingRef.current = false;
            }
        }
    };

    /* ─── handleConversationStatus() — from test_ui.html line 589 ─ */

    const handleConversationStatus = (msg: any) => {
        canSpeakRef.current = msg.can_speak;
        const state: AgentState = msg.agent_state || "idle";
        setAgentState(state);

        switch (msg.agent_state) {
            case "speaking":
                setStatusText("Agent is speaking...");
                break;

            case "listening":
                setStatusText("Your turn — listening...");
                // AUTO-LISTEN: Wait for agent audio to finish, then start recording
                // EXACTLY like test_ui.html line 610
                waitForAgentToFinishThenListen();
                break;

            case "thinking":
                setStatusText("Processing your answer...");
                break;

            case "complete":
                setStatusText("Interview complete");
                break;
        }
    };

    /* ─── handleResults() — from test_ui.html line 629 ─ */

    const handleResults = async (msg: any) => {
        if (finalizeTimerRef.current) {
            clearTimeout(finalizeTimerRef.current);
            finalizeTimerRef.current = null;
        }

        console.log("Interview result:", msg);
        const r: InterviewResult = {
            session_id: msg.session_id,
            transcript: msg.transcript,
            analysis: msg.analysis || {},
            audio_url: msg.audio_url,
            audio_duration_seconds: msg.audio_duration_seconds,
        };
        setResult(r);
        setStatus("complete");
        setStatusText("Interview complete!");
        addMsg("system", "Interview complete! Results above.");
        hasDeliveredResultRef.current = true;

        // Persist to the backend FIRST so the dashboard's completion gate
        // (which requires a completed voice session) sees the result.
        try {
            await fetchWithTimeout(
                `${API_BASE_URL}/api/interviews/complete`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({
                        sessionId: msg.session_id,
                        caseId,
                        transcript: msg.transcript,
                        analysis: msg.analysis,
                        audioUrl: msg.audio_url,
                    }),
                },
                20000
            );
        } catch (err) {
            console.error("Failed to persist interview result to backend", err);
        }

        onComplete?.(r);
    };

    /* ─── waitForAgentToFinishThenListen() — EXACTLY from test_ui.html line 713 ─ */

    const waitForAgentToFinishThenListen = () => {
        if (isRecordingRef.current) return; // Already recording

        if (agentIsPlayingRef.current) {
            // Agent still speaking, wait and check again
            setTimeout(waitForAgentToFinishThenListen, 200);
        } else {
            // Agent done, wait a moment then start listening
            setTimeout(() => {
                if (canSpeakRef.current && !isRecordingRef.current && !agentIsPlayingRef.current) {
                    startAutoRecording();
                }
            }, 300); // Small delay after audio ends — matches test_ui.html
        }
    };

    /* ─── startAutoRecording() — EXACTLY from test_ui.html line 752 ─ */

    const startAutoRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Set up audio analysis
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.fftSize = 256;
            audioCtxRef.current = audioContext;
            analyserRef.current = analyser;

            // Set up MediaRecorder — EXACTLY like test_ui.html
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
                audioBitsPerSecond: 128000,
            });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                cleanup();

                // Only send if user actually spoke something
                if (hasUserStartedSpeakingRef.current && audioChunksRef.current.length > 0) {
                    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                    const audioBuffer = await audioBlob.arrayBuffer();
                    const base64Audio = arrayBufferToBase64(audioBuffer);

                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        // Send audio
                        console.log("sending audio over WS, bytes=", audioBlob.size);
                        wsRef.current.send(JSON.stringify({
                            type: "audio",
                            audio: base64Audio,
                            sequence: Date.now(),
                        }));
                        // Signal we're done speaking
                        wsRef.current.send(JSON.stringify({
                            type: "user_finished",
                            silence_duration: 1.5,
                        }));
                    }
                }
            };

            // Reset state
            hasUserStartedSpeakingRef.current = false;
            silenceStartRef.current = null;
            noiseFloorRef.current = null;

            // Start recording
            mediaRecorder.start(); // no timeslice => single clean container
            isRecordingRef.current = true;

            // Update UI
            setStatusText("🎤 Listening... speak now!");
            addMsg("system", "🎤 Listening... Speak now! (auto-detects when you're done)");

            // Start voice activity detection loop — EXACTLY like test_ui.html
            const checkSilence = () => {
                if (!analyserRef.current || !isRecordingRef.current) return;

                const dataArray = new Uint8Array(analyserRef.current.fftSize);
                analyserRef.current.getByteTimeDomainData(dataArray);
                let sumSquares = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const centered = (dataArray[i] - 128) / 128;
                    sumSquares += centered * centered;
                }
                const rms = Math.sqrt(sumSquares / dataArray.length);
                const avgVolume = rms * 100; // Scale to a 0-100-ish range

                if (noiseFloorRef.current === null) {
                    noiseFloorRef.current = avgVolume;
                } else if (!hasUserStartedSpeakingRef.current) {
                    noiseFloorRef.current =
                        noiseFloorRef.current * (1 - NOISE_FLOOR_ALPHA) + avgVolume * NOISE_FLOOR_ALPHA;
                }

                const dynamicSpeechThreshold = Math.max(SPEECH_THRESHOLD, (noiseFloorRef.current || 0) + 4);
                const dynamicSilenceThreshold = Math.max(SILENCE_THRESHOLD, (noiseFloorRef.current || 0) + 2);

                if (!hasUserStartedSpeakingRef.current) {
                    // STATE 1: Waiting for user to start speaking
                    if (avgVolume > dynamicSpeechThreshold) {
                        hasUserStartedSpeakingRef.current = true;
                        silenceStartRef.current = null;
                        setStatusText("🔴 Recording...");
                        console.log("Voice detected! Recording started.");
                    }
                } else {
                    // STATE 2: User has started speaking, detect when they stop
                    if (avgVolume < dynamicSilenceThreshold) {
                        // Silence detected
                        if (!silenceStartRef.current) {
                            silenceStartRef.current = Date.now();
                        } else if (Date.now() - silenceStartRef.current > SILENCE_DURATION) {
                            // Silence long enough - they're done
                            console.log("Silence after speech detected. Processing...");
                            stopAutoRecording();
                            // Do NOT set hasUserStartedSpeakingRef=false here!
                            // The onstop event is asynchronous and needs to see this=true to send the audio!
                        }
                    } else {
                        // Still speaking, reset silence timer
                        silenceStartRef.current = null;
                    }
                }

                // Update UI Mic Volume for the breathing orb animation
                // (Scale from 0 to 1 based on volume typical range ~0-50)
                const normalizedVol = Math.min(Math.max(avgVolume / 50, 0), 1);
                setMicVolume((prev) => prev * 0.8 + normalizedVol * 0.2); // Smooth lerp

                silenceCheckIntervalRef.current = setTimeout(checkSilence, 50);
            };

            silenceCheckIntervalRef.current = setTimeout(checkSilence, 50);

        } catch (error: any) {
            console.error("Auto-recording error:", error);
            setStatus("error");
            setStatusText("Microphone access denied");
            addMsg("system", "Microphone access denied. Please allow microphone access and try again.");
            onError?.("Microphone access denied");
        }
    };

    /* ─── stopAutoRecording() — EXACTLY from test_ui.html line 874 ─ */

    const stopAutoRecording = () => {
        if (mediaRecorderRef.current && isRecordingRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
            isRecordingRef.current = false;
            setStatusText("⏳ Processing...");
            setMicVolume(0); // Reset mic volume when recording stops

            console.log("stopAutoRecording called. isRecording=", isRecordingRef.current,
                "state=", mediaRecorderRef.current?.state);

            if (hasUserStartedSpeakingRef.current) {
                addMsg("system", "⏳ Processing your response...");
            }
        }
    };

    /* ─── userFinished() — Manual "Done Speaking" — from test_ui.html line 913 ─ */

    const userFinished = () => {
        // Stop recording (triggers onstop which sends audio)
        if (mediaRecorderRef.current && isRecordingRef.current) {
            // Fake that they started speaking so `onstop` sends whatever audio we have
            hasUserStartedSpeakingRef.current = true;

            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
            isRecordingRef.current = false;
            setMicVolume(0); // Reset mic volume when recording stops

            // The onstop handler will take care of sending the audio and the `user_finished` message
        } else {
            // If not recording, just send a basic user_finished
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: "user_finished",
                    silence_duration: 2.0,
                }));
            }
        }

        addMsg("system", "Processing your response...");
    };

    /* ─── endInterview() — from test_ui.html line 929 ─ */

    const endInterview = () => {
        if (mediaRecorderRef.current && isRecordingRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
            isRecordingRef.current = false;
            setMicVolume(0); // Reset mic volume when recording stops
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "end_interview" }));
        }

        setStatusText("Finishing interview... waiting for final analysis.");
        setAgentState("thinking");
        addMsg("system", "Interview ending... final analysis is being prepared.");
        scheduleFallbackFinalize();
        cleanup();
    };

    /* ================================================================
       RENDER — Interactive Voice-First UI
       ================================================================ */

    const isIdle = status === "idle";
    const isActive = status === "active";

    // Compute derived state classes for the orb
    let orbStateClass = "state-idle";
    if (status === "connecting") orbStateClass = "state-connecting";
    else if (agentState === "listening") orbStateClass = "state-listening";
    else if (agentState === "thinking") orbStateClass = "state-thinking";
    else if (agentState === "speaking") orbStateClass = "state-speaking";

    // Dynamic scale for the orb when listening
    const orbScale = agentState === "listening" ? 1 + micVolume * 0.4 : 1;

    return (
        <div
            style={{
                fontFamily: "Inter, sans-serif",
                background: "#0f172a",
                borderRadius: 16,
                padding: window.innerWidth < 640 ? "24px 16px" : "40px",
                color: "#e2e8f0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                border: "1px solid #1e293b",
                position: "relative",
                overflow: "hidden",
            }}
        >
            {/* Hidden audio element for agent speech */}
            <audio ref={agentAudioRef} />

            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "#fff" }}>
                    {language === "English" ? "AI Voice Intake" : "قانونی صوتی انٹرویو"}
                </h3>
                <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 14 }}>
                    {language === "English"
                        ? "Speak naturally. The AI will listen and guide you."
                        : "قدرتی انداز میں بات کریں۔ اے آئی سنے گا اور آپ کی رہنمائی کرے گا۔"}
                </p>
            </div>

            {/* Main Interactive Orb Area */}
            {status !== "complete" && status !== "error" && (
                <div className="voice-orb-container">
                    {/* Background rings/spinners depending on state */}
                    {agentState === "listening" && <div className="ring-listening" />}
                    {agentState === "thinking" && <div className="ring-thinking" />}

                    {/* The Orb */}
                    <div
                        className={`voice-orb ${orbStateClass}`}
                        style={{ transform: `scale(${orbScale})` }}
                    >
                        {status === "idle" && <Mic size={48} />}
                        {status === "connecting" && <Loader2 size={48} className="spin" color="#64748b" />}
                        {agentState === "listening" && <Mic size={48} />}
                        {agentState === "speaking" && <MicOff size={48} />}
                        {agentState === "thinking" && <MessageSquare size={48} />}
                    </div>
                </div>
            )}

            {/* Dynamic Status Text */}
            {status !== "complete" && status !== "error" && (
                <div
                    style={{
                        margin: "20px 0 40px",
                        fontSize: 18,
                        fontWeight: 500,
                        color: agentState === "speaking" ? "#60a5fa" :
                            agentState === "listening" ? "#34d399" :
                                agentState === "thinking" ? "#a78bfa" : "#cbd5e1",
                        minHeight: 28,
                        textAlign: "center"
                    }}
                >
                    {statusText}
                </div>
            )}

            {/* Controls */}
            <div style={{ display: "flex", gap: 16, justifyContent: "center", width: "100%", zIndex: 20 }}>
                {isIdle && (
                    <button
                        onClick={startInterview}
                        style={{
                            padding: "16px 40px",
                            borderRadius: 30,
                            border: "none",
                            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: "pointer",
                            fontSize: 18,
                            boxShadow: "0 4px 15px rgba(37, 99, 235, 0.4)",
                            transition: "all 0.2s ease"
                        }}
                    >
                        <Mic size={20} style={{ marginRight: 10, verticalAlign: "middle" }} />
                        Start Interview
                    </button>
                )}

                {status === "connecting" && (
                    <button
                        disabled
                        style={{
                            padding: "16px 40px",
                            borderRadius: 30,
                            border: "none",
                            background: "#334155",
                            color: "#94a3b8",
                            fontWeight: 600,
                            fontSize: 18,
                        }}
                    >
                        <Loader2 size={20} className="spin" style={{ marginRight: 10 }} />
                        Connecting...
                    </button>
                )}

                {isActive && (
                    <>
                        <button
                            onClick={userFinished}
                            disabled={agentState !== "listening"}
                            style={{
                                padding: "14px 32px",
                                borderRadius: 30,
                                border: "none",
                                background: agentState === "listening" ? "#10b981" : "#334155",
                                color: "#fff",
                                fontWeight: 600,
                                cursor: agentState === "listening" ? "pointer" : "not-allowed",
                                fontSize: 16,
                                transition: "all 0.2s"
                            }}
                        >
                            <CheckCircle2
                                size={18}
                                style={{ marginRight: 8, verticalAlign: "middle" }}
                            />
                            Done Speaking
                        </button>
                        <button
                            onClick={endInterview}
                            style={{
                                padding: "14px 32px",
                                borderRadius: 30,
                                border: "1px solid #ef4444",
                                background: "rgba(239, 68, 68, 0.1)",
                                color: "#ef4444",
                                fontWeight: 600,
                                cursor: "pointer",
                                fontSize: 16,
                            }}
                        >
                            End Interview
                        </button>
                    </>
                )}

                {status === "error" && (
                    <button
                        onClick={() => {
                            setStatus("idle");
                            setStatusText("Click Start to begin the interview");
                        }}
                        style={{
                            padding: "14px 32px",
                            borderRadius: 30,
                            border: "1px solid #eab308",
                            background: "transparent",
                            color: "#eab308",
                            fontWeight: 600,
                            cursor: "pointer",
                            fontSize: 16,
                        }}
                    >
                        <AlertCircle
                            size={18}
                            style={{ marginRight: 8, verticalAlign: "middle" }}
                        />
                        Retry
                    </button>
                )}
            </div>

            {/* Chat History Toggle (Clean View) */}
            {(messages.length > 0 || status === "complete") && (
                <div style={{ width: "100%", marginTop: 40, borderTop: "1px solid #1e293b" }}>
                    <button
                        onClick={() => setShowChat(!showChat)}
                        style={{
                            width: "100%",
                            padding: "16px 0",
                            background: "transparent",
                            border: "none",
                            color: "#94a3b8",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            fontSize: 14,
                        }}
                    >
                        <MessageSquare size={16} style={{ marginRight: 8 }} />
                        {showChat ? "Hide Transcript" : "Show Transcript"}
                        {showChat ? <ChevronUp size={16} style={{ marginLeft: 8 }} /> : <ChevronDown size={16} style={{ marginLeft: 8 }} />}
                    </button>

                    {showChat && (
                        <div
                            className="chat-history-scroll"
                            style={{
                                height: 280,
                                overflowY: "auto",
                                background: "#020617",
                                borderRadius: 12,
                                padding: 16,
                                marginTop: 8,
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                                border: "1px solid #1e293b",
                            }}
                        >
                            {messages.map((m) => (
                                <div
                                    key={m.id}
                                    style={{
                                        alignSelf:
                                            m.role === "user"
                                                ? "flex-end"
                                                : m.role === "agent"
                                                    ? "flex-start"
                                                    : "center",
                                        background:
                                            m.role === "user"
                                                ? "#2563eb"
                                                : m.role === "agent"
                                                    ? "#1e293b"
                                                    : "transparent",
                                        color: m.role === "system" ? "#64748b" : "#f1f5f9",
                                        padding: m.role === "system" ? "4px 8px" : "12px 16px",
                                        borderRadius: 16,
                                        borderBottomRightRadius: m.role === "user" ? 4 : 16,
                                        borderBottomLeftRadius: m.role === "agent" ? 4 : 16,
                                        maxWidth: "85%",
                                        fontSize: m.role === "system" ? 12 : 14,
                                        fontStyle: m.role === "system" ? "italic" : "normal",
                                        direction: m.isUrdu ? "rtl" : "ltr",
                                        fontFamily: m.isUrdu ? "'Noto Nastaliq Urdu', serif" : "inherit",
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {m.text}
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>
            )}

            {/* Results Display Area */}
            {status === "complete" && result && (
                <div
                    style={{
                        background: "linear-gradient(to bottom right, #0f172a, #1e293b)",
                        borderRadius: 16,
                        padding: 24,
                        width: "100%",
                        marginTop: 20,
                        border: "1px solid #334155",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.3)"
                    }}
                >
                    <h4 style={{ color: "#34d399", margin: "0 0 20px", display: "flex", alignItems: "center", fontSize: 20 }}>
                        <CheckCircle2
                            size={24}
                            style={{ marginRight: 12 }}
                        />
                        Interview Complete
                    </h4>
                    {Object.keys(result.analysis || {}).length > 0 ? (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 16,
                                fontSize: 14,
                                color: "#cbd5e1",
                            }}
                        >
                            <div style={{ background: "#0b1120", padding: "12px 16px", borderRadius: 8 }}>
                                <strong style={{ color: "#94a3b8", display: "block", marginBottom: 4 }}>Legal Domain</strong>
                                {formatAiEnum("domain", result.analysis.legal_domain)}
                            </div>
                            <div style={{ background: "#0b1120", padding: "12px 16px", borderRadius: 8 }}>
                                <strong style={{ color: "#94a3b8", display: "block", marginBottom: 4 }}>Urgency</strong>
                                {formatAiEnum("urgency", result.analysis.urgency)}
                            </div>
                            <div style={{ background: "#0b1120", padding: "12px 16px", borderRadius: 8 }}>
                                <strong style={{ color: "#94a3b8", display: "block", marginBottom: 4 }}>Confidence Score</strong>
                                {result.analysis.confidence_score
                                    ? `${(result.analysis.confidence_score * 100).toFixed(0)}%`
                                    : "—"}
                            </div>
                            <div style={{ background: "#0b1120", padding: "12px 16px", borderRadius: 8 }}>
                                <strong style={{ color: "#94a3b8", display: "block", marginBottom: 4 }}>ADR Suitable</strong>
                                {result.analysis.adr_suitable === true ? "Yes" : result.analysis.adr_suitable === false ? "No" : "—"}
                            </div>
                            <div style={{ gridColumn: "1 / -1", background: "#0b1120", padding: "16px", borderRadius: 8, marginTop: 8 }}>
                                <strong style={{ color: "#94a3b8", display: "block", marginBottom: 8 }}>Issue Summary</strong>
                                <p style={{ margin: 0, lineHeight: 1.6 }}>{result.analysis.issue_summary || "—"}</p>
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: "#94a3b8", fontSize: 14, background: "#0b1120", padding: "16px", borderRadius: 8 }}>
                            AI Analysis unavailable. The interview may have been too short, or no specific legal issues were detected. Please try starting a new interview and providing more details about your case.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
