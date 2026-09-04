import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  Menu,
  Plus,
  Trash2,
  Pencil,
  PanelLeftOpen,
  PanelLeftClose,
  MessageSquare,
} from "lucide-react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import axios from "axios";
import { API_BASE_URL } from "../config";
import LegalAssistantChat, {
  ChatMessage,
} from "../components/LegalAssistantChat/LegalAssistantChat";
import { useActionDialogs } from "../components/common/ActionDialog";

const CHAT_OWNER_KEY = "legal_assistant_owner_id";
const ACTIVE_CONVERSATION_KEY = "legal_assistant_active_conversation_id";

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

function getChatHeaders(ownerId: string) {
  const token = localStorage.getItem("token");
  return {
    "x-chat-owner-id": ownerId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getUserProfile() {
  const raw = localStorage.getItem("user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const name = String(parsed?.name || "").trim();
    const email = String(parsed?.email || "").trim();
    const role = String(parsed?.role || "").trim();
    return {
      name,
      email,
      role,
      label: name || email || "Logged in user",
    };
  } catch (_err) {
    return null;
  }
}

function getInitials(label: string) {
  const parts = label
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

// Types for conversations stored in JSON via backend
type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ConversationFull = ConversationSummary & {
  messages: ChatMessage[];
};

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 **Welcome to Insafdaar Legal Assistant**.\nTell me your legal issue or choose a quick option below.",
};

export default function LegalAssistantPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [ownerId] = useState<string>(() => getOrCreateChatOwnerId());
  const [profile] = useState(() => getUserProfile());

  // The floating widget hands its in-flight chat over via navigation state so
  // expanding never loses the conversation. Only a real expand (PUSH)
  // carries the chat: browsers restore history state on reload/back, so
  // seeding on those would re-create a duplicate conversation.
  const seededMessages =
    navigationType === "PUSH"
      ? ((location.state as { messages?: ChatMessage[] } | null) ?? {}).messages
      : undefined;
  const initialMessages: ChatMessage[] =
    Array.isArray(seededMessages) && seededMessages.length > 0
      ? seededMessages
      : [WELCOME_MESSAGE];

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  // When opened with an in-flight chat from the floating widget, persist it
  // as a new conversation right away (instead of waiting for the next send).
  useEffect(() => {
    if (Array.isArray(initialMessages) && initialMessages.length >= 2) {
      void handleMessagesChange(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const { confirm, prompt, dialogs } = useActionDialogs();

  const activeConversationIdRef = useRef<string | null>(null);
  const creatingConversationRef = useRef<Promise<string> | null>(null);
  const latestMessagesRef = useRef<ChatMessage[]>([WELCOME_MESSAGE]);
  // Writes are chained so two quick turns can never land out of order
  // (last-write-wins in submission order, not completion order).
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Load list of conversations on mount
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        setLoadingConversations(true);
        const res = await axios.get<ConversationSummary[]>(
          `${API_BASE_URL}/api/legal-assistant/conversations`,
          {
            headers: getChatHeaders(ownerId),
          }
        );
        setConversations(res.data || []);
        const list = res.data || [];

        // Refresh should return to the conversation that was open, not the
        // welcome screen. The id is persisted locally on open/create.
        const activeId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
        if (activeId && list.some((c) => c.id === activeId)) {
          loadConversation(activeId);
        }
      } catch (err) {
        console.error("Failed to load conversations", err);
      } finally {
        setLoadingConversations(false);
      }
    };

    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const loadConversation = async (id: string) => {
    try {
      setLoadingConversation(true);
        const res = await axios.get<ConversationFull>(
          `${API_BASE_URL}/api/legal-assistant/conversations/${id}`,
          {
            headers: getChatHeaders(ownerId),
          }
        );
      const conv = res.data;
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, conv.id);
      setActiveConversationId(conv.id);
      setMessages(
        conv.messages && conv.messages.length > 0
          ? conv.messages
          : [WELCOME_MESSAGE]
      );
    } catch (err) {
      console.error("Failed to load conversation", err);
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleNewChat = () => {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setActiveConversationId(null);
    setMessages([WELCOME_MESSAGE]);
  };

  // Persist messages whenever chat updates
  const handleMessagesChange = async (updatedMessages: ChatMessage[]) => {
    setMessages(updatedMessages);
    latestMessagesRef.current = updatedMessages;

    try {
      // Ignore initial-only-welcome state
      if (
        updatedMessages.length <= 1 ||
        (updatedMessages.length === 1 && updatedMessages[0].id === "welcome")
      ) {
        return;
      }

      // Derive a simple title from the first user message
      const firstUser = updatedMessages.find((m) => m.role === "user");
      const title =
        firstUser?.content?.slice(0, 40).trim() || "New Conversation";

      let conversationId = activeConversationIdRef.current;

      if (!conversationId) {
        if (!creatingConversationRef.current) {
          creatingConversationRef.current = axios
            .post<ConversationFull>(
              `${API_BASE_URL}/api/legal-assistant/conversations`,
              {
                title,
                messages: updatedMessages,
              },
              {
                headers: getChatHeaders(ownerId),
              }
            )
            .then((res) => {
              const created = res.data;
              activeConversationIdRef.current = created.id;
              localStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
              setActiveConversationId(created.id);
              setConversations((prev) => {
                const next = [
                  {
                    id: created.id,
                    title: created.title,
                    createdAt: created.createdAt,
                    updatedAt: created.updatedAt,
                  },
                  ...prev.filter((c) => c.id !== created.id),
                ];
                return next;
              });
              return created.id;
            })
            .finally(() => {
              creatingConversationRef.current = null;
            });
        }

        conversationId = await creatingConversationRef.current;

        // Ignore stale updates queued before a newer message set arrived.
        if (latestMessagesRef.current !== updatedMessages) {
          return;
        }
      }

      // Queue the write: concurrent turns must land in submission order, not
      // completion order (a slow earlier PUT must not clobber a newer one).
      persistQueueRef.current = persistQueueRef.current
        .then(async () => {
          // Superseded by a newer message set before this write ran?
          if (latestMessagesRef.current !== updatedMessages) return;
          try {
            const res = await axios.put<ConversationFull>(
              `${API_BASE_URL}/api/legal-assistant/conversations/${conversationId}`,
              {
                messages: updatedMessages,
              },
              {
                headers: getChatHeaders(ownerId),
              }
            );
            const updated = res.data;
            setConversations((prev) =>
              prev
                .map((c) =>
                  c.id === updated.id
                    ? {
                        id: updated.id,
                        title: updated.title,
                        createdAt: updated.createdAt,
                        updatedAt: updated.updatedAt,
                      }
                    : c
                )
                .sort(
                  (a, b) =>
                    new Date(b.updatedAt).getTime() -
                    new Date(a.updatedAt).getTime()
                )
            );
          } catch (err) {
            console.error("Failed to persist conversation", err);
          }
        })
        .catch(() => {}); // keep the chain alive after individual failures
    } catch (err) {
      console.error("Failed to persist conversation", err);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    const ok = await confirm({
      title: "Delete Conversation",
      message: "Delete this conversation permanently? Its messages and context will be removed.",
      confirmText: "Delete",
      cancelText: "Cancel",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await axios.delete(`${API_BASE_URL}/api/legal-assistant/conversations/${id}`, {
        headers: getChatHeaders(ownerId),
      });

      setConversations((prev) => prev.filter((conv) => conv.id !== id));
      if (activeConversationId === id) {
        localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
        setActiveConversationId(null);
        setMessages([WELCOME_MESSAGE]);
      }
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  const handleRenameConversation = async (id: string, currentTitle: string) => {
    const newTitle = await prompt({
      title: "Rename Conversation",
      message: "Give this conversation a new title.",
      defaultValue: currentTitle,
      placeholder: "Conversation title",
      confirmText: "Rename",
      cancelText: "Cancel",
    });
    if (!newTitle?.trim()) return;

    try {
      const res = await axios.put<ConversationFull>(
        `${API_BASE_URL}/api/legal-assistant/conversations/${id}`,
        { title: newTitle.trim() },
        { headers: getChatHeaders(ownerId) }
      );
      const updated = res.data;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title: updated.title, updatedAt: updated.updatedAt } : c
        )
      );
    } catch (err) {
      console.error("Failed to rename conversation", err);
    }
  };

  const handleClearAllConversations = async () => {
    const ok = await confirm({
      title: "Clear All Conversations",
      message: "Clear all conversations permanently? This will remove your entire chat history and cannot be undone.",
      confirmText: "Clear All",
      cancelText: "Cancel",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await axios.delete(`${API_BASE_URL}/api/legal-assistant/conversations`, {
        headers: getChatHeaders(ownerId),
      });
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      setConversations([]);
      setActiveConversationId(null);
      setMessages([WELCOME_MESSAGE]);
    } catch (err) {
      console.error("Failed to clear conversations", err);
    }
  };

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

  return (
    <div className="w-screen h-screen flex flex-col bg-[#f3f6fa] overflow-hidden">

      {/* TOP HEADER */}
      <header className="bg-white shadow-md border-b px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 sticky top-0 z-30 w-full">
        <button
          onClick={() => navigate(-1)}
          className="hidden md:inline-flex p-2 rounded-md bg-[#004aad] text-white hover:bg-[#00367a] transition"
        >
          <ArrowLeft size={20} />
        </button>

        <button
          onClick={toggleSidebar}
          className="inline-flex md:hidden p-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-100 transition"
        >
          <Menu size={20} />
        </button>

        <h1 className="text-lg md:text-xl font-bold text-[#00142e] flex items-center gap-2">
          <MessageSquare className="text-[#004aad]" size={20} />
          Insafdaar Legal Assistant
        </h1>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs md:text-sm text-gray-600">
            <ShieldCheck className="text-[#004aad]" size={18} />
            Secure AI Helper
          </div>

          {profile ? (
            <div className="flex items-center gap-2 rounded-full border border-[#cdd8ea] bg-[#f6f9ff] px-2.5 py-1">
              <div className="h-7 w-7 rounded-full bg-[#004aad] text-white text-xs font-bold flex items-center justify-center">
                {getInitials(profile.label)}
              </div>
              <div className="hidden md:block leading-tight">
                <div className="text-[11px] font-semibold text-[#0f172a] max-w-[140px] truncate">
                  {profile.label}
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                  {profile.role || "account"}
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="rounded-full bg-[#004aad] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00367a] transition"
            >
              Login
            </button>
          )}
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex w-full overflow-hidden">

        {/* SIDEBAR (desktop) */}
        <aside
          className={`hidden md:flex flex-col bg-[#0f172a] text-gray-100 border-r border-slate-800 transition-all duration-200 ${
            sidebarOpen ? "w-72" : "w-16"
          }`}
        >
          <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
            {sidebarOpen && (
              <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                Conversations
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {sidebarOpen && (
                <>
                  <button
                    onClick={handleNewChat}
                    className="p-1.5 rounded-md bg-[#0ea5e9] text-white hover:bg-[#0284c7] transition shadow-sm"
                    title="New chat"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={handleClearAllConversations}
                    className="p-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
                    title="Clear all"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
                title={sidebarOpen ? "Collapse" : "Expand"}
              >
                {sidebarOpen ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <PanelLeftOpen size={16} />
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingConversations ? (
              <div className="px-3 py-4 text-xs text-slate-400">
                Loading conversations...
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-400">
                No previous chats yet.
              </div>
            ) : (
              <ul className="px-2 py-2 space-y-1">
                {conversations.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  const label = conv.title || "Untitled conversation";

                  return (
                    <li key={conv.id}>
                      <div className="group flex items-center gap-1">
                        <button
                          onClick={() => loadConversation(conv.id)}
                          className={`min-w-0 flex-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-left transition ${
                            isActive
                              ? "bg-slate-700 text-white"
                              : "hover:bg-slate-800 text-slate-200"
                          }`}
                        >
                          <div className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-300">
                            <MessageSquare size={14} />
                          </div>
                          {sidebarOpen && (
                            <div className="flex-1 min-w-0 flex flex-col">
                              <span className="truncate font-medium">
                                {label}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(conv.updatedAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </button>
                        {sidebarOpen && (
                          <button
                            onClick={() => handleRenameConversation(conv.id, conv.title)}
                            aria-label="Rename conversation"
                            className="p-2 rounded-md text-blue-300 hover:text-white hover:bg-slate-700 transition"
                            title="Rename conversation"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {sidebarOpen && (
                          <button
                            onClick={() => handleDeleteConversation(conv.id)}
                            className="p-2 rounded-md text-slate-400 hover:text-red-300 hover:bg-slate-800 transition"
                            title="Delete conversation"
                          >
                          <Trash2 size={13} />
                        </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* MOBILE SIDEBAR OVERLAY */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="w-72 max-w-[80%] bg-[#0f172a] text-gray-100 border-r border-slate-800 flex flex-col">
              <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
                <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                  Conversations
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={handleNewChat}
                    className="p-1.5 rounded-md bg-[#0ea5e9] text-white hover:bg-[#0284c7] transition shadow-sm"
                    title="New chat"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={handleClearAllConversations}
                    className="p-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
                    title="Clear all"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={toggleSidebar}
                    className="p-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
                    title="Close sidebar"
                  >
                    <PanelLeftClose size={16} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingConversations ? (
                  <div className="px-3 py-4 text-xs text-slate-400">
                    Loading conversations...
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-slate-400">
                    No previous chats yet.
                  </div>
                ) : (
                  <ul className="px-2 py-2 space-y-1">
                    {conversations.map((conv) => {
                      const isActive = conv.id === activeConversationId;
                      const label = conv.title || "Untitled conversation";

                      return (
                        <li key={conv.id}>
                          <div className="group flex items-center gap-1">
                            <button
                              onClick={() => {
                                loadConversation(conv.id);
                                setSidebarOpen(false);
                              }}
                              className={`min-w-0 flex-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-left transition ${
                                isActive
                                  ? "bg-slate-700 text-white"
                                  : "hover:bg-slate-800 text-slate-200"
                              }`}
                            >
                              <div className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-300">
                                <MessageSquare size={14} />
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col">
                                <span className="truncate font-medium">
                                  {label}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(conv.updatedAt).toLocaleString()}
                                </span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleRenameConversation(conv.id, conv.title)}
                              aria-label="Rename conversation"
                              className="p-2 rounded-md text-blue-300 hover:text-white hover:bg-slate-700 transition"
                              title="Rename conversation"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteConversation(conv.id)}
                              className="p-2 rounded-md text-slate-400 hover:text-red-300 hover:bg-slate-800 transition"
                              title="Delete conversation"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Clickable backdrop */}
            <div
              className="flex-1 bg-black/40"
              onClick={toggleSidebar}
            />
          </div>
        )}

        {/* CHAT PANEL */}
        <main className="flex-1 overflow-hidden relative">
          {loadingConversation && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/5 backdrop-blur-[1px]">
              <div className="px-4 py-2 rounded-lg bg-white shadow text-sm text-gray-700">
                Loading conversation...
              </div>
            </div>
          )}

          <LegalAssistantChat
            conversationId={activeConversationId}
            messages={messages}
            onMessagesChange={handleMessagesChange}
          />
        </main>
      </div>
      {dialogs}
    </div>
  );
}
