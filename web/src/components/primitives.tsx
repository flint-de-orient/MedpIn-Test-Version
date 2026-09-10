"use client";

import { useId, useState } from "react";
import { IconCheck, IconInfo, IconWarning } from "@/components/icons";
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
  ok: "text-ok-ink bg-ok-tint",
  waiting: "text-waiting-ink bg-waiting-tint",
  stopped: "text-stopped-ink bg-stopped-tint",
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
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-micro font-medium tracking-[0.02em] whitespace-nowrap",
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
          "tnum text-metric leading-none font-semibold tracking-tight",
          tone === "waiting" && "text-waiting",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-micro tracking-[0.04em] uppercase">
        {label}
      </span>
      {hint ? <span className="text-muted-foreground text-caption">{hint}</span> : null}
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

/* -------------------------------------------------------------------- alert */

/*
 * The edge is the accent; everything inside the tint is the ink.
 *
 * The icon used to be the accent too, which is the role globals.css tunes for
 * 3:1 — correct against a card, and this icon is not on a card. `--waiting` on
 * `--waiting-tint` is 2.86:1 in light, so the amber warning triangle was the
 * least visible of the three, in the theme most people use, on the banner that
 * exists to be noticed. The docblock below says the icon is what tells a
 * reader who cannot separate amber from red which kind this is; at 2.86:1 it
 * was not telling anybody anything.
 *
 * `--stopped` and `--ok` on their own tints are 5.51:1 and 5.83:1, so only one
 * of the three was actually broken. All three moved anyway: "on a tint, use
 * the ink" is a rule somebody can hold, and "on a tint use the ink unless the
 * tint happens to be dark enough" is a table nobody will consult.
 */
const ALERT_TONE = {
  waiting: {
    edge: "border-l-waiting",
    surface: "bg-waiting-tint",
    ink: "text-waiting-ink",
  },
  stopped: {
    edge: "border-l-stopped",
    surface: "bg-stopped-tint",
    ink: "text-stopped-ink",
  },
  ok: {
    edge: "border-l-ok",
    surface: "bg-ok-tint",
    ink: "text-ok-ink",
  },
} as const;

// A caution triangle on an all-clear says the opposite of the words beside it,
// and the icon is what somebody who cannot separate green from amber reads.

/**
 * One banner, three tones, and a hard limit on how much it may say.
 *
 * ---- Why it takes a title and a line, not children ----------------------
 *
 * The amber boxes it replaces were paragraphs: the problem, what it means
 * legally, and what to do about it, in one block of 11px text inside a flat
 * fill. Nobody reads that. It is skipped precisely because it looks like the
 * small print it was written as.
 *
 * So the shape is fixed. `title` is the fact, in three or four words, and it is
 * the only thing that has to be read. `children` is one line saying why it
 * matters. Anything longer belongs in a definition somebody can open, and
 * anything actionable belongs in `action` — a warning that explains a fix in
 * prose is a button that was never built.
 *
 * ---- And the colour does not carry the meaning alone -------------------
 *
 * A left edge, an icon and a tint. The edge is what makes it read as a banner
 * at a glance rather than a tinted paragraph, and the icon is what says which
 * kind it is to somebody who cannot separate amber from red.
 */
export function Alert({
  tone = "waiting",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof ALERT_TONE;
  title: string;
  /** One line. Not a paragraph — see above. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = ALERT_TONE[tone];
  return (
    <div
      // `alert` would interrupt a screen reader mid-sentence for something that
      // was on the page before they arrived. These describe a state, they do
      // not announce a change.
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-l-2 px-3 py-2.5",
        "border-border/60",
        t.edge,
        t.surface,
        className,
      )}
    >
      {tone === "ok" ? (
        <IconCheck className={cn("mt-px size-4 shrink-0", t.ink)} />
      ) : (
        <IconWarning className={cn("mt-px size-4 shrink-0", t.ink)} />
      )}
      <div className={cn("min-w-0 flex-1 text-caption leading-relaxed", t.ink)}>
        <p className="font-semibold">{title}</p>
        {/* The line under the title was `opacity-90`, which is a fourth way of
            saying "quieter" on a banner that already has weight to say it
            with. The title is semibold and this is not. */}
        {children ? <p className="mt-0.5">{children}</p> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------------- info */

/**
 * A word, and its definition one tap away.
 *
 * ---- Why not a tooltip -------------------------------------------------
 *
 * A tooltip is a hover, and half of this console is read on a phone where
 * there is no hover. The other half of the time it is a definition somebody
 * wants to keep on screen while they look at the thing it defines, which a
 * tooltip actively prevents by vanishing.
 *
 * So it is a disclosure: the term stays put, the definition appears under it,
 * and it stays until it is dismissed. Same behaviour with a mouse, a finger or
 * a keyboard, which is one behaviour to get right instead of three.
 */
export function Info({
  term,
  children,
  className,
}: {
  term: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {term}
        <IconInfo className="size-3 shrink-0" />
        <span className="sr-only">{open ? "Hide the definition" : "What this means"}</span>
      </button>
      {open ? (
        <span
          id={id}
          className="text-muted-foreground border-border bg-muted/50 block rounded-sm border px-2 py-1.5 text-micro leading-relaxed font-normal normal-case"
        >
          {children}
        </span>
      ) : null}
    </span>
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
  count,
  description,
  actions,
  children,
  className,
}: {
  /** Anchor, so a count elsewhere on the page can point at the list. */
  id?: string;
  title?: string;
  /**
   * How many things are in it, beside the title.
   *
   * "Departments" is a heading; "Departments 6" is one an operator can act on
   * without opening it, and "Departments 0" is the answer to the question they
   * came with. Rendered even at zero — a section that is empty is a fact, and
   * the panel is showing its empty state directly underneath either way.
   */
  count?: number;
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
            <h2 className="text-body font-semibold tracking-tight">
              {title}
              {count === undefined ? null : (
                <span className="text-muted-foreground tnum ml-1.5 font-normal">{count}</span>
              )}
            </h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-caption leading-relaxed">
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
      <dt className="text-muted-foreground text-micro tracking-[0.04em] uppercase">
        {label}
      </dt>
      <dd className={cn("text-title break-words", mono && "font-mono tnum text-body")}>
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
      <p className="text-title font-medium">{title}</p>
      {hint ? (
        <p className="text-muted-foreground max-w-sm text-caption leading-relaxed">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Failed({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-stopped text-title font-medium">Could not load this</p>
      <p className="text-muted-foreground max-w-md text-caption leading-relaxed">{message}</p>
      {retry ? (
        <button
          onClick={retry}
          className="border-border hover:bg-muted mt-1 rounded-sm border px-3 py-1.5 text-caption font-medium transition-colors"
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
