import React from "react";
import { motion } from "framer-motion";
import { Brain, Globe2, Network, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FutureSection() {
  const { t, i18n } = useTranslation();

  return (
    <section
      id="future"
      dir={i18n.language === "ur" ? "rtl" : "ltr"}
      className={`relative py-28 text-[#00142e] overflow-hidden transition-all duration-500 ${
        i18n.language === "ur" ? "bg-[#f9fbfe] text-right" : "bg-[#ffffff] text-left"
      }`}
    >
      {/* Background Glow */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[900px] h-[900px] bg-[#004aad]/5 blur-[220px] -translate-x-1/2 -translate-y-1/2"
        animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.05, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
        {/* Section Header */}
        <h2 className="text-4xl md:text-5xl font-extrabold mb-8">
          <span className="text-[#004aad]">{t("futureTitle1")}</span>{" "}
          {t("futureOf")}{" "}
          <span className="text-[#f5b301]">{t("futureTitle2")}</span>
        </h2>

        <p className="max-w-3xl mx-auto text-gray-600 text-lg leading-relaxed mb-16">
          {t("futureDesc")}
        </p>

        {/* Key Themes Grid */}
        <div className="grid md:grid-cols-4 gap-10">
          {[
            {
              icon: <Brain size={40} className="text-[#004aad]" />,
              title: t("f1Title"),
              desc: t("f1Desc"),
            },
            {
              icon: <Network size={40} className="text-[#004aad]" />,
              title: t("f2Title"),
              desc: t("f2Desc"),
            },
            {
              icon: <Globe2 size={40} className="text-[#004aad]" />,
              title: t("f3Title"),
              desc: t("f3Desc"),
            },
            {
              icon: <Sparkles size={40} className="text-[#004aad]" />,
              title: t("f4Title"),
              desc: t("f4Desc"),
            },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: i * 0.15 }}
              viewport={{ once: true }}
              className="p-6 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-lg transition-all"
            >
              <div className="flex justify-center mb-4">{item.icon}</div>
              <h4 className="text-lg font-semibold mb-2">{item.title}</h4>
              <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
