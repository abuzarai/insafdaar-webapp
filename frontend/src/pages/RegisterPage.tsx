import { useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { API_BASE_URL } from "../config";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setMessage("Please fill out all fields.");
      return;
    }
    try {
      setLoading(true);
      const res = await axios.post(`${API_BASE_URL}/api/register`, form);
      console.log(res.data);
      setMessage("Registration successful! Please log in.");
    } catch {
      setMessage("Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-gradient-to-br from-[#060b18] via-[#0a1630] to-[#00244d] overflow-hidden">
      {/* Background Glows */}
      <motion.div
        className="absolute w-[900px] h-[900px] bg-[#004aad]/25 rounded-full blur-[200px] top-[-200px] left-[-150px]"
        animate={{ opacity: [0.2, 0.4, 0.2], scale: [1, 1.08, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />
      <motion.div
        className="absolute w-[700px] h-[700px] bg-[#f5b301]/15 rounded-full blur-[180px] bottom-[-150px] right-[-100px]"
        animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.05, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      {/* Urdu Background Layer */}
      {["انصاف", "وکالت", "قانون", "عدالت", "حق", "گواہی", "شہادت"].map(
        (w, i) => (
          <motion.span
            key={i}
            className="absolute text-[1.8rem] md:text-[2.2rem] font-semibold text-[#f5b301]/10 select-none pointer-events-none"
            style={{
              top: `${12 + i * 10}%`,
              left: `${(i * 15) % 80 + 10}%`,
              transform: `rotate(${i % 2 === 0 ? -8 : 8}deg)`,
            }}
            animate={{
              opacity: [0.05, 0.1, 0.05],
              y: [0, 10, 0],
            }}
            transition={{ duration: 8 + i, repeat: Infinity }}
          >
            {w}
          </motion.span>
        )
      )}

      {/* Register Form */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-10"
      >
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">
            Join <span className="text-[#f5b301]">Insafdaar</span>
          </h1>
          <p className="text-gray-300 text-sm mt-2">
            Empower your legal journey with AI-driven support.
          </p>
        </div>

        <form onSubmit={handleRegister} className="mt-8 space-y-5">
          {/* Name */}
          <input
            name="name"
            placeholder="Full Name"
            value={form.name}
            onChange={handleChange}
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#f5b301] outline-none transition"
          />

          {/* Email */}
          <input
            name="email"
            type="email"
            placeholder="Email Address"
            value={form.email}
            onChange={handleChange}
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#f5b301] outline-none transition"
          />

          {/* Password */}
          <input
            name="password"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#f5b301] outline-none transition"
          />

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-lg font-semibold text-[#00142e] transition-all shadow-md ${
              loading
                ? "bg-[#f5b301]/50 cursor-not-allowed"
                : "bg-[#f5b301] hover:bg-[#ffd84d]"
            }`}
          >
            {loading ? "Creating account..." : "Register"}
          </button>
        </form>

        {/* Message */}
        {message && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center text-sm text-gray-300 font-medium"
          >
            {message}
          </motion.p>
        )}

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm text-gray-400">
          <p>
            Already registered?{" "}
            <a
              href="/login"
              className="text-[#f5b301] font-semibold hover:underline"
            >
              Login here
            </a>
          </p>
        </div>
      </motion.div>

      {/* Footer Branding */}
      <div className="absolute bottom-5 text-center w-full text-gray-500 text-xs">
        © {new Date().getFullYear()}{" "}
        <span className="text-[#f5b301] font-semibold">Insafdaar</span> — AI-Powered Legal Access
      </div>
    </div>
  );
}
