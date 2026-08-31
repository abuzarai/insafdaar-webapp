// frontend/src/components/common/Badge.tsx
// Shared status badge — previously duplicated per component (audit F14).
function Badge({
  variant,
  children,
}: {
  variant: "blue" | "amber" | "green" | "gray" | "red";
  children: React.ReactNode;
}) {
  const styles =
    variant === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : variant === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : variant === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : variant === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${styles}`}>
      {children}
    </span>
  );
}

export { Badge };
