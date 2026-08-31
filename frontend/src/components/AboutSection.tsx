import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export default function AboutSection() {
  const { t, i18n } = useTranslation();

  return (
    <section
      className={`relative py-28 bg-[#f3f6fa] text-[#00142e] overflow-hidden transition-all duration-500 ${
        i18n.language === "ur" ? "text-right" : "text-left"
      }`}
      dir={i18n.language === "ur" ? "rtl" : "ltr"}
    >
      {/* Background Accent Glow */}
      <motion.div
        className="absolute top-0 left-1/2 w-[1000px] h-[1000px] rounded-full bg-[#004aad]/10 blur-[200px] -translate-x-1/2 -translate-y-1/2"
        animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.1, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      {/* Main Container */}
      <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
        <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
          <span className="text-[#004aad]">{t("aboutTitle1")}</span>{" "}
          <span className="text-[#f5b301]">{t("aboutTitle2")}</span>
        </h2>

        <p className="max-w-3xl mx-auto text-gray-600 text-lg leading-relaxed mb-16">
          {t("aboutDesc")}
        </p>

        {/* Company Highlights */}
        <div className="flex flex-col md:flex-row justify-center items-center gap-10 md:gap-20">
          {[
            { value: "310+", label: t("aboutStat1") },
            { value: "120+", label: t("aboutStat2") },
            { value: "2.1K+", label: t("aboutStat3") },
            { value: "98%", label: t("aboutStat4") },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <h3 className="text-3xl font-extrabold text-[#004aad]">{stat.value}</h3>
              <p className="text-gray-600 mt-2">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          className="mt-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <a
            href="/contact"
            className="inline-block px-8 py-3 rounded-md bg-[#004aad] text-white font-semibold hover:bg-[#003b82] transition"
          >
            {t("contactButton")}
          </a>
        </motion.div>
      </div>
    </section>
  );
}
