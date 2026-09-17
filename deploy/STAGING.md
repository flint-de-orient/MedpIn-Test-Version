# Staging

A second MedPin on the same box: its own port, its own database, its own
uploads, its own secrets. Roughly forty minutes to stand up, once.

## Why this exists

Every deploy so far has gone local → production. `verifyIsolation.js` has never
had anywhere to run. The release checklist has a dozen items that cannot be
answered without somewhere to answer them in — migrations against realistic
data, a payment lifecycle end to end, backward compatibility on a copy of real
rows.

Staging is not a nicety here. It is the thing that makes the rest checkable.

## The one thing that can go badly wrong

A staging box holding production's messaging credentials can text and push real
patients.

This is not a hypothetical mistake, it is the *expected* one — the fastest way
to stand up a second environment is to copy the first one's `.env`, and every
outward channel in this application is credential-gated in a way that fails
silent-and-safe when omitted. Which means omitting them looks exactly like
forgetting to set them up, and copying them looks like nothing at all.

So `DEPLOY_ENV=staging` is in the template, and the server checks itself:

```
$ curl -s https://staging.clinq.flintdeorient.in/api/v1/health
{"status":"ok","db":"connected","config":"degraded","degradedCount":1,...}
```

`GET /api/v1/admin/readiness`, as an operator, says which and why.

---

## 1. Database

Its own database, not a prefix inside production's. The name is the boundary —
a shared database is one forgotten filter away, and the scripts in
`backend/scripts/` operate on whatever they are pointed at.

```bash
mongosh --eval 'db.getSiblingDB("medpin_staging").createCollection("_init")'
```

## 2. Working copy

```bash
sudo mkdir -p /var/www/clinq-staging
sudo chown "$USER" /var/www/clinq-staging
git clone git@github.com:flint-de-orient/ClinQ.git /var/www/clinq-staging
cd /var/www/clinq-staging/backend && npm ci --omit=dev
mkdir -p /var/www/clinq-staging/uploads
```

A separate checkout rather than a second branch in the same one. A shared
checkout's failure mode is production running staging's code in the window
between a `git checkout` and a `pm2 restart` — which nobody would think to look
at afterwards.

## 3. Configuration

```bash
cp /var/www/clinq/deploy/staging.env.example /var/www/clinq-staging/backend/.env
$EDITOR /var/www/clinq-staging/backend/.env
```

Generate fresh secrets — do not copy production's:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 48   # ADMIN_JWT_SECRET
```

Fresh values mean a token minted on staging cannot be presented to production.
Copying them makes the two environments one trust domain, which undoes most of
the reason for having two.

## 4. Process

```bash
pm2 start /var/www/clinq/deploy/ecosystem.config.cjs --only clinq-staging
pm2 save
pm2 logs clinq-staging --lines 50
```

The boot log is worth reading once. Anything misconfigured is warned about by
name, and anything switched off is listed.

## 5. Apache

```bash
sudo cp /var/www/clinq/deploy/apache/staging.clinq.flintdeorient.in.conf \
        /etc/apache2/sites-available/
sudo certbot --apache -d staging.clinq.flintdeorient.in
sudo a2enmod proxy proxy_http headers ssl
sudo a2ensite staging.clinq.flintdeorient.in
sudo apache2ctl configtest && sudo systemctl reload apache2
```

(A records for `staging.clinq.flintdeorient.in` first, obviously.)

## 6. Prove it

```bash
cd /var/www/clinq/backend
node scripts/smoke.mjs https://staging.clinq.flintdeorient.in
```

Twelve checks, all read-only, exit non-zero on any failure. It does not create
a record, send a message, or cost money — every request is a GET or a
deliberately-unauthorised one whose correct outcome is a refusal.

---

## Deploying to staging

```bash
cd /var/www/clinq-staging
git fetch flint && git checkout <branch-or-sha>
cd backend && npm ci --omit=dev
pm2 restart clinq-staging
node scripts/smoke.mjs https://staging.clinq.flintdeorient.in
```

Then production, unchanged from today:

```bash
cd /var/www/clinq && git pull && cd backend && npm install
pm2 restart clinq
node scripts/smoke.mjs https://clinq.flintdeorient.in
```

### Once, after deploying the knowledge scoping

Before that change, a passage written on the app's knowledge screen was saved
with no practice — which makes it shared, cited by every practice's assistant.
Shared passages are now read-only from the app, so a practice's own passages
stay read-only to it until this hands them back:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
mongosh --quiet --eval 'db.getSiblingDB("medpin_staging").practices.find({}, { name: 1 })'
node scripts/backfillKnowledgePractice.js --practice <practiceId>            # dry run
mongodump --db medpin_staging --collection knowledgechunks --out ~/dumps/knowledge-before-backfill
node scripts/backfillKnowledgePractice.js --practice <practiceId> --apply
```

The script reads `.env` from the directory it is run in, and that file alone
decides which database it writes to — run it from the deployment's own
`backend/`. For production, `medpin_staging` above becomes the database named in
production's `MONGODB_URI`.

It adopts passages that have no practice and whose `docId` is not in the seed,
so the platform's seeded clinical content stays shared. Passages record no
author, so it cannot tell which practice wrote one: where more than one practice
has written knowledge, read the dry run before applying. A second run adopts
nothing.

### Before deploying the concurrency fixes: split conversations

The rule that a patient has one conversation per practice (per department, per
kind) was declared as a unique index with options MongoDB refuses to combine,
so it was never built in any environment. Two replies arriving together could
each create the conversation, and the thread split in two. This release fixes
the declaration and builds the index at startup — but a unique index cannot be
built over data that already breaks it. Check first:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/checkDuplicateConversations.js
```

Exit 0 means the index will build. Exit 1 lists each split conversation and the
message count in each half. The deploy is still safe with splits present: the
index build fails and is logged, and conversations keep behaving exactly as
they do today. Joining the halves rewrites message order in a clinical record,
so it is a separate, reviewed step — do not improvise it.

Two counters also start with this release, for prescription references and
queue tokens, plus one per conversation for message order. Each seeds itself
from the highest number already issued the first time it is used, so there is
nothing to run — but a prescription reference issued during the deploy window
by the old process could, in principle, be issued again by the new one. Deploy
outside clinic hours.

### Once, after deploying banded clinic readings

A blood pressure or sugar a patient logged was stored with its clinical band;
the same numbers taken in a consultation or at registration were stored with
none, so anything asking "whose blood pressure is out of control" skipped every
reading the clinic itself took. New clinic readings are banded; this bands the
ones already recorded:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillReadingBands.js                                         # report
mongodump --db medpin_staging --collection vitalrecords --out ~/dumps/bands-before-backfill
mongodump --db medpin_staging --collection glucosereadings --out ~/dumps/bands-before-backfill
node scripts/backfillReadingBands.js --apply
```

Only unbanded rows are written; a reading with a band keeps it. **No alerts are
raised** — these are history, and paging a doctor today about a crisis reading
from March would be noise wearing the look of an emergency. A second run
changes nothing.

### Once, after deploying the medicine lifecycle (C3)

A patient's "Stop" and a doctor's stop wrote the same `isActive: false`; a
finished course stayed on the list with its reminders; and a new prescription
matched the running list by name alone, so metformin 1000 mg replaced 500 mg
and one practice's prescription overwrote another's. Medicines now carry the
practice that prescribed them and two separate states — the prescription's
(active, completed, stopped by the doctor, cancelled) and the patient's
(taking, stopped). This gives the rows already on record the same:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillMedicineLifecycle.js                                    # report
mongodump --db medpin_staging --collection medications --out ~/dumps/medicines-before-lifecycle
mongodump --db medpin_staging --collection prescriptions --out ~/dumps/medicines-before-lifecycle
node scripts/backfillMedicineLifecycle.js --apply
node scripts/backfillMedicineLifecycle.js                                    # report again: all zeros but "ambiguous"
```

- **Ambiguous rows are listed, not guessed**: a doctor who works at two
  practices, for a patient enrolled at both. They stay without a practice, and
  only the practices their prescriber works at may change them. Read the list;
  set any that matter by hand.
- Old stopped medicines become `ended_legacy` — ended before anybody recorded
  whether a doctor or the patient stopped them. Nothing is attributed.
- Medicines the patient typed in themselves, recorded as the clinic's, are
  relabelled `manual`.
- Nothing breaks before it runs: old rows read their state from `isActive`, and
  a renewal by the same doctor adopts their row rather than duplicating it. Run
  it in the same window anyway — until it does, a renewal by a *different*
  doctor at the same practice adds a second row beside the old one.
- **The app**: builds from before this still work — `isActive` means what it
  always meant. The new build is what gives patients "Stop taking", and stops
  weekly, alternate-day and finished medicines ringing daily on the phone.

### Once, after deploying the dietician caseload (C1 + C7)

Two changes to who looks after a patient's nutrition, and one migration for
both.

A dietician's caseload was "everyone at the practice, unless somebody has been
assigned to me", so a second dietician or a locum inherited the whole practice
the day they were hired. It is now exactly the patients assigned to them.

And the assignment moved. It was `PatientProfile.assignedDietician` — one field
per patient — so a patient enrolled at two practices could be held by only one
practice's dietician, and the second practice's choice took the patient from
the first. It is now on the enrolment (`Enrollment.dietician`, with
`dieticianSource`, `dieticianSince`, `dieticianBy` and `dieticianHistory`), and
**nothing reads the profile field any more**. Without this migration, every
assignment a doctor made before the release vanishes from the dietician's list,
and a one-dietician practice's dietician opens the app to nobody.

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
# 1. Backup — the rollback. The profile field is left untouched, but take it too.
mongodump --db medpin_staging --collection enrollments     --out ~/dumps/diet-before-c7
mongodump --db medpin_staging --collection patientprofiles --out ~/dumps/diet-before-c7
# 2. Dry run, and read it.
node scripts/backfillDieticianAssignments.js
# 3. Apply.
node scripts/backfillDieticianAssignments.js --apply
# 4. Verify: a second report should show 0 to carry and 0 to assign.
node scripts/backfillDieticianAssignments.js
```

What the report means:

1. **Carried over** — each profile assignment is written onto the enrolment at
   the practice where that dietician works or worked (a dietician who has left
   is carried too: it is history), marked `migration`, with no date because
   none was recorded.
2. **Not carried — never worked where the patient is enrolled**: the field
   named another practice's dietician. It granted nothing before; it is left
   behind so it grants nothing now.
3. **Not carried — works at more than one of the patient's practices**: which
   practice it was is not in the data. Listed by patient id; the doctor
   assigns on the patient's profile.
4. **Assigned by default** — at a practice with exactly one *active*
   dietician, every current enrolment nobody has decided for. A practice with
   two or more is listed and left alone: the choice is the doctor's.

Every write repeats "nothing decided yet", so a doctor's decision made between
the dry run and the apply — including deliberately unassigning — is kept, and
a second run changes nothing.

**Run it in the same maintenance window as the deploy**, and after the
enrolment backfills (`backfillEnrollments.js`, `backfillDeskRegistrations.js`):
it can only assign a relationship that exists.

**The app.** Older builds keep working: the patient summary still sends
`profile.assignedDietician` as `{ _id, name, phone }` (now from this
practice's enrolment, and null for a dietician no longer active), and the
assignment route still answers `assignedDietician` and `reviewIntervalDays`.
What only the new build shows: a dietician who has left, the history of who
held the patient, and "somebody changed this a moment ago" when two doctors
choose at once.

**Rollback**: restore `enrollments` from the dump, then roll the code back. The
old code reads the profile field, which this never changed.

### Staff passwords (§30) — nothing to run yet, and what comes next

From this release nobody can set a colleague's password: `POST /team` refuses a
hire that carries one (`PASSWORD_NOT_ALLOWED`), the app's hire sheet no longer
offers one, and every account created since signs in with a code texted to its
own number. **Existing passwords keep working** at `POST /auth/login` — that is
the migration policy until the product owner approves a date to retire them.

Before that date, in this order:

```bash
cd /var/www/clinq/backend
# 1. Who still holds a password, and who still relies on it. Reads only.
node scripts/reportStaffPasswords.js
```

2. For each account marked "still relies on the password" — in practice the
   counter handsets — sign the handset in **once** with a code. It then stays
   signed in: the app renews its own session (refresh tokens, 60 days,
   renewed on use), so nobody types or shares anything at the counter. A desk
   with two lines gets its second number with
   `node scripts/addLoginNumber.js "<desk name>" <number> --apply`, and either
   line receives the code.
3. Run the report again until nobody relies on a password.
4. Only then, as its own reviewed release: a script to remove the hashes (dry
   run / `--apply`, mongodump of `users` first), the `/auth/login` route, and
   the "Sign in with a password" link. Not written yet, on purpose — the date
   is a product decision.

`scripts/seed.js` still gives its synthetic demo accounts passwords. It builds
demo data for staging and a laptop, never production; retire it with step 4.

### Once, after deploying appointment isolation

An appointment carried a patient, a doctor and sometimes a clinic, and no
practice. "One open request at a time" was therefore a query with neither
practice nor doctor in it, so a patient enrolled at two clinics who asked the
second one rewrote the row sitting in the first one's diary. New appointments
now record whose diary they are in, and the database enforces one open request
per patient per practice. This gives the existing rows the same answer:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillAppointmentPractice.js                                  # report
mongodump --db medpin_staging --collection appointments --out ~/dumps/apptpractice-before-backfill
node scripts/backfillAppointmentPractice.js --apply
```

The clinic answers it where there is one; a teleconsult falls back to the
doctor's current membership. A doctor who has left leaves the row unplaced and
reported — every route still scopes by doctor, so an unplaced row behaves
exactly as it does today, and filing it under a guessed practice would be one
clinic reading another's diary.

**Read the contested list.** Where one patient holds two open requests that
turn out to belong to one practice — the state the old query produced — neither
row is written, because choosing between them is the desk's job. Close the
stale one in the app, then run the script again.

The unique index builds itself at startup and covers only rows that have a
practice, so it never fails to build on a database that has not been
backfilled.

### Once, after deploying the prescription record state

Creating a prescription that replaced another used to end the old one by
clearing a boolean: `recordState` stayed `current`, so the row reads as in
force while every screen treats it as gone, and nothing recorded who ended it,
why, or what replaced it. The route now goes through the record lifecycle, and
this gives the older rows the same shape:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillPrescriptionRecordState.js                              # report
mongodump --db medpin_staging --collection prescriptions --out ~/dumps/rxstate-before-backfill
node scripts/backfillPrescriptionRecordState.js --apply
```

It touches only rows that are `isActive: false` with no state — which can only
have come from that one line, since every other ending sets both. Where the
prescription written in its place still names the old one, the two are linked
and the reason says which; where nothing does, the row is still marked
superseded and the reason says plainly that the record does not say. `endedBy`
stays empty throughout: the old line recorded no actor, and naming a doctor who
may not have done it would be worse than a blank.

A row claimed by more than one prescription is reported and left alone. A
second run changes nothing.

### Once, after deploying desk registrations

Before that change, `POST /doctor/patients` with a number MedPin had not seen
made an account and no enrolment. Every list scoped to a practice's enrolled
patients left those people out, so the desk that had just added somebody could
not find them.

**This is no longer a bulk backfill.** The script used to enrol every patient it
matched, ACTIVE, in one `--apply`. Patients are now enrolled one at a time, with
their consent (C8, §26), so the script only reports — it has no write path and
`--apply` does nothing but say so:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillDeskRegistrations.js                                    # report only
```

The report lists, per practice, each patient its desk added and cannot see,
with the number they were registered under. Hand each practice its list. The
desk registers each person again from the app: the number already has an
account, so the patient is texted a code and is enrolled when they read it back
— and is then asked, once, in their own app, whether that practice may see
their earlier records. Rows the script cannot match to one practice are listed
as unresolved; ask the practices, and enrol through the same route.

If this ran with `--apply` on a deployment before C8, the enrolments it wrote
stand — nothing here removes them.

### Once, after deploying patient-controlled sharing and feedback routing (C8)

Feedback used to store the patient and nothing else, and every practice that
patient was enrolled at read all of it — about any clinic, and about the app.
New feedback records where it went: one practice (and the enrolment it went
through), or MedPin. Nothing on the old rows says which clinic they were about,
so they are marked `legacy_unattributed` and stay private to the patient who
wrote them. Every inbox already ignores them, so this changes what the data
says, not what anybody sees:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
mongodump --db medpin_staging --collection feedbacks --out ~/dumps/feedback-before-routing   # 1. back up
node scripts/backfillFeedbackRouting.js                                                       # 2. dry run
mongosh --quiet --eval 'db.getSiblingDB("medpin_staging").feedbacks.countDocuments({ origin: { $exists: false } })'  # 3. matches the report
node scripts/backfillFeedbackRouting.js --apply                                               # 4. apply
node scripts/backfillFeedbackRouting.js                                                       # 5. verify: 0 rows
```

- **Tell the live practice before deploying.** Old feedback leaves every
  practice's inbox with this release — it was never attributable to one
  practice, and could not stay in a list that now means "written to us". The
  patients who wrote it still see it in the app, marked private.
- Nothing is deleted; the old practice-wide "reviewed" mark stays on the rows
  that have it. A second run changes nothing. The rollback is the dump above.
- Nothing to run for sharing. `ShareGrant` had no rows (nothing wrote to it), the
  new consent-log fields are optional, and the new unique indexes (one answer
  per consent, one open request per patient per practice, the idempotency keys)
  build themselves at startup over collections that cannot already break them.
- **Nobody's sharing is answered for them.** The two questions — "share my own
  health logs", "share my earlier history" — are asked once per desk consent.
  A patient a desk enrolled before this release (their enrolment has a consent
  event of method `otp_desk`) finds them waiting in the app; one the migration
  enrolled (no such event) is not asked, and can share from "Who can see my
  records?". Until somebody answers, nothing is shared beyond what the
  enrolment gives. There is no script that answers for anybody.
- **Admin console**: platform feedback — about the app, and from patients no
  practice has taken on — is in the console at Platform → Feedback (`/feedback/`,
  reading `GET /api/v1/admin/feedback`), without the patient's identity. Deploy
  the console with the API, or that feedback has nowhere to be read.
- **Tell the practices** that patients' own logs and earlier history are now
  asked for at the counter with the code ("The patient answered now"), or in the
  patient's app, and that a patient record shows what has not been shared.
- **The app**: builds from before this keep sending feedback (a patient with
  one practice is routed to it; with two, the old form is told to choose, which
  it cannot, and says so) and keep working at the desk — an existing number
  now always asks for the patient's code, and the older build opens the patient
  list afterwards rather than the record.

### Once, after deploying per-practice emergency numbers

The number patients ring — "Call clinic", the emergency card, and the number the
assistant names in emergency advice — is now each practice's own
`emergencyPhone`. `CLINIC_EMERGENCY_PHONE` is no longer given to any practice's
patients, so the live clinic's number has to be put back on its practice:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
mongosh --quiet --eval 'db.getSiblingDB("medpin_staging").practices.find({}, { name: 1, emergencyPhone: 1 })'
node scripts/backfillEmergencyPhone.js --practice <practiceId>            # dry run
node scripts/backfillEmergencyPhone.js --practice <practiceId> --apply
```

It copies this deployment's `CLINIC_EMERGENCY_PHONE` onto the practice you name,
and only when that practice has no number yet — a second run changes nothing.
Every other practice sets its own in the app, under Profile → Clinic → Patient
call number. Until one does, its patients are given the phone of its only
location, or no number at all.

### Before deploying practice identity (C10): see what each practice is called

`CLINIC_NAME` and `DOCTOR_DISPLAY_NAME` are no longer read by anything at
runtime — both defaulted to Dr. Amit Kumar Dey's clinic and name, and every
practice that had not filled something in was covered for by them. Identity now
comes from the practice (Practice → Location → Head Doctor), and in the same
change the name printed on new prescriptions and used by the assistant becomes
the practice's rather than its first location's. Look before patients do:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/checkPracticeIdentity.js
```

Read-only. Exit 0 means every practice names itself and a doctor. Exit 1 lists
what deserves a look:

- **no printed doctor name and no head doctor** — the assistant will say "your
  doctor". Set the printed name on the practice in the console (Edit details).
- **the name changes** — a practice whose name differs from its location's now
  prints the practice's. For the live clinic this is the row copied from its
  clinic when practices were introduced; if the clinic was renamed since, edit
  the practice's name to match before deploying.
- **locations with no practice** — they resolve from their own row only and
  borrow no brand from anywhere.

Prescriptions already issued keep the letterhead stamped on them. Nothing is
written by this step, so there is nothing to back up or roll back.

### Once, after deploying practice identity (C10): reword the shared knowledge

The seeded knowledge base named Dr. Dey throughout ("Only Dr. Dey can tell you
to change an insulin dose"), and seeded passages are shared — the assistant
grounds every practice's answers in them. The seed now says "your doctor"; this
brings the rows already in the database into line:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
mongodump --db medpin_staging --collection knowledgechunks --out ~/dumps/knowledge-before-reword
node scripts/neutraliseKnowledgeIdentity.js                                  # dry run: lists each phrase
node scripts/neutraliseKnowledgeIdentity.js --apply
node scripts/neutraliseKnowledgeIdentity.js                                  # dry run again: 0 passages
```

It touches only shared rows (`practice: null`) whose `docId` the seed writes,
and inside them only the exact phrases listed in the script — a passage somebody
corrected keeps the correction, and a practice's own passages, which may rightly
name its own doctor, are never selected. The clinical wording and the approval
are unchanged; `version` goes up by one. Embeddings are left as they are — the
rewording changes a name, not what the passage is about. The rollback is the
dump above.

### Before deploying C10: suspension is enforced from the first request

A practice marked `suspended` in the console used to change nothing. From this
release its staff are refused every practice route with `PRACTICE_SUSPENDED`
(they can still sign in and see that it is suspended; its patients are
unaffected). Look for any practice already marked suspended, because it stops
working the moment this deploys:

```bash
mongosh --quiet --eval 'db.getSiblingDB("medpin_staging").practices.find({ status: "suspended" }, { name: 1, status: 1 })'
```

Reinstate from the console (it now asks for a reason) before deploying if any of
them should still be working. Nothing is written by the deploy itself.

### After deploying C10: prescription references — nothing to run, one decision

New references are `RX-<year>-<n>` unless the practice has its own prefix;
references already issued are never rewritten. Counters are now one per prefix
per year (`prescription:<PREFIX>:<year>`), each seeding itself from the highest
reference already printed with that prefix, so there is nothing to run — and the
old `prescription:<year>` counter is simply no longer used. Deploy outside clinic
hours, as with the counters before: a reference issued by the old process in the
window carries `AKD-`.

**The decision owed:** whether the founding practice continues its `AKD-` series.
If so, an operator sets its prefix to `AKD` in the console (practice → Edit
details → Prescription prefix). The server allows it only when every existing
`AKD-` prescription is recorded as that practice's own, so run the medicine
lifecycle backfill above first; a row with no practice refuses it. The
`one_practice_per_prescription_prefix` index builds at startup and cannot fail on
existing data — no practice has a prefix before this release.

The daily patient summary and onboarding changes need no data step. Every daily
report generation writes `AuditLog` rows (`resource: "DailyReport"`); check one
appears after `node scripts/smoke.mjs` and a first report from the app.

### Once, after deploying scheduling and locations (C6)

Moving an appointment cancelled the original and wrote the replacement as
`requested` — with a time on it and no day the patient asked for. The desk
watched a booking it had just moved reappear under "Waiting for a time", and a
patient's own move turned their confirmed visit back into a request. The route
now writes the replacement `confirmed`. This gives the replacements already on
record that status, where their time is still ahead:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
mongodump --db medpin_staging --collection appointments --out ~/dumps/appts-before-rescheduled
node scripts/backfillRescheduledBookings.js                                  # report
node scripts/backfillRescheduledBookings.js --apply
node scripts/backfillRescheduledBookings.js                                  # report again: 0 to confirm
```

- **Read the report before applying.** Only replacements still exactly as the
  old route left them, with a time still ahead, are confirmed. Nobody is
  notified — the patient already believes they hold that time.
- **Past ones are listed, never written**: whether those visits happened is not
  recorded anywhere, and confirming them would claim a booking nobody can vouch
  for. The desk can decline them from the app if they clutter "Waiting for a
  time".
- Rows that look moved but whose original is not a cancelled appointment are
  listed and left for a person.
- Nothing breaks before it runs: an old replacement is a request with a time,
  which the desk can still give a time to. A row the desk changes between the
  report and the apply keeps what the desk did. A second run changes nothing.
  The rollback is the dump above.

The other changes in the same deploy need **no data change**, and each is worth
one check afterwards:

- `Membership.locations` narrows a member of staff to particular locations. It
  is empty on every existing row, and empty means every location of the
  practice, so nobody's access changes on deploy. Verify with
  `GET /api/v1/clinics/access` as a practice owner: every row should read
  `"everyLocation": true`. A practice narrows somebody with
  `PUT /api/v1/clinics/access/<membershipId>` and `{"locationIds": [...]}`;
  `[]` gives them every location back. The owner is never narrowed.
- The waiting-room date (`queueDate`) is now the clinic's date rather than the
  server's. Rows already written keep the date they were given — the checked-in
  patients of past days are history either way. On a UTC server, a deploy
  between midnight and 05:30 IST starts that day's tokens at 1, while anybody
  checked in earlier that night keeps the number the old code gave them and is
  listed under the previous day. Deploy outside those hours to avoid the mix.
- Two new collections start empty and fill themselves: `diarylocks` (one small
  row per doctor, holding their diary while a booking is written) and
  `idempotentwrites` (appointment writes sent with an `Idempotency-Key`, removed
  by a TTL index after a day). Their indexes build at startup. Verify after the
  restart with
  `mongosh --quiet --eval 'db.getSiblingDB("medpin_staging").idempotentwrites.getIndexes()'`:
  there should be an `actor_1_key_1` unique index and a `createdAt_1` index with
  `expireAfterSeconds: 86400`. A `diarylocks` row with a `holder` and an
  `until` in the past is a hold whose request died; the next booking for that
  doctor takes it over, and nothing needs clearing by hand.
- A doctor's hours per location can now be entered (`PUT
  /api/v1/clinics/<id>/availability/<doctorId>`). A doctor with no diary keeps
  the location's hours exactly as before, so nothing changes until a practice
  sets one; `scripts/backfillAvailability.js` stays optional.

## Pointing the app at staging

`API_BASE_URL` is a `--dart-define`, so no code change:

```bash
cd mobile
flutter build apk --debug \
  --dart-define=API_BASE_URL=https://staging.clinq.flintdeorient.in/api/v1
```

Install it alongside nothing — it shares a package id with the release build,
so it replaces it. Uninstalling to go back wipes the login.

## Loading realistic data

The migration and backward-compatibility items on the checklist need rows that
look like production's, and that is the point at which staging stops being
theoretical and starts holding patient data.

**A restore of production into staging makes staging a clinical system.** Same
retention obligations, same access control, same reason not to leave it on a
box with a default password. If it holds real patients:

- keep the outward channels empty, which the readiness check enforces
- do not point a debug APK at it and hand it to anybody
- drop the database when the exercise is finished

The alternative is `backend/scripts/seed.js`, which builds a synthetic practice
and is enough for most of the checklist.

## Rolling back

Production is a git checkout and a pm2 process, so a rollback is a checkout and
a restart:

```bash
cd /var/www/clinq && git log --oneline -5
git checkout <previous-sha> && cd backend && npm install
pm2 restart clinq && node scripts/smoke.mjs https://clinq.flintdeorient.in
```

What this does *not* roll back is a migration. Every script in
`backend/scripts/` is forward-only, and none has a down. Before running one
against production, run it against staging and take a `mongodump` of the
collections it touches — that dump is the rollback.
