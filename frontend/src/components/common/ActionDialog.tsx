import React, { useRef, useState } from "react";

type Tone = "neutral" | "danger";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
};

type PromptOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  tone?: Tone;
};

type ConfirmState = (ConfirmOptions & { open: boolean }) | null;
type PromptState = (PromptOptions & { open: boolean; value: string }) | null;

function baseBtn(
  primary: boolean,
  tone: Tone = "neutral",
  disabled = false
) {
  if (primary) {
    if (tone === "danger") {
      return `inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold transition ${
        disabled
          ? "bg-rose-200 text-rose-50 cursor-not-allowed"
          : "bg-rose-600 text-white hover:bg-rose-700"
      }`;
    }
    return `inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold transition ${
      disabled
        ? "bg-slate-200 text-slate-500 cursor-not-allowed"
        : "bg-[#1E3A8A] text-white hover:bg-[#163274]"
    }`;
  }

  return "inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition";
}

export function useActionDialogs() {
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);

  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [promptState, setPromptState] = useState<PromptState>(null);

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ open: true, tone: "neutral", ...opts });
    });

  const prompt = (opts: PromptOptions) =>
    new Promise<string | null>((resolve) => {
      promptResolverRef.current = resolve;
      setPromptState({
        open: true,
        tone: "neutral",
        value: opts.defaultValue || "",
        ...opts,
      });
    });

  const closeConfirm = (value: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(value);
  };

  const closePrompt = (value: string | null) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptState(null);
    if (resolver) resolver(value);
  };

  const dialogs = (
    <>
      {confirmState?.open ? (
        <div className="fixed inset-0 z-[120] bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-base font-bold text-slate-900">{confirmState.title}</div>
            </div>
            <div className="px-5 py-4 text-sm text-slate-700 whitespace-pre-wrap">{confirmState.message}</div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                className={baseBtn(false)}
                onClick={() => closeConfirm(false)}
              >
                {confirmState.cancelText || "Cancel"}
              </button>
              <button
                type="button"
                className={baseBtn(true, confirmState.tone)}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {promptState?.open ? (
        <div className="fixed inset-0 z-[120] bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-base font-bold text-slate-900">{promptState.title}</div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{promptState.message}</div>
              <textarea
                autoFocus
                value={promptState.value}
                onChange={(e) => setPromptState((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                placeholder={promptState.placeholder || "Type here..."}
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
              />
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                className={baseBtn(false)}
                onClick={() => closePrompt(null)}
              >
                {promptState.cancelText || "Cancel"}
              </button>
              <button
                type="button"
                className={baseBtn(true, promptState.tone, !!promptState.required && !promptState.value.trim())}
                disabled={!!promptState.required && !promptState.value.trim()}
                onClick={() => closePrompt(promptState.value.trim())}
              >
                {promptState.confirmText || "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return { confirm, prompt, dialogs };
}
