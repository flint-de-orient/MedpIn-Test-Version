# Deploying the admin panel

> **Superseded, and the nginx below never applied.**
>
> This panel is replaced by the Next.js console in [`../web/`](../web/DEPLOY.md).
> Use that document.
>
> Everything here describing the server is wrong in the same way: **the VPS runs
> Apache**. nginx is installed there and stopped, and starting it would collide
> with Apache on 80 and 443 and take down every site on the box. The server block
> below was never read by anything, so the Content-Security-Policy it sets was
> not merely misconfigured — it was absent, which looks exactly like a permissive
> one.
>
> Kept only until the old panel is removed. Do not copy configuration out of it.

Static files. No build step, no `npm install`, nothing to compile — copy the
directory and serve it.

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
ALLOWED_ORIGINS=https://testadmin.medpin.in
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

Apache, on its own subdomain, reverse-proxying the API from the console's own
host. A separate signing key stops a clinic token authenticating here; serving
both halves from one origin is what lets the session cookie stay
`SameSite=Strict`, which is a CSRF defence rather than a mitigation of one.

> This block used to be an nginx `server { }`, and it had no `/api/` proxy in
> it. Two faults, one symptom. The box serves with Apache and nginx is stopped
> there, so the file was never read; and even read, it would have served the
> console with nothing behind `/api/v1/`, which is what "Practice type shows
> empty" was — every fetch answered by the web server's own 404 page.
>
> The CSP below also used to name `connect-src https://clinq.flintdeorient.in`,
> left over from an older cross-origin arrangement. A strict cookie set by that
> host is never sent from a page on this one, so that arrangement cannot
> authenticate at all. `'self'` is the version that matches the cookie.

Written to `/etc/apache2/sites-available/testadmin.medpin.in.conf`:

```apache
<VirtualHost *:443>
    ServerName testadmin.medpin.in

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/testadmin.medpin.in/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/testadmin.medpin.in/privkey.pem

    DocumentRoot /var/www/medpin-admin

    # The API, from this host, so the session cookie is first-party.
    #
    # Longest match first: Apache matches ProxyPass in file order, and a
    # ProxyPass for "/" written above this one would swallow the API too.
    ProxyPreserveHost On
    ProxyPass        /api/v1/ http://127.0.0.1:4000/api/v1/
    ProxyPassReverse /api/v1/ http://127.0.0.1:4000/api/v1/

    # Everything else is the static export. `FallbackResource` is wrong here:
    # this is a static export with real files per route, and a fallback would
    # answer a mistyped asset path with index.html instead of a 404.
    <Directory /var/www/medpin-admin>
        Require all granted
        AllowOverride None
        Options -Indexes
    </Directory>

    # No inline script or style is used, so both can be forbidden outright,
    # which is what makes a CSP worth having rather than a header that passes a
    # scanner. `connect-src 'self'` because the API is proxied from this host.
    Header always set Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"

    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Content-Type-Options nosniff
    Header always set Referrer-Policy no-referrer
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"

    # The export hashes its asset filenames but not index.html, so the document
    # must revalidate or a stale one keeps calling an endpoint that has moved —
    # which fails as "Failed to fetch" and reads as the API being down.
    <FilesMatch "\.(html)$">
        Header always set Cache-Control "no-cache"
    </FilesMatch>
</VirtualHost>

<VirtualHost *:80>
    ServerName testadmin.medpin.in
    Redirect permanent / https://testadmin.medpin.in/
</VirtualHost>
```

Enable it, and the two modules the proxy needs:

```bash
a2enmod proxy proxy_http headers ssl
a2ensite testadmin.medpin.in
apache2ctl configtest && systemctl reload apache2
```

Certificate: `certbot --apache -d testadmin.medpin.in`.

Check the proxy before anything else — it is the piece whose absence looks like
a broken console rather than a missing route:

```bash
curl -s https://testadmin.medpin.in/api/v1/health
# {"status":"ok","db":"connected",...}
```

An HTML 404 there is Apache answering, which means the proxy is not in place.

## 4. Turn on the second factor

Sign in, open **Account**, and follow it. The panel shows a setup key to type
into an authenticator app — as text rather than a QR code, because drawing one
means putting a library on the page that handles the secret, and this is the one
page where an extra script is worth avoiding. Every authenticator app takes a
typed key.

Setup alone does **not** enable it. The factor switches on only after a code
from the app has been verified, so a mistyped key cannot lock you out of the
panel that set it up.

Turning it off needs a current code as well as a session: otherwise a stolen
token can remove the factor protecting the account, which is the same as not
having one.

Until it is on, the panel says so at the top of every screen. An account that
can suspend every practice on the platform and is held by a password alone
should be told, every time.

## What is protected, and what is not

**Is:** a separate signing key and issuer, so a clinic token fails on the
signature rather than a role check. A separate origin. Five failed attempts
locks the account for fifteen minutes regardless of source address. Every
action logged including reads, in a collection of its own. No clinical route
exists in the namespace at all.

**Is not:** the session lives in memory only, so closing the tab signs you out
and there is no "remember me". That is deliberate for an account that can
suspend every practice, and it means a sign-in after every refresh.

## Losing the password

There is a reset, and it is deliberately not an email link. A link would make
your mailbox the key to every practice on the platform, protected by somebody
else's password policy and whatever device it is signed into. This account can
suspend a clinic; its recovery should not be easier than its login.

```bash
node scripts/resetAdmin.js you@example.com          # report
node scripts/resetAdmin.js you@example.com --apply  # mint a token
```

The token prints once and only its hash is stored, so a database dump does not
hand somebody a working reset. It expires in thirty minutes and is spent on
use — a token that still worked afterwards would be a second password nobody
knew they had.

Hand it over out of band. The person resetting opens the panel, clicks **Lost
the password?** on the sign-in screen, and spends it there — email, token, new
password, and a code if the account has a factor.

**Two-factor still applies.** A reset that skipped it would make the second
factor decorative — anyone holding a leaked token would be past it.

The reset returns no session; it lands back on the sign-in screen. Choosing a
new password is not signing in, and handing back a token would let a stolen
reset skip the login it just re-enabled.

The same thing over the wire, if the browser is not available:

```
POST /api/v1/admin/auth/reset
{ "email": "...", "token": "...", "newPassword": "...", "totp": "123456" }
```
