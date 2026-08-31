
import Hero from "../components/Hero";
import AboutSection from "../components/AboutSection";
import FrameworkSection from "../components/FrameworkSection";
import FutureSection from "../components/FutureSection";
// import FloatingChatWidget from "../components/LegalAssistantChat/FloatingChatWidget";

export default function HomePage() {
  return (
    <div className="bg-[#060b18] text-white">

      {/* --- HERO Section --- */}
      <Hero />

      {/* --- About Section --- */}
      <AboutSection />

      {/* --- Framework Section --- */}
      <FrameworkSection />

      {/* --- Future Section --- */}
      <FutureSection />

      {/* --- Floating Chatbot Button (new) --- */}
      {/* <FloatingChatWidget /> */}
    </div>
  );
}
