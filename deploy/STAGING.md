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

### Once, after deploying the dietician caseload

A dietician's caseload was "everyone at the practice, unless somebody has been
assigned to me". Assignment was a restriction rather than a grant, so a
practice with one dietician needed no assignments at all — and a second
dietician, or a locum, inherited the whole practice the day they were hired.

The caseload is now exactly what the assignments say, and a practice with one
dietician assigns them as each patient joins. Without this, the dietician at a
practice that never assigned anybody opens the app to an empty list on the
morning this deploys — same people, same work, no way to see any of it:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillDieticianAssignments.js                                 # report
mongodump --db medpin_staging --collection patientprofiles --out ~/dumps/diet-before-backfill
node scripts/backfillDieticianAssignments.js --apply
```

It covers only practices with exactly one active dietician — precisely the set
the old default served — and never overwrites an assignment a doctor made. A
practice with two or more is reported and left alone: the old default gave
both of them everybody, so there is no arrangement to write down faithfully,
and the doctor assigns those patients on each profile.

**Run this in the same maintenance window as the deploy.** Between the restart
and this script, a one-dietician practice's dietician sees nobody.

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
- **Admin console**: platform feedback is served at `/admin/feedback`, without
  the patient's identity. Until the console has a screen for it, it is readable
  with an operator's bearer token.
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
