/**
 * The icon set, drawn here rather than installed.
 *
 * Every glyph at one stroke weight on one grid. A library would be 1,500 of
 * them at a weight chosen by somebody else, and the tell of a template is not
 * that icons exist — it is that they were picked from a sheet rather than
 * chosen for the thing they label.
 *
 * All 24×24, 1.5 stroke, round caps, `currentColor`. `aria-hidden` throughout:
 * every one of these sits beside its own label, and an icon that is announced
 * as well makes a screen reader say everything twice.
 */

type Props = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconOverview = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 13h5l2-6 3 12 2.5-8 1.5 2h4" />
  </svg>
);

/** A clinic: a building with a cross. Not a hospital bed — these are practices. */
export const IconPractice = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 21V6.5a1 1 0 0 1 .6-.9l6-2.5a1 1 0 0 1 1.4.9V21" />
    <path d="M12 9h7a1 1 0 0 1 1 1v11" />
    <path d="M2 21h20M14.5 13.5h2M15.5 12.5v2" />
    <path d="M7.5 8v2.5M6.25 9.25h2.5" />
  </svg>
);

export const IconAnalytics = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 15l4-5 3 3 5-7" />
  </svg>
);

/** A shield with a clock hand: what happened, and that it is kept. */
export const IconAudit = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 22s8-3.5 8-10V5.5L12 2 4 5.5V12c0 6.5 8 10 8 10Z" />
    <path d="M12 8.5V12l2.2 1.6" />
  </svg>
);

export const IconAdmins = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.2" />
    <path d="M17.5 14.2a4 4 0 0 1 4.5 4V20M16.5 4.4a3.2 3.2 0 0 1 0 5.9" />
  </svg>
);

/**
 * Patients: a pulse, not a chart.
 *
 * The obvious glyph is a clipboard, and it would be a lie — this console holds
 * no clinical record and the whole argument for putting it on its own host is
 * that it does not. A heart with a trace through it counts people under care
 * without implying anything here can read about them.
 */
export const IconPatients = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 20.6C12 20.6 4.5 16 4.5 10.5A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.5-7.5 10.1-7.5 10.1Z" />
    <path d="M4.9 11.6h3.2l1.3-2.6 2.1 5.4 1.5-3.3 1 1.5h5" />
  </svg>
);

/** A location: a pin. The product is called MedPin. */
export const IconPin = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10.2" r="2.6" />
  </svg>
);

export const IconAccount = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const IconSearch = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconBell = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconAlert = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 3.5 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3.5Z" />
    <path d="M12 9.5v4M12 17.2h.01" />
  </svg>
);

/** A caution triangle. The glyph on a banner that is not an error. */
export const IconWarning = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.3v4.2M12 16.9h.01" />
  </svg>
);

/** An i in a ring, for a definition somebody can open and close. */
export const IconInfo = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.2v-4.6M12 8.2h.01" />
  </svg>
);

export const IconCheck = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const IconChevron = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconMenu = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconSun = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);

export const IconMonitor = ({ className }: Props) => (
  <svg {...base} className={className}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="1.6" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </svg>
);

export const IconEye = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconEyeOff = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M9.9 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6" />
    <path d="M6.3 7.3A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4-.85" />
    <path d="M10 10a2.9 2.9 0 0 0 4 4" />
    <path d="m3.5 3.5 17 17" />
  </svg>
);

/**
 * A ring that turns, for a button waiting on the network.
 *
 * Its own component because a disabled button with changed text says the click
 * registered and says nothing about whether anything is still happening — which
 * on a slow connection is the moment somebody clicks again.
 */
export const Spinner = ({ className }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The MedPin mark — the real one, not a redraw.
 *
 * An M formed by a figure whose arms close around a heart, navy over the brand
 * light blue. It is two colours by design, so it cannot be an SVG taking
 * `currentColor` without flattening the thing that makes it recognisable, and
 * it is drawn well enough that tracing it by hand would only produce a slightly
 * wrong version of a file that already exists.
 *
 * Served from `public/`, copied from `mobile/assets/brand/` — the same file the
 * phone app ships, so the two cannot drift into two nearly-identical logos.
 */
export const Logo = ({ className }: Props) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/medpin-emblem.png"
    alt=""
    aria-hidden
    className={className}
    // Explicit, so the sidebar does not reflow on a slow load and shove the
    // navigation down by 22 pixels as the image arrives.
    width={346}
    height={399}
  />
);

/** The full lockup, for the sign-in screen where there is room for it. */
export const Wordmark = ({ className }: Props) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/medpin-logo.png"
    alt="MedPin"
    className={className}
    width={700}
    height={256}
  />
);
