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
not find them. This enrols each at the practice whose desk added them, dated
from when the account was made, with a consent event saying how it came to be:

```bash
cd /var/www/clinq-staging/backend     # then /var/www/clinq/backend for production
node scripts/backfillDeskRegistrations.js                                    # report
mongodump --db medpin_staging --collection enrollments --out ~/dumps/desk-before-backfill
mongodump --db medpin_staging --collection consentevents --out ~/dumps/desk-before-backfill
node scripts/backfillDeskRegistrations.js --apply
```

**Read the report before applying.** A patient with no enrolment anywhere is
either one of these or a self sign-up, and a self sign-up is unaffiliated by
decision — enrolling one hands a stranger's record to a practice. The two are
told apart by the desk route's audit row, matched to the account by time
because those rows did not record the account's id. Anything the script cannot
match to exactly one row is listed as skipped and left for a person: that list
is the part worth reading, and the right answer for an ambiguous row is to
enrol that patient from the app, with their code, rather than by script.

A second run enrols nobody. The rollback is the dump above.

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
