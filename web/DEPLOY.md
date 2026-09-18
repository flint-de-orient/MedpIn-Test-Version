# Deploying the operator console

> **The server runs Apache.** nginx is installed on that box and **stopped**, and
> it must stay stopped — starting it collides with Apache on 80 and 443 and takes
> down every site on the machine.
>
> Earlier versions of this document were written for nginx, and the deploy script
> wrote its policy into `/etc/nginx/snippets/`. Apache never reads that, so the
> Content-Security-Policy was not wrong — it was **absent**, which looks exactly
> like a permissive one. If you find an nginx config anywhere in this repo
> describing this server, it is stale.

Two halves that move together: the API gains the routes the console calls, and
the console is a static export served by Apache on its own subdomain.

> **This is the test console: `https://testadmin.medpin.in`.** It talks to the
> **test backend** — pm2 `clinq-staging`, port 4001, its own database, reached
> publicly as `test.medpin.in` — and never to production's port 4000. It shares
> the server with the live console at `admin.medpin.in`, so it has its own folder
> (`/var/www/medpin-testadmin`) and its own policy file, and `deploy.sh`
> defaults to both. Deploying it cannot touch the live console.

The console is **off by default**. Without `ADMIN_JWT_SECRET` on the API, every
route under `/api/v1/admin` answers `404`. A deployment not running it should
stay that way — an admin API present but unused is an attack surface kept for
nothing.

---

## 1. The API first

The console calls routes that only exist from `00766b3` onwards. Ship the
backend first, or the operator's first screen is a 404.

**Pull into the checkout pm2 actually runs, not the one in your home
directory.** For the test backend `deploy/ecosystem.config.cjs` declares
`cwd: /var/www/clinq-staging/backend`. Pulling into the wrong one updates
nothing that is running: `pm2 restart clinq-staging` then reports success,
`/health` answers, and the box serves the previous release. Confirm before you
pull — whatever the answer is, it is the only directory that counts.

```bash
pm2 describe clinq-staging | grep -Ei 'exec cwd|script path'
```

```bash
cd /var/www/clinq-staging  # or whatever the line above printed
git pull
cd backend
npm install
node scripts/checkRecordWindow.js
```

It must say *Every active patient has an active enrolment* and list no practice
with staff but nobody enrolled. It exits non-zero otherwise, so it can gate the
restart rather than relying on somebody reading the output.

No migration. `plan`, `limits` and `planRenewsOn` default on read, and a
practice with no limit has no cap — which is every practice until somebody types
a number in.

```bash
pm2 restart clinq-staging
curl -s https://test.medpin.in/api/v1/health
node scripts/smoke.mjs https://test.medpin.in
```

A low `uptime` confirms the restart took. `config: ready` confirms no subsystem
is misconfigured; `degraded` publishes a count and never a reason, so read the
reasons from `GET /api/v1/admin/readiness` as an operator.

The smoke run is what proves the restart served *this* release rather than the
last one: it asks for the routes that only exist in it, and a `404` there means
the running checkout is not the one that was pulled.

---

## 2. Turn the admin API on

Skip this to leave the console switched off.

```bash
openssl rand -base64 48
```

In the test backend's `.env` — `/var/www/clinq-staging/backend/.env`, not
production's:

```
ADMIN_JWT_SECRET=<the value above>
ALLOWED_ORIGINS=https://testadmin.medpin.in
ADMIN_CONSOLE_URL=https://testadmin.medpin.in
ADMIN_RP_ID=testadmin.medpin.in
```

`ADMIN_RP_ID` is the domain passkeys are bound to. A browser ties a passkey to
the domain it was made on, so passkeys enrolled on `admin.medpin.in` do not work
here — sign in with password and authenticator code, then enrol a new one.

`ADMIN_JWT_SECRET` **must differ from `JWT_ACCESS_SECRET`**, or the guard
refuses every request and says why. A misconfiguration that silently grants
platform access is worse than one that stops the console working.

`ALLOWED_ORIGINS` is an exact string match. `https://testadmin.medpin.in` and
`https://www.testadmin.medpin.in` are different origins to a browser, and a
trailing slash is a third thing again — `allowedOrigins()` trims one rather
than leaving it to be found at 9pm, but nothing can rescue a wrong hostname.

Leaving it empty is legitimate **only** because Apache proxies `/admin/` and
`/applications/` from the console's own host, so the browser never makes a
cross-origin request. A console served from anywhere else with this unset sees
nothing but failed requests, and the API logs nothing at all.

Readiness reports `browserOrigins`, and what it can catch is the state that
looks configured: a list that does not contain the host named in
`ADMIN_CONSOLE_URL`, or an entry that is not a bare origin — a path, or a
missing scheme. Both are `degraded`, so `scripts/smoke.mjs` sees them before an
operator does.

```bash
pm2 restart clinq-staging
cd /var/www/clinq-staging/backend
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<12+ chars>' node scripts/createAdmin.js
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<12+ chars>' node scripts/createAdmin.js --apply
```

The test backend has its own database, so its operator accounts are its own —
the live console's login does not exist here until you create it.

The password comes from the environment, not an argument — arguments land in
shell history and in `ps` output. There is no default account: whatever goes in
those two variables *is* the login.

---

## 3. Apache, once

```bash
a2enmod headers rewrite ssl http2
```

`mod_headers` is what sets the CSP. Without it the `Header` directives are a
config error and `configtest` fails, which is at least loud.

### The certificate, first

The vhost names its certificate, so Apache will not load it until the
certificate exists:

```bash
certbot certonly --apache -d testadmin.medpin.in
```

### The vhost — the file in the repo, not a copy of it

The vhost is `deploy/apache/testadmin.medpin.in.conf`. It serves the export from
`/var/www/medpin-testadmin`, proxies `/api/v1/` to the test backend on port
4001 (the console's session cookie is first-party, so the API must be reached
from the console's own host), and `Include`s the policy `deploy.sh` generates.
An earlier copy of the vhost pasted here had no proxy at all, and a console
served from it could not sign anybody in.

**Enable it after step 4 has run once.** The `Include` names the policy file
`deploy.sh` uploads, and Apache refuses a config that includes a file that is
not there yet.

```bash
cp deploy/apache/testadmin.medpin.in.conf /etc/apache2/sites-available/
a2ensite testadmin.medpin.in
apache2ctl configtest && systemctl reload apache2
```

`configtest` before every reload. A broken config that is reloaded takes down
all sixteen sites on this box; a broken config that is merely tested does not.

---

## 4. Build and ship

From your laptop. The build needs 364 npm packages; the server needs none of
them, because what ships is static files — the Next toolchain never lands on
production.

```bash
cd web
./deploy.sh root@<server> --dry-run
./deploy.sh root@<server>
```

The script builds, generates the policy, checks the server really is Apache with
`mod_headers` on and nginx *not* running, uploads the policy, uploads the site
with `--delete`, then `apache2ctl configtest && systemctl reload apache2`.

### Why the policy is generated

The policy is `script-src 'self'` with no `unsafe-inline`. That is what makes it
a wall rather than a header that passes a scanner: a script injected into the
page cannot run and cannot exfiltrate anywhere the policy does not name.

Next's static export does not cooperate — it emits inline scripts carrying
hydration data, plus one of ours that sets the theme before first paint, and
their contents change every build. The usual answer is `'unsafe-inline'`, which
on the console that can suspend every practice re-permits exactly the attack the
policy exists to stop.

So `csp.mjs` hashes every inline block the build produced and names them. A
script the build did not emit cannot run. The cost is a policy regenerated and
re-uploaded with each export, and a stale copy blocks the page rather than
exposing it — the right way round for a mistake to fail.

It came out **stricter** than the old hand-written panel's. `next/font`
downloads the IBM Plex faces at build time and serves them from
`/_next/static/media`, so there is no Google Fonts origin to allow and no third
party is told who opens the console. Not one external origin appears in the
export.

### Order matters

The policy goes up before the site. A new policy against an old page refuses
scripts the page does not have, which is harmless. An old policy against a new
page refuses the ones it does, which is an outage.

`--delete` on the site, because chunks from previous builds otherwise accumulate
in `_next/static` forever, and a browser holding a stale HTML file keeps finding
the old ones instead of noticing it should reload.

---

## 5. Prove it

Open `https://testadmin.medpin.in`, sign in, then go to **Account** and enrol a
second factor before anything else. Until you do, the console says so at the top
of every screen.

Then reload **with the browser console open**. A CSP violation appears there and
nowhere else: the page looks broken with no error on screen. `Refused to execute
inline script` means the `csp.conf` on the server is from a different build than
the files beside it — re-run `deploy.sh`, which always ships both.

```bash
curl -sI https://testadmin.medpin.in/ | grep -i content-security-policy
curl -s https://testadmin.medpin.in/api/v1/admin/me     # 401 as JSON: the proxy reaches the test backend
node backend/scripts/smoke.mjs https://testadmin.medpin.in --console
```

If that line is missing, the `Include` is not in the vhost or `mod_headers` is
off. An absent header looks exactly like a permissive one, which is how the
nginx version of this document went unnoticed for four deploys.

---

## Losing the password

There is a reset, and deliberately not an email link — a link would make your
mailbox the key to every practice on the platform.

```bash
cd backend
node scripts/resetAdmin.js you@example.com          # report
node scripts/resetAdmin.js you@example.com --apply  # mint a token
```

Prints once; only the hash is stored, so a database dump does not hand somebody
a working reset. Thirty minutes, spent on use. Hand it over out of band; the
person resetting clicks **Lost the password?** on the sign-in screen.

**Two-factor still applies.** A reset that skipped it would make the second
factor decorative. The reset returns no session: choosing a new password is not
signing in.

---

## What is protected, and what is not

**Is:** a separate signing key and issuer, so a clinic token fails on the
signature rather than a role check. A separate origin. Five failed attempts
locks the account for fifteen minutes regardless of source address. Every action
logged including reads, in its own collection. No clinical route exists in the
namespace — and the routes cannot even import a model that names a patient,
which a test enforces.

**Is not:** the session lives in memory only, so closing the tab signs you out.
And there is no *sign out everywhere*: the token is not tracked server-side, so
once issued it is valid for its full two hours and nothing revokes it early. If
one leaked, the remedy is to wait it out or rotate `ADMIN_JWT_SECRET`, which
signs everyone out at once. That is why the expiry is short and the session does
not persist — when you cannot revoke, the next best thing is not lasting long.
