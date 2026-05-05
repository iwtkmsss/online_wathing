import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect } from "react";

type ToastTone = "success" | "info" | "error";

type ToastNoticeProps = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  onClose: () => void;
};

const toneClass: Record<ToastTone, string> = {
  success: "border-toxic/45 bg-black/70 text-white shadow-[0_0_18px_rgba(57,255,20,0.18)]",
  info: "border-plasma/40 bg-black/70 text-white shadow-[0_0_18px_rgba(155,92,255,0.16)]",
  error: "border-red-400/45 bg-black/75 text-white shadow-[0_0_18px_rgba(248,113,113,0.16)]"
};

const iconClass: Record<ToastTone, string> = {
  success: "text-toxic",
  info: "text-plasma",
  error: "text-red-300"
};

function ToastNotice({ message, tone = "info", durationMs = 2500, onClose }: ToastNoticeProps) {
  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timer = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, message, onClose]);

  if (!message) {
    return null;
  }

  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : Info;

  return (
    <div className="fixed right-4 top-4 z-[80] w-[min(calc(100vw-2rem),320px)] animate-[toast-in_0.18s_ease-out]">
      <div
        className={`flex items-center gap-2 rounded-md border px-2.5 py-2 backdrop-blur-xl ${toneClass[tone]}`}
        role={tone === "error" ? "alert" : "status"}
      >
        <Icon className={`h-4 w-4 shrink-0 ${iconClass[tone]}`} aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-white/88">{message}</p>
        <button
          className="inline-flex h-6 shrink-0 items-center justify-center rounded border border-white/10 px-1.5 text-[10px] font-black uppercase text-white/62 transition hover:border-toxic/60 hover:text-toxic"
          type="button"
          onClick={onClose}
          title="Закрити"
        >
          OK
        </button>
      </div>
    </div>
  );
}

export default ToastNotice;
