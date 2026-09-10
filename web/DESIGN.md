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

## Themes

Three modes, and **system is the default** — a console nobody has expressed a
preference about follows the machine it is on.

| Mode | What it does | Stored as |
|---|---|---|
| `light` | Forces light | `medpin-admin-theme = "light"` |
| `dark` | Forces dark | `medpin-admin-theme = "dark"` |
| `system` | Follows `prefers-color-scheme`, and keeps following it | the key is **removed** |

`system` is the absence of a stored value rather than the string `"system"`.
Anything unreadable — a cleared key, a private window, a corrupted value —
lands on `system`, which is the right answer to "we do not know what they want".

The toggle cycles light → dark → system. Its label and `aria-label` name the
**current** state and the next one: *"Theme: Dark. Switch to system."* A button
labelled "Dark" that turns dark off is a coin toss every time it is pressed.

### How dark is applied

A single `.dark` class on `<html>`, toggled in JavaScript. Not a
`@media (prefers-color-scheme: dark)` block, because a media query cannot be
overridden by somebody who wants light on a dark machine — and that override is
the whole point of having three modes rather than two.

Every token is redefined under `.dark`. Nothing in a component branches on
theme; a component that asked which theme it was in would be a component that
gets it wrong somewhere.

### Following the system means following it as it changes

In `system` mode a `matchMedia` listener stays attached, so a laptop that
switches to dark at sunset takes the console with it. Reading the preference
once at load and stopping would be following the system *as it was*, which is a
different and less useful thing.

The listener is removed when the mode is not `system`.

### No flash of the wrong theme

`THEME_BOOTSTRAP` runs as a blocking script in `<head>`, before React and before
first paint, and sets the class from storage. Without it the first paint is
light and then corrects itself, which on a dark-mode machine is a white flash in
a dark room.

`<html>` carries `suppressHydrationWarning` because that script has already
changed the DOM by the time React arrives — the mismatch is intended, and
warning about it would train somebody to ignore real ones.

### Storage, and why this one is allowed

The theme is the one thing in this console that goes in `localStorage`. The
argument against storing a session token does not extend to which colours
somebody likes, and re-picking dark mode on every visit would be its own small
insult.

Every access is wrapped: a private window or a browser set to block site data
throws on the accessor itself, and a theme toggle must not be able to take the
console down with it. When a write fails the toggle still worked for that tab,
which is most of the value.

### Contrast in dark

Dark is not light inverted. Four tokens are deliberately lifted rather than
flipped, because the light values fail contrast on a dark ground:

| Token | Light | Dark | Why |
|---|---|---|---|
| `--primary` | `#003399` | `#4da3ff` | `#003399` on `#141719` is unreadable. A brand colour that cannot be read is not a brand colour. |
| `--ok` | `#076b3c` | `#34d399` | A dark green disappears into a dark card. |
| `--waiting` | `#d97706` | `#f59e0b` | Amber needs lifting to stay amber. |
| `--stopped` | `#b91c1c` | `#f87171` | Dark red on dark reads as brown. |

The grounds are not pure either: `#141719` rather than black, and cards at
`#16202b` — a fractionally blue card on a neutral ground gives the same
separation in dark that `#ffffff` on `#fbfcfd` gives in light, without a border
doing all the work.

### Testing a change

Any colour change has to be checked in **all three**, and system twice — once
with the OS in light and once in dark. The mode that breaks is usually system,
because it is the one nobody sets deliberately and therefore the one nobody
looks at.

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

Seven routes. Each one below lists what it reads, what it composes, what it
lets an operator do, and the decisions that are not obvious from the markup.

---

### `/` — Overview

**Reads** `GET /admin/overview`, `GET /admin/practices`

**Composes** two `Panel`s, an `Alert`, `Attention`, `Metrics`

The first question an operator has is "what needs me today", so the page answers
that before it answers anything else. Metric tiles across the top, then what is
waiting, then what recently happened.

**Attention is derived, never stored.** A dismissible notification table would
need a rule for when something comes back, and the honest rule is "when it is
still true" — which is what recomputing already means. Every item carries the
link that acts on it: an alert that cannot be acted on from where it appears is
a worry rather than a task.

The attention panel shows a skeleton while loading, not an empty render. Those
look identical and mean opposite things — "still asking" versus "nothing needs
you" is the single distinction this panel exists to draw.

**Empty here is success.** "Nothing is waiting on you — every practice is
decided and every administrator has a second factor" is an `ok`-toned `Alert`,
not an `Empty`. Reaching zero is the goal, and rendering it as an absence would
make the good state look like a missing panel.

---

### `/practices` — The register, and every practice

**Reads** `GET /admin/practices` (list) · `GET /admin/practices/:id` (detail)

**Writes** `PATCH /admin/practices/:id/status` · `/verification` · `/plan`

**Composes** 7 `Panel`s, 5 `Stat`s, 3 `Empty`s, 2 `Alert`s, plus
`PracticeRegister`, `NewPracticeDialog`, `PlanDialog`, `MemberDialog`,
`EditPractice`

The largest page in the console, and two screens in one file: `?id=` shows the
detail, its absence shows the register.

**The register** filters, sorts and pages on the server. It used to fetch every
practice and filter in the browser — correct at two practices, and a failure
that arrives silently as the payload and the table grow together. The search box
waits 250ms before asking, so a typed word is one request rather than one per
keystroke.

Filters write to the URL, so a filtered view is a link. Sort options are
"Needs attention first" (the default), newest, by name, and most staff. The
default is not alphabetical because the console is opened to find out what needs
doing, not to browse an alphabet.

The total travels with the page. "25 of 312" answers something a pair of arrows
cannot — whether a filter matched almost everything or almost nothing.

Desktop renders a table, below `md` a list of cards. A different layout for a
different width, not a shrunken table. Practices awaiting a decision carry a 3px
`waiting` edge in both.

**Two empty states, because they need different actions.** "Nothing matches
those filters" offers *Clear filters*; "No practices yet" offers *Add a
practice* and says what creating one means — it arrives onboarding and
unverified, because creating a practice is not vouching for it.

**The detail** is sections rather than tabs: Decisions, then locations,
departments, people, usage, plan, notes. Tabs were not used because they hide
what an operator is scanning for.

**Verification and suspension both require a typed reason.** They stop people
working, and six months later the reason is what a review reads. The
confirmation names the consequence rather than asking "are you sure".

The plan panel shows where a plan came from — `granted, not billed` where nobody
is paying, or the subscription's status — because two things write
`practice.plan` now and the plan alone no longer says which.

---

### `/billing` — Money

**Reads** `GET /admin/billing/revenue` · `/plans` · `/subscriptions`

**Composes** 6 `Panel`s, 4 `Stat`s, 2 `LineChart`s, an `Alert`

Four tiles — MRR, ARR, Active, ARPU — then charts, then the subscription queue,
then the plan reference.

**Every money figure is an em dash when unknown, never ₹0.** A revenue figure of
nothing during a Razorpay outage is indistinguishable from a business that has
lost every customer, on the morning that is hardest to check. The panel says why
underneath rather than leaving a blank that reads as broken.

**MRR and "Collected" are kept apart and labelled apart.** MRR projects what
active subscriptions would bill; Collected is a fact from the payment ledger. A
dashboard that blurs them is one where nobody can tell a good month from an
optimistic one.

**Started and cancelled are two lines, not one netted line.** A net zero can be
a quiet month or five customers replaced by five others, and those need
different conversations.

ARPU carries the `waiting` tone whenever anything is halted, because a failing
card is not revenue and ARPU would otherwise be the last figure to move.

**The queue is a queue.** Status filters run across the top and "Payment failed"
is one click away, because an unfiltered list of subscriptions is neither a
support queue nor a revenue figure. A practice billed for one plan while sitting
on another is lifted out of the list into a banner.

**The plans panel is read-only, and says so on the page.** There is no "New
plan" because a tier is an enum entry that gates capabilities plus an immutable
Razorpay object — a row written from a web form would be a plan the resolver has
never heard of, and unknown means unrestricted. What the panel answers is the
question support actually gets: what does Professional include and what does it
cost.

Revenue and plans load separately from the queue, so a provider outage costs the
price column rather than the work.

---

### `/analytics` — Platform figures

**Reads** `GET /admin/analytics?months=N`

**Composes** 4 `Panel`s, `LineChart`, 2 `Empty`s

Growth over time, and which practices are near a cap. The range is selectable in
months.

`LineChart` lives in `components/charts.tsx` and is shared with `/billing` — a
chart redrawn per page is two charts that disagree about their axis the first
time one is tuned.

**Every chart carries a table under it.** An SVG is unreadable to a screen
reader and unusable to anybody who wants the number rather than the trend, and
this console is operated by people doing support.

**"No practice has a cap" is informative and stays.** It is the answer an
operator came for — every practice is unlimited until somebody types a number
into a plan — and hiding it would make a real state look like a missing panel.

---

### `/audit` — Everything anybody did

**Reads** `GET /admin/audit?…` · `GET /admin/audit/actions`

**Composes** 1 `Panel`, `Empty`, `Failed`, `Loading`

The action list is fetched rather than hardcoded, so a filter cannot fall behind
the actions the server records.

Reads are logged as well as writes. "Who looked" is the half of an audit trail
usually missing, and an administrator listing every practice on the platform is
doing something worth a record.

Entries carry before and after where a value changed, and the typed reason where
one was required. "The trial was extended" without the old date cannot be
reviewed, only believed.

---

### `/admins` — Who else can do all this

**Reads** `GET /admin/admins`

**Composes** 1 `Panel`, 2 `Modal`s, `Empty`, `Failed`, `Loading`

A short list nobody looks at until something has gone wrong, at which point it
is the first question.

**The column that matters is the second factor.** "Who can suspend a practice
with a password alone" is the useful form of it. An administrator with a passkey
and no authenticator app is protected and is not warned — telling them otherwise
is a warning about something they have already done, which teaches them to
ignore the section.

Deactivating an administrator requires a reason. There is no delete: what they
did stays on the audit trail, so the account is deactivated rather than removed.

---

### `/account` — Your own sign-in

**Reads** `GET /admin/me/totp/setup` when enrolling

**Composes** 5 `Panel`s, 2 `Alert`s, `PasskeyPanel`

Password, two-factor, passkeys, email verification.

**The console nags about a missing second factor on every other page and not on
this one.** Here it would be a banner pointing at the button underneath it.

Enrolment shows the secret as a QR code and as text, because a QR code is
unusable to somebody signing in on the machine displaying it.

The TOTP code input is `text-metric` and mono with wide tracking — a code being
typed is a figure read at a glance, not body text.

While the session resolves the page renders a skeleton shaped like its own
content. It used to return `null`, which on a slow connection is a blank page
beside a sidebar — indistinguishable from a broken build.

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
