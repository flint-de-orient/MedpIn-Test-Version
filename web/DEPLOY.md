# Deploying the operator console

Two halves that must move together: the API gains the routes the console calls,
and the console is a static export served by nginx on its own subdomain.

The console is **off by default**. Without `ADMIN_JWT_SECRET` on the API, every
route under `/api/v1/admin` answers `404` and the console says so plainly rather
than looking broken. A deployment not running it should stay in that state — an
admin API that is present but unused is an attack surface kept for nothing.

---

## 1. The API first

The console calls routes that only exist from `00766b3` onwards. Ship the
backend before the front end, or the first thing an operator sees is a 404.

```bash
cd ~/ClinQ
git pull
cd backend
```

**Check before restarting.** Two things in these commits change what a
clinician sees, and both fail quietly:

```bash
node scripts/checkRecordWindow.js
```

It must say *Every active patient has an active enrolment* and list no practice
with staff but nobody enrolled. It exits non-zero otherwise, so it can sit in
front of the restart in a script rather than relying on somebody reading it.

No migration. The new `plan`, `limits` and `planRenewsOn` fields default on
read, and a practice with no limit has no cap — which is every practice until
somebody types a number in.

```bash
pm2 restart clinq
curl -s https://clinq.flintdeorient.in/api/v1/health
```

A low `uptime` confirms the restart took.

---

## 2. Turn the admin API on

Skip this section to leave the console switched off.

```bash
openssl rand -base64 48
```

In `backend/.env`:

```
ADMIN_JWT_SECRET=<the value above>
ALLOWED_ORIGINS=https://admin.medpin.in
```

`ADMIN_JWT_SECRET` **must differ from `JWT_ACCESS_SECRET`**. If they match the
guard refuses every request and says why — deliberately, because a
misconfiguration that silently grants platform access is worse than one that
stops the console working.

`ALLOWED_ORIGINS` is a comma-separated allowlist that defaults to *deny all* in
production. The console is on a different origin, so it must be listed or the
browser blocks every call. It is an exact string match: `https://admin.medpin.in`
and `https://www.admin.medpin.in` are different origins.

```bash
pm2 restart clinq
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<12+ chars>' node scripts/createAdmin.js
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<12+ chars>' node scripts/createAdmin.js --apply
```

The password comes from the environment rather than an argument, because
arguments end up in shell history and in `ps` output on a shared box. There is
no default account and no seeded password: whatever you put in those two
variables *is* the login.

---

## 3. Build the console

On your machine, not the VPS. Building needs 364 npm packages; the VPS needs
none of them, because what ships is static files.

```bash
cd web
npm ci
npm run build
API_ORIGIN=https://clinq.flintdeorient.in node scripts/csp.mjs
```

That leaves `web/out/` — the site — and `web/out/csp.conf`, which is the
Content-Security-Policy for *this* build.

### Why the policy is generated

The policy is `script-src 'self'` with no `unsafe-inline`. That is what makes it
a wall rather than a header that passes a scanner: a script injected into the
page cannot run, and cannot exfiltrate anywhere the policy does not name.

Next's static export does not cooperate. It emits inline scripts carrying
hydration data, and one more of ours that sets the theme before the first paint
— their contents change on every build. The usual answer is to add
`'unsafe-inline'`. On the console that can suspend every practice on the
platform that is the wrong trade: it re-permits exactly the attack the policy
exists to stop.

So `csp.mjs` hashes every inline block the build produced and names them. A
script the build did not emit cannot run. The cost is that the policy is
regenerated and re-uploaded with each export — and a stale copy blocks the page
rather than exposing it, which is the right way round for a mistake to fail.

It came out **stricter** than the hand-written panel's, not looser. `next/font`
downloads the IBM Plex faces at build time and serves them from
`/_next/static/media`, so there is no Google Fonts origin to allow and no third
party is told who opens the console. Not one external origin appears in the
export.

---

## 4. Ship it

```bash
rsync -av --delete web/out/ root@<server>:/var/www/medpin-admin/
rsync -av web/out/csp.conf root@<server>:/etc/nginx/snippets/medpin-admin-csp.conf
```

`--delete` matters: without it, chunks from previous builds accumulate in
`_next/static` forever, and a browser holding a stale HTML file keeps finding
the old ones and never notices it should have reloaded.

The `csp.conf` inside `out/` is copied to nginx and then *not* served — it sits
under the web root only because that is where the build wrote it. Delete it from
the web root if that offends; nginx does not serve `.conf`, and nothing links it.

---

## 5. nginx

Its own subdomain, not a path on the API host. A separate signing key stops a
clinic token authenticating here; a separate **origin** stops a script on either
page reaching the other with the browser's credentials. Half that wall is not a
wall.

```nginx
server {
    listen 443 ssl http2;
    server_name admin.medpin.in;

    ssl_certificate     /etc/letsencrypt/live/admin.medpin.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.medpin.in/privkey.pem;

    root /var/www/medpin-admin;
    index index.html;

    # Generated by the build. Regenerated and re-uploaded every deploy.
    include /etc/nginx/snippets/medpin-admin-csp.conf;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    # No build step puts a content hash in the HTML filenames, so nothing tells
    # a browser that a page changed. `no-cache` still allows a cached copy, it
    # just has to be revalidated first — one 304, and it removes the class of
    # bug where a stale page calls an endpoint that has moved.
    #
    # Server level on purpose. An `add_header` inside a `location` block
    # REPLACES every directive above it rather than adding to them, so putting
    # any of these in one would silently stop the CSP being sent.
    add_header Cache-Control "no-cache" always;

    # The export uses trailing slashes, so /audit/ is /audit/index.html.
    location / {
        try_files $uri $uri/ $uri.html /index.html;
    }

    # Hashed chunks are immutable by construction: the name changes when the
    # content does. These are the only things here worth caching hard.
    location /_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
}

server {
    listen 80;
    server_name admin.medpin.in;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d admin.medpin.in
```

> **The `/_next/static/` block replaces the headers above it**, including the
> CSP. That is fine and deliberate — those are script and font files, not
> documents, and a CSP on a `.js` response does nothing. Do not copy that
> pattern to `location /`.

---

## 6. Prove it

Open `https://admin.medpin.in`, sign in, and go to **Account** — enrol a second
factor before doing anything else. Until you do, the console says so at the top
of every screen, because an account that can suspend every practice and is held
by a password alone should be told.

Then open the browser console and reload. **A CSP violation appears there and
nowhere else**: the page will look broken with no error on screen. If you see
`Refused to execute inline script`, the `csp.conf` on the server is from a
different build than the `out/` beside it — re-run step 3 and re-upload both.

---

## Losing the password

There is a reset, and it is deliberately not an email link. A link would make
your mailbox the key to every practice on the platform, protected by somebody
else's password policy and whatever device it is signed into.

```bash
cd backend
node scripts/resetAdmin.js you@example.com          # report
node scripts/resetAdmin.js you@example.com --apply  # mint a token
```

The token prints once and only its hash is stored, so a database dump does not
hand somebody a working reset. Thirty minutes, spent on use. Hand it over out of
band; the person resetting clicks **Lost the password?** on the sign-in screen.

**Two-factor still applies.** A reset that skipped it would make the second
factor decorative — anyone holding a leaked token would be past it.

The reset returns no session. Choosing a new password is not signing in, and
handing back a token would let a stolen reset skip the login it just re-enabled.

---

## What is protected, and what is not

**Is:** a separate signing key and issuer, so a clinic token fails on the
signature rather than a role check. A separate origin. Five failed attempts
locks the account for fifteen minutes regardless of source address. Every action
logged including reads, in a collection of its own. No clinical route exists in
the namespace at all — and the routes cannot even import a model that names a
patient, which is enforced by a test.

**Is not:** the session lives in memory only, so closing the tab signs you out
and there is no "remember me". And there is no *sign out everywhere*: the token
is not tracked server-side, so once issued it is valid for its full two hours
and nothing can revoke it early. If one leaked, the remedy is to wait it out or
rotate `ADMIN_JWT_SECRET`, which signs everyone out at once. That is why the
expiry is short and the session does not persist — when you cannot revoke, the
next best thing is not lasting long.
