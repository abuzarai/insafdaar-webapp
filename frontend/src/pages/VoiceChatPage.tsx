import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isLoggedIn } from "../utils/auth";

export default function VoiceChatPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!isLoggedIn()) {
      nav("/login?next=/voice");
      return;
    }
    setReady(true);
  }, [nav]);

  const startRec = async () => {
    setTranscript("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = async () => {
      setTranscript("🎤 Audio captured (demo) — backend STT integration pending.");
    };
    mr.start();
    mediaRef.current = mr;
    setRecording(true);
  };

  const stopRec = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#003366] to-[#004aad] px-4">
      <div className="bg-white/95 backdrop-blur-xl p-8 rounded-2xl shadow-xl w-full max-w-2xl">
        <h2 className="text-3xl font-bold text-[#004aad] mb-2">
          Urdu Voice Chat Prototype
        </h2>
        <p className="text-gray-600 mb-6">
          Speak naturally in Urdu and our AI will soon handle transcription and case filing.
        </p>

        <div className="flex gap-4 mb-6">
          {!recording ? (
            <button
              onClick={startRec}
              className="px-6 py-3 bg-[#004aad] text-white rounded-lg font-semibold shadow hover:bg-[#005de0] transition"
            >
              🎙Start Recording
            </button>
          ) : (
            <button
              onClick={stopRec}
              className="px-6 py-3 bg-[#f5b301] text-[#002b5b] rounded-lg font-semibold shadow hover:bg-[#ffd84d] transition"
            >
              ⏹ Stop & Save
            </button>
          )}
          <button
            onClick={() => nav("/")}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-100 transition"
          >
            Back to Home
          </button>
        </div>

        <textarea
          className="w-full h-40 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-[#004aad]"
          value={transcript}
          placeholder="Your Urdu transcript will appear here after backend integration..."
          readOnly
        />

        <p className="text-gray-500 text-sm mt-4">
          • Audio will be processed by Whisper → NLP extraction → case filing pipeline.
        </p>
      </div>
    </div>
  );
}
