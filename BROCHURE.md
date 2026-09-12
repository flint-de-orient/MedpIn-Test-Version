# MedPin — Feature Source Book

**Purpose of this document.** Everything MedPin does today, written so a
brochure, a pitch deck, a website or a sales conversation can be assembled from
it without anybody having to read the code or guess. Every claim here was read
off the implementation on **12 September 2026** and is marked with how far it
actually goes.

**How to read the markers.**

| Marker | Means |
| --- | --- |
| ✅ | Built end to end, backed by tests, safe to put on a brochure. |
| ◐ | Built and working, with a stated limit. Say the limit. |
| ○ | API exists, no screen yet. Do not put on a brochure as a user feature. |
| ✕ | Deliberately not built. Say so if asked; never imply otherwise. |

There is a **§17 Do-Not-Claim list** at the end. In a medical product that
section is the most commercially valuable part of the document: a claim that
cannot survive a demo costs more than the feature would have earned.

---

## 1. What MedPin is, in one paragraph

MedPin is a clinical platform for Indian outpatient practices. A patient gets a
phone app in their own language that carries their medicines, their readings,
their diet plan, their reports and one conversation with their clinic — where an
AI assistant trained on that clinic's own protocols answers between visits, and
a deterministic triage engine escalates anything dangerous to a human the same
second. The practice gets a panel that composes itself: the same app is a
diabetes clinic's dashboard, a cardiology department's, a laboratory bench's or a
practice manager's rota, decided by what kind of organisation it is, what it has
paid for, which department somebody works in and what that person is allowed to
do. Nothing is hardcoded per customer, and nothing is invented for the sake of a
screen.

**One sentence version.** One app, composed per practice, per department, per
role, per plan — with an assistant that only speaks inside the clinic's own
scope.

---

## 2. Who it is for

MedPin models six kinds of organisation. The type is not cosmetic: it decides
what the software will let the organisation do at all.

| Organisation | Signing authority is called | What it gets |
| --- | --- | --- |
| **Clinic** | Head doctor | Prescribing, labs, assistant, analytics |
| **Specialty centre** | Lead consultant | The above, plus departments |
| **Diagnostic centre** | Responsible pathologist | Labs, multiple locations, scheduled reports — **no prescribing** |
| **Polyclinic** | Medical director | Departments, multiple locations, the full clinical set |
| **Hospital** | Medical superintendent | Everything |
| **Healthcare group** | Group medical director | Everything |

The diagnostic-centre row is the one worth showing a prospect. It is not a
pricing decision and not a permissions decision — a diagnostic centre cannot
prescribe because that is not what a diagnostic centre is licensed to do, and
the software refuses it even if an operator switches it on by hand. That is the
argument that the product understands healthcare rather than being a CRM with
medical labels. ✅

---

## 3. The composition engine — the actual differentiator

Most clinical software is one screen with features hidden. MedPin builds the
screen. Seven inputs resolve to one interface:

```
Practice type  ─┐
Plan           ─┤
Operator grant ─┼──►  Capabilities ─┐
                │                    ├──►  Dashboard  ──►  Navigation
Role           ─┼──►  Permissions ──┘      Widgets         Actions
Department     ─┘                           Quick actions   API access
```

**What travels over the wire is a list of names.** The server decides *which*
components appear. It never sends layout, styling, labels or data. The app
refuses a name it does not recognise, and so does the server. A compromised or
mistaken server therefore cannot draw anything it likes on a clinician's phone. ✅

**Precedence is stated, deterministic and tested** — four tiers, in this order:

1. what the practice configured on that department
2. the platform default for that **role**
3. the platform default for that **department**
4. the general clinical set

Rule one: explicit beats default. Rule two: among defaults, role beats
department — a lab technician posted to cardiology is at a bench, not in a
clinic. The API tells the caller which tier answered, so two colleagues with
different screens can find out why without anybody reading source. ✅

**Commercial consequence.** A new department's dashboard is a configuration
write, not a release. Only a genuinely new visualisation needs app work.

---

## 4. The four panels and the console

Which one a person lands in is decided by their role at sign-in. Every role the
server defines is named in one table; a role that is not named resolves to
nothing rather than to somebody else's application. ✅

| Panel | Who | Tabs | Landing |
| --- | --- | --- | --- |
| **Patient app** | `patient` | Home · Assistant · Medicines · Food · Profile | Home |
| **Practice panel** | doctor, doctor's assistant, lab manager, lab technician, practice manager | Home · Care · Nutrition* · Profile | Home (composed) |
| **Front desk** | staff | Today · Patients · Profile | Today |
| **Dietician** | dietician | Dashboard · Patients · Profile | Dashboard |
| **Operator console** (web) | platform admin | Practices · Sign-ups · Billing · Analytics · Audit · Admins · Account | Overview |

\* The Nutrition tab appears when the practice has the AI assistant **or**
employs a dietician. Either is enough — a diagnostic centre that hired a
dietician can see the stream it is paying for. ✅

---

## 5. Roles — eight, each fully decided

Every role has a written permission preset, a written capability exclusion list,
a landing area and a profile label. There is no fall-through: a role added
without a preset throws at startup rather than silently inheriting the
receptionist's access. ✅

| Role | What they are for | Never, whatever the grant says |
| --- | --- | --- |
| **Head doctor** (owner flag) | A doctor who also administers — locations, people, letterhead | — |
| **Doctor** | Consults, prescribes, signs | — |
| **Doctor's assistant** | Works the record beside a doctor: vitals, notes, follow-ups | Prescribe |
| **Dietician** | Diet plans, food-log review, nutrition conversation | Prescribe |
| **Front desk** (staff) | Registration, booking, payment, the day sheet | Prescribe · order a test |
| **Laboratory manager** | Runs the bench: results, reporting, and the people | Prescribe |
| **Laboratory technician** | Enters and reports results | Prescribe |
| **Practice manager** | Rotas, departments, billing — and no clinical record at all | Prescribe · order · read a result · AI |

**Two rows are worth a paragraph each in a brochure.**

*Doctor's assistant.* The line between assisting and practising is enforced in
code, not in a policy document. An assistant granted PRESCRIBE by hand still
cannot sign — the exclusion outranks the grant. ✅

*Practice manager.* The only preset without patient access. Until this role
existed, the only way to employ an administrator was to file them as front-desk
staff and hand them every patient in the building. The server refuses them the
record, not merely the tab. ✅

**Seven permissions**, stored per person per practice rather than derived from a
rank: view patient · edit record · prescribe · manage staff · manage department ·
view audit · share records. Roles do not extend — a practice manager needs
`MANAGE_STAFF` without `PRESCRIBE`, a locum needs the reverse, and neither is
expressible as a hierarchy. ✅

---

## 6. Departments — 18 shipped, unlimited added

Departments are database rows, not a hardcoded list. Eighteen ship as shared
specialties every practice can see; a practice adds its own ("Diabetic Foot
Clinic", "Antenatal Day Unit") without a release. ✅

General Physician · Diabetes & Endocrinology · Cardiology · Gynaecology ·
Paediatrics · Dermatology · Orthopaedics · Psychiatry · Physical Medicine &
Rehabilitation · Neurology · Ophthalmology · ENT · Oncology · Urology ·
Radiology · Pathology · Laboratory · Nutrition & Dietetics

Each department carries four things beyond its name:

- **names** in English, Bengali and Hindi, with fallback ✅
- **clinician dashboard** — which panels and actions its clinicians see ◐ *(API complete; no editor screen — see §17)*
- **patient home cards** — which cards its patients see ◐ *(engine works; only two card keys are wired in the app)*
- **assistant scope** — what the AI covers and what it refuses, per specialty ✅
- **triage rules** — which red flags apply ✅

**The honest default, and it is a selling point.** A new department starts with
*no* assistant scope and *no* triage rules. An assistant improvising cardiology
answers out of diabetes guidance is worse than silence, because neither the
patient nor the reviewing doctor can tell the difference. Inherited triage looks
like safety and is not. ✅

---

## 7. Patient app — what a patient actually gets

### 7.1 One conversation, not an inbox ✅

The AI assistant, the doctor and the dietician all speak in the same thread,
each labelled. A patient never learns a second inbox and never has to guess who
replied.

- **Answers from the clinic's own protocols.** Retrieval over a knowledge base
  the doctor writes, not generic web advice. Replies carry tappable citations
  back to the source.
- **Scoped per specialty.** Outside its department's scope it says so and hands
  off rather than guessing.
- **Three languages** — English, Bengali, Hindi — with a language guard on the
  model's output, so a Bengali question does not come back in English.
- **Voice messages** — tap to record with a live waveform, up to 10 minutes,
  server-transcribed so the assistant can answer a spoken question and the
  triage rules can read it. Both sides can play back and scrub.
- **Attachments** — camera, gallery, PDF, Word, Excel, text. Images compressed
  before upload.
- **Thread craft** — reply-to-quote, pinned messages, date separators, delivery
  and seen marks, jump-to-latest, edit, report a reply for clinical review.
- **Call the clinic** from the header — the clinic's number, never a doctor's
  personal line.

### 7.2 Safety, and the sentence that sells it ✅

> Rules decide urgency. The model may raise it and can never lower it.

A deterministic triage engine runs **before** the model on every message. It
reads glucose values, blood pressure, SpO₂, temperature, pulse and red-flag
phrases — including numbers written in Bengali and Hindi digits. An emergency
verdict shows an emergency card and dials the clinic's emergency number, and
raises a clinical alert on the doctor's side in the same moment. ✅

The emergency number has no default. A deployment that forgets to set it gets a
refusal, not a placeholder — because a placeholder is a fake number handed to
somebody with chest pain. ✅

### 7.3 Medicines ✅

- Current medicines with dose, timing and duration.
- **Scan a paper prescription** — photograph it, the app reads the medicines off
  it, the patient confirms before anything is saved.
- **Your own meal times** — set breakfast, lunch and dinner so "after breakfast"
  means *your* breakfast.
- **Three-tier reminder reliability** — local rolling-window alarms with a
  server-side push backstop, and the reminder stops once the dose is marked
  taken. Dose history and an adherence figure.
- Reminder health card: the app tells the patient when its own reminders are at
  risk (permissions revoked, battery optimisation) rather than failing silently.

### 7.4 Readings and records ✅

Glucose (mg/dL or mmol/L, applied everywhere), HbA1c history as a trend,
vitals — BP, pulse, SpO₂, temperature, weight, waist — lifestyle logs, and a
health profile with conditions, allergies and diagnosis detail.

**Conditions are rows, not columns.** A patient with diabetes and hypertension
has detail on each; the Home screen's cards follow the conditions they actually
have. ✅

### 7.5 Food and diet ✅

The dietician conversation **is** the food log: a photo sent there becomes a log
entry server-side. Day-by-day history. The diet plan the dietician writes
arrives in the same care thread as readable text — headings and bullets, not a
custom card — so it survives translation, can be copied, and still makes sense
when the patient screenshots it for whoever cooks at home.

### 7.6 Appointments ✅

See what is booked, request a time, and see a request that was declined — with
the reason. Before this existed, the first a patient knew of a confirmed slot
was the reminder the evening before.

### 7.7 Specialty care ◐

**Foot assessments** and **eye reports** with wound progression tracking and
patient education. Built and working; currently reachable from the clinical
record rather than as their own patient-facing tab.

### 7.8 Reports ✅

Lab tests the doctor advised, reports the patient uploaded against them, and an
AI summary of a report with per-analyte values, units, reference windows and
low/normal/high/critical flags read from a real analyte catalogue.

### 7.9 Household ✅

One phone can carry more than one person — a parent managing a child's or an
elderly relative's care. The switcher appears only when there is more than one
name, because a switcher above a single name is a control answering a question
nobody asked.

### 7.10 The patient's own settings ✅

Light/dark/system theme · three languages · glucose unit · per-category
notification switches · app lock behind device PIN or biometric · send feedback
about the clinic or about the app.

**Feedback is kept out of the clinical queue on purpose.** "The app is slow" and
"I have chest pain" must not share a list.

---

## 8. Practice panel — the clinical day

### 8.1 The composed home screen ✅

Everything refreshes on a 20-second timer, on resume and on pull-to-refresh, and
the screen says when its data was actually pulled. There is no hardcoded
"updated just now".

Eleven panels exist, and which of them a person sees is the engine's answer:

| Panel | What it is | Gate |
| --- | --- | --- |
| Clinic snapshot | Trends over a window the reader chooses | Advanced analytics |
| Triage queue | Who needs a doctor now, ranked | View patient |
| Today's clinic | The day's appointments, and how many are done | View patient |
| Action queue | Alerts, unread messages, flagged chats, requests | View patient |
| Open alerts | Raised alerts, with an explicit all-clear state | View patient |
| Live activity | What the practice has been doing — context, not work | View patient |
| Nutrition reviews | Diet plans falling due | View patient |
| Critical lab results | Reports holding a value flagged critical | Lab result |
| Recent lab reports | Newest by tested-on date | Lab result |
| Lab flag summary | How many values came back low, high or critical | Lab result |

Nine quick actions under the same rule: start consultation · add patient ·
record vitals · write prescription · alerts · lab reports · export · team ·
departments. Every one opens a route that exists — a button that goes nowhere is
worse than an absent one, because somebody presses it in front of a patient. ✅

### 8.2 What five people see on the same install ✅

This is the demo that sells the engine. One deployment, five sign-ins.

| Who | Home screen |
| --- | --- |
| **Doctor, diabetes clinic** | Snapshot chart, triage queue, today's clinic, action queue, nutrition reviews, open alerts, live activity |
| **Doctor, cardiology** | Triage queue, today's clinic, **recent lab reports**, action queue, open alerts — no snapshot, no nutrition |
| **Lab technician** (anywhere) | Critical results, flag summary, recent reports. No appointments, no consultations, no prescribing |
| **Lab manager** (anywhere) | The bench, plus the team action |
| **Practice manager** | Analytics only, and team · departments · export. No patient panel, because they hold no patient permission |

The lab rows carry a real story. Filed as front-desk staff, the bench lost the
ability to order — correctly, because a receptionist must not order clinical
investigations — and the result was a laboratory that could read a critical
result and could not begin the work that produced it. Two dedicated roles fixed
it. ✅

### 8.3 Care — the patient inbox ✅

A working inbox, not a directory. Unread first, then most recent. Last message
preview with who spoke last, timestamp, unread badge, live patient photo, a
media icon for an attachment turn. Search by name or phone, an unread filter,
and a 3-second poll so a new message arrives without a manual refresh.

### 8.4 The patient record ✅

Header: photo, name, age, sex, patient ID, risk band with a warning glyph only
when the band earns it. Call and Message.

Inside: health score, adherence, average glucose, time in range, estimated
HbA1c, HbA1c history as a trend rather than one value, test reports, recent
alerts, current medicines, vitals history, conditions and allergies, and
**assistant context** — exactly what the AI was given before it answered, so any
reply can be audited afterwards.

### 8.5 Consultation ✅

A three-step consult: **vitals → diagnosis → advice**, persisted at each step,
so a refresh does not lose the consultation. From there: prescription, lab
orders, follow-up date.

### 8.6 Prescription ✅

Medicine name with autocomplete from a shared practice dictionary, strength,
dose, frequency as a breakfast/lunch/dinner toggle that maps onto the patient's
own reminder slots, duration, before/after/with food, free-text instruction.

- **Sending is blocked** if a medicine has no name, or no B/L/D selected — a
  medicine with no schedule reaches the patient's tracker with no reminder
  times and silently never reminds them.
- **A PDF on the practice letterhead**, with the doctor's qualifications,
  registration number and digital signature. The signature is previewed as it
  will print — on white, always, because it is cut out on transparency and
  prints onto paper.
- **Only a doctor can prescribe.** The create route records the prescribing
  doctor; a receptionist writing one would have stored *them* in that field and
  printed their name as the prescriber. That is not a permission slip, it is a
  false medical record. ✅
- A doctor whose registration number the platform has not verified holds the
  permission and still cannot sign. The permission is what the practice allows;
  verification is what the platform allows. ✅

### 8.7 Clinical alerts ✅

The triage queue filtered by open / acknowledged / resolved / all, with
acknowledge and resolve. Emergency and urgent alerts push to the clinic's
phones; nothing below that does, so the ones that push stay meaningful. Only a
doctor may resolve one — "this patient no longer needs a doctor" is a judgement
only a doctor can make.

### 8.8 Practice administration ✅

| Screen | What it does |
| --- | --- |
| **Practice** | Letterhead, locations, opening hours, departments, people, food-log review interval |
| **People** | Everyone here, with role, department, location, owner/suspended/left state, and seat-limit awareness |
| **Departments** | The practice's departments and specialties |
| **Plan and billing** | What you are on, what you are using, and what it costs |
| **Export** | Patients, alerts and figures as CSV or JSON |
| **Chat review** | Every assistant reply a patient reported, with the full exchange |
| **Knowledge base** | The clinic's own protocols — add, edit, approve, retire. Each entry is embedded and becomes what the assistant retrieves from |
| **Patient feedback** | Ratings and comments, filterable, with mark-reviewed |

**Two deliberate ungatings worth mentioning.** Plan and billing is readable by
any doctor, not gated on a billing permission — knowing the clinic is on a trial
ending on the 14th is not privileged, and hiding it until somebody holds a
permission is how a practice discovers its plan by being cut off. The buttons
inside are gated; the screen is not. Similarly, the team list is readable by any
clinician — the desk needs to know which doctor is in — while what a reader may
*change* is answered by the payload rather than by hiding the list. ✅

---

## 9. Front desk ✅

Its own application, because its work genuinely is different — a day sheet and a
registration queue, not a caseload.

- **Today** — the day's schedule, appointment requests to accept or decline,
  check-in, and the registration queue.
- **Patients** — register a patient with phone verification, search, open a
  record, see prescriptions, open the care thread.
- **Clinics** — set up the practice's first location. The desk keeps this
  deliberately: on a first run it is usually the receptionist who does the
  setup, and gating it on a management permission would break that path for most
  practices.
- **Profile** — own photo, own details, app lock, language, theme.

The desk cannot prescribe, cannot order a test and cannot resolve a clinical
alert — enforced server-side, not by hiding a button. ✅

---

## 10. Dietician panel ✅

- **Dashboard** — a time-aware greeting, counts for patients/reviews/plans
  tinted only when non-zero, and an action queue of the outstanding work.
  Reviews rank above plans, because care going stale outranks care not yet
  started, and longest-waiting first within each. A patient in both lists
  appears once. "All caught up" replaces the queue only when it is genuinely
  empty — a green tick over outstanding work is worse than no tick.
- **Patients** — every patient in the practice, unless the doctor has explicitly
  assigned patients to this dietician, in which case only those. Enforced
  server-side; a patient outside the scope is unreachable even by URL.
- **Patient overview** — facts, allergies called out separately as the one thing
  a diet plan must not get wrong, current medicines, food log with photos.
- **Diet plan editor** — goal in the patient's own terms, meals with free-text
  names and times (an Indian day is not breakfast/lunch/dinner, and "before
  namaz" has to be sayable), one editable line per item, a "best avoided" list,
  and a general notes field. Plan revisions are kept with history.
- **Save and Send are separate buttons**, and the plan card states which:
  *Not sent yet* · *Edited since it was last sent* · *Sent 4 Aug · Ritu Sen*. A
  finished-looking plan the patient has never seen is a draft, and the card says
  so instead of looking done.

**Assignment is a restriction, not a requirement.** A clinic has one or two
dieticians and hundreds of patients, so requiring an assignment per patient made
"nobody is watching this patient's diet" the default. By default a dietician
sees everyone; explicit assignment narrows them. ✅

---

## 11. Appointments ✅

Full lifecycle: request → confirm → reschedule → cancel → check-in → consult →
complete, with a waitlist that is notified when a slot frees, a today queue,
availability per doctor per location, double-booking refusal, and clinic-local
time handling.

Notifications on both sides: the clinic is told when a patient requests or
cancels, the patient is told when a request is confirmed or declined **and
why**, and both get a visit-tomorrow reminder plus an evening schedule digest.

---

## 12. Laboratory ◐

**What is real.** Lab reports with files, per-analyte values, units, reference
windows and low/normal/high/critical flags from a real analyte catalogue;
AI-assisted report reading; patient association; lab tests the doctor advised;
a practice-wide lab overview (critical results, flag counts, recent reports);
review-by attribution; permission-gated access.

**What is deliberately absent, and this is a strength to state rather than a gap
to hide.** There is no specimen queue, no "12 pending, 4 processing", no
turnaround-time figure and no collected→received→processing→validated lifecycle.
MedPin has no sample model, so four numbers of that kind would have nothing
behind them. A registered panel with no data behind it is not a placeholder — it
renders empty forever and reads as *a clinic with no work* rather than as a
feature that was never built. ✕

A laboratory dashboard therefore shows what came back abnormal, which is a real
and genuinely more useful screen than who is in the waiting room. If a specimen
workflow is required, the data model comes first.

---

## 13. Plans, billing and payment ✅

Four plans. A plan is a name and a set of capabilities and nothing else — it
carries no price, because the price lives in the Razorpay dashboard where it can
change without a deploy, and no numeric limit, because limits are per practice
so a customer who negotiates an extra location does not need a plan invented for
them.

| | Trial | Essential | Professional | Enterprise |
| --- | --- | --- | --- | --- |
| Patients | 50 | 1 000 | 5 000 | unlimited |
| Staff seats | 5 | 10 | 25 | unlimited |
| Locations | 2 | 1 | 5 | unlimited |
| AI replies / month | 2 000 | 1 000 | 5 000 | unlimited |
| Prescribing | ● | ● | ● | ● |
| Lab order & result | ● | ● | ● | ● |
| AI assistant | ● | ● | ● | ● |
| Departments | ● | — | ● | ● |
| Multiple locations | ● | — | ● | ● |
| Advanced analytics & reports | ● | — | ● | ● |
| Report export | ● | — | ● | ● |
| Department analytics | ● | — | ● | ● |
| Staff analytics | ● | — | ● | ● |
| Scheduled reports | ● | — | — | ● |

**The trial is the widest tier on purpose.** Somebody deciding whether to buy
should be looking at the product, not at a version of it with the interesting
parts removed. A trial that cannot demonstrate what is being sold converts
nobody.

**A capability must clear two independent ceilings** — the organisation's type
and the plan — and an operator's manual grant is re-checked against the type. A
grant cannot make a diagnostic centre prescribe. ✅

**Razorpay, end to end.** Subscription creation, checkout, signature
verification, webhook with its own separate secret, plan change at cycle end,
pause, resume, refresh-from-Razorpay, cancel, invoice ledger, revenue reporting,
trial extension and grace periods from the operator console. ✅

Two sentences worth keeping verbatim:

> A subscription is never activated on the strength of a frontend success. The
> backend verification is authoritative.

> The API secret and the webhook secret are different things and are not
> interchangeable. Using the API secret to check a webhook signature is the
> commonest way this integration is got wrong, and it fails open — every forged
> "payment succeeded" is accepted.

**Blank keys are a working state.** With no Razorpay key the billing surface is
simply off. A half-configured payment integration is worse than an absent one:
it takes money and cannot confirm it. ✅

**A lapse restricts growth, not care.** When retries are exhausted there is a
configurable grace window — seven days by default, long enough to reach a
practice manager who is on leave, short enough that a lapse is not free service.
Clinical reading is never withheld: a doctor's own caseload is not a premium
feature, and a plan lapse must not hide it. ✅

---

## 14. Operator console (web) ✅

A separate Next.js application with its own authentication, for the people who
run the platform rather than a practice.

| Page | What it does |
| --- | --- |
| **Overview** | Platform health, practices needing attention |
| **Practices** | Create, edit, verify, suspend, change plan, edit a member's permissions, and **see what a type and a plan add up to** — every capability, whether the practice has it, what is blocking it (type or plan) and what a member still needs |
| **Sign-ups** | Practice applications: claim, request more information, reject, approve, provision |
| **Billing** | Plans, subscriptions, revenue, extend a trial, pause, resume, grant grace |
| **Analytics** | Platform-level figures |
| **Audit** | Who did what, when, to which resource, filterable by action |
| **Admins** | Platform administrators |
| **Account** | Own credentials, passkeys, TOTP |

**The capability explainer deserves its own brochure line.** `DEPARTMENT` clears
three independent gates — the type must be one that has departments, the plan
must pay for them, and the person must hold the permission. Miss any one and the
app draws nothing, deliberately, because a greyed section on a screen a solo
doctor opens weekly is a permanent advertisement for something that will never
apply to them. That is right for the doctor and useless for the operator who has
just set a practice up and is looking at a screen with no departments on it. The
console says which gate is closed, and names type before plan when both are —
because a plan is a sale and a type is what the organisation is. ✅

**Admin authentication** is deliberately strong: password, email verification,
passkeys (WebAuthn), TOTP, phone OTP, and its own session and audit trail,
separate from the clinical one. ✅

---

## 15. Cross-cutting

### Security ✅

- Phone-number ownership is **proved, not typed**. Hiring somebody takes a token
  proving the number was answered — a regex tests the shape of a phone number
  and nothing about who holds it, and one mistyped digit means the account
  belongs to whoever owns the number typed instead. For a doctor, that account
  can prescribe.
- Tenant isolation on every clinical query; a patient at another practice is not
  reachable even by URL.
- Confirming an id exists is itself an answer, so cross-tenant reads return
  *not found* rather than *forbidden*.
- Refresh-token rotation, session expiry, bcrypt password hashing, Helmet, CORS,
  rate limiting, Zod validation on every write, file-upload type and size
  validation, authenticated media serving.
- Webhook and checkout signature verification with separate secrets.
- No secret has a working default. Production is checked at boot.

### Audit ✅

Two trails, deliberately separate. **Clinical**: actor, actor role, action,
resource, resource id, subject patient, IP, user agent, timestamp — on record
reads, writes, exports and logins. **Operator**: every administrative action in
the console. A membership that ends keeps its row, because a receptionist who
worked here until March registered patients and answered messages, and the audit
log points at a person who must still resolve to a name.

### Notifications ✅

FCM push, SMS, and email for the console only — because a clinic's patients do
not reliably have email and do reliably have a phone.

Deliberately narrow. Clinicians are pushed for emergency and urgent clinical
alerts, appointment changes, an evening digest and the tomorrow schedule.
Patients are pushed for medicine reminders, appointment confirmations and
declines, prescription delivery, a glucose check-in nudge, a lab upload nudge,
and emergency alerts on their own account. **If every message buzzed, the
emergency buzz would be the one that gets ignored.**

### Languages and accessibility ✅

English, Bengali and Hindi across 701 translated strings, with each language
offered in its own script so a Hindi speaker can find "हिन्दी" while the app is
still in English. Body text has a 16px floor and every colour was measured
against the surface it actually sits on — this clinic's patients are largely
elderly and many have diabetic retinopathy. Every status tone ships with a word,
never a colour alone, because red-green deficiency runs alongside diabetes.
48px minimum tap targets, semantic labels, and text-scaler-aware layout.

### Engineering ✅

| | |
| --- | --- |
| Data models | 50 |
| API endpoints | 247 across 30 route modules |
| Backend services | 64 |
| Flutter source files | 259 |
| Backend test files | 108 — **1 640 of 1 642 assertions passing** |
| Flutter test files | 38 |
| Analyzer | **0 errors, 0 warnings** |
| Translated strings | 701 × 3 languages |
| Operational scripts | 33 — 8 data backfills, 6 seeds, and audit/repair tooling |

Verified on 12 September 2026. The two failing assertions are stale
source-string tests left behind by the roles refactor, not a defect in the
product — see §17.

---

## 16. Brochure copy — ready to lift

**Headline options**

- One app. Every practice. Composed, not configured.
- The clinic's own protocols, answering at two in the morning.
- Rules decide urgency. The model may raise it and can never lower it.
- A dashboard for a cardiologist, a bench and a practice manager — from one install.

**Three-bullet version**

- **Composed, not customised.** The screen is built from your practice type,
  your plan, your departments and each person's role. A new department's
  dashboard is a setting, not a software release.
- **Safe by construction.** A deterministic triage engine runs before the AI on
  every message and can only be escalated, never overruled. Every sensitive
  action is refused at the server, not hidden in the app.
- **Nothing invented.** No fabricated scores, no placeholder queues, no numbers
  with nothing behind them. Where there is no data, the app says so.

**The differentiator paragraph**

> Most clinical software is one product with features switched off. MedPin builds
> the interface. A doctor in cardiology, a technician at a bench and a practice
> manager who may not read a patient record sign in to the same installation and
> get three genuinely different applications — because the server sends a list of
> component names resolved from the organisation's type, its plan, the
> department and that person's permissions, and the app draws only what it
> recognises. Adding a specialty is a configuration write. Adding a role is a
> table entry that the build refuses to let anybody leave half-finished.

**The safety paragraph**

> Every patient message passes a rule engine before it reaches a language model.
> The rules read glucose values, blood pressure, oxygen saturation, temperature,
> pulse and red-flag phrases — including numbers written in Bengali and Hindi
> digits — and the verdict they reach can be raised by the model but never
> lowered. An emergency shows the emergency card, dials the clinic's emergency
> number, and puts an alert in front of a doctor in the same second. The
> emergency number has no default value: a deployment that forgets to set it is
> refused rather than handing somebody with chest pain a placeholder.

---

## 17. Do not claim — and what to say instead

The list that protects the sale. Each of these is either not built, built with a
limit, or a decision that will be asked about.

| Do not say | Say |
| --- | --- |
| "ECG monitoring" | Not built. There is no ECG data model, source, or API. A fake waveform on a cardiology screen is the one defect a cardiologist will spot in ten seconds. |
| "Cardiac risk scoring" | Not built, on purpose. Framingham, QRISK and ASCVD are validated instruments, not arithmetic. A number labelled "cardiac risk" would be read as a validated score. If required: name the instrument, define its inputs, then build it. |
| "Specimen tracking" / "lab turnaround times" | Not built. There is no sample model. The laboratory dashboard shows what came back abnormal, which is the more useful screen. |
| "Drag-and-drop dashboard builder" | The **API** is complete and validated — a practice can compose a department's dashboard, and an unknown component name is refused at write time with the name it did not know. There is **no editor screen** yet; today it is an API call or an operator action. Sell it as "your dashboards are configuration, not code", not as a builder UI. |
| "Any role can be added from the app" | The server accepts all seven practice roles and the permission system is complete for all of them. The in-app "Add someone" sheet still offers only Doctor / Front desk / Dietician. The four newer roles must be created through the API or the console until that sheet is widened. **This is the top production gap.** |
| "Patient home adapts to every condition" | The engine resolves cards per condition and per department correctly. The app currently gates two card keys (`glucose`, `diet_plan`); `hba1c`, `medications` and `blood_pressure` are resolved but always shown. Say "condition-aware home screen", not "fully composable patient home". |
| "Fully offline" | There is an offline banner and local reminder alarms. There is no offline clinical write queue. |
| "HIPAA compliant" / "ISO certified" | No certification has been obtained. Describe the controls — audit trail, tenant isolation, permission enforcement, signature verification — not a certification. |
| "Staging-verified releases" | There is no staging environment today; the backend deploys from a git remote and restarts under a process manager. Do not describe a pipeline that does not exist. |
| "Dark mode" | The theme selector is hidden behind a flag that is currently off. Do not show it in screenshots. |
| "Multi-practice ready today" | The data model, migration and guards are shipped and live. Two guards are deliberately inert, and a second doctor account at one practice currently breaks booking. Safe to say "built for multi-practice"; not yet safe to onboard a second practice without clearing that. |

**One more, and it is the most important.** MedPin's own rule is that no screen
displays a number it cannot source. Say that out loud in a pitch. It is unusual,
it is true here, and it is the claim a clinician will test first.

---

## 18. Where the detail lives

| Document | What it holds |
| --- | --- |
| `UI_DESIGN.md` | Every screen of every panel, tab by tab, with the visual specification |
| `API_CONTRACT.md` | Endpoint shapes |
| `DOCTOR_PANEL_WORKFLOW.md` · `PATIENT_PANEL_WORKFLOW.md` · `DIETICIAN_PANEL_WORKFLOW.md` | Per-panel walkthroughs |
| `AI_ASSISTANT_WORKFLOWS.md` | Assistant, retrieval and triage behaviour |
| `PROJECT_STATUS.md` | Delivery state |
| `backend/src/services/capabilities.js` | The capability resolver, and why each rule exists |
| `backend/src/services/uiConfig.js` | The widget registry and the precedence rules |
| `mobile/lib/core/theme/tokens.dart` | The design system |
