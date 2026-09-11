"use client";

import { Logo, Wordmark } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The two halves of the way in.
 *
 * ---- Why the left panel is not decoration -------------------------------
 *
 * This console is reached at a bare domain by two audiences who must not be
 * confused with one another: MedPin's own operators, and the practices they
 * administer. The panel says which product this is and who runs it, before
 * anybody types an address into a box.
 *
 * It is the one place in this console where a page is doing any persuading at
 * all, and it collapses on a phone — a sign-in form on a 360px screen is a
 * sign-in form, and a marketing column above it is something to scroll past.
 */
export function EntryShell({ children }: { children: React.ReactNode }) {
  // `min-h-dvh`, not `min-h-full`: a percentage height resolves against an
  // ancestor chain that has to be height-resolved the whole way up, and the
  // dynamic viewport unit depends on nothing above it. `h-screen` is the static
  // variant and leaves a strip of background under a phone address bar that has
  // slid away.
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <BrandPanel />

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center lg:px-10">
        {/*
          One landmark on the page, and the form inside it. `max-w` rather than
          a fixed width so a long validation message wraps instead of widening
          the card past its column.
        */}
        <div className="w-full max-w-[27rem]">{children}</div>
      </main>
    </div>
  );
}

/**
 * What MedPin is, for whoever has arrived at a bare domain.
 *
 * Hidden below `lg`. Not collapsed to a banner: a shortened version of a
 * persuasive column is a thing that takes up space on a phone and persuades
 * nobody, and the header above the form already carries the mark.
 */
function BrandPanel() {
  return (
    <aside
      // Decorative in the accessibility tree on small screens it does not
      // render at all, and on large ones it repeats nothing the form needs.
      aria-label="About MedPin"
      /*
        Stays put while the form scrolls.
        
        The registration is five steps and the tallest of them runs well past a
        laptop viewport. Without this the panel stretched to match it, which
        pushed the illustration hundreds of pixels below the fold and left a
        column of empty tint beside the fields — the brand argument visible
        only to somebody who had already decided to scroll past it.
        
        `max-h-dvh` with its own scroll, so a short viewport can still reach the
        bottom of the panel rather than clipping it.
      */
      className="bg-accent/60 border-border hidden shrink-0 flex-col justify-between border-r px-10 py-12 lg:sticky lg:top-0 lg:flex lg:max-h-dvh lg:w-[42%] lg:max-w-[34rem] lg:overflow-y-auto"
    >
      <div>
        <div className="flex items-center gap-3">
          <Logo className="size-9" />
          <Wordmark className="h-7 w-auto" />
        </div>
        <p className="text-muted-foreground mt-2 text-caption tracking-[0.04em]">
          Healthcare Operations Platform
        </p>

        <h1 className="text-foreground mt-10 max-w-[18ch] text-[1.75rem] leading-[1.2] font-semibold tracking-tight">
          Smarter operations for better healthcare
        </h1>
        <p className="text-muted-foreground mt-4 max-w-[44ch] text-body leading-relaxed">
          MedPin helps healthcare practices and the operators who support them
          run the day: registration, consultations, prescriptions and the plan
          behind them.
        </p>

        <ul className="mt-9 flex flex-col gap-6">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <span className="text-primary mt-0.5 shrink-0">{p.icon}</span>
              <span>
                <span className="text-foreground block text-title font-semibold">
                  {p.title}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-caption leading-relaxed">
                  {p.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Clinic className="text-primary mt-12 w-full" />
    </aside>
  );
}

/**
 * Three claims, and every one of them is something the product does.
 *
 * "Trusted by 500+ clinics" is the sentence that belongs here in a template
 * and it would be invented. These describe the console the reader is about to
 * sign into.
 */
const POINTS = [
  {
    title: "Separated by practice",
    detail: "Every record belongs to one clinic, and no query crosses that line.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
        <path
          d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6L12 3Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Decisions, on the record",
    detail: "Every operator action is logged with who, what changed, and why.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
        <path
          d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "No patient records here",
    detail: "This console holds practices, plans and counts — never a chart.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
        <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.6 5.6 0 0 0-2.2-4.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

/**
 * A building, drawn flat and quiet.
 *
 * Two tints of the brand and nothing else — no gradients, no shadow, no
 * perspective. It is scenery at the foot of a column, and scenery that tries
 * is the thing that makes a page look bought rather than built.
 */
function Clinic({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 120"
      fill="none"
      aria-hidden
      className={cn("h-auto", className)}
    >
      <g opacity="0.18" fill="currentColor">
        <rect x="8" y="56" width="46" height="52" rx="2" />
        <rect x="300" y="48" width="52" height="60" rx="2" />
        <rect x="62" y="72" width="30" height="36" rx="2" />
        <rect x="270" y="68" width="24" height="40" rx="2" />
      </g>

      <g opacity="0.34" fill="currentColor">
        <rect x="112" y="34" width="136" height="74" rx="3" />
        <rect x="96" y="62" width="18" height="46" rx="2" />
        <rect x="246" y="62" width="18" height="46" rx="2" />
      </g>

      {/* The one mark that says what kind of building it is. */}
      <g opacity="0.9" fill="currentColor">
        <rect x="172" y="46" width="16" height="5" rx="1" />
        <rect x="177.5" y="40.5" width="5" height="16" rx="1" />
      </g>

      <g opacity="0.2" fill="currentColor">
        <rect x="126" y="66" width="16" height="14" rx="1.5" />
        <rect x="152" y="66" width="16" height="14" rx="1.5" />
        <rect x="192" y="66" width="16" height="14" rx="1.5" />
        <rect x="218" y="66" width="16" height="14" rx="1.5" />
        <rect x="126" y="88" width="16" height="14" rx="1.5" />
        <rect x="152" y="88" width="16" height="14" rx="1.5" />
        <rect x="218" y="88" width="16" height="14" rx="1.5" />
      </g>

      <rect x="186" y="88" width="22" height="20" rx="1.5" fill="currentColor" opacity="0.42" />
      <rect y="108" width="360" height="1.5" rx="0.75" fill="currentColor" opacity="0.22" />
    </svg>
  );
}

/**
 * Which of the two audiences is signing in.
 *
 * A tab rather than a link: both live at the same address, and the operator
 * who lands here every morning should not have to navigate to reach the one
 * they always use. Admin is first and default because this is the operator
 * console — the practice side is the guest here.
 *
 * `role="tablist"` with real arrow-key movement, because a row of buttons that
 * looks like tabs and does not behave like them is worse for somebody on a
 * keyboard than a row of buttons that looks like buttons.
 */
export function AudienceTabs({
  value,
  onChange,
}: {
  value: "admin" | "practice";
  onChange: (v: "admin" | "practice") => void;
}) {
  const order: ("admin" | "practice")[] = ["admin", "practice"];

  return (
    <div
      role="tablist"
      aria-label="Who is signing in"
      /*
        Stacked on a phone, side by side from `sm`.
        
        "Admin / Operator" in a half-width button at 360px is two lines of
        11px or a mid-word break. Two full-width rows read at a glance and
        give a thumb something the size of a thumb.
      */
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const i = order.indexOf(value);
        onChange(order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length]);
      }}
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active}
            aria-controls={`panel-${tab.key}`}
            // Only the selected tab is in the tab order; the arrows move
            // between them. This is what makes a tablist one stop rather than
            // one stop per tab.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={cn(
              "focus-visible:ring-ring flex items-center justify-center gap-2 rounded-md border px-4 py-3",
              "text-body font-medium transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            <span className="shrink-0">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

const TABS = [
  {
    key: "admin" as const,
    label: "Admin / Operator",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M5 20a7 7 0 0 1 14 0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: "practice" as const,
    label: "Practice",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M4 20V8.5L12 4l8 4.5V20"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M10 12h4M12 10v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M9.5 20v-4h5v4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
];
