import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus,
  ClipboardCheck,
  Mic,
  UserCheck,
  Handshake,
  FileText,
  ShieldCheck,
  Scale,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  BadgeCheck,
  Download,
} from "lucide-react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Step = {
  id: string;
  title: string;
  desc: React.ReactNode;
  icon: React.ReactNode;
  badge?: string;
  group: "start" | "match" | "agreement" | "pay";
  accent?: string;
};

function GlowPill({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-[12px] px-3 py-1 rounded-full border transition",
        active
          ? "border-white/25 bg-white/15 text-white"
          : "border-white/12 bg-white/8 text-white/80 hover:bg-white/12"
      )}
    >
      {children}
    </span>
  );
}

function StepMiniCard({
  step,
  active,
  done,
  onClick,
  brand,
}: {
  step: Step;
  active: boolean;
  done: boolean;
  onClick: () => void;
  brand: { gold: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left w-full rounded-2xl border shadow-sm overflow-hidden transition",
        active
          ? "bg-white border-slate-200 shadow-md"
          : "bg-white/80 border-slate-200 hover:bg-white hover:shadow-md"
      )}
    >
      <div className="p-4 flex items-start gap-3">
        <div
          className={cn(
            "h-11 w-11 rounded-xl border flex items-center justify-center shrink-0",
            active ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
          )}
          style={{
            boxShadow: active ? `0 0 0 4px ${brand.gold}20` : undefined,
          }}
        >
          <span className="text-slate-800">{step.icon}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-extrabold text-slate-900 truncate">
              {step.title}
            </div>

            {step.badge ? (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-extrabold border"
                style={{
                  borderColor: `${brand.gold}55`,
                  backgroundColor: `${brand.gold}14`,
                  color: "#7a5600",
                }}
              >
                {step.badge}
              </span>
            ) : null}

            {done ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-extrabold border border-emerald-200 bg-emerald-50 text-emerald-800">
                Done
              </span>
            ) : null}
          </div>

          <div className="text-sm text-slate-600 mt-1 line-clamp-2">
            {step.desc}
          </div>
        </div>
      </div>

      {/* subtle active underline */}
      <div
        className="h-[3px]"
        style={{
          background: active
            ? `linear-gradient(90deg, ${brand.gold}, rgba(245,179,1,0.25), transparent)`
            : "transparent",
        }}
      />
    </button>
  );
}

function BigStepPanel({
  step,
  index,
  total,
  brand,
}: {
  step: Step;
  index: number;
  total: number;
  brand: { navyFrom: string; navyVia: string; navyTo: string; gold: string };
}) {
  const pct = Math.round(((index + 1) / total) * 100);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      {/* top accent */}
      <div
        className="h-2"
        style={{
          background: `linear-gradient(90deg, ${brand.gold} 0%, rgba(245,179,1,0.25) 45%, transparent 100%)`,
        }}
      />
      <div className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div
            className="h-14 w-14 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
            style={{ boxShadow: `0 0 0 6px ${brand.gold}18` }}
          >
            <span className="text-slate-800">{step.icon}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-xl md:text-2xl font-extrabold text-slate-900">
                {step.title}
              </div>
              {step.badge ? (
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-extrabold border"
                  style={{
                    borderColor: `${brand.gold}55`,
                    backgroundColor: `${brand.gold}14`,
                    color: "#7a5600",
                  }}
                >
                  {step.badge}
                </span>
              ) : null}
              <span className="text-[11px] px-2 py-0.5 rounded-full font-extrabold border border-slate-200 bg-slate-50 text-slate-700">
                Step {index + 1} / {total}
              </span>
            </div>

            <div className="text-slate-600 mt-3 leading-relaxed">
              {step.desc}
            </div>

            {/* progress */}
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                <span>Progress</span>
                <span>{pct}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${brand.gold}, rgba(245,179,1,0.35))`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>

            {/* group hint */}
            <div className="mt-5 flex items-center gap-2 text-xs font-bold text-slate-600">
              <Sparkles size={14} className="text-slate-500" />
              <span>
                Phase:{" "}
                <span className="text-slate-900 font-extrabold">
                  {step.group}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  const BRAND = {
    navyFrom: "#060b18",
    navyVia: "#0a1428",
    navyTo: "#00142e",
    gold: "#f5b301",
  };

  const steps: Step[] = useMemo(
    () => [
      {
        id: "signup",
        group: "start",
        title: "Create your account",
        badge: "OTP verified",
        desc: (
          <>
            Register as a client in seconds — your account is secured with{" "}
            <b>OTP email verification</b>.
          </>
        ),
        icon: <UserPlus className="text-slate-800" />,
      },
      {
        id: "profile",
        group: "start",
        title: "Complete your profile",
        desc: (
          <>
            Add your details once — name, CNIC, city and contacts. Upload your{" "}
            <b>CNIC (front & back)</b> and <b>address proof</b>.
          </>
        ),
        icon: <ClipboardCheck className="text-slate-800" />,
      },
      {
        id: "start-case",
        group: "start",
        title: "Start a case",
        badge: "Main Step",
        desc: (
          <>
            Pick your language: <b>Urdu</b> or <b>English</b>.
          </>
        ),
        icon: <Scale className="text-slate-800" />,
      },
      {
        id: "ai-interview",
        group: "start",
        title: "AI voice interview",
        desc: (
          <>
            Answer guided questions <b>by voice</b>. Everything is transcribed and analysed
            into a structured case summary automatically.
          </>
        ),
        icon: <Mic className="text-slate-800" />,
      },
      {
        id: "matching",
        group: "match",
        title: "AI advocate matching",
        badge: "Smart shortlist",
        desc: (
          <>
            Advocates are ranked by specialization, experience and workload into a shortlist.
            You can mark a <b>preferred advocate</b>.
          </>
        ),
        icon: <Sparkles className="text-slate-800" />,
      },
      {
        id: "admin-assign",
        group: "match",
        title: "Admin assigns the advocate",
        desc: "An administrator reviews the shortlist and officially assigns the advocate — your preferred choice is respected.",
        icon: <UserCheck className="text-slate-800" />,
      },
      {
        id: "advocate-accepts",
        group: "match",
        title: "Advocate accepts & prepares",
        desc: "The assigned advocate reviews your facts and documents, verifies them, and begins preparation.",
        icon: <BadgeCheck className="text-slate-800" />,
      },
      {
        id: "meeting",
        group: "agreement",
        title: "Meeting over Google Meet",
        desc: (
          <>
            The advocate requests a meeting; once approved, a <b>Google Meet link</b> is
            generated automatically so you can discuss the details.
          </>
        ),
        icon: <Handshake className="text-slate-800" />,
      },
      {
        id: "contract-sign",
        group: "agreement",
        title: "Contract drafted & signed",
        badge: "AI assisted",
        desc: (
          <>
            A draft contract is prepared with AI assistance. Both parties review it and{""}
            <b>sign digitally with OTP</b>.
          </>
        ),
        icon: <FileText className="text-slate-800" />,
      },
      {
        id: "contract-approve",
        group: "agreement",
        title: "Admin approves the contract",
        badge: "Unlocks case",
        desc: (
          <>
            After verifying signatures, the admin approves — unlocking your <b>full case
            dashboard</b>.
          </>
        ),
        icon: <ShieldCheck className="text-slate-800" />,
      },
      {
        id: "voucher",
        group: "pay",
        title: "Fee voucher & payment proof",
        desc: (
          <>
            A <b>PDF fee voucher</b> is generated instantly. Download it, deposit the fee,
            and upload your payment proof.
          </>
        ),
        icon: <Download className="text-slate-800" />,
      },
      {
        id: "payment-verified",
        group: "pay",
        title: "Payment verified — case proceeds",
        badge: "Done",
        desc: "The admin verifies your payment and your case moves forward actively. Track every stage from your dashboard.",
        icon: <ShieldCheck className="text-slate-800" />,
      },
    ],
    []
  );

  const [active, setActive] = useState(0);
  const total = steps.length;

  // Auto-play (keeps it “fascinating”)
  useEffect(() => {
    const timer = setInterval(() => {
      setActive((a) => (a + 1) % total);
    }, 6500);
    return () => clearInterval(timer);
  }, [total]);

  const goPrev = () => setActive((a) => (a - 1 + total) % total);
  const goNext = () => setActive((a) => (a + 1) % total);

  const chips = [
    { key: "start", label: "Getting Started" },
    { key: "match", label: "Matching & Assignment" },
    { key: "agreement", label: "Meetings & Contract" },
    { key: "pay", label: "Payments & Access" },
  ] as const;

  return (
    <div className="min-h-screen bg-[#F6F8FC]">
      {/* HERO (same vibe as your main hero) */}
      <div
        className="relative overflow-hidden text-white"
        style={{
          background: `linear-gradient(135deg, ${BRAND.navyFrom} 0%, ${BRAND.navyVia} 45%, ${BRAND.navyTo} 100%)`,
        }}
      >
        {/* subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "70px 70px",
          }}
        />

        {/* glow */}
        <motion.div
          className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full blur-[140px]"
          style={{ background: `${BRAND.gold}25` }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.25, 0.45, 0.25] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-48 -left-48 w-[520px] h-[520px] rounded-full blur-[160px]"
          style={{ background: `rgba(0, 212, 255, 0.14)` }}
          animate={{ scale: [1, 1.05, 1], opacity: [0.18, 0.34, 0.18] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative z-10 max-w-[1200px] mx-auto px-4 md:px-6 py-16">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
                How it <span style={{ color: BRAND.gold }}>Works</span>
              </h1>
              <p className="mt-4 text-gray-300 max-w-2xl leading-relaxed">
                Register → complete your profile → AI voice intake → smart advocate matching →
                meet & sign online → secure payments → track your case to completion.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 transition"
                aria-label="Previous step"
                type="button"
              >
                <ChevronLeft />
              </button>
              <button
                onClick={goNext}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 transition"
                aria-label="Next step"
                type="button"
              >
                <ChevronRight />
              </button>
            </div>
          </div>

          {/* Phase chips */}
          <div className="mt-8 flex flex-wrap gap-2">
            {chips.map((c) => {
              const isActive = steps[active].group === c.key;
              return (
                <GlowPill key={c.key} active={isActive}>
                  {c.label}
                </GlowPill>
              );
            })}
            <span className="ml-1 text-[12px] px-3 py-1 rounded-full border border-white/12 bg-white/8 text-white/80">
              Step {active + 1} of {total}
            </span>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-10">
        <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-6 items-start">
          {/* LEFT: Big animated panel */}
          <div className="sticky top-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={steps[active].id}
                initial={{ opacity: 0, y: 18, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.99 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <BigStepPanel
                  step={steps[active]}
                  index={active}
                  total={total}
                  brand={BRAND}
                />
              </motion.div>
            </AnimatePresence>

            {/* CTA */}
            <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden relative">
              <div
                className="absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 20% 20%, rgba(245,179,1,1) 0%, transparent 35%), radial-gradient(circle at 80% 30%, rgba(0,212,255,1) 0%, transparent 38%)",
                }}
              />
              <div className="relative z-10 flex items-start justify-between gap-6 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xl font-extrabold text-slate-900">
                    Ready to begin?
                  </div>
                  <div className="text-slate-600 mt-2">
                    Sign up, complete your profile, start a case, then record your voice in{" "}
                    <b>Urdu</b> or <b>English</b>.
                  </div>
                </div>

                <div className="flex gap-2">
                  <a
                    href="/register-client"
                    className={cn(
                      "px-5 py-2.5 rounded-xl font-extrabold border transition",
                      "bg-[#f5b301] text-[#00142e] border-[#f5b301] hover:bg-[#ffd84d] shadow-sm"
                    )}
                  >
                    Register as Client
                  </a>
                  <a
                    href="/meet-advocates"
                    className={cn(
                      "px-5 py-2.5 rounded-xl font-extrabold border transition",
                      "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    Meet Advocates
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Clickable step list + timeline feel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900">
                  Interactive Journey
                </h2>
                <p className="text-slate-600 mt-1">
                  Auto-plays like a story — click any step to jump.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: BRAND.gold }}
                  />
                  Active
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Done
                </span>
              </div>
            </div>

            {/* timeline rail */}
            <div className="relative">
              <div className="absolute left-[18px] top-2 bottom-2 w-[2px] bg-slate-200 rounded-full" />
              <motion.div
                className="absolute left-[18px] top-2 w-[2px] bg-emerald-500 rounded-full"
                initial={false}
                animate={{
                  height: `${Math.max(6, ((active + 1) / total) * 100)}%`,
                }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />

              <div className="space-y-3">
                {steps.map((s, idx) => {
                  const isActive = idx === active;
                  const done = idx < active;

                  return (
                    <div key={s.id} className="relative pl-10">
                      {/* node */}
                      <div
                        className={cn(
                          "absolute left-[10px] top-6 h-4 w-4 rounded-full border",
                          done
                            ? "bg-emerald-500 border-emerald-500"
                            : isActive
                            ? "bg-white border-slate-900"
                            : "bg-white border-slate-300"
                        )}
                        style={{
                          boxShadow: isActive
                            ? `0 0 0 4px ${BRAND.gold}20`
                            : undefined,
                        }}
                      />
                      <StepMiniCard
                        step={s}
                        active={isActive}
                        done={done}
                        onClick={() => setActive(idx)}
                        brand={{ gold: BRAND.gold }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* small helper */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div
                  className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0"
                  style={{ boxShadow: `0 0 0 4px ${BRAND.gold}14` }}
                >
                  <Sparkles className="text-slate-800" size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-slate-900">
                    Your preference matters
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    Mark a <b>preferred advocate</b> from your shortlist — the admin assigns
                    advocates with your choice in mind.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="h-10" />
      </div>
    </div>
  );
}
