"use client";

import { cn } from "@/lib/utils";

/**
 * The pieces this console repeats, defined once.
 *
 * Deliberately small. Everything here earns its place by appearing on three or
 * more screens; a component used once is a function call with extra steps, and
 * a component library nobody can hold in their head is where consistency goes
 * to die.
 */

/* -------------------------------------------------------------------- state */

type Tone = "ok" | "waiting" | "stopped" | "muted" | "accent";

const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok-tint",
  waiting: "text-waiting bg-waiting-tint",
  stopped: "text-stopped bg-stopped-tint",
  accent: "text-accent-foreground bg-accent",
  muted: "text-muted-foreground bg-muted",
};

/**
 * A status, said in a word.
 *
 * Never colour alone: every one of these carries its own text, so an operator
 * who cannot separate the amber from the green still reads "onboarding".
 */
export function Pill({
  tone = "muted",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium tracking-[0.02em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const statusTone = (s: string): Tone =>
  ({ active: "ok", onboarding: "waiting", suspended: "stopped" })[s] as Tone ?? "muted";

export const verificationTone = (v: string): Tone =>
  ({ verified: "ok", pending: "waiting", rejected: "stopped" })[v] as Tone ?? "muted";

/* ------------------------------------------------------------------ numbers */

/**
 * A number and what it counts, the number first.
 *
 * "Patients: 147" makes the reader parse a label to reach the fact. The figure
 * leads, at a size that can be read across a desk, with the word underneath in
 * the quiet colour.
 */
export function Stat({
  value,
  label,
  hint,
  tone,
  jumpTo,
}: {
  value: React.ReactNode;
  label: string;
  hint?: string;
  tone?: "waiting";
  /**
   * The id of the panel that lists what this counts.
   *
   * "Staff 3" and the list of the three are the same fact twice, and on a phone
   * they are a screen apart because the columns stack. Not every stat has one —
   * patients are counted and deliberately not listed anywhere in this console.
   */
  jumpTo?: string;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "tnum text-2xl leading-none font-semibold tracking-tight",
          tone === "waiting" && "text-waiting",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {label}
      </span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </>
  );

  if (!jumpTo) return <div className="flex flex-col gap-0.5">{inner}</div>;

  return (
    <a
      href={`#${jumpTo}`}
      className="hover:text-primary focus-visible:ring-ring -m-1.5 flex flex-col gap-0.5 rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {inner}
      <span className="sr-only">— jump to the list</span>
    </a>
  );
}

/* ------------------------------------------------------------------ surface */

/**
 * A panel: one hairline, no shadow.
 *
 * Shadow is reserved for things that genuinely float — a dialog, a menu. A
 * shadow on a section that is flat against the page is decoration, and it is
 * most of what makes a screen read as a template.
 */
export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  /** Anchor, so a count elsewhere on the page can point at the list. */
  id?: string;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        // Jumping to a panel puts its header hard against the top of the
        // viewport, under the sticky bar. This is the offset that leaves it
        // visible where it lands.
        id && "scroll-mt-20",
        // `min-w-0` is load-bearing. A grid item defaults to `min-width: auto`,
        // so a panel holding a long unbroken name grows past its column rather
        // than clipping it — and takes the page's width with it, which is how a
        // phone ends up scrolling sideways with the status badge off the edge.
        "border-border bg-card min-w-0 rounded-md border",
        className,
      )}
    >
      {title ? (
        <header className="border-border flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A field and its value, in a column.
 *
 * `mono` for anything that is an identifier or a count — see the note in
 * layout.tsx about numbers that do not line up.
 */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {label}
      </dt>
      <dd className={cn("text-sm break-words", mono && "font-mono tnum text-[13px]")}>
        {children}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------- states */

/**
 * Nothing here, and what to do about it.
 *
 * An empty state that only says "no results" makes the reader work out whether
 * that is a filter, a bug or the truth. Every one of these says which.
 */
export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? (
        <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Failed({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-stopped text-sm font-medium">Could not load this</p>
      <p className="text-muted-foreground max-w-md text-xs leading-relaxed">{message}</p>
      {retry ? (
        <button
          onClick={retry}
          className="border-border hover:bg-muted mt-1 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** A row of grey bars that matches the shape of what is coming. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-border divide-y">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="bg-muted h-3 w-40 animate-pulse rounded-sm" />
          <div className="bg-muted h-3 w-24 animate-pulse rounded-sm" />
          <div className="bg-muted ml-auto h-3 w-16 animate-pulse rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- time */

/** "3 Sep", "12:04 today", "—". Short, because these sit in dense rows. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function fullWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
