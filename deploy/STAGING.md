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
