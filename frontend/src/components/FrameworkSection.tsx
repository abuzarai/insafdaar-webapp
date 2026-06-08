import React from "react";
import { motion } from "framer-motion";
import { Scale, BrainCircuit, Users, Banknote, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FrameworkSection() {
  const { t, i18n } = useTranslation();

  return (
    <section
      id="framework"
      dir={i18n.language === "ur" ? "rtl" : "ltr"}
      className={`relative py-28 text-[#00142e] overflow-hidden transition-all duration-500 ${
        i18n.language === "ur" ? "text-right bg-[#f9fbfe]" : "bg-white text-left"
      }`}
    >
      {/* Faint Urdu Text Layer */}
      {["انصاف", "وکالت", "قانون", "عدالت", "فیصلہ", "گواہی"].map((w, i) => (
        <motion.span
          key={i}
          className="absolute text-[2rem] md:text-[2.6rem] font-semibold select-none pointer-events-none"
          style={{
            top: `${15 + i * 12}%`,
            left: i % 2 === 0 ? "8%" : "82%",
            opacity: 0.06,
            color: "#004aad",
            transform: `rotate(${i % 2 === 0 ? -8 : 8}deg)`,
            filter: "blur(0.5px)",
          }}
          animate={{
            opacity: [0.04, 0.1, 0.05],
            y: [0, 8, 0],
          }}
          transition={{ duration: 10 + i, repeat: Infinity }}
        >
          {w}
        </motion.span>
      ))}

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
        <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
          <span className="text-[#004aad]">{t("frameworkTitle1")}</span>{" "}
          <span className="text-[#f5b301]">{t("frameworkTitle2")}</span>
        </h2>

        <p className="text-gray-600 max-w-2xl mx-auto mb-16 leading-relaxed">
          {t("frameworkDesc")}
        </p>

        {/* Horizontal Process Flow */}
        <div
          className={`flex flex-col md:flex-row justify-center items-start md:items-center gap-10 md:gap-20 mt-10 ${
            i18n.language === "ur" ? "md:flex-row-reverse" : ""
          }`}
        >
          {[
            {
              icon: <Mic size={38} className="text-[#004aad]" />,
              title: t("fwStep1Title"),
              desc: t("fwStep1Desc"),
            },
            {
              icon: <BrainCircuit size={38} className="text-[#004aad]" />,
              title: t("fwStep2Title"),
              desc: t("fwStep2Desc"),
            },
            {
              icon: <Users size={38} className="text-[#004aad]" />,
              title: t("fwStep3Title"),
              desc: t("fwStep3Desc"),
            },
            {
              icon: <Banknote size={38} className="text-[#004aad]" />,
              title: t("fwStep4Title"),
              desc: t("fwStep4Desc"),
            },
            {
              icon: <Scale size={38} className="text-[#004aad]" />,
              title: t("fwStep5Title"),
              desc: t("fwStep5Desc"),
            },
          ].map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: i * 0.15 }}
              viewport={{ once: true }}
              className="flex flex-col items-center max-w-[220px]"
            >
              <div className="mb-4">{s.icon}</div>
              <h4 className="text-lg font-semibold mb-1">{s.title}</h4>
              <p className="text-gray-600 text-sm leading-relaxed">{s.desc}</p>

              {/* Connector line for desktop */}
              {i < 4 && (
                <div className="hidden md:block w-24 h-[2px] bg-gradient-to-r from-[#f5b301]/50 to-[#004aad]/30 mt-6" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
