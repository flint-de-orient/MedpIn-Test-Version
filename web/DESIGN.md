# MedPin operator console — design system

The web admin console at `admin.medpin.in`. This document covers the console
only; `PROJECT_STATUS.md` at the repository root covers the backend and the
Flutter app as well.

Current at `60d07a6`.

---

## What this console is

A platform operator's control room. It creates practices, decides whether they
may operate, manages subscriptions, and reads audit trails.

**It holds no patient records, and that is enforced rather than intended.** A
test refuses any import of a clinical model into the admin routes, and a second
one refuses any clinical route from writing into the platform audit log. Where
the console needs to know how many patients a practice has, it gets a count
through a service that has no function capable of returning an identity.

That boundary is the most important thing about this surface. Everything below
is in service of an operator being able to act on a practice quickly and
correctly, without ever being handed a patient's name.

---

## On the reference material

Reference dashboards are a **quality bar, not a palette**. The one supplied is
violet, heavily gradient, and generously rounded. MedPin is `#003399` on a
near-white ground with 6px radii and almost no gradient anywhere.

Taking the polish and leaving the palette is deliberate, and the brief says so:
where a reference and the product conflict, the product wins. What is worth
taking from a reference of that quality:

- Density that stays readable — a lot of information without crowding
- One accent doing the work, everything else neutral
- Numbers set large enough to scan and aligned so they can be compared
- Cards that group rather than decorate
- Motion you notice only when it is absent

What is worth leaving:

- Gradient fills on cards and bars
- Large radii, which read as playful rather than precise
- Colour used decoratively rather than semantically
- Emoji in interface chrome

---

## Colour

Every colour is a token. There are **zero hardcoded hex values** in `src/`
outside `globals.css`, and that is the property to preserve — a colour typed
into a component is a colour that will not follow the theme.

### Brand

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--primary` | `#003399` | `#4da3ff` | The accent. Buttons, links, the active nav edge, focus rings. |
| `--primary-foreground` | `#ffffff` | — | Text on the accent. |
| `--accent` | `#f0f7ff` | — | The tint behind an active nav item. |
| `--accent-foreground` | `#003399` | — | Text on that tint. |
| `--ring` | `#003399` | — | Focus outline. Same as primary on purpose: focus is the brand paying attention. |

`#003399` is ClinQ's blue and comes from the mobile app. The dark theme lifts it
to `#4da3ff` because `#003399` on `#141719` fails contrast — a brand colour that
cannot be read is not a brand colour.

### Ground and text

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | `#fbfcfd` | `#141719` | The page. Not pure white: a fractionally cool ground lets a white card sit on it. |
| `--card` | `#ffffff` | `#16202b` | Panels. |
| `--foreground` | `#111827` | `#e6edf3` | Primary text. |
| `--muted-foreground` | `#545e72` | `#a3b2c0` | Secondary text, labels, hints. |
| `--secondary` | `#f2f5f8` | — | Hover fills, quiet buttons. |
| `--muted` | `#f7f9fb` | — | Skeletons, inert fills. |
| `--border` | `#dde3ea` | — | Hairlines. |
| `--border-strong` | `#cbd4de` | — | Where a border must be seen rather than felt. |

### Status

Three states, each with a fill and an ink so a badge reads on its own tint.

| State | Colour | Tint | Ink | Means |
|---|---|---|---|---|
| `ok` | `#076b3c` | `#e3f5ec` | `#064e3b` | Active, verified, paid, settled |
| `waiting` | `#d97706` | `#fef3c7` | `#78350f` | Pending, onboarding, retrying, nearly full |
| `stopped` | `#b91c1c` | `#fde8e8` | `#7f1d1d` | Suspended, rejected, halted, failed, full |
| `destructive` | `#b91c1c` | — | — | Actions that take something away |

Dark theme lifts all three (`#34d399`, `#f59e0b`, `#f87171`) for the same
contrast reason as the brand.

**Colour is never the only carrier.** Every status pill has a word in it. A
practice awaiting verification is not an amber dot; it is an amber pill reading
"pending", beside a 3px amber edge on its row. Anyone who cannot separate amber
from green still reads the word.

---

## Type

Seven steps, and no eighth. Declared in `@theme`, so they are real utilities.

| Utility | Size | Line height | Used for |
|---|---|---|---|
| `text-micro` | 11px | 1.45 | Table headers, badges, section labels |
| `text-caption` | 12px | 1.5 | Hints, secondary detail, pagination |
| `text-body` | 13px | 1.55 | The workhorse |
| `text-title` | 15px | 1.4 | Card and row titles |
| `text-heading` | 17px | 1.35 | Section headings |
| `text-display` | 20px | 1.25 | Page titles |
| `text-metric` | 24px | 1.1 | A figure on a KPI card, or a code being typed |

Named for the job rather than the size, so a step can be retuned without a
rename: `text-body` survives 13px becoming 13.5.

Line heights ride with the size. A dense table and a paragraph of explanation
want different leading, and setting it per call site is how two rows that look
identical end up different heights.

**`metric` is a step rather than a fold.** A number on a KPI card and a one-time
code being typed into a box are the same job — a figure read at a glance — and
neither is body text at any size.

### What was here before

Colour was tokenised and type was not: 57 uses of `text-[13px]`, 35 of
`text-[11px]`, then 10px, 14px and 17px, alongside Tailwind's own `text-xs`
through `text-2xl`. Ten sizes on screen, each chosen per component. Nothing was
individually wrong, which is exactly why the console read as slightly
unfinished — the numbers disagreed with each other rather than with any rule.

`src/components/ui/` is shadcn and keeps its own conventions. Rewriting it would
turn every future upstream diff into a merge conflict for a one-pixel gain.

---

## Shape and depth

| | |
|---|---|
| `--radius` | `0.375rem` (6px) base, with `sm`/`md`/`lg`/`xl` derived |
| Panels | rounded, one hairline, no shadow |
| Modals and popovers | the only elevated surfaces |

The hierarchy is **flat → hairline → elevated**, and only dialogs reach the
third level. Cards belong to the page rather than floating above it: a console
where everything is elevated has no way left to say "this one is on top".

---

## Motion

| Kind | Duration |
|---|---|
| Colour, hover, focus | 150ms |
| Layout — the sidebar collapse | 200ms |
| Drawer | 150ms |

`prefers-reduced-motion: reduce` collapses every transition to `0.01ms` in one
global rule, so anything added later inherits it without anybody remembering
to. Nothing in the console depends on motion to be usable.

---

## Layout

```
┌──────────────┬────────────────────────────────────────────┐
│              │  Top bar — search, notifications, account   │
│   Sidebar    ├────────────────────────────────────────────┤
│   15rem      │                                            │
│   or 4rem    │  Page — max 80rem, centred                 │
│   collapsed  │                                            │
├──────────────┴────────────────────────────────────────────┤
│  Footer — what this console is, and what it does not hold │
└───────────────────────────────────────────────────────────┘
```

The sidebar collapses to a 64px rail on `lg` and above, remembered in
`localStorage` because it is a preference rather than a mode. Below `lg` it is a
drawer, because at that width the content needs the whole screen.

**The collapse toggle sits at the foot, not the header.** In the header it had
nowhere to live once collapsed — the rail is a centred logo and 64px — so the
control that got you in would not have got you out.

Collapsed, section headings become a rule rather than disappearing: the grouping
is information, and losing it turns seven icons into one list. The label stays
the accessible name via `aria-label`, because a rail of unlabelled icons is
unusable with a screen reader and `title` alone does not fix that.

---

## Pages

| Route | What it is |
|---|---|
| `/` | Overview — what needs attention, recent activity |
| `/practices` | The register, and every practice's detail |
| `/billing` | Revenue, the subscription queue, the plan reference |
| `/analytics` | Platform figures and trends |
| `/audit` | Everything anybody did |
| `/admins` | Who else can do all this |
| `/account` | Your own sign-in and second factor |

### The register

Filtered, sorted and paged **on the server**. It used to return every practice
and filter in the browser — correct at two practices, and a failure that arrives
silently as the payload and the table grow together.

The search box waits 250ms before asking, so a typed word is one request rather
than one per keystroke. The total travels with the page: "25 of 312" answers
something a pair of arrows cannot — whether a filter matched almost everything
or almost nothing.

Desktop renders a table; below `md` it renders cards. Not a shrunken table —
a different layout for a different width.

---

## States

Every data page has all four. A blank page while waiting is indistinguishable
from a broken build.

**Loading** — skeletons shaped like the content, never a bare spinner, never an
empty box holding space.

**Empty** — says what is missing, why, and what to do. It also distinguishes
*filtered to nothing* from *nothing exists*, because those need different
actions:

> **Nothing matches those filters** — Clear them to see the whole register.
>
> **No practices yet** — Add the first one. It arrives onboarding and
> unverified; creating a practice is not vouching for it.

**Error** — human, with a retry. Never a status code as the headline.

**Empty that is informative stays.** "No practice has a cap" is the answer an
operator came for; hiding it would make a real state look like a missing panel.

---

## Rules worth not breaking

**No fake data, ever.** A console that invents a figure to look populated is a
console nobody can trust with a real one. Where a number is unknown it renders
an em dash and the panel says why — a revenue figure of ₹0 during a provider
outage is indistinguishable from a business that has lost every customer.

**Null is not zero.** An uncapped practice shows "No limit", never "0". Read as
zero it means the opposite of what is true.

**Destructive actions require a reason.** Suspension, rejection and every manual
billing action take free text that lands in the audit log beside the before and
after. Six months later, the reason is what a review reads.

**One component, reused.** `Panel`, `Stat`, `Pill`, `Alert`, `Empty`, `Failed`,
`Loading`, `Modal`, `Field`. A second card with slightly different padding is
how a design system dies.

**The active nav marker is an edge, not a fill.** It survives being scanned past
at speed in a way a background tint does not.

---

## Building

```bash
cd web
npm run build          # must succeed before deploying
npx tsc --noEmit       # types
./deploy.sh root@<vps> # builds, ships, reloads Apache
```

`deploy.sh` uploads the CSP policy **before** the site. The policy names the
SHA-256 hashes of that build's inline scripts, so an old policy against a new
page refuses the scripts it does have — which looks like a broken app and reads
nowhere except the browser console. A new policy against an old page refuses
scripts it does not have, which is harmless. Only one of those orders is safe.

The server runs **Apache**. nginx is installed and stopped and must stay
stopped; starting it collides on 80 and 443 and takes down every site on the
box.
