import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// 🗂 Translation resources
const resources = {
  en: {
    translation: {
      // 🌍 General
      appName: "Insafdaar",
      tagline: "Justice made simple for everyone",
      home: "Home",
      login: "Login",
      register: "Register",
      voiceAssistant: "Voice Assistant",
      advocateDashboard: "Advocate Dashboard",
      clientDashboard: "Client Dashboard",
      startWithVoice: "Start with Voice",
      exploreFramework: "Explore Framework",
      heroTitle: "Digital Justice Platform",
      heroDesc:
        "A secure digital platform connecting citizens, advocates, and courts for transparent legal access.",
      footerText: "Empowering Justice through Technology",

      // 🧠 Hero Stages
      intakeTitle: "Smart Case Intake",
      intakeDesc:
        "Start a case easily using your voice or text — our system helps capture all key details automatically.",
      reviewTitle: "Case Review & Guidance",
      reviewDesc:
        "Get clear insights about your case progress, important documents, and next steps — all in one place.",
      findAdvocateTitle: "Find the Right Advocate",
      findAdvocateDesc:
        "Be connected with experienced advocates who match your case type and location instantly.",
      recordsTitle: "Secure Digital Records",
      recordsDesc:
        "All your case files and updates are safely stored and accessible anytime you need them.",
      progressTitle: "Transparent Legal Progress",
      progressDesc:
        "Track every hearing, update, and milestone clearly — justice made simple and transparent.",

      // 🏛 About Section
      aboutTitle1: "About",
      aboutTitle2: "Insafdaar",
      aboutDesc:
        "Insafdaar is Pakistan’s first enterprise-grade digital legal platform designed to make justice simple, accessible, and transparent for everyone.",
      aboutStat1: "Active Legal Matters",
      aboutStat2: "Verified Advocates",
      aboutStat3: "Digital Case Records",
      aboutStat4: "Client Satisfaction",
      contactButton: "Get in Touch",

      // ⚙️ Framework Section
      frameworkTitle1: "Insafdaar’s",
      frameworkTitle2: "Digital Legal Framework",
      frameworkDesc:
        "Insafdaar’s legal intelligence system brings together people, law, and technology — guiding cases from the first voice interaction to final resolution.",
      fwStep1Title: "Voice Onboarding",
      fwStep1Desc:
        "Talk naturally in Urdu — your case is safely recorded and analyzed instantly.",
      fwStep2Title: "Case Understanding",
      fwStep2Desc:
        "AI identifies the core issue, legal category, and next steps clearly.",
      fwStep3Title: "Advocate Matching",
      fwStep3Desc:
        "You’re connected with a verified advocate best suited to your case.",
      fwStep4Title: "Smart Finance",
      fwStep4Desc:
        "Transparent digital billing and payment tracking for every case.",
      fwStep5Title: "Outcome Monitoring",
      fwStep5Desc:
        "Track progress, compliance, and hearing updates in one place.",

      // 🚀 Future Section (English)
      futureTitle1: "The Future",
      futureOf: "of",
      futureTitle2: "Legal Intelligence",
      futureDesc:
        "Insafdaar is building the next era of Pakistan’s justice system — connecting courts, advocates, and citizens through secure digital intelligence.",
      f1Title: "Cognitive Case Systems",
      f1Desc:
        "Smart, adaptive systems that understand legal language, context, and behavior — improving with every case.",
      f2Title: "Connected Justice Cloud",
      f2Desc:
        "A national legal network linking courts, advocates, and citizens securely for real-time access to justice.",
      f3Title: "Inclusive Access",
      f3Desc:
        "Built in Urdu first, ensuring that every citizen can seek justice without language barriers.",
      f4Title: "Ethical Automation",
      f4Desc:
        "Transparent, accountable AI systems that uphold fairness, human oversight, and integrity.",

      // 🧭 Footer Section (English)
      footerBrand: "Insafdaar",
      footerDesc:
        "AI-powered justice infrastructure for Pakistan — bridging the gap between law, technology, and people through trust and intelligence.",
      footerExplore: "Explore",
      footerCompany: "Company",
      footerContact: "Contact",
      footerAbout: "About Us",
      footerFuture: "Future Vision",
      footerEmail: "support@insafdaar.ai",
      footerLocation: "Islamabad, Pakistan",
      footerRights: "Building Pakistan’s AI-Powered Legal Future",
      registerAsClient: "Register as Client",
      registerAsAdvocate: "Register as Advocate",
    },
  },

  ur: {
    translation: {
      // 🌍 عمومی مواد
      appName: "انصاف دار",
      tagline: "سب کے لیے آسان انصاف",
      home: "صفحہ اول",
      login: "لاگ ان",
      register: "رجسٹر کریں",
      voiceAssistant: "وائس اسسٹنٹ",
      advocateDashboard: "وکیل کا ڈیش بورڈ",
      clientDashboard: "کلائنٹ ڈیش بورڈ",
      startWithVoice: "آواز سے آغاز کریں",
      exploreFramework: "فریم ورک دیکھیں",
      heroTitle: "ڈیجیٹل انصاف پلیٹ فارم",
      heroDesc:
        "ایک محفوظ ڈیجیٹل پلیٹ فارم جو شہریوں، وکلاء اور عدالتوں کو جوڑتا ہے تاکہ انصاف تک شفاف رسائی ممکن بنائی جا سکے۔",
      footerText: "ٹیکنالوجی کے ذریعے انصاف کو بااختیار بنانا",

      // 🧠 Hero Stages
      intakeTitle: "کیس درج کریں",
      intakeDesc:
        "اپنے کیس کی تفصیل آواز یا تحریر کے ذریعے دیں، نظام خود تمام اہم معلومات جمع کرتا ہے۔",
      reviewTitle: "کیس کا جائزہ اور رہنمائی",
      reviewDesc:
        "اپنے کیس کی پیش رفت، ضروری دستاویزات اور اگلے اقدامات ایک جگہ پر دیکھیں۔",
      findAdvocateTitle: "موزوں وکیل تلاش کریں",
      findAdvocateDesc:
        "اپنے کیس اور علاقے کے لحاظ سے بہترین وکیل سے فوری رابطہ حاصل کریں۔",
      recordsTitle: "محفوظ قانونی ریکارڈز",
      recordsDesc:
        "تمام کیس فائلیں اور تازہ ترین معلومات محفوظ رہتی ہیں اور کسی بھی وقت دستیاب ہیں۔",
      progressTitle: "شفاف قانونی پیش رفت",
      progressDesc:
        "ہر پیشی، اپ ڈیٹ اور مرحلے کو آسانی سے دیکھیں — انصاف شفاف اور واضح۔",

      // 🏛 About Section
      aboutTitle1: "متعلق",
      aboutTitle2: "انصاف دار",
      aboutDesc:
        "انصاف دار پاکستان کا پہلا جدید ڈیجیٹل قانونی پلیٹ فارم ہے جو انصاف کو عام شہریوں کے لیے آسان، قابلِ رسائی اور شفاف بناتا ہے۔",
      aboutStat1: "زیرِ عمل قانونی معاملات",
      aboutStat2: "تصدیق شدہ وکلاء",
      aboutStat3: "ڈیجیٹل کیس ریکارڈز",
      aboutStat4: "کلائنٹ اطمینان",
      contactButton: "رابطہ کریں",

      // ⚙️ Framework Section (Urdu)
      frameworkTitle1: "انصاف دار کا",
      frameworkTitle2: "ڈیجیٹل قانونی فریم ورک",
      frameworkDesc:
        "انصاف دار جدید ٹیکنالوجی اور قانونی ماہرین کو ایک پلیٹ فارم پر لا کر مقدمات کے آغاز سے اختتام تک رہنمائی فراہم کرتا ہے۔",
      fwStep1Title: "آواز کے ذریعے اندراج",
      fwStep1Desc:
        "اردو میں بات کریں، نظام خود آپ کا کیس ریکارڈ اور تجزیہ کرے گا۔",
      fwStep2Title: "کیس کی سمجھ بوجھ",
      fwStep2Desc:
        "نظام مسئلے، قانونی نوعیت، اور اگلے اقدامات کو واضح طور پر شناخت کرتا ہے۔",
      fwStep3Title: "وکیل کا انتخاب",
      fwStep3Desc:
        "آپ کو اپنے کیس کے لیے موزوں ترین وکیل سے خودکار طور پر جوڑا جاتا ہے۔",
      fwStep4Title: "سمارٹ فنانس",
      fwStep4Desc:
        "ہر کیس کے لیے شفاف ڈیجیٹل بلنگ اور ادائیگی کا ریکارڈ۔",
      fwStep5Title: "نتائج کی نگرانی",
      fwStep5Desc:
        "پیش رفت، مطابقت اور سماعت کی اپ ڈیٹس ایک ہی جگہ دیکھیں۔",

      // 🚀 Future Section (Urdu)
      futureTitle1: "مستقبل",
      futureOf: "کا",
      futureTitle2: "قانونی نظام",
      futureDesc:
        "انصاف دار پاکستان کے عدالتی نظام کا نیا دور تعمیر کر رہا ہے — عدالتوں، وکلاء، اور شہریوں کو ایک محفوظ ڈیجیٹل نظام کے ذریعے جوڑ رہا ہے۔",
      f1Title: "ذہین کیس سسٹمز",
      f1Desc:
        "ایسے خود سیکھنے والے نظام جو زبان، قانون، اور سیاق و سباق کو سمجھ کر ہر کیس کے ساتھ بہتر ہوتے ہیں۔",
      f2Title: "منسلک عدالتی نیٹ ورک",
      f2Desc:
        "عدالتوں، وکلاء، اور شہریوں کو حقیقی وقت میں انصاف تک رسائی کے لیے ایک پلیٹ فارم پر لاتا ہے۔",
      f3Title: "شمولیتی رسائی",
      f3Desc:
        "اردو میں تیار کردہ نظام جو ہر شہری کو بغیر زبان کی رکاوٹ کے انصاف تک رسائی دیتا ہے۔",
      f4Title: "اخلاقی خودکاری",
      f4Desc:
        "ایسے شفاف اور جوابدہ AI نظام جو دیانتداری اور انسانی نگرانی کو یقینی بناتے ہیں۔",

      // 🧭 Footer Section (Urdu)
      footerBrand: "انصاف دار",
      footerDesc:
        "پاکستان کے لیے اے آئی سے تقویت یافتہ عدالتی نظام — جو قانون، ٹیکنالوجی اور عوام کو اعتماد اور علم کے ذریعے جوڑتا ہے۔",
      footerExplore: "دریافت کریں",
      footerCompany: "کمپنی",
      footerContact: "رابطہ",
      footerAbout: "ہمارے بارے میں",
      footerFuture: "مستقبل کا وژن",
      footerEmail: "support@insafdaar.ai",
      footerLocation: "اسلام آباد، پاکستان",
      footerRights: "پاکستان کے اے آئی سے چلنے والے عدالتی مستقبل کی بنیاد",
      registerAsClient: "کلائنٹ کے طور پر رجسٹر کریں",
      registerAsAdvocate: "وکیل کے طور پر رجسٹر کریں",
    },
  },
};

// ⚙️ Initialize i18next
i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem("lang") || "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes
  },
});

export default i18n;
