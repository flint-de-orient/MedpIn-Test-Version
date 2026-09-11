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

      {/*
        The illustration, framed rather than bled.

        Its own background is a near-white, which on the pale panel in light is
        very nearly seamless and on the dark panel would be a bright rectangle
        with a hard edge. A rounded frame and a hairline make that a deliberate
        image in both themes instead of an accident in one.

        `width`/`height` are the real pixel dimensions of the file so the
        browser reserves the box before it loads — without them the panel
        reflows when the image arrives, which on a sign-in screen moves the
        form somebody is already reaching for.

        Not `next/image`: this console is a static export, and the loader adds
        configuration for a single decorative asset that is already 26KB.
      */}
      <img
        src="/entry-illustration.webp"
        alt=""
        // Decorative. Everything it depicts is said in words above it, and a
        // description read aloud before a sign-in form is an obstacle.
        aria-hidden
        width={928}
        height={506}
        className="border-border/60 mt-12 w-full rounded-lg border"
      />
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
