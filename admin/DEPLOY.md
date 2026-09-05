# Deploying the admin panel

Static files. No build step, no `npm install`, nothing to compile — copy the
directory and point nginx at it.

The panel is **off by default**: without `ADMIN_JWT_SECRET` set on the API, every
route under `/api/v1/admin` answers `404`, and the panel says so plainly rather
than looking broken. A deployment not running the panel should stay in that
state — an admin API that is present but unused is an attack surface kept for
nothing.

## 1. A secret, and it must not be the clinic's

```bash
openssl rand -base64 48
```

In the API's `.env`:

```
ADMIN_JWT_SECRET=<the value above>
ALLOWED_ORIGINS=https://admin.medpin.in
```

`ADMIN_JWT_SECRET` **must differ from `JWT_ACCESS_SECRET`**. If they match, the
guard refuses every request and says why — deliberately, because a
misconfiguration that silently grants platform access is worse than one that
stops the panel working.

`ALLOWED_ORIGINS` is a comma-separated allowlist and defaults to *deny all* in
production. The panel is on a different origin, so it must be listed or the
browser will block every call.

Then `pm2 restart clinq`.

## 2. The first administrator

A script rather than a route. An open "create the first admin" endpoint has to
be closed after it is used, and the closing is a thing somebody has to remember
on a day nobody is thinking about it.

```bash
cd backend
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<20+ chars>' node scripts/createAdmin.js
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<20+ chars>' node scripts/createAdmin.js --apply
```

The password is read from the environment, not an argument — arguments end up in
shell history and in `ps` output on a shared box.

## 3. Serve the files

```bash
rsync -av admin/ root@<server>:/var/www/medpin-admin/
```

nginx, on its own subdomain — not a path on the API host. A separate signing key
stops a clinic token authenticating here; a separate **origin** stops a script on
either page reaching the other with the browser's credentials. Half that wall is
not a wall.

```nginx
server {
    listen 443 ssl http2;
    server_name admin.medpin.in;

    ssl_certificate     /etc/letsencrypt/live/admin.medpin.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.medpin.in/privkey.pem;

    root /var/www/medpin-admin;
    index index.html;

    # No inline script or style is used, so both can be forbidden outright —
    # which is what makes a CSP worth having rather than a header that passes a
    # scanner. `connect-src` names the API explicitly: a script that got onto
    # this page could not exfiltrate to anywhere else.
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://clinq.flintdeorient.in; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" always;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    # Nothing here needs a camera, a microphone or a location.
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    location / {
        try_files $uri $uri/ =404;
    }
}

server {
    listen 80;
    server_name admin.medpin.in;
    return 301 https://$host$request_uri;
}
```

Certificate: `certbot --nginx -d admin.medpin.in`.

## 4. Turn on the second factor

Sign in, then `POST /api/v1/admin/me/totp/setup` returns an `otpauth://` URI to
scan, and `POST /api/v1/admin/me/totp/enable` with a code from the app switches
it on. Setup alone does **not** enable it — a secret stored without a verified
code locks you out the moment you mistype it into the authenticator.

Turning it off needs a current code too, not just a session: otherwise a stolen
token can remove the factor protecting the account, which is the same as not
having one.

## What is protected, and what is not

**Is:** a separate signing key and issuer, so a clinic token fails on the
signature rather than a role check. A separate origin. Five failed attempts
locks the account for fifteen minutes regardless of source address. Every
action logged including reads, in a collection of its own. No clinical route
exists in the namespace at all.

**Is not:** the session lives in memory only, so closing the tab signs you out
and there is no "remember me". That is deliberate for an account that can
suspend every practice, and it means a sign-in after every refresh.

**Still open:** there is no password-reset flow. Losing the password means
re-running `createAdmin.js` on the server, which needs shell access — acceptable
while the number of administrators is one or two, and worth revisiting before it
is more.
