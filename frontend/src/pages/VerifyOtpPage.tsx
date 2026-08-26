import { useEffect, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("pending_email") || "";
    setEmail(saved);
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!email) {
      setMsg("Email not found. Please register again.");
      return;
    }
    if (!otp) {
      setMsg("Please enter OTP.");
      return;
    }

    try {
      setLoading(true);

      // backend endpoint should exist:
      // POST /api/auth/verify-otp  { email, otp }
      await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, { email, otp });

      localStorage.removeItem("pending_email");
      setMsg("Email verified! Redirecting to login...");

      setTimeout(() => navigate("/login"), 900);
    } catch (err: any) {
      setMsg(err?.response?.data?.error || "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-gradient-to-br from-[#060b18] via-[#0a1630] to-[#00244d] overflow-hidden">
      {/* Glow */}
      <motion.div
        className="absolute w-[900px] h-[900px] bg-[#004aad]/25 rounded-full blur-[200px] top-[-200px] left-[-150px]"
        animate={{ opacity: [0.2, 0.4, 0.2], scale: [1, 1.08, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-10"
      >
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">
            Verify <span className="text-[#f5b301]">OTP</span>
          </h1>
          <p className="text-gray-300 text-sm mt-2">
            Enter the code sent to your email.
          </p>
        </div>

        <form onSubmit={handleVerify} className="mt-8 space-y-5">
          <input
            value={email}
            readOnly
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 outline-none"
          />

          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="Enter OTP"
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#f5b301] outline-none transition"
          />

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-lg font-semibold text-[#00142e] transition-all shadow-md ${
              loading
                ? "bg-[#f5b301]/50 cursor-not-allowed"
                : "bg-[#f5b301] hover:bg-[#ffd84d]"
            }`}
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        {msg && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center text-sm text-gray-300 font-medium"
          >
            {msg}
          </motion.p>
        )}

        <div className="mt-6 text-center text-sm text-gray-400">
          <p>
            After verification, you’ll be sent to{" "}
            <span className="text-[#f5b301] font-semibold">Login</span>.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
