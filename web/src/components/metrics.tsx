"use client";

import { cn } from "@/lib/utils";

export type Movement = { current: number; previous: number };

/**
 * A number, what it counts, and which way it is going.
 *
 * ---- The figure leads --------------------------------------------------
 *
 * "Patients: 12,842" makes the reader parse a label before reaching the fact.
 * The number goes first, at a size readable across a desk, with the word under
 * it in the quiet colour.
 *
 * ---- And the trend is honest -------------------------------------------
 *
 * A percentage from a small base is noise dressed as insight: one new practice
 * against one last month is "+100%". Below five, this shows the count instead —
 * "+1 this month" is a true statement where "+100%" is a misleading one.
 *
 * From nothing to something has no percentage at all, and saying so beats
 * printing ∞ or silently hiding the row.
 */
export function MetricCard({
  label,
  value,
  movement,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  movement?: Movement;
  hint?: string;
  icon?: React.ReactNode;
}) {
  const t = movement ? describe(movement) : null;

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px] font-medium tracking-[0.06em] uppercase">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground/70 shrink-0">{icon}</span> : null}
      </div>

      <span className="tnum text-[27px] leading-none font-semibold tracking-tight">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>

      <div className="flex min-h-[1rem] items-center gap-1.5 text-[11px]">
        {t ? (
          <>
            <span
              className={cn(
                "font-medium tabular-nums",
                t.direction === "up"
                  ? "text-ok"
                  : t.direction === "down"
                    ? "text-stopped"
                    : "text-muted-foreground",
              )}
            >
              {t.arrow} {t.text}
            </span>
            <span className="text-muted-foreground">vs previous 30 days</span>
          </>
        ) : hint ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Small bases get a count; everything else gets a percentage. */
function describe({ current, previous }: Movement) {
  const delta = current - previous;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";

  if (delta === 0) return { direction, arrow, text: "no change" };

  // Below five, a percentage is arithmetic on noise.
  if (previous < 5) {
    return { direction, arrow, text: `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"}` };
  }

  const pct = Math.round((Math.abs(delta) / previous) * 100);
  return { direction, arrow, text: `${pct}%` };
}

/**
 * How much of a limit is used.
 *
 * Never colour alone: the numbers are printed beside the bar, so somebody who
 * cannot separate amber from green still reads "118 of 120".
 *
 * No cap is not zero, and it is not a full bar either — it is the absence of a
 * bar, because drawing one implies a ceiling that does not exist.
 */
export function UsageBar({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number | null;
}) {
  if (cap === null) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px]">{label}</span>
          <span className="tnum text-muted-foreground font-mono text-xs">
            {used.toLocaleString()} · no cap
          </span>
        </div>
        <div className="bg-muted h-1.5 rounded-full" />
      </div>
    );
  }

  const ratio = cap === 0 ? 1 : Math.min(used / cap, 1);
  const state = used >= cap ? "stopped" : ratio >= 0.8 ? "waiting" : "ok";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px]">{label}</span>
        <span
          className={cn(
            "tnum font-mono text-xs",
            state === "stopped"
              ? "text-stopped"
              : state === "waiting"
                ? "text-waiting"
                : "text-muted-foreground",
          )}
        >
          {used.toLocaleString()} / {cap.toLocaleString()}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            state === "stopped"
              ? "bg-stopped"
              : state === "waiting"
                ? "bg-waiting"
                : "bg-primary",
          )}
          style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}
