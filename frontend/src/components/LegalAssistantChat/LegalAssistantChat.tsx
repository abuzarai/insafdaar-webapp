import React, { useRef, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Send, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { safeExternalHref } from "../../utils/url";
import { API_BASE_URL } from "../../config";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "social" | "uncertain" | "legal";
  citations?: string[];
  sources?: Array<{ title: string; link?: string | null }>;
};

type LegalAssistantChatProps = {
  conversationId: string | null;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
};

const quickOptions = [
  "FIR / Police Complaint",
  "Marriage / Divorce Advice",
  "Property / Land Dispute",
  "Contract Review",
  "Court Case Status",
  "Legal Notice Drafting",
];

const CHAT_OWNER_KEY = "legal_assistant_owner_id";
const GUEST_PROMPT_LIMIT = 3;

function getOrCreateChatOwnerId() {
  const existing = localStorage.getItem(CHAT_OWNER_KEY);
  if (existing && existing.trim()) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `owner-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  localStorage.setItem(CHAT_OWNER_KEY, generated);
  return generated;
}

function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("insafdaar_token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("accessToken") ||
    ""
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function renderInlineMarkup(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(
      <strong key={`bold-${match.index}`} className="font-semibold text-slate-900">
        {match[1]}
      </strong>
    );
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts;
}

function renderAssistantContent(content: string) {
  const blocks = content
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, blockIdx) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
    const numberedLines = lines.filter((line) => /^\d+\.\s+/.test(line));

    if (lines.length > 0 && bulletLines.length === lines.length) {
      return (
        <ul key={`ul-${blockIdx}`} className="list-disc pl-5 space-y-1 text-slate-700 marker:text-slate-400">
          {bulletLines.map((line, idx) => (
            <li key={`li-${blockIdx}-${idx}`}>{renderInlineMarkup(line.replace(/^[-*]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }

    if (lines.length > 0 && numberedLines.length === lines.length) {
      return (
        <ol key={`ol-${blockIdx}`} className="list-decimal pl-5 space-y-1 text-slate-700 marker:text-slate-400">
          {numberedLines.map((line, idx) => (
            <li key={`oli-${blockIdx}-${idx}`}>{renderInlineMarkup(line.replace(/^\d+\.\s+/, ""))}</li>
          ))}
        </ol>
      );
    }

    const headingMatch = block.match(/^([A-Za-z][A-Za-z\s]{2,40}):\s*(.*)$/);
    if (headingMatch) {
      return (
        <p key={`p-${blockIdx}`} className="leading-relaxed text-slate-700 whitespace-pre-wrap">
          {renderInlineMarkup(headingMatch[2] || headingMatch[1])}
        </p>
      );
    }

    return (
      <p key={`p-${blockIdx}`} className="leading-relaxed text-slate-700 whitespace-pre-wrap">
        {renderInlineMarkup(block)}
      </p>
    );
  });
}

function getDisplayContent(content: string) {
  let cleaned = content
    .replace(/^\s*[-_]{3,}\s*$/gm, "")
    .replace(/^\s*\*\*?\s*(Summary|Detailed Analysis|Analysis|Answer)\s*:?\s*\*\*?\s*/gim, "")
    .replace(/^\s*(Summary|Detailed Analysis|Analysis|Answer)\s*:\s*/gim, "");

  cleaned = cleaned.replace(
    /^\s*\*\*?\s*Citations\s*:?\s*\*\*?\s*[\s\S]*?(?=^\s*\*\*?\s*Sources\s*:?\s*\*\*?\s*|^\s*Sources\s*:\s*|\s*$)/gim,
    ""
  );

  cleaned = cleaned
    .replace(/^\s*Citations\s*:\s*[\s\S]*?(?=^\s*Sources\s*:\s*|\s*$)/gim, "")
    // strip bare trailing source-reference lines ("Order-VII-Plaints.pdf p.35")
    // that the model sometimes adds even without a Citations: header,
    // since the Sources box below already shows them
    .replace(/^(?:[-*]\s*)?[\w-]+\.pdf\s+p?\.?\s*\d+(?:\s*,\s*\d+)*\s*$/gim, "")
    .replace(/^\s*[-*]\s*Source\s*\d+\s*$/gim, "")
    .replace(/^\s*\*\*?\s*Sources\s*:?\s*\*\*?\s*$/gim, "")
    .replace(/^\s*Sources\s*:\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

export default function LegalAssistantChat({
  conversationId,
  messages,
  onMessagesChange,
}: LegalAssistantChatProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // ✅ hide quick options instantly after first action (prevents corner bug)
  const [hideQuickOptions, setHideQuickOptions] = useState(false);

  // ✅ NEW: show a small "sending..." bubble for a moment (no blank feeling)
  const [sending, setSending] = useState(false);
  const [ownerId] = useState<string>(() => getOrCreateChatOwnerId());

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, sending]);

  const token = getAuthToken();
  const isLoggedIn = Boolean(token);
  const guestUserMessageCount = useMemo(
    () => messages.filter((msg) => msg.role === "user").length,
    [messages]
  );
  const guestLimitReached = !isLoggedIn && guestUserMessageCount >= GUEST_PROMPT_LIMIT;

  const hasUserMessage = useMemo(
    () => messages.some((m) => m.role === "user" && m.content.trim().length > 0),
    [messages]
  );

  const showQuickOptions = !hideQuickOptions && !hasUserMessage && !loading;

  useEffect(() => {
    if (!hasUserMessage) setHideQuickOptions(false);
  }, [hasUserMessage]);

  const handleSend = async (override?: string) => {
    const finalText = (override ?? input).trim();
    if (!finalText || loading) return;

    if (guestLimitReached) {
      const limitMsg: ChatMessage = {
        id: `guest-limit-${Date.now()}`,
        role: "assistant",
        content:
          "You have reached the free guest limit. Please login to continue unlimited legal assistant chat.",
      };
      onMessagesChange([...messages, limitMsg]);
      return;
    }

    setHideQuickOptions(true);
    setInput("");

    // show "Sending…" bubble briefly (echo of the user message), then
    // "Thinking…" takes over via loading. The two must never overlap.
    setSending(true);
    window.setTimeout(() => setSending(false), 700);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: finalText,
    };

    const updatedAfterUser = [...messages, userMsg];
    onMessagesChange(updatedAfterUser);

    setLoading(true);

    try {
      // Bounded retry: network errors and server blips (non-504 5xx) get one
      // retry; 504/timeouts never retry (the backend already ran the RAG
      // query — retrying would double Gemini spend).
      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await axios.post(
            `${API_BASE_URL}/api/legal-assistant/query`,
            {
              query: finalText,
              history: updatedAfterUser,
              conversationId,
            },
            {
              headers: {
                "x-chat-owner-id": ownerId,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            }
          );
          break;
        } catch (err: any) {
          const status = err?.response?.status;
          const retryable = !err?.response || (status >= 500 && status !== 504);
          if (!retryable || attempt >= 1) throw err;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      const botReply: string =
        response.data?.answer ?? "I couldn't understand the server response.";

      const botMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: botReply,
        mode:
          response.data?.mode === "social"
            ? "social"
            : response.data?.mode === "uncertain"
              ? "uncertain"
              : "legal",
        citations: Array.isArray(response.data?.citations) ? response.data.citations : [],
        sources: Array.isArray(response.data?.sources) ? response.data.sources : [],
      };

      onMessagesChange([...updatedAfterUser, botMsg]);
    } catch (e: any) {
      if (e?.response?.data?.code === "GUEST_LIMIT_REACHED") {
        const limitMsg: ChatMessage = {
          id: `guest-limit-${Date.now()}`,
          role: "assistant",
          content: "Guest limit reached. Please login to continue with full access.",
        };
        onMessagesChange([...updatedAfterUser, limitMsg]);
        return;
      }

      const serverMessage =
        e?.response?.data?.error ||
        e?.response?.data?.detail ||
        e?.message ||
        "Unable to reach server. Please try again.";

      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `${serverMessage}`,
      };
      onMessagesChange([...updatedAfterUser, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = (text: string) => {
    setHideQuickOptions(true);
    handleSend(text);
  };

  const canSend = input.trim().length > 0 && !loading && !guestLimitReached;

  // Hide the intro "Welcome" bubble once the assistant has actually replied.
  // It stays visible while the thread holds just the greeting or a pending
  // user message; loaded histories use their own ids and are unaffected.
  const hasAssistantReply = messages.some(
    (m) => m.id !== "welcome" && m.role === "assistant"
  );
  const visibleMessages = hasAssistantReply
    ? messages.filter((m) => m.id !== "welcome")
    : messages;

  const inputHint = useMemo(() => {
    return input.trim().length < 4
      ? "Enter to send • Shift+Enter for new line"
      : "";
  }, [input]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-50 to-slate-100 overflow-hidden">
      {/* small CSS for animations (Tailwind-safe) */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px) scale(.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .anim-fadeUp { animation: fadeUp .25s ease-out both; }
        .anim-fadeIn { animation: fadeIn .2s ease-out both; }
      `}</style>

      {/* CHAT SURFACE */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* QUICK OPTIONS */}
          {showQuickOptions && (
            <div className="anim-fadeUp rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700 text-sm font-semibold">
                <Sparkles size={16} className="text-amber-500" />
                Quick actions
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Pick one to get started, or type your own question.
              </p>

              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {quickOptions.map((q) => (
                  <button
                    key={q}
                    onMouseDown={() => setHideQuickOptions(true)}
                    onClick={() => handleQuickSelect(q)}
                    className={cn(
                      "group text-left",
                      "rounded-xl border border-slate-200/80 bg-white",
                      "px-3 py-2.5",
                      "text-[12.5px] font-medium text-slate-700",
                      "shadow-sm hover:shadow-md",
                      "hover:border-slate-300",
                      "transition-all",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    )}
                  >
                    <span className="block leading-snug">{q}</span>
                    <span className="mt-1 block text-[11px] text-slate-400 group-hover:text-slate-500">
                      Tap to ask
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {guestLimitReached && (
            <div className="anim-fadeIn rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="text-sm font-semibold text-amber-800">Guest limit reached</div>
              <p className="mt-1 text-xs text-amber-700">
                You used your free prompts. Login to continue unlimited legal guidance.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-3 inline-flex rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600"
              >
                Login to continue
              </button>
            </div>
          )}

          {/* THREAD */}
          {visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "anim-fadeUp flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="flex gap-3 max-w-[92%] sm:max-w-[80%]">
                  <div
                    className={cn(
                      "flex-shrink-0",
                      "w-9 h-9",
                      "rounded-2xl",
                      "bg-gradient-to-br from-[#064bb0] to-[#043d8f]",
                      "ring-1 ring-white/40",
                      "shadow-sm",
                      "flex items-center justify-center"
                    )}
                    aria-hidden
                  >
                    <MessageSquare size={16} className="text-white" />
                  </div>

                  <div
                    className={cn(
                      "relative",
                      "rounded-2xl rounded-tl-md",
                      "bg-white",
                      "border border-slate-200/70",
                      "shadow-sm",
                      "px-4 py-3.5",
                      "text-slate-800",
                      "text-[14px] sm:text-[15px]"
                    )}
                  >
                    {(() => {
                      const displayContent = getDisplayContent(msg.content);

                      return (
                        <>
                          <div className="space-y-2">{renderAssistantContent(displayContent)}</div>

                          {!!msg.sources?.length && (
                       <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Sources</div>
                        <ul className="mt-2 space-y-1.5 text-[12px] text-blue-700">
                          {msg.sources.map((source, idx) => (
                            <li key={`${msg.id}-source-${idx}`} className="leading-snug">
                              {source.link ? (
                                <a
                                  href={safeExternalHref(source.link)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium hover:underline"
                                >
                                  {source.title}
                                </a>
                              ) : (
                                source.title
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                          )}

                          <div className="mt-2 text-[11px] text-slate-400">Insafdaar Assistant</div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {msg.role === "user" && (
                <div
                  className={cn(
                    "max-w-[92%] sm:max-w-[78%]",
                    "rounded-2xl rounded-tr-md",
                    "bg-gradient-to-br from-[#064bb0] to-[#043d8f]",
                    "text-white",
                    "px-4 py-3",
                    "shadow-[0_10px_25px_-18px_rgba(2,6,23,0.55)]",
                    "whitespace-pre-wrap leading-relaxed",
                    "text-[14px] sm:text-[15px]"
                  )}
                >
                  {msg.content}
                  <div className="mt-2 text-[11px] text-white/70 text-right">
                    You
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* SENDING INDICATOR (so no blank feeling) */}
          {sending && (
            <div className="anim-fadeIn flex justify-end">
              <div
                className={cn(
                  "max-w-[80%]",
                  "rounded-2xl rounded-tr-md",
                  "bg-slate-200 text-slate-700",
                  "px-4 py-3",
                  "text-[13px]",
                  "shadow-sm border border-slate-300/60"
                )}
              >
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Sending…</span>
                </div>
              </div>
            </div>
          )}

          {/* ASSISTANT THINKING */}
          {loading && (
            <div className="anim-fadeIn flex items-start gap-3 max-w-[92%] sm:max-w-[80%]">
              <div
                className={cn(
                  "w-9 h-9 rounded-2xl",
                  "bg-gradient-to-br from-[#064bb0] to-[#043d8f]",
                  "ring-1 ring-white/40 shadow-sm",
                  "flex items-center justify-center"
                )}
                aria-hidden
              >
                <MessageSquare size={16} className="text-white" />
              </div>

              <div
                className={cn(
                  "rounded-2xl rounded-tl-md",
                  "bg-white border border-slate-200/70 shadow-sm",
                  "px-4 py-3"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <div className="mt-2 text-[11px] text-slate-400">Thinking…</div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* INPUT BAR */}
      <div className="border-t border-slate-200/70 bg-white/85 backdrop-blur px-4 sm:px-6 py-4 shadow-[0_-18px_50px_-40px_rgba(15,23,42,0.55)]">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm p-2 flex items-end gap-2">
            <div className="flex-1">
              <textarea
                rows={2}
                className={cn(
                  "w-full resize-none rounded-xl",
                  "px-3 py-2.5",
                  "text-[14px] sm:text-[15px]",
                  "text-slate-800 placeholder:text-slate-400",
                  "focus:outline-none",
                  "bg-transparent"
                )}
                placeholder="Type your legal question…"
                value={input}
                disabled={guestLimitReached}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              {inputHint && (
                <div className="px-3 pb-1 text-[11px] text-slate-400">
                  {inputHint}
                </div>
              )}
            </div>

            <button
              onClick={() => handleSend()}
              disabled={!canSend}
              className={cn(
                "h-11 px-4 sm:px-5",
                "rounded-xl font-semibold text-sm",
                "inline-flex items-center gap-2",
                "transition-all",
                canSend
                  ? "bg-gradient-to-br from-[#064bb0] to-[#043d8f] hover:brightness-110 shadow-md"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              )}
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
              <span>Send</span>
            </button>
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            For informational purposes only — verify with a qualified lawyer for
            final decisions.
          </div>
        </div>
      </div>
    </div>
  );
}
