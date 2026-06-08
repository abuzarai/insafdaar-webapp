import { useState, useEffect } from "react";
import RightSideChatPanel from "./RightSideChatPanel";
import { MessageSquare } from "lucide-react";

export default function FloatingChatWidget() {
  const [open, setOpen] = useState(false);

  // Rotating popup messages (continuous)
  const messages = [
    "Need legal guidance?",
    "Chat with Insafdaar Assistant",
    "Get instant legal help",
  ];

  const [msgIndex, setMsgIndex] = useState(0);

  // Rotate text continuously
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % messages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* --- SLIDE-IN POPUP MESSAGE --- */}
      {!open && (
        <div
          className="
            fixed bottom-28 right-6 z-40
            bg-[#eef2ff] border border-[#ccd3ff]
            px-3 py-2 rounded-xl shadow-lg

            flex items-center gap-2
            animate-slide-in-right animate-pop-loop

            cursor-pointer
            hover:shadow-xl hover:scale-[1.02]
            transition
          "
          onClick={() => setOpen(true)}
        >
          {/* Icon */}
          <MessageSquare size={18} className="text-[#004aad]" />

          {/* Text */}
          <div className="text-[13px] text-[#002b5b] font-medium leading-tight">
            {messages[msgIndex]}
          </div>
        </div>
      )}

      {/* --- MAIN CHAT BUTTON --- */}
      <button
        onClick={() => setOpen(true)}
        className="
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full
          bg-[#004aad] text-white
          flex items-center justify-center
          shadow-2xl hover:scale-110 
          transition-all
        "
      >
        <MessageSquare size={26} />
      </button>

      {/* --- RIGHT SIDE PANEL --- */}
      <RightSideChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
