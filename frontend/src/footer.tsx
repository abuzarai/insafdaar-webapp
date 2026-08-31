import { Link } from "react-router-dom";
import { Mail, MapPin, Twitter, Linkedin, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Footer() {
  const { t, i18n } = useTranslation();

  return (
    <footer
      className={`bg-[#00142e] text-gray-300 text-sm mt-auto relative overflow-hidden transition-all duration-500 ${
        i18n.language === "ur" ? "text-right" : "text-left"
      }`}
      dir={i18n.language === "ur" ? "rtl" : "ltr"}
    >
      {/* Top Accent Line */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#004aad] via-[#f5b301] to-[#004aad]" />

      {/* Soft Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#001b3d] via-transparent to-transparent opacity-60" />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 py-16 grid sm:grid-cols-2 md:grid-cols-4 gap-10">
        {/* Brand */}
        <div>
          <h4 className="text-white font-extrabold text-xl mb-3 tracking-wide">
            {t("footerBrand")}
            <span className="text-[#f5b301]">.</span>
          </h4>
          <p className="text-gray-400 text-sm leading-relaxed">
            {t("footerDesc")}
          </p>
        </div>

        {/* Navigation */}
        <div>
          <h4 className="text-white font-semibold text-lg mb-4">
            {t("footerExplore")}
          </h4>
          <ul className="space-y-2 text-gray-400">
            <li>
              <Link to="/" className="hover:text-[#f5b301] transition">
                {t("home")}
              </Link>
            </li>
            <li>
              <Link to="/voice" className="hover:text-[#f5b301] transition">
                {t("voiceAssistant")}
              </Link>
            </li>
            <li>
              <Link to="/login" className="hover:text-[#f5b301] transition">
                {t("login")}
              </Link>
            </li>
            <li>
              <Link
                to="/register-client"
                className="hover:text-[#f5b301] transition"
              >
                {t("registerAsClient")}
              </Link>
            </li>
            <li>
              <Link
                to="/register-advocate"
                className="hover:text-[#f5b301] transition"
              >
                {t("registerAsAdvocate")}
              </Link>
            </li>
          </ul>
        </div>

        {/* Company */}
        <div>
          <h4 className="text-white font-semibold text-lg mb-4">
            {t("footerCompany")}
          </h4>
          <ul className="space-y-2 text-gray-400">
            <li>
              <Link to="/about" className="hover:text-[#f5b301] transition">
                {t("footerAbout")}
              </Link>
            </li>
            <li>
              <Link to="/future" className="hover:text-[#f5b301] transition">
                {t("footerFuture")}
              </Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-[#f5b301] transition">
                {t("footerContact")}
              </Link>
            </li>
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h4 className="text-white font-semibold text-lg mb-4">
            {t("footerContact")}
          </h4>
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <Mail size={16} className="text-[#f5b301]" />
            <span>{t("footerEmail")}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <MapPin size={16} className="text-[#f5b301]" />
            <span>{t("footerLocation")}</span>
          </div>
          <div className="flex gap-4 mt-4 text-lg justify-start md:justify-start">
            <a
              href="https://insafdaar.ai"
              className="hover:text-[#f5b301] transition"
              aria-label="Website"
            >
              <Globe size={18} />
            </a>
            <a
              href="https://twitter.com"
              className="hover:text-[#f5b301] transition"
              aria-label="Twitter"
            >
              <Twitter size={18} />
            </a>
            <a
              href="https://linkedin.com"
              className="hover:text-[#f5b301] transition"
              aria-label="LinkedIn"
            >
              <Linkedin size={18} />
            </a>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="relative z-10 bg-[#001025] text-center py-5 text-gray-500 text-xs border-t border-white/10">
        © {new Date().getFullYear()}{" "}
        <span className="text-white font-semibold">Insafdaar</span> —{" "}
        {t("footerRights")}
      </div>
    </footer>
  );
}
