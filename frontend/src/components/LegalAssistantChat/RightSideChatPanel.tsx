import React, { useEffect, useState } from "react";
import { X, Maximize2, MessageSquare } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import LegalAssistantChat, {
  ChatMessage,
} from "./LegalAssistantChat";

export default function RightSideChatPanel({ open, onClose }: any) {
  const navigate = useNavigate();
  const location = useLocation();

  const userRaw = localStorage.getItem("user");
  let user: any = null;
  try {
    user = userRaw ? JSON.parse(userRaw) : null;
  } catch (_err) {
    user = null;
  }
  const profileLabel = (user?.name || user?.email || "Guest").trim();
  const initials = profileLabel
    .split(" ")
    .map((part: string) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase() || "")
    .join("") || "G";

  // Floating chat has its own temporary messages
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "👋 **Welcome to Insafdaar Legal Assistant**.\n\nHow can I assist you today?",
    },
  ]);

  const handleMessagesChange = (updated: ChatMessage[]) => {
    setMessages(updated);
  };

  // Auto-close if user opens full screen chat
  useEffect(() => {
    if (location.pathname === "/legal-assistant") {
      onClose();
    }
  }, [location.pathname]);

  return (
    <div
      className={`
        fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50
        transition-all duration-300
        ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
      `}
    >
      <div
        className="
          bg-white
          w-[92vw] max-w-[380px]
          h-[75vh] max-h-[560px]
          rounded-2xl shadow-2xl border border-gray-200
          overflow-hidden backdrop-blur-xl
          flex flex-col
        "
      >
        {/* HEADER */}
        <div className="bg-[#004aad] flex items-center justify-between px-4 h-14">
          
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <MessageSquare size={20} className="text-[#f5b301]" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm tracking-wide leading-tight">
                Insafdaar Legal Assistant
              </h2>
              <div className="text-[10px] text-blue-100/90">{user ? `Logged in: ${profileLabel}` : "Guest mode"}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 text-white text-[11px] font-bold flex items-center justify-center">
              {initials}
            </div>
            {/* Full screen */}
            <button aria-label="Fullscreen"
              onClick={() => navigate("/legal-assistant", { state: { messages } })}
              className="p-2 rounded-md hover:bg-white/20 transition"
            >
              <Maximize2 size={18} className="text-white" />
            </button>

            {/* Close */}
            <button aria-label="Close chat"
              onClick={onClose}
              className="p-2 rounded-md hover:bg-white/20 transition"
            >
              <X size={20} className="text-white" />
            </button>
          </div>
        </div>

        {/* INNER CHAT WRAPPER */}
        <div className="flex-1 bg-[#eef1f6] p-2 overflow-hidden rounded-b-2xl">
          <div className="w-full h-full bg-white rounded-2xl shadow-inner overflow-hidden">
            <LegalAssistantChat
              conversationId={null}
              messages={messages}
              onMessagesChange={handleMessagesChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
