// DemoBadge — "Synthetic Phantom Demo Case" label.
//
// Required by Invariant 4 (honesty over theater) and plan 04 §C-4.
// Appears in the navbar, the upload preview, and on every page of the
// audit PDF. Never hidden, never minimized.
//
// This is a server component — no state, no effects.

interface DemoBadgeProps {
  variant?: "compact" | "full";
  className?: string;
}

export function DemoBadge({ variant = "compact", className = "" }: DemoBadgeProps) {
  const isFull = variant === "full";

  return (
    <span
      role="note"
      aria-label="Synthetic phantom demo case"
      className={[
        "inline-flex items-center gap-1.5 rounded-full",
        "border border-critic-warn/40 bg-critic-warn/10",
        "text-critic-warn font-medium tracking-wide",
        isFull ? "px-3 py-1 text-xs uppercase" : "px-2 py-0.5 text-[10px] uppercase",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-critic-warn"
      />
      {isFull ? "Synthetic Phantom — Demo Case" : "Phantom Demo"}
    </span>
  );
}
