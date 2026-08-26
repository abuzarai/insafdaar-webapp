import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Mic, UserCheck, ClipboardList, FileCheck, Scale } from "lucide-react";
import { isLoggedIn } from "../utils/auth";
import { useTranslation } from "react-i18next";

export default function Hero() {
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { t } = useTranslation();

  const goVoice = () =>
    !isLoggedIn() ? nav("/login?next=/voice") : nav("/voice");

  // 🟢 Multilingual Stages
  const stages = [
    {
      title: t("intakeTitle"),
      desc: t("intakeDesc"),
      icon: <Mic size={40} />,
      color: "#f5b301",
    },
    {
      title: t("reviewTitle"),
      desc: t("reviewDesc"),
      icon: <ClipboardList size={40} />,
      color: "#00d4ff",
    },
    {
      title: t("findAdvocateTitle"),
      desc: t("findAdvocateDesc"),
      icon: <UserCheck size={40} />,
      color: "#4ade80",
    },
    {
      title: t("recordsTitle"),
      desc: t("recordsDesc"),
      icon: <FileCheck size={40} />,
      color: "#facc15",
    },
    {
      title: t("progressTitle"),
      desc: t("progressDesc"),
      icon: <Scale size={40} />,
      color: "#60a5fa",
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => setActive((a) => (a + 1) % stages.length), 6000);
    return () => clearInterval(timer);
  }, [stages.length]);

  const urduWords = [
    { word: "انصاف", x: "10%", y: "20%", rotate: -12 },
    { word: "وکالت", x: "80%", y: "22%", rotate: 10 },
    { word: "قانون", x: "6%", y: "70%", rotate: -8 },
    { word: "عدالت", x: "83%", y: "68%", rotate: 8 },
    { word: "فیصلہ", x: "15%", y: "48%", rotate: -10 },
    { word: "گواہی", x: "86%", y: "43%", rotate: 10 },
    { word: "شہادت", x: "65%", y: "78%", rotate: 5 },
    { word: "حقوق", x: "33%", y: "12%", rotate: -6 },
  ];

  return (
    <section className="relative flex flex-col justify-center items-center min-h-screen overflow-hidden bg-gradient-to-br from-[#060b18] via-[#0a1428] to-[#00142e] text-white">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "70px 70px",
        }}
      />

      {/* Glow core */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[850px] h-[850px] rounded-full blur-[200px] bg-[#004aad]/25 -translate-x-1/2 -translate-y-1/2"
        animate={{ scale: [1, 1.05, 1], opacity: [0.25, 0.5, 0.25] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      {/* Urdu floating words */}
      {urduWords.map((u, i) => (
        <motion.span
          key={i}
          className="absolute text-[2.3rem] md:text-[2.7rem] font-semibold select-none pointer-events-none"
          style={{
            top: u.y,
            left: u.x,
            color: "#f5b301",
            opacity: 0.06,
            transform: `rotate(${u.rotate}deg)`,
            textShadow: "0 0 25px rgba(245,179,1,0.15)",
            filter: "blur(0.5px)",
            whiteSpace: "nowrap",
          }}
          animate={{
            opacity: [0.05, 0.12, 0.07],
            y: [0, 10, 0],
            x: [0, i % 2 === 0 ? 4 : -4, 0],
          }}
          transition={{ duration: 10 + i * 0.5, repeat: Infinity, ease: "easeInOut" }}
        >
          {u.word}
        </motion.span>
      ))}

      {/* Hero Text */}
      <div className="relative z-10 text-center px-6">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight">
          <span className="text-[#f5b301]">{t("appName")}</span>
        </h1>
        <p className="mt-4 text-xl md:text-2xl font-medium text-white/90 tracking-wide">
          {t("tagline")}
        </p>
        <p className="mt-6 text-gray-300 text-lg leading-relaxed max-w-2xl mx-auto">
          {t("heroDesc")}
        </p>
      </div>

      {/* Stage cycle */}
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 mt-24 text-center max-w-2xl px-8"
        >
          <motion.div
            className="mx-auto w-20 h-20 flex items-center justify-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm"
            style={{
              color: stages[active].color,
              boxShadow: `0 0 40px ${stages[active].color}60`,
            }}
            animate={{ scale: [1, 1.05, 1], rotate: [0, 2, -2, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            {stages[active].icon}
          </motion.div>

          <h3
            className="text-2xl font-semibold mt-8 tracking-tight"
            style={{ color: stages[active].color }}
          >
            {stages[active].title}
          </h3>
          <p className="text-gray-300 text-base mt-3 leading-relaxed">
            {stages[active].desc}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Buttons */}
      <div className="relative z-10 mt-14 flex gap-5 flex-wrap justify-center">
        <button
          onClick={goVoice}
          className="px-8 py-3 rounded-md bg-[#f5b301] text-[#001a3a] font-semibold hover:bg-[#ffd84d] transition shadow-md"
        >
          🎙 {t("startWithVoice")}
        </button>
        <a
          href="#framework"
          className="px-8 py-3 rounded-md border border-white/20 text-gray-200 bg-white/10 hover:bg-white/20 transition"
        >
          {t("exploreFramework")}
        </a>
      </div>
    </section>
  );
}
