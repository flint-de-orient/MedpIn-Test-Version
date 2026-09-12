# MedPin — UI Design Specification

**What this document is.** The visual and structural specification for every
screen MedPin ships, panel by panel, tab by tab, with the role and department
variations spelled out. It is written to be handed to a designer or a Flutter
engineer and acted on without further questions.

**What it is not.** It is not a wishlist. Every screen listed exists in
`mobile/lib` or `web/src`, and every data point named in a composition spec is
something the API already answers. Where a design would need data that does not
exist, the document says so instead of specifying it — that rule is the reason
this app does not have a fake ECG on its cardiology dashboard.

Read against the code on **12 September 2026**.

---

# PART 0 — FOUNDATIONS

Everything in Parts 1–7 assumes these. A screen that invents its own value is a
screen that makes the whole product read as amateur, and it is caught by
`mobile/tool/verify_tokens.dart`.

## 0.1 The scale

All of it lives in `mobile/lib/core/theme/tokens.dart` as `T`. Nothing outside
the theme files invents a value.

**Spacing — a 4px grid, eight steps and no others.**

| Token | Value | Used for |
| --- | --- | --- |
| `s1` | 4 | Icon to its own label; chip internals |
| `s2` | 8 | Label above a value; adjacent chips |
| `s3` | 12 | Default gap between siblings in a list or grid |
| `s4` | 16 | Card padding; the screen's side margin |
| `s5` | 20 | Generous padding, for the one card leading a screen |
| `s6` | 24 | Between distinct blocks of content |
| `s8` | 32 | Between sections about different things |
| `s12` | 48 | Breathing room above a screen's primary action |

If a gap "needs" 13, it needs 12 or 16. The in-between value is always the eye
asking for something else.

**Type — five sizes, three weights.**

| Token | Size / line-height | Rule |
| --- | --- | --- |
| `display` | 32 / 1.2, w700, −0.8 | One per screen. Says what the screen is *for*: "Enter phone number", not "Welcome back" |
| `name` | 28 / 1.15, w800, −0.6 | A person being addressed, not a thing labelled |
| `metric` | 30 / 1.0, w800, −1.0 | A health figure. Deliberately larger than `title` — on a clinical screen the number is the content |
| `title` | 20 / 1.25, w700, −0.4 | Screen titles; the heading of a leading card |
| `body` | 16 / 1.5, w400 | The floor. Nothing a patient must read goes below this |
| `bodyStrong` | 16 / 1.5, w600 | A name; a row's primary line |
| `small` | 14 / 1.45, w400 | Secondary prose. Muted, never black |
| `label` | 12 / 1.35, w600, +0.2 | Captions, tile labels, pill text |

Line-height falls as size rises. Display type set at body line-height looks
loose, and that is one of the clearest tells of generated UI.

**Colour — one primary, one tint, three greys, three semantics.**

| Token | Hex | Role |
| --- | --- | --- |
| `primary` | `#003399` | The brand, straight from the logo |
| `primaryLight` | `#4890F0` | Interactive states, links, the lit accent |
| `primaryTint` | `#EBF1FB` | Badge and section backgrounds. **Never** a text colour |
| `ink` | `#111827` | Near-black, warmed slightly toward the brand. Not `#000` |
| `inkMuted` | `#545E72` | Secondary text — 6.18:1 on the page |
| `inkFaint` | `#69738A` | Placeholders, the faintest legible tier — 4.50:1 |
| `surface` | `#F7F9FC` | The page |
| `surfaceRaised` | `#FFFFFF` | Cards on the page |
| `line` | `#E5E9F0` | Hairline dividers and card edges |
| `danger` | `#B91C1C` | 5.66:1 on its tint |
| `warning` | `#B45309` | 4.67:1 on its tint |
| `success` | `#076B3C` | 5.88:1 on its tint |
| `dangerTint` / `warningTint` / `successTint` | `#FDECEC` / `#FEF6E7` / `#E7F5EE` | Semantic surfaces at the same ~8% weight as `primaryTint` |

The greys are tinted toward the accent, not Tailwind's stock neutrals, and every
ratio above was measured on the surface the colour actually sits on. The previous
`inkFaint` measured 2.41:1 — it failed AA for body text and failed the 3.0 bar
for large text too, in an app whose type scale has a 16px floor *because* these
readers are elderly. Getting the size right and the colour wrong helps nobody.

**Radius — four, and full-round. Mixing radii is the fastest way to look unfinished.**

`rCard` 12 (rows, tiles) · `rControl` 16 (buttons, inputs, sheets, anything that
reads as a control) · `rLead` 20 (a leading card that must sit apart) ·
`rSection` 24 (a main section card — the only radius a full-width card takes) ·
`rNav` 28 (the navigation pill, one step above `rSection` so the bar reads as
floating *over* the page rather than as another card in the stack) · `rFull`
(avatars, pills, badges).

**Elevation — large blur, low opacity, tinted with the brand rather than black.**
A shadow should be felt, not seen; black shadows at 0.3 are the classic tell.

- `e1` resting: cards and rows
- `e2` raised: the leading card, sheets
- `eAction` a primary button carrying its own brand light

**Touch.** `tap` 48 is the floor and nothing interactive is smaller, ever.
`hControl` 56 is shared by inputs and buttons so a stacked form reads as one
rhythm rather than as boxes of assorted sizes. `hCircle` 44 for an icon-only
header control.

## 0.2 Three surface levels, never four

1. **the page** — `surface`, a very light blue-grey ground
2. **`SectionCard`** — white, `rSection`, one hairline, one soft shadow
3. **`InnerTile`** — `rControl`, a faint wash, no shadow, barely a border

A fourth level is deliberately unavailable. Depth is information, and spending it
on a single number leaves nothing left to say *these things belong together*. The
worst habit these screens had was page → card → card → card, each with its own
border, until every individual fact sat in a box and none of the boxes meant
anything.

**If something inside an `InnerTile` must stand out, it does it with type or
colour, not another box.**

## 0.3 The five states every screen owes

No blank screens. No silently swallowed exceptions. No raw stack traces.

| State | Treatment |
| --- | --- |
| **Loading** | Skeleton at the shape of the content that is coming — not a centred spinner on a screen that had structure a moment ago. A panel of counts skeletons its counts. |
| **Empty — noise** | Hidden. An attention list with nobody in it should not draw a card saying zero. |
| **Empty — informative** | Shown, and stated as a fact: "No glucose readings in the last 14 days". A clinician needs to notice that, and hiding it makes it indistinguishable from still-loading. |
| **Error** | The thing that failed, named, plus **Retry**. "Could not load the team", not "Something went wrong". |
| **Permission denied** | Say what is missing and who can grant it: "Only a doctor can sign a prescription." A person is a conversation with their practice, not a sale. |
| **Plan restriction** | Say what the feature is and that the plan does not include it. Distinguished from the above because one is a sale and the other is not — `Capabilities.withheld()` exists exactly for that. |
| **Offline** | A banner, with a retry path. Reads never blank out; what was fetched stays on screen with its timestamp. |

**The one rule that outranks all of these:** a panel that cannot tell "no
critical results" from "the request has not come back" must say the second, not
the first. "No result came back critical" is a reassuring sentence, and saying it
before the request has returned is saying it without knowing.

## 0.4 Motion

Motion is for continuity, not delight. A clinician between consultations is
reading, not being entertained.

| Where | Duration | Curve |
| --- | --- | --- |
| Tap feedback, ink ripple | 120 ms | standard |
| Card enter, list item stagger | 180 ms, max 40 ms stagger, max 6 items | `easeOutCubic` |
| Tab / branch switch | 220 ms cross-fade, no slide | `easeInOut` |
| Sheet in | 260 ms | `easeOutCubic` |
| Number change on a metric | 400 ms count-up, only on first paint | `easeOutQuart` |
| Chart draw-in | 500 ms, once per mount, never on refresh | `easeOutCubic` |

**Never animate.** A value updating from a poll (it draws the eye to a change
that is not news). A skeleton into content when the skeleton was shown for under
150 ms (flash). Anything on an emergency card.

**Banned outright in this codebase:** fragment-shader `ImageFilter` effects —
they render blank on the clinic's own phones — and overscroll stretch, for the
same reason.

## 0.5 Iconography and copy

- **One icon system**, one size (24 px, 20 px inside a control), one weight,
  outlined. `Icons.*_outlined` throughout.
- **No emoji in UI chrome.** They render in the system font, shift with every OS
  version, and come out at a different weight and baseline from the type beside
  them.
- **One action language.** There is exactly one way to say "go and see the rest
  of it" — `ActionLink`. This app once had "See all", "View all", "View full
  plan" and "+ Add" for the same gesture, in four weights, three colours and two
  alignments. A reader learns one affordance and should not have to re-learn it
  per card.
- **Name a control for what it does.** A button labelled "History" is not where
  anyone looks to *view a prescription*.
- **Capitalisation is consistent across peers.** Sentence case for row titles and
  subtitles; the section label is the only place that takes caps.

## 0.6 Accessibility, non-negotiable here

- Colour is **never** the only carrier. Not a red dot but "Needs attention".
  Diabetic retinopathy is common in these patients and red-green deficiency runs
  alongside diabetes.
- Any fixed height holding text is sized through
  `MediaQuery.textScalerOf(context).scale(...)`. "Needs review" fitted at 1.0 and
  truncated to "Needs revi…" one notch above it, on the one caption that had to
  be unambiguous. Prefer wrapping to ellipsising on short, load-bearing labels.
- `Semantics` on anything tappable that is an icon or a shape.
- 48 px minimum, achieved with padding — never a bare `GestureDetector` on 14 px
  of text.

## 0.7 Horizontal rails

A scroller **always** cuts whatever lands at the edge. Fading the edge only makes
the cut prettier; the content is still hidden.

- **Bounded, known set** (nav chips, filters, quick actions, section tabs):
  do not scroll. `Wrap`, or fit them. A filter you cannot see is a filter you do
  not use. The quick-action bar is a `Wrap` for exactly this reason.
- **Unbounded** (photos, a caseload's meals, a patient's reports): scroll, fade
  the end that has more behind it, and pad both ends so the first and last items
  clear the screen edge instead of sitting flush.

## 0.8 The layout traps that have actually shipped bugs here

Read this before writing a widget. Three separate screens shipped broken from the
first item in one day.

1. **Never size a widget from whatever contains it.** A `Container` with
   `alignment:` and no width expands to fill its constraints — shrink-wrapped and
   correct inside a horizontal `ListView`, full-width and wrong inside a `Wrap`,
   where every chip became a full-width bar. Give a widget its own padding and
   its own minimum height.
2. **`DropdownButton` sizes to its widest item** unless `isExpanded: true`. In a
   narrower parent the child is clipped away entirely and you get a chevron over
   an empty box — correct on a wide form, blank on a narrow one.
3. **`Expanded`/`Flexible` and `Spacer` in one `Row` both take flex** and split
   the free space. A `Flexible` text beside a `Spacer` gets half the row and
   ellipsises with blank space next to it. Use `Expanded` on the thing that
   should grow and no `Spacer`. `mobile/tool/find_flex_conflicts.dart` finds
   these; its one documented false positive is `if (x) Expanded(...) else
   Spacer()`, which is mutually exclusive and fine.
4. **A `Row` overflowing a shrink-wrapping parent's rounded clip silently does
   not draw its last child.** No overflow stripe, no error, no analyzer warning.
   A doctor could not open a prescription for days.
5. **A `Wrap` inside a `SizedBox` of one row's height** overflows onto the
   content beneath it rather than pushing it down.

After moving a widget between layouts, re-check it in both. A clean analyzer
proves nothing about layout — build it, install it, and **look at it**.

---

# PART 1 — HOW A SCREEN IS ASSEMBLED

Understanding this part is what stops a designer specifying a screen the engine
cannot produce.

## 1.1 The resolution order

```
    ┌─────────────┐
    │  Practice   │  type ─────► capability ceiling A
    └──────┬──────┘  plan ─────► capability ceiling B
           │         grant ────► additions, re-checked against A
           ▼
    ┌─────────────┐
    │ Capabilities│  = ALL ∩ A ∩ B ∪ grant
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │    Role     │ ─► permission preset ─► membership grant (stored, editable)
    │             │ ─► capability exclusions (per-role, never overridable)
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │ Department  │ ─► configured widgets / quickActions, or null
    └──────┬──────┘
           │
    ┌──────▼──────────────────────────────────────────┐
    │  composeFor(department, role) — four tiers:      │
    │   1. department configuration                   │
    │   2. role default                               │
    │   3. department default                         │
    │   4. general clinical set                       │
    └──────┬──────────────────────────────────────────┘
           │
    ┌──────▼──────┐
    │  Filter     │  drop unknown ids, then drop what
    │             │  capability / permission does not allow
    └──────┬──────┘
           ▼
      widgets[]  quickActions[]  source
```

`source` comes back on the wire — `'department' | 'role' | 'departmentDefault' |
'general'` — so a person looking at a colleague's different screen can find out
which tier answered without anybody reading source code.

## 1.2 What the server may and may not send

**May send:** component identifiers from `WIDGETS` and `QUICK_ACTIONS` in
`backend/src/services/uiConfig.js`, in order.

**May not send:** layout, sizes, colours, labels, icons, copy, or data. Those are
the app's, and a server that sent them would be a server able to draw anything it
liked on a clinician's phone — which is not a thing a server should be able to
do however well it is behaving today.

**Unknown identifiers are dropped, not rendered as an error.** The two ends
version independently: a phone a release behind will meet a component that did
not exist when it shipped, and the right answer is a slightly shorter dashboard,
not a red screen in front of a patient and not a grey box reading
`CRITICAL_LAB_RESULTS`. The server drops what it does not recognise for the same
reason, so an operator's typo and a stale app fail identically — quietly, and
only in the one panel.

**But a write is refused.** Somebody who mistypes a component name while
configuring a department is told which name was not recognised. Dropping at read
time and refusing at write time is the same decision from both ends: never let a
configuration look as though it took effect when it did nothing.

## 1.3 Absence permits — the rule the whole app rests on

Unknown never narrows. A practice with no type keeps every capability, a
membership with no grant keeps its role's preset, a department with no widget
list gets a default, and a capability set that has not arrived yet is treated as
permissive.

`null` means *not yet known*. `[]` means *the platform's default applies*. Neither
means *denied*.

Read literally, an empty permission array would hand the doctor seeing patients
this morning an empty home screen on the deploy that added the field. Both ends
agree on this, and they have to — or one of them hides what the other permits.

**In the UI this shows up as:** a navigation bar that does not rearrange itself
twice on a cold start, and a button that may appear a moment late rather than
vanishing from under somebody's thumb. A button that turns out not to work is a
worse experience than a slow one; a bar that reflows on every launch is worse
than both.

## 1.4 Frontend hiding is a courtesy, never a control

Every route behind every component enforces the same capability and permission
server-side. Hiding a button the server would refuse is for the person holding
the phone. It is not what keeps them out.

Design consequence: it is always safe to show a screen and refuse an action
inside it, and that is often the better UX — *Plan and billing* is readable by
any doctor and its buttons are gated, because a practice should not discover its
plan by being cut off.

---

# PART 2 — PATIENT APP

Five tabs. Bottom bar is a floating pill: `rNav` 28, `GlassNavBar`, `primary`
on the active item with its label always visible, `inkFaint` inactive.

```
┌──────────────────────────────────────────────┐
│  Home   Assistant   Medicines   Food  Profile │
└──────────────────────────────────────────────┘
```

Persistent everywhere in this panel: offline banner, app-lock gate in front of
everything when enabled, and the patient's chosen language and theme.

## 2.1 Tab 1 — Home `/home`

The one screen that is genuinely composed for the patient, from the conditions
they actually have.

**Vertical order, and each gap is `s8` 32.**

| # | Block | Component | Shown when |
| --- | --- | --- | --- |
| 1 | **Header** | Greeting + first name + mood avatar. Not a card — a panel around a greeting makes the top of the page look like another read-out to get past. Sitting directly on the ground it reads as the page's voice. | Always |
| 2 | **Hero card** | `rLead` 20, `e2`. The one card that leads the screen. | Always |
| 3 | **Appointments** | Confirmed, waiting-for-reply and declined appointments, each with its date and — for a decline — its reason. Directly under the hero because it is the only thing on this screen with a deadline attached. | Always — states *"No appointments yet"* |
| 4 | **Household switcher** | Only when the phone carries more than one person. A switcher above a single name is a control answering a question nobody asked. | `isHousehold` |
| 5 | **Health profile** | Conditions, diagnosis year, height, weight, allergy count. | Always |
| 6 | **Glucose** | Trend chart + stats row + latest HbA1c. | `shows('glucose')` |
| 7 | **Diet plan** | Summary card with the goal and meal chips. | plan exists **and** `shows('diet_plan')` |
| 8 | **Food logs** | Recent meals as a horizontal rail with photos. | Always |
| 9 | **Allergies** | Called out on its own. | Non-empty only |

**Card composition** — `homeCards` arrives resolved from the patient's conditions
(and their department), with the honest reading: an empty list means the server
recorded none, which is read as *show everything*, not *show nothing*.

> **Gap to close.** The engine resolves five card keys — `glucose`, `hba1c`,
> `medications`, `diet_plan`, `blood_pressure` — and the screen currently gates
> only two. `hba1c` is folded into the glucose section, `medications` has no Home
> card, and `blood_pressure` has no card at all, so a cardiology patient's Home
> is a diabetes patient's Home. **Specified below in §7.6; this is the highest-
> value patient-side design work outstanding.**

**Glucose chart, and the four rules it exists to obey**

1. The axis reaches **zero** on a percentage. A day where nothing was in range
   clamped to 30 and was *drawn* at 30 — an axis that cannot reach zero has no
   business plotting a percentage.
2. A gap is **not** a zero. No readings that day is not "nothing was in range".
   Break the line, or bridge it in a visibly different stroke. Never drop it to
   the floor.
3. A fall from 100 to 29 is **71 percentage points**, not 71%. Written as a
   percentage it reads as a 71% relative drop, a different and much smaller
   number.
4. The chart says **when it was last true**. Anything calling itself current owes
   the reader the time it was pulled.

Target band as a `successTint` region behind the line; the line `primary` 2 px;
points 4 px, only on the last reading and on any out-of-range one; out-of-range
points `danger` or `warning` **with the value printed**, never colour alone.

## 2.2 Tab 2 — Assistant `/chat`

One thread, three voices, each labelled. `ChatTab` resolves to the single
conversation for a patient who has one — every patient today — and shows a
picker the first time there is a choice.

**Structure**

```
┌─ header ─────────────────────────────────────┐
│ clinic wordmark · thread name · [call]       │
├─ pinned banner (if any) ─────────────────────┤
│ 📌 what the clinic wants kept reachable      │
├─ messages ───────────────────────────────────┤
│  date separator: Today                       │
│  ┌──────────────────────┐                    │
│  │ assistant · cited    │ ← left, surfaceRaised
│  └──────────────────────┘                    │
│                     ┌───────────────────────┐│
│                     │ patient               ││ → right, primaryTint
│                     └───────────────────────┘│
├─ jump-to-latest (floating, when scrolled) ───┤
├─ composer ───────────────────────────────────┤
│ [+] [text field………………] [mic] [send]         │
└──────────────────────────────────────────────┘
```

**Bubble specification**

| Aspect | Received (assistant / doctor / dietician) | Sent (patient) |
| --- | --- | --- |
| Alignment | Left | Right |
| Surface | `surfaceRaised`, hairline `line` | `primaryTint`, no border |
| Radius | `rControl` 16, with the corner nearest its own edge at 4 | Same, mirrored |
| Max width | 78% of the viewport | 78% |
| Author | Always labelled — `label` style, `inkMuted`, with the speaker's accent for the leading glyph | Not labelled |
| Padding | `s3` 12 vertical, `s4` 16 horizontal | Same |
| Gap between bubbles | `s2` 8 same author, `s4` 16 on author change | — |

**Speaker accents.** Assistant `primaryLight`; doctor `primary`; dietician
`success`. The accent is a 3 px leading rule and the author label's colour — not
the bubble fill, which stays neutral so a thread with three speakers does not
read as three colour schemes.

**AI-specific chrome**

- **Citation chips** under a reply that used the knowledge base. Tappable,
  `label` type, `primaryTint` fill, `rFull`. This is what separates the clinic's
  assistant from a chatbot and it should be visible, not tucked away.
- **Generating bubble** — a three-dot pulse inside the received bubble shape, so
  the reply arrives *into* the space that was already reserved. No empty bubble
  flash.
- **Assistant disclaimer banner** — stated once at the top of the thread, not
  repeated per message. AI-generated content is visibly distinguished from a
  clinician's reply by the author label and accent, permanently.
- **Animated gradient border** on the composer while the assistant is available,
  as the one piece of decorative motion in the app. It is earned: it says
  something is listening.

**Safety chrome — the two cards that outrank everything else on the screen**

*Emergency card.* Full-width, `dangerTint` fill, `danger` 1.5 px border,
`rSection` 24, no shadow. A `display`-weight line, the emergency instruction in
`body`, and one full-width `hControl` 56 button: **Call the clinic now**. No
animation. No dismiss. It is followed by the conversation, not replaced by it.

*Urgent card.* Same shape in `warningTint`/`warning`, with the softer
instruction and a call button that is an outline rather than a fill.

**Voice**

- Recorder bar replaces the composer in place, with a live waveform driven by
  actual amplitude, an elapsed counter, and a cancel that is a slide rather than
  a small ×.
- Player: play/pause at `hCircle` 44, a scrubbable waveform, duration on the
  right. A long note from a patient collapses to one line of transcript with
  **Show more**, so a 10-minute note does not bury the thread.

**Attachments.** `+` opens a sheet: camera · gallery · document. Images preview
as a thumb strip above the composer before sending, each removable. A document
renders as a card with its type glyph, filename and size — not as a link.

## 2.3 Tab 3 — Medicines `/medications`

| Block | Specification |
| --- | --- |
| **Adherence ring** | The lead card. `metric` figure inside the ring, the window under it, and the count as words beside it — never the ring alone, because the ring is colour. |
| **Reminder health** | Shown **only** when reminders are actually at risk — permission revoked, battery optimisation, exact-alarm denied. A permanent warning stops meaning anything. Names the specific problem and offers the specific fix. |
| **Today's slots** | One `InnerTile` per slot — Breakfast · Lunch · Dinner — each listing its medicines, with a tap to mark taken. Taken state is a filled check plus the word, and the time it was marked. |
| **All medicines** | Name, strength, dose, frequency as B/L/D pips, duration, and the relation to food as words. |
| **Actions** | `ActionLink` to Reminder times · Dose history · Prescriptions. |

**Sub-screens**

- `/medications/reminders` — the patient's own breakfast, lunch and dinner times,
  as three time pickers with generous targets. The screen says plainly why it
  matters: *"after breakfast" means your breakfast*.
- `/medications/history` — dose history, grouped by day, with a taken/missed mark
  that carries a word.
- `/medications/prescriptions` — the prescription list, each opening its PDF.

**Scan a prescription.** A sheet: capture or pick → the read result as an
editable list of medicines, each with what was detected → explicit **Confirm**.
Nothing is saved until the patient confirms. Every field remains editable,
because OCR is a suggestion and a medicine list is not a place to be confident.

## 2.4 Tab 4 — Food `/food-log`

The tab **is** the dietician conversation. A photo sent here becomes a log entry
server-side, which is why there is no separate "log a meal" form to get wrong.

Same chat specification as §2.2, with:

- Dietician accent (`success`) as the only received speaker.
- Composer weighted toward the camera: the camera button is the primary
  affordance, sized as a button rather than hidden behind `+`.
- Empty state: *"Say hello and share your first meal."*
- `ActionLink` in the header to `/food-log/history`.

`/food-log/history` — day sections, each a `SectionCard` with a date header and a
grid of meal tiles: photo, meal type, time. A meal without a photo gets its type
glyph on `primaryTint`, never a broken-image box.

## 2.5 Tab 5 — Profile `/profile`

`ProfileSection` cards with `ProfileRow` children. One shape for every group is
most of what makes the page read as a single product.

| Section | Rows |
| --- | --- |
| **Header** | Photo (tap to change), name in `name` style, phone in `small` `inkMuted` |
| **Appearance** | Light · Dark · System — **currently hidden behind a flag that is off**. A control that changes nothing is worse than no control. |
| **Language** | English · বাংলা · हिन्दी, each in its own script, in a card like every other group. Loose chips floating on the background read as content that escaped its section. |
| **Preferences** | Glucose unit — mg/dL or mmol/L, applied everywhere numbers are shown |
| **Account** | Edit profile · Health details · My tests & reports · Notifications · Send feedback |
| **Security** | App lock (device PIN or biometric) |
| **Clinic** | Call the clinic · About, with version |
| | Log out — `danger` text, never a filled red button |

**`ProfileRow` anatomy.** Leading icon 24 px `inkMuted` · title `bodyStrong` ·
optional subtitle `small` `inkFaint` · optional current value right-aligned
`small` `inkMuted` · chevron. Minimum height `tap` 48, scaled by the text scaler.
Divider between siblings, none on the last.

**The subtitle rule, learned the hard way.** Either every row in a section
carries a subtitle or none of them do. Three explained and three bare made the
bare ones look like afterthoughts, and left the reader guessing which of two rows
held the thing they wanted. And the title says what the row is *for*, while the
current state goes in the value slot on the right — a row whose subtitle held its
saved value described itself on an empty profile and stopped describing itself
the moment it was filled in.

**Sub-screens.** `/profile/edit` (name, photo, DOB, gender) ·
`/profile/health` (conditions with per-condition detail, allergies, height,
weight) · `/profile/notifications` (per-category switches) · `/profile/tests`
(advised tests and uploaded reports) · `/profile/feedback`.

**Feedback screen, specified.** Two subject chips — *The clinic* (your care,
appointments, staff) / *This app* (bugs, speed, anything confusing). An optional
1–5 star rating. A message up to 2000 characters with a live counter. Two
statements in `small` `inkMuted` above the send button: that the patient's name
is sent so the clinic can follow up, and that this is **not** part of their
medical record. The rating is optional on purpose — somebody with something
specific to say should not have to reduce it to a number first.

---

# PART 3 — PRACTICE PANEL

Four branches. The bar shows three or four depending on the practice, and the
mapping from bar index to branch index is computed in one place — hiding a branch
does not renumber the rest, and getting that wrong means tapping Profile opens
Nutrition, which looks like a routing problem for a day.

| Branch | Route | Tab | Shown |
| --- | --- | --- | --- |
| 0 | `/clinician/dashboard` | Home | Always |
| 1 | `/clinician/patients` | Care | Always |
| 2 | `/clinician/nutrition` | Nutrition | AI assistant **or** a dietician on the roster |
| 3 | `/clinician/more` | Profile | Always |

Somebody standing on Nutrition when the capability goes away is moved, not left
looking at Home labelled Nutrition.

**This area is the practice's, not the doctor's.** It holds the composed
dashboard, Team, Departments, Export and Billing — which is what a lab manager or
a practice manager actually needs. The rows that are genuinely the doctor's
identity (letterhead, professional details, signature) are gated on the doctor's
role inside the Profile screen, which is where that gate belongs.

## 3.1 Tab 1 — Home `/clinician/dashboard`

```
┌────────────────────────────────────────────┐
│ ClinicWordmark            [bell] [avatar]  │
│ Department name · role label               │  ← only when a department is set
├────────────────────────────────────────────┤
│ ┌ Quick actions (Wrap, never a scroller) ┐ │
│ │ [Start consultation] [Add patient]     │ │
│ │ [Record vitals] [Write prescription]   │ │
│ └────────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│ widgets[0] …                               │  ← server order, verbatim
│ widgets[1] …                               │
│ widgets[n] …                               │
├────────────────────────────────────────────┤
│ Updated 14:32 · pull to refresh            │  ← real timestamp, always
└────────────────────────────────────────────┘
```

Refreshes on a 20-second timer, on resume, and on pull-to-refresh. **One poll
drives every panel**, passed down as a single `DashboardData` rather than each
panel reaching for its own provider — a dashboard whose panels disagree about
what time it is has no business calling any of them live.

**A practice showing no lab panel makes no lab request.** Fetching the lab
overview always and throwing it away is a query per doctor per refresh for a
panel nobody is looking at.

### The eleven panels, specified

All sit in `PanelCard`: white, `rSection` 24, hairline `line`, `e1`, `s5` 20
padding. Heading is `PanelSectionHeader` — a 36 px tinted plate carrying the
glyph, the title in `title`, an optional second line in `small` `inkMuted`, and
an optional `ActionLink` on the right. One shape for every section is most of
what makes the page read as one product; before this, four sections had four
different headings.

---

**`ANALYTICS_SUMMARY` — Clinic snapshot** · *gate: advanced analytics*

The leading panel where present. A window selector (7 / 30 / 90 days) as
segmented chips, a sparkline per series, and the figures in `metric` with their
labels in `label` beneath. The window selector changes the data, so it belongs on
the panel that owns it rather than in a screen-level filter.

Renders `null`, not an empty card, until the analytics have arrived — this panel
*is* its numbers.

---

**`TRIAGE_QUEUE` — Who needs a doctor now** · *gate: view patient*

The top three open alerts, worst severity first, newest within a severity. Each
row: an urgency dot **with its word**, the patient's name in `bodyStrong`, the
time it fired in `small` `inkFaint`, the alert detail, and tags for severity and
category. Tapping opens that patient's thread. Beneath: `ActionLink` **View all
triage (N)**.

Severity tones: emergency `danger` · high `warning` · advice `primaryLight` ·
routine `inkMuted`. Every one ships with its label — "High · Review soon", not an
orange dot.

Carries the pull timestamp, because a queue of who needs a doctor *now* is the
one panel where staleness is clinical.

---

**`TODAYS_CLINIC` — The day** · *gate: view patient*

A progress bar of completed vs remaining, the two counts in `metric`, and the
next few encounters as `InnerTile` rows with time, patient and state. Hidden
entirely on a day with no clinic — a zero here is noise.

---

**`ACTION_QUEUE` — What is queued** · *gate: view patient*

Four counts: open alerts · unread messages · flagged chats · appointment
requests. A 2×2 grid below 400 dp, four across above it — four stat cards across
a 360 dp phone ellipsise "Unread messages".

**This panel changes shape with the workload.** A caught-up practice gets one
line, not four hero-sized zeros. Renders `null` until both halves have arrived,
because half of it is a different number from the other half.

---

**`OPEN_ALERTS` — Alert digest** · *gate: view patient*

The alerts raised, with an explicit all-clear. **Shown when empty** — unlike Live
Activity below — because no alerts is a clinical fact worth stating, and a
clinician needs to see that it was stated rather than wonder whether the panel
loaded.

---

**`LIVE_ACTIVITY` — Context, not work** · *gate: view patient*

Recent events across the practice, as a timeline: a 2 px `line` rail with 8 px
`primaryTint` nodes, the event in `small`, the relative time in `label`
`inkFaint`.

**Hidden when empty**, unlike the alert digest. The difference is what the
emptiness means: no alerts is a clinical fact; no recent activity is the absence
of a log.

---

**`NUTRITION_REVIEWS` — Diet plans falling due** · *gate: view patient*

A card per patient with an `N Due` badge on the heading. Each shows **Day 14/30**
through their cycle — amber once due — a flag derived from their actual logging
(*Stopped logging* · *Logging patchy* · *Never logged a meal* · *Logging well*),
and **Review log**.

Every one of those flags is derived from real log timestamps. None is a
placeholder, and the label says review, never "expiring" — the schema has no
expiry, and labelling a review date as an expiry is how a number stops being
trusted.

---

**`CRITICAL_LAB_RESULTS`** · *gate: lab result + view patient*

Reports holding a value flagged `critical`. Each row: patient, the analyte, the
value with its unit, the reference window, and the flag as a word in `dangerTint`.
`testedOn`, relative.

**Renders nothing — not the empty state — while the request is in flight.** "No
result came back critical" is a reassuring sentence, and saying it before the
answer arrives is saying it without knowing. This is the one panel where that
distinction is unambiguously a safety matter.

---

**`RECENT_LAB_REPORTS`** · *gate: lab result + view patient*

Newest by `testedOn`. Patient, title, lab name, date, and a flag summary pill
carrying the worst flag in the report with its word.

---

**`LAB_FLAG_SUMMARY`** · *gate: lab result + view patient*

Counts of values that came back low · high · critical across the practice, as
three `InnerTile` metrics with their tints. Same shape rule as Action Queue.

---

### Quick actions

Nine, each opening a route that exists. A `Wrap` at `s2` 8 spacing — a bounded,
known set, and an action somebody cannot see is an action they do not use.

Each button: `primaryTint` fill, `rControl` 16, minimum height `tap` 48 **scaled
by the text scaler**, a 20 px `primary` glyph, `bodyStrong` `primary` label.
`Semantics(button: true)`.

| Id | Label | Gate |
| --- | --- | --- |
| `START_CONSULTATION` | Start consultation | edit record |
| `ADD_PATIENT` | Add patient | edit record |
| `RECORD_VITALS` | Record vitals | edit record |
| `WRITE_PRESCRIPTION` | Write prescription | prescription cap + prescribe |
| `VIEW_ALERTS` | Alerts | view patient |
| `VIEW_LAB_REPORTS` | Lab reports | lab result cap + view patient |
| `EXPORT_REPORT` | Export | report export cap |
| `MANAGE_TEAM` | Team | manage staff |
| `MANAGE_DEPARTMENTS` | Departments | department cap + manage department |

Labels are in one voice, naming what pressing it does.

## 3.2 The dashboard, per role and per department

The matrix the engine actually produces. **This is the design brief for five
different screens from one install.**

| Who | Panels, in order | Quick actions | Tier |
| --- | --- | --- | --- |
| **Doctor · no department** (general) | Snapshot · Triage · Today · Action queue · Nutrition reviews · Open alerts · Live activity | Consult · Add patient · Vitals · Prescribe · Alerts | general |
| **Doctor · cardiology** | Triage · Today · **Recent lab reports** · Action queue · Open alerts | Consult · Vitals · Prescribe · **Lab reports** · Alerts | departmentDefault |
| **Doctor · laboratory / pathology** | Critical results · Flag summary · Recent reports | Lab reports · Export | departmentDefault |
| **Doctor · nutrition** | Nutrition reviews · Triage · Action queue | Consult · Vitals | departmentDefault |
| **Doctor · any configured department** | Whatever the practice composed | Whatever the practice composed | department |
| **Doctor's assistant** | The department's screen, same as the doctor's | Consult · Add patient · Vitals · Alerts — **never Prescribe** | as department |
| **Lab technician · anywhere** | Critical results · Flag summary · Recent reports | Lab reports · Export | role |
| **Lab manager · anywhere** | Critical results · Flag summary · Recent reports | Lab reports · Export · **Team** | role |
| **Practice manager · anywhere** | **Snapshot only** | Team · Departments · Export | role |

**Three things a designer must internalise from this table.**

*The lab rows have no appointments, no consultations and no prescribing on them
at all.* That is the clearest case for the engine existing: the same app,
composed differently, rather than a second application.

*A doctor is deliberately absent from the role-default table.* A doctor's screen
**is** the department's screen — that is the whole argument for departments having
one.

*The practice manager's screen is not the general set filtered down.* Every
patient-facing panel needs `VIEW_PATIENT`, which their preset withholds, so
composing the general set for them would produce an empty screen after
filtering. An empty screen is not an answer. One analytics panel and three
administrative actions is what their job actually looks like.

**A configured department beats a role default**, even for a lab technician
posted to cardiology — whoever configured that department did it knowing who
works there.

## 3.3 Tab 2 — Care `/clinician/patients`

A working inbox, not a directory. Polls every 3 seconds.

**Row anatomy** — minimum height 72, `s4` 16 padding:

```
┌──────────────────────────────────────────────────┐
│ (photo)  Rahul Das                    14:32  ●3  │
│  44px    Dietician · "Sent your plan for…"       │
└──────────────────────────────────────────────────┘
```

Photo `rFull` 44 with initials on `primaryTint` as the fallback — never a broken
image. Name `bodyStrong`. Preview line: who spoke last in `label` with that
speaker's accent, then the text in `small` `inkFaint`, one line, ellipsised. A
media turn shows a small glyph instead of text. Timestamp `label` `inkFaint`.
Unread badge `primary` fill, white `label`, `rFull`, minimum 20 px.

**Unread first, then most recent.** Sorting by recency alone buries an unread
message under a thread the doctor just replied in.

Header: search by name or phone, and an **Unread** filter as a chip — bounded
set, so it does not scroll.

## 3.4 Patient thread `/clinician/patients/:id/thread`

Same bubble specification as §2.2, with the doctor's own replies on the right and
everything received on the left — including the assistant's answers and the
dietician's notes, so the doctor sees the whole conversation the patient sees.

Clinician-specific: voice reply (faster than typing between patients), a long
patient voice note collapsed to one transcript line with **Show more**,
attachments, and call-from-header.

## 3.5 Patient profile `/clinician/patients/:id`

```
┌──────────────────────────────────────────────────┐
│ (photo)  Rahul Das                               │
│  64px    44 Yrs · Male · P-98421                 │
│          [High risk ⚠]  [Type 2]                 │
│          [ Call ]  [ Message ]                   │
├──────────────────────────────────────────────────┤
│ SectionCard — Clinical summary                   │
│   health score · adherence · avg glucose ·       │
│   time in range · estimated HbA1c                │
├──────────────────────────────────────────────────┤
│ SectionCard — HbA1c history        [chart]       │
├──────────────────────────────────────────────────┤
│ SectionCard — Current medicines (N)              │
├──────────────────────────────────────────────────┤
│ SectionCard — Vitals                             │
├──────────────────────────────────────────────────┤
│ SectionCard — Lab reports            ActionLink  │
├──────────────────────────────────────────────────┤
│ SectionCard — Conditions & allergies             │
├──────────────────────────────────────────────────┤
│ SectionCard — Recent alerts                      │
├──────────────────────────────────────────────────┤
│ SectionCard — Assistant context                  │
├──────────────────────────────────────────────────┤
│ SectionCard — Dietician assignment               │
└──────────────────────────────────────────────────┘
```

**The risk pill carries a warning triangle only when the band earns it.** A glyph
on every pill is a glyph that says nothing.

**HbA1c as a trend, never one value.** A single HbA1c is a number; three of them
is a direction, and the direction is the clinical content.

**Assistant context is a first-class section, not a debug panel.** It shows
exactly what the AI was given before it answered, so any reply can be audited
after the fact. Present it as provenance: collapsible, `small` monospace-free
prose, with the retrieval sources listed as the same citation chips the patient
saw.

**Sections that would be empty are hidden**, except Lab reports and Vitals, which
state their emptiness — "No reports uploaded" and "No vitals recorded" are things
a doctor needs to notice.

## 3.6 Consultation `/clinician/patients/:id/consult`

A three-step stepper, persisted at each step. **A refresh must not lose the
consultation** — that is the requirement the design serves.

```
   ●─────────○─────────○
 Vitals  Diagnosis  Advice
```

Stepper header: `rFull` nodes, `primary` filled for done, `primary` ring for
current, `line` for pending; label under each in `label`, the current one in
`primary`. Never a percentage.

**Step 1 · Vitals.** BP systolic/diastolic as a paired field, pulse, SpO₂,
temperature, weight, waist. Each with its unit **in** the field, not as a
separate label. Each validated against the real stored range — systolic 50–300,
pulse 25–250, SpO₂ 50–100, temperature 30–45.

> **An impossible value is refused at the field with its range stated.** Silently
> accepting one puts a false reading in a clinical record; refusing it without
> saying why makes the form look broken.

Below the inputs, the patient's **last recorded set with its timestamp** — never
pre-filled into the fields, because a stale value displayed as current is the
failure this panel most easily creates.

**Step 2 · Diagnosis.** Free text, plus condition chips from the patient's
existing conditions so a known diagnosis is one tap.

**Step 3 · Advice.** Clinical advice, lab orders as tap-to-select chips for the
tests the practice orders most with free text for anything else, and a follow-up
date clearable with an ×.

Footer: **Back** as an outline, **Continue** / **Finish** as a fill at `hControl`
56, `s12` 48 above it.

## 3.7 Prescription

Reached from the consult and from the patient. Per medicine:

| Field | Treatment |
| --- | --- |
| Name | Autocomplete from the practice's shared dictionary |
| Strength | Free text, with the dictionary's known strengths as suggestions |
| Dose | Free text |
| Frequency | **B / L / D** toggle — three `rControl` segments, selected in `primary`. Maps directly onto the patient's own three reminder slots |
| Duration | Days |
| Relation to food | Before · After · With — segmented, as words |
| Instruction | Free text |

**Add another medication** as a text-and-glyph `ActionLink`, never a bare `+`.

**Send is blocked with a reason, at the field.** A medicine with no name, or with
no B/L/D selected, reaches the patient's tracker with no reminder times and
silently never reminds them. That is worth a refusal.

**After sending:** the form clears and the screen **stays on the patient**.
Navigating away after a send takes the doctor out of the consultation they are
still in.

**Gate.** The whole surface requires `PRESCRIPTION` capability and the
`PRESCRIBE` permission, and the server records the prescribing doctor
independently. A doctor whose registration the platform has not verified sees the
form and is refused the signature, with the reason stated — not a disabled button
with no explanation.

## 3.8 Tab 3 — Nutrition `/clinician/nutrition`

The doctor's window onto the dietician↔patient conversations. Same inbox anatomy
as Care, with the dietician accent, and a review state per row.

## 3.9 Tab 4 — Profile `/clinician/more`

| Section | Rows | Gate |
| --- | --- | --- |
| **Header** | Photo, name, **role label** | Label comes from one table so a lab technician is not told they are a "Doctor" |
| **Account** | Edit profile | — |
| **Appearance** | Light · Dark · System | Hidden — flag off |
| **Language** | Three, in a card | — |
| **Clinic tools** | Practice · Plan and billing · Clinical alerts · People · Export data · Chat review · Knowledge base · Patient feedback | billing: doctor · export: report export cap · chat review: AI cap |
| **Prescription letterhead** | Professional details · Digital signature **with a live preview** | doctor only |
| **Security** | App lock | — |
| **App** | Clinic phone number · About | — |
| | Log out | — |

**The signature preview is specified, because "Set" was a defect.** It told the
doctor a file existed — not whether it was the right one, the right way up, or
legible, and the first place they would otherwise find out is a prescription
already sent. The preview renders **on white, always**, whatever the theme: the
signature is cut out on transparency and prints onto paper, so previewing it on a
themed surface shows the doctor something the prescription never looks like.

**Why the letterhead section is role-gated rather than area-gated.** These rows
are the doctor's *identity*. When staff shared this area, their Profile offered
the prescription letterhead, the professional details and the signature — two of
which are somebody else's. The gate belongs on the rows, not on the area.

## 3.10 Practice administration screens

| Screen | Route | Composition |
| --- | --- | --- |
| **Practice** | `/clinician/practice` | Letterhead · locations with opening hours · departments (count + "N-panel dashboard") · people · food-log review interval |
| **People** | `/clinician/team` | Member rows: photo, name, role, department, location, and tags — Owner (accent) · Suspended (warn) · Left (muted) · Account off (muted). Seat-limit awareness with **"At the limit"** in `warning` rather than a silently disabled button. `ActionLink` **Add someone** |
| **Departments** | `/clinician/departments` | The practice's departments; shared specialties are marked uneditable |
| **Plan and billing** | `/clinician/billing` | Current plan, renewal date, usage against limits, payment state, history. Readable by any doctor; actions gated |
| **Clinical alerts** | `/clinician/alerts` | Filter chips (Open · Acknowledged · Resolved · All) — bounded, so no scroller. Each alert: severity with its word, patient, time, detail, and Acknowledge / Resolve. Resolve is doctor-only and confirms |
| **Export** | `/clinician/export` | What to export, the window, and the format (CSV / JSON) |
| **Chat review** | `/clinician/chat-review` | Reported assistant replies; the detail screen shows the full exchange with the retrieval sources |
| **Knowledge base** | `/clinician/knowledge` | Entries with state — draft · approved · retired — add, edit, approve, retire |
| **Patient feedback** | `/clinician/feedback` | Filter All / The clinic / The app. Each card: subject, stars, message, author, time, **Mark reviewed**. Unreviewed carries a coloured border |
| **Appointments** | `/clinician/appointments` | The practice's schedule with a manage sheet per appointment |
| **Clinics** | `/clinician/clinics` | Locations, add and edit |

> **Gap — the "Add someone" sheet.** It offers three segments (Doctor · Front
> desk · Dietician). The server accepts all seven practice roles. Four roles —
> doctor's assistant, lab manager, lab technician, practice manager — are fully
> implemented, permission-tested and dashboard-composed, and **cannot be created
> from the app**. The segmented control was chosen because three fixed options
> should all be visible; at seven it becomes a list. **Specified in §7.1.**

---

# PART 4 — FRONT DESK

Three tabs. Its own area because its work genuinely is a different application —
a day sheet and a registration queue, not a caseload.

| Tab | Route |
| --- | --- |
| Today | `/staff/today` |
| Patients | `/staff/patients` |
| Profile | `/staff/profile` |

## 4.1 Today `/staff/today`

Ordered by what the desk does, in the order they do it.

| Block | Composition |
| --- | --- |
| **Header** | Wordmark, **Desk** subtitle, notification bell, avatar |
| **Register** | The primary action of the screen, as a full-width `hControl` 56 fill. Registering is what this tab exists for |
| **Requests** | Appointment requests as `RequestCard`s — patient, requested time, reason — each with Accept and Decline. Decline **requires a reason**, because the patient is shown it |
| **Today's schedule** | `DeskAppointmentRow` per encounter: time, patient, doctor, state, and check-in. Grouped by state — remaining above completed |
| **Waitlist** | Who is waiting, and a notify action when a slot frees |

Hidden when empty: requests, waitlist. Stated when empty: today's schedule
("Nothing booked today").

## 4.2 Patients `/staff/patients`

The same `PatientsScreen` as the clinician's Care tab, which is correct — it is
the same list — with destinations that stay inside `/staff/*`.

**This was a real defect worth recording in a design document.** The screen
pushed `/clinician/...` outright. For the doctor that was correct; for the desk
every destination redirected straight back to Today, and nothing said why.
Tapping a patient, the register button, and finishing a registration all bounced.
The screen looked broken because half its destinations were in an area its own
user is not allowed into. **Every shared screen resolves its links through
`areaPrefix`.**

## 4.3 Registration `/staff/patients/new`

A single-column form at `hControl` 56 per field, `s3` 12 between siblings.

Name · phone with **verification** (a code is texted and entered — the number is
proved, not typed) · DOB · gender · optional conditions.

**Phone verification is a step in the form, not a modal.** It has its own inline
state: *Send code* → *code field + Resend in 0:28* → *Verified ✓* in `success`
with the word. One mistyped digit and the account belongs to whoever owns the
number typed instead.

## 4.4 Profile `/staff/profile`

Own photo and details, app lock, language, theme, log out. **Clinics** appears
here — on a first run it is usually the receptionist who sets up the practice's
first location, and gating that on a management permission would break the
first-run path for most practices.

No letterhead. No professional details. No signature. Those are the doctor's.

---

# PART 5 — DIETICIAN PANEL

| Tab | Route |
| --- | --- |
| Dashboard | `/dietician/dashboard` |
| Patients | `/dietician/patients` |
| Profile | `/dietician/profile` |

## 5.1 Dashboard `/dietician/dashboard`

| Block | Composition |
| --- | --- |
| **Greeting** | *"Good evening, Ritu Sen"* in `name`, over *"Here is your daily nutrition overview"* in `small` `inkMuted`. Time-aware |
| **Counts** | Active patients · Reviews · Plans, as three `InnerTile` metrics. **Tinted only when non-zero** — a permanently red box stops meaning anything |
| **Action queue** | The outstanding work as rows: initials avatar, name, and either **Review due · Nd** with a chevron into the patient, or **Create plan · Nd** with a **Create** button straight into the editor |
| **All caught up** | Replaces the queue **only** when it is genuinely empty. A green tick over outstanding work is worse than no tick. Stated once on the screen, never in two panels |
| **Latest meals** | A horizontal rail of the newest meals — photo, meal type, patient, relative time. Faded at the end that has more behind it, padded at both ends |

**Queue ordering is a design decision worth stating.** Reviews rank above plans —
care going stale outranks care not yet started — and longest-waiting first within
each. A patient in both lists appears **once**, as the plan they still do not
have.

**Counts and lists come from one endpoint**, so a number never disagrees with the
list under it.

**There is no "New patient" action here.** A dietician does not enrol patients.
The doctor does, and the dietician sees them automatically.

## 5.2 Patients `/dietician/patients`

Every patient in the practice, unless the doctor has explicitly assigned patients
to this dietician — then only those. Enforced server-side; a patient outside the
scope is unreachable even by URL.

One card per patient, overdue first, with a **Review due** badge. The dashboard's
counts link straight to the worklist they stand for, so tapping "3 reviews due"
lands on those three rather than on everyone (`?filter=review|noplan|critical|high`).

Empty state: *"A doctor will assign patients to you."*

## 5.3 Patient overview `/dietician/patients/:id`

| Section | Why it sits where it does |
| --- | --- |
| Header — name, age, sex, risk band | — |
| Facts — conditions, height, weight, review interval | — |
| **Allergies** | Called out **separately**. The one thing a diet plan must not get wrong |
| **Diet plan summary** | **Above everything else.** The plan is what the dietician is here to produce; the rest of the screen is input to it |
| Current medicines, with a count | A plan is built around what the patient is actually taking |
| Food log — meals with photos, day by day | — |
| **Message patient** | Opens the nutrition chat |

**The plan summary card is the most carefully specified card in this panel.** It
shows the goal, a chip per meal with its time, how many foods are on the avoid
list, and — the part that matters most — **whether the patient has actually been
sent it**:

| State | Treatment |
| --- | --- |
| *Not sent yet* | `inkMuted` label, no border accent |
| *Edited since it was last sent* | `warning` border and label |
| *Sent 4 Aug · Ritu Sen* | `success` label, with who sent it |

A finished-looking plan the patient has never seen is a draft, and the card says
so instead of looking done.

And it says **sent**, never "accepted". Nothing records a patient accepting a
plan; claiming otherwise would be inventing consent.

## 5.4 Diet plan editor `/dietician/patients/:id/diet`

| Field | Treatment |
| --- | --- |
| **Goal** | Multi-line, in the patient's own terms — *"bring fasting sugar under 130 without cutting rice completely"* |
| **Meals** | Add as many as the day needs. Suggested chips (Breakfast · Mid-morning · Lunch · Evening snack · Dinner) plus **Other**. Meal **name and time are free text on purpose**: an Indian day is not breakfast/lunch/dinner, and *"before namaz"* has to be sayable |
| **Items** | One line per item, **each separately editable** — fixing "2 rotis" must not mean retyping the meal. Plus an optional note per meal |
| **Best avoided** | Chips, kept **out** of the meal cards deliberately: a patient scanning for *"can I have this?"* should have one place to look |
| **Anything else** | Water, cooking oil, eating out, fasting days |

**Two buttons, and they are separate on purpose.** **Save** and **Send to
patient**. A dietician halfway through moving a portion from lunch to dinner
should not be notifying the patient twice. If there are unsaved edits when Send
is pressed, they are saved first — the plan the patient receives is always the one
the dietician is looking at.

**What sending does, and the design follows from it.** The plan goes into the
patient's care thread as readable plain text — headings, bullets, and a closing
line inviting them to say if something does not suit them. Plain text rather than
a custom card so it survives translation, can be copied, and still makes sense
when the patient screenshots it for whoever does the cooking at home. Sending
also marks the food-log review done for that cycle.

Plan history is reachable as a sheet, so a dietician can see what changed.

## 5.5 Nutrition chat `/dietician/patients/:id/chat`

Writes into the same care thread the patient already uses, tagged as the
dietician — the patient does not learn a second inbox. Full history, including
attachments. Empty state: *"Say hello and share your first food guidance."*

---

# PART 6 — OPERATOR CONSOLE (web)

Next.js. A different product for a different reader, and it should look like it:
denser, keyboard-first, and desktop-shaped. It shares the palette and the type
scale; it does not share the mobile spacing rhythm.

| Page | Composition |
| --- | --- |
| **Overview** `/` | Platform metrics, practices needing attention |
| **Practices** `/practices` | Table with a command palette. Detail: identity, type, plan, limits, verification, status, members, and **the capability explainer** |
| **Sign-ups** `/signups` | Applications with their state: claim · request info · reject · approve |
| **Billing** `/billing` | Plans, subscriptions, revenue, extend trial, pause, resume, grace |
| **Analytics** `/analytics` | Platform figures |
| **Audit** `/audit` | Who · what · when · which resource, filterable by action |
| **Admins** `/admins` | Platform administrators |
| **Account** `/account` | Credentials, passkeys, TOTP |

**The capability explainer is the console's signature screen and deserves real
design attention.** For every capability it states: whether the practice has it,
what is blocking it — **type** or **plan** — and what a member still needs before
they can use it.

Specification: one row per capability. A `success` check or an `inkFaint` dash.
When blocked, a pill naming the gate: **Type** in `inkMuted` (what the
organisation *is* — does not resolve itself with money) or **Plan** in `warning`
(a sale). **Type is named first when both block it**, because "a clinic does not
have departments" is the more useful half of the answer. A third column names the
permission a member still needs, shown **even when the practice has the
capability** — because "the practice has departments and this doctor cannot
manage them" is the commonest reason a section is missing from one person's screen
and not another's, and it is a conversation with the practice, not a sale.

**The permission editor's empty-state copy matters and is already right.** When a
membership's grant is empty, the dialog says these are the *defaults for this
role, not a saved list* — the grant is empty and the role's preset is standing
in. A console that read the raw array would show every membership as
permission-less, and an operator would then "fix" what was already correct.

---

# PART 7 — THE WORK OUTSTANDING

Everything above exists. This part is what to build, in the order that buys the
most, with enough specification to be picked up directly.

## 7.1 Widen "Add someone" to seven roles — **blocker**

Four fully-implemented roles cannot be created from the app.

**Design.** The segmented control was correct at three fixed options, all
visible. At seven it becomes a grouped list:

```
Who are you adding?

  CLINICAL
  ○ Doctor              Consults, prescribes, signs
  ○ Doctor's assistant  Vitals, notes, follow-ups. Does not prescribe
  ○ Dietician           Diet plans and food-log review

  LABORATORY
  ○ Laboratory manager  Runs the bench, and the people on it
  ○ Laboratory technician  Enters and reports results

  ADMINISTRATIVE
  ○ Front desk          Registration, booking, payment
  ○ Practice manager    Rotas, departments, billing. Reads no patient record
```

Radio rows at `tap` 48, title `bodyStrong`, the one-line description in `small`
`inkFaint` — **the description is the feature**, because a practice owner does not
know what "doctor's assistant" means in this software until it tells them.

The two most consequential descriptions are the ones that state a *limit*:
*"Does not prescribe"* and *"Reads no patient record"*. Those prevent a
misassignment that the permission system would then correctly enforce and
everybody would experience as a bug.

Roles the practice type cannot use are hidden, not disabled. Department and
location pickers appear per role — a lab technician's department is the point of
the row.

## 7.2 Dashboard composer — API complete, no editor

The write path is complete and validated: unknown component names are refused at
write time with the name that was not recognised, and `[]` restores the platform
default.

**Design.** A screen inside Departments:

```
Cardiology — dashboard                    [Preview]

  ON SCREEN                                    drag to reorder
  ☰ Triage queue          who needs a doctor now      [×]
  ☰ Today's clinic        the day's appointments      [×]
  ☰ Recent lab reports    newest by tested-on date    [×]

  AVAILABLE
  + Clinic snapshot       trends over a window     Advanced analytics
  + Action queue          alerts, messages, requests
  + Lab flag summary      low, high and critical counts      Lab result
  + Critical results      values flagged critical            Lab result
  …

  QUICK ACTIONS
  [Start consultation ×] [Record vitals ×] [Prescribe ×]  [+ Add]

  ─────────────────────────────────────────────────
  Showing the platform default for Cardiology.
  [ Save ]        [ Restore default ]
```

Four things this screen must do that a generic builder would not:

1. **Name what each component requires**, right-aligned in `label` `inkMuted` —
   "Advanced analytics", "Lab result". An operator who adds a panel the plan does
   not cover should learn it here, not from a clinician who cannot see it.
2. **Say which tier is currently answering** — the `source` field already comes
   back. "Showing the platform default for Cardiology" versus "Configured by this
   practice" is the difference between a screen that looks unconfigured and one
   that is.
3. **Preview as a role**, not in the abstract. The same list filters differently
   for a doctor and an assistant, and the preview is where that is discovered.
4. **Restore default is `[]`, not an empty list.** The copy must say *restore the
   platform default*, never *clear* — a department cannot be configured to show
   nothing, and the button that looks like it does that must not claim to.

## 7.3 Converge the two component systems

There are two card systems: `shared/widgets/surfaces.dart` (`SectionCard`,
`InnerTile`, `SectionHeader`, `ActionLink`) on the patient side, and
`clinician/.../panel_ui.dart` (`PanelCard`, `PanelSectionHeader`, `PanelPill`) on
the clinician side. They render *nearly* the same card, from two different token
sources — `T` and `AppSpacing`/`AppColors`.

**Nearly is the problem.** Two systems that agree on most values and disagree on
a few produce exactly the "numbers that do not quite line up" effect the token
file exists to prevent, and it is invisible in review because each screen is
internally consistent.

**Plan.** Keep both APIs, reimplement `panel_ui` on `T` so the two render
identically, then deprecate the duplicate names. No screen changes in the same
commit.

## 7.4 Clear the token debt — 563 violations across 87 files

`dart tool/verify_tokens.dart` reports: **125 colour · 42 radius · 188 type · 208
spacing**, across 87 files. 102 files still use `AppSpacing`, 100 use
`AppColors`, and only 41 import `tokens.dart`.

This is the single largest thing standing between the app as it is and the app
reading as premium — not any individual screen.

**Order of attack, worst first:**

| File | Violations |
| --- | --- |
| `dietician/presentation/dietician_patient_screen.dart` | 52 |
| `staff/presentation/staff_today_screen.dart` | 49 |
| `clinician/presentation/patient_profile_screen.dart` | 35 |
| `home/presentation/home_screen.dart` | 31 |
| `clinician/.../desk_appointment_row.dart` | 23 |
| `clinician/presentation/appointments_admin_screen.dart` | 22 |
| `clinician/.../dashboard_sections.dart` | 18 |
| `dietician/presentation/dietician_dashboard_screen.dart` | 17 |
| `home/.../appointments_section.dart` | 16 |

`mobile/tool/snap_to_tokens.dart` exists to help. Convert one screen per commit,
look at it on a device, and do not mix a token conversion with a layout change —
when something moves, nobody can tell which half did it.

## 7.5 Cardiology, honestly

The cardiology dashboard resolves correctly and shows real panels. What a
cardiologist expects and will ask for is an ECG trace and a risk score, and
**neither exists in this platform**.

**Do not build either as a visualisation first.** A registered widget with
nothing behind it renders empty forever and reads as a clinic with no data rather
than a feature that was never built — and a cardiac-risk number is worse than
empty, because a cardiologist reading a value labelled that way will take it for
a validated score. Framingham, QRISK and ASCVD are instruments, not arithmetic.

**What can be built now, from data that exists:** a blood-pressure trend from
`VitalRecord` (systolic, diastolic, pulse are stored, with a stored BP category),
a pulse trend, an SpO₂ reading, cardiac-relevant lab analytes from `LabReport`,
and the patient's medication list. That is a real cardiology screen.

**If ECG is required**, in this order: data model → source → API contract →
storage → waveform representation → permissions → visualisation → test with real
clinical datasets → a visible distinction between demo and patient data. Nine
steps before a pixel.

**If a risk score is required**, name the instrument, document its required
inputs, and then display: calculation source · input data · calculation date ·
result · **missing inputs** · clinical disclaimer. A score computed from partial
inputs must say which were missing.

## 7.6 Wire the remaining patient home cards

The engine resolves `glucose`, `hba1c`, `medications`, `blood_pressure` and
`diet_plan`. The screen gates two.

| Card | Work |
| --- | --- |
| `hba1c` | Currently folded into the glucose section. Give it its own gate so a patient with HbA1c tracking and no daily glucose gets the right screen |
| `medications` | No Home card at all. Specify: today's slots with a taken state, one tap to mark — the highest-value card for an elderly patient |
| `blood_pressure` | **No card exists.** A cardiology patient's Home is a diabetes patient's Home. Specify: BP trend with the stored category as a word, systolic/diastolic as a paired series, never a single averaged line |

## 7.7 Fix the two stale Flutter tests

`test/staff_shell_test.dart` asserts on literal source strings
(`const staffHome = '/staff/today';`, `if (_isStaff(authState)) {`) that the roles
refactor replaced with the `areaForRole` table. The behaviour is preserved and
guarded elsewhere; the assertions are stale.

**This matters more than two red lines suggest.** A suite that is red for a
reason everybody knows about trains people to stop reading it, and the next
failure — the real one — arrives into an audience that has learned to ignore the
colour.

Rewrite both against `areaForRole` / `homeForArea`, which is what
`shared_screens_stay_in_their_area_test.dart` already does correctly.

## 7.8 Smaller, worth doing

| Item | Note |
| --- | --- |
| **Dark mode** | `kDarkThemeEnabled` in `shared/providers/theme_provider.dart` is `false`, so `AppTheme.light()` is served for both slots and the selector is hidden. The stored preference is still read and written, so flipping the flag restores it. A control that changes nothing is worse than no control — either finish the dark palette against the measured ratios in §0.1 or leave it hidden |
| **Loading skeletons** | Several screens centre a spinner where they had structure a moment before. Skeleton at the shape of the content |
| **Plan-restriction copy** | `Capabilities.withheld()` distinguishes "the practice does not have it" from "you do not have it". Only some screens use the distinction; the copy should differ everywhere it applies |
| **Orphaned screens** | Built screens exist that are not wired into the router or navbar. Audit before rebuilding anything |
| **Tablet** | Nothing is specified above a phone width. The 2×2/4-across breakpoint at 400 dp is the only responsive rule in the app |

---

# PART 8 — VERIFICATION CHECKLIST

Before calling any UI work on this codebase done:

- [ ] `flutter analyze` — **zero errors, zero warnings** (currently clean)
- [ ] `dart tool/verify_tokens.dart` — no new violations, ideally fewer
- [ ] `dart tool/find_flex_conflicts.dart` — clean, or each hit understood
- [ ] Widget checked in the **narrowest** layout it can appear in, and re-checked
      after being moved between layouts
- [ ] Text scaler raised — nothing clips, nothing truncates mid-word
- [ ] Every status has a **word**, not just a colour
- [ ] Every tappable thing ≥ 48 px with `Semantics`
- [ ] Every displayed number traced to real data — nothing hardcoded, nothing
      that could be stale without saying so
- [ ] Empty state decided: hidden if noise, **shown if informative**
- [ ] Loading distinguished from empty on anything whose empty state is
      reassuring
- [ ] Built, installed, and **looked at** on a device

That last one matters most. Three layout bugs shipped here because the analyzer
was clean and nobody opened the screen.

---

# APPENDIX — ROLE × DEPARTMENT DASHBOARD MATRIX

Reference table. `general` = Snapshot · Triage · Today · Action queue · Nutrition
reviews · Open alerts · Live activity. `bench` = Critical results · Flag summary ·
Recent reports.

| Role ↓ Dept → | *(none)* | Cardiology | Laboratory | Pathology | Nutrition | Other seeded | Configured |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Doctor** | general | cardiology set | bench | bench | nutrition set | general | as configured |
| **Head doctor** (owner) | general | cardiology set | bench | bench | nutrition set | general | as configured |
| **Doctor's assistant** | general | cardiology set | bench | bench | nutrition set | general | as configured |
| **Lab manager** | bench + Team | bench + Team | bench + Team | bench + Team | bench + Team | bench + Team | as configured |
| **Lab technician** | bench | bench | bench | bench | bench | bench | as configured |
| **Practice manager** | Snapshot only | Snapshot only | Snapshot only | Snapshot only | Snapshot only | Snapshot only | as configured |
| **Dietician** | *(own panel)* | — | — | — | — | — | — |
| **Front desk** | *(own panel)* | — | — | — | — | — | — |

Then every cell is filtered by capability and permission, so a practice on
Essential loses Snapshot everywhere, and a member whose grant has been customised
down loses whatever it no longer covers. Filtering can only **remove** — it
cannot add what the composed list never offered, which is why the lab manager's
list names the Team action explicitly rather than relying on their permission to
produce it.
