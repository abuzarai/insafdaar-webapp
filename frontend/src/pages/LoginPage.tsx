import { useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE_URL } from "../config";

export default function LoginPage() {
  // role is UI-only (backend decides actual role)
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const update = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!form.email || !form.password) {
      setMsg("Please fill in all fields.");
      return;
    }

    try {
      setLoading(true);

      // ✅ backend decides role (secure)
      const res = await axios.post(`${API_BASE_URL}/api/auth/login`, {
        email: form.email,
        password: form.password,
      });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));

      setMsg(`Welcome ${res.data.user?.name || ""}! Redirecting...`);

      setTimeout(() => {
        const roleRaw = res.data.user?.role || "CLIENT";
        const role = String(roleRaw).toUpperCase();

        // ✅ redirect by SERVER role
        if (role === "ADMIN") navigate("/admin");
        else if (role === "ADVOCATE") navigate("/advocate-dashboard");
        else navigate("/client-dashboard");
      }, 800);
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;

      if (
        serverMsg &&
        (serverMsg.toLowerCase().includes("verify") ||
          serverMsg.toLowerCase().includes("otp"))
      ) {
        setMsg("Email not verified. Redirecting to OTP...");
        setTimeout(() => {
          navigate(`/verify-otp?email=${encodeURIComponent(form.email)}`);
        }, 900);
        return;
      }

      setMsg(serverMsg ? `${serverMsg}` : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-gradient-to-br from-[#060b18] via-[#0a1630] to-[#00244d] overflow-hidden">
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
            Insafdaar<span className="text-[#f5b301]">.</span>
          </h1>
          <p className="text-gray-300 mt-2 text-sm tracking-wide">
            Secure access for Clients, Advocates & Admin
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <input
            type="email"
            name="email"
            placeholder="Email address"
            value={form.email}
            onChange={update}
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#f5b301] outline-none transition"
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            value={form.password}
            onChange={update}
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
            {loading ? "Signing in..." : "Login"}
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
            New here?{" "}
            <Link
              to="/register-client"
              className="text-[#f5b301] font-semibold hover:underline"
            >
              Register as Client
            </Link>{" "}
            or{" "}
            <Link
              to="/register-advocate"
              className="text-[#f5b301] font-semibold hover:underline"
            >
              Register as Advocate
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
