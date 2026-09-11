#!/usr/bin/env bash
#
# Build the operator console and ship it.
#
# ---- The server runs Apache -------------------------------------------------
#
# nginx is installed on that box and stopped, and it must stay stopped: starting
# it collides with Apache on 80 and 443 and takes down every site on the server.
# Earlier versions of this script reloaded nginx and wrote the policy into
# /etc/nginx/snippets/, which Apache never reads — so the CSP was silently inert
# rather than wrong, which is worse.
#
# ---- Why a script rather than a list of commands ----------------------------
#
# The policy names the SHA-256 hashes of the inline scripts that one particular
# build emitted, so the export and the policy are a single artefact in two
# files. Upload one without the other and the page loads and then refuses to run
# its own scripts — which looks like the app is broken and reads nowhere except
# the browser console.
#
# The build runs here, on a laptop. Nothing about the Next toolchain lands on
# production; what ships is static files.
#
#   ./deploy.sh root@vps.example.com
#   ./deploy.sh root@vps.example.com --dry-run
#
set -euo pipefail

SERVER="${1:-}"
DRY=""
[[ "${2:-}" == "--dry-run" ]] && DRY="--dry-run"

if [[ -z "$SERVER" ]]; then
  echo "Usage: ./deploy.sh user@server [--dry-run]" >&2
  exit 1
fi

WEB_ROOT="${WEB_ROOT:-/var/www/medpin-admin}"
# Apache reads conf-enabled only for server-wide config; this one is Included
# by the vhost so it applies to this site alone. See DEPLOY.md.
CSP_PATH="${CSP_PATH:-/etc/apache2/conf-available/medpin-admin-csp.conf}"

cd "$(dirname "$0")"

echo "==> Building"
npm ci
npm run build
node scripts/csp.mjs --apache

test -s out/csp.conf || { echo "csp.conf is empty — refusing to ship" >&2; exit 1; }
test -f out/index.html || { echo "no index.html — refusing to ship" >&2; exit 1; }

echo
echo "==> Policy for this build"
grep -o "script-src[^;]*" out/csp.conf | head -1
echo

echo "==> Checking the server is the one we think it is"
# Cheap, and it would have caught the four sets of nginx instructions that were
# written for this box before anybody noticed it does not run nginx.
ssh "$SERVER" 'set -e
  if ! command -v apache2ctl >/dev/null 2>&1; then
    echo "apache2ctl not found — this box may not be the Apache server" >&2; exit 1
  fi
  if systemctl is-active --quiet nginx; then
    echo "nginx is RUNNING. Two servers cannot both hold 80/443." >&2; exit 1
  fi
  apache2ctl -M 2>/dev/null | grep -q headers_module || {
    echo "mod_headers is not enabled. Run: a2enmod headers && systemctl reload apache2" >&2
    exit 1
  }
  # The API is served from this host so the session cookie stays first-party.
  # Without the proxy the console loads perfectly and every request it makes is
  # answered by Apache with its own 404 page — which reads as a broken console,
  # or as a missing route, or as an unset ADMIN_JWT_SECRET, depending on which
  # error the client happened to map it to. It reads as anything except what it
  # is, which is why this is checked rather than assumed.
  apache2ctl -M 2>/dev/null | grep -q proxy_http_module || {
    echo "mod_proxy_http is not enabled. Run: a2enmod proxy proxy_http && systemctl reload apache2" >&2
    exit 1
  }
  grep -rqs "ProxyPass[[:space:]]*/api/v1/" /etc/apache2/sites-enabled/ || {
    echo "No vhost proxies /api/v1/ to the backend." >&2
    echo "The console will load and every request it makes will 404. See admin/DEPLOY.md." >&2
    exit 1
  }'

# The policy first. A new policy against an old page refuses scripts the page
# does not have, which is harmless; an old policy against a new page refuses the
# ones it does, which is an outage. Only one of those orders is safe.
echo "==> Uploading the policy"
rsync -av $DRY out/csp.conf "${SERVER}:${CSP_PATH}"

echo "==> Uploading the site"
# --delete so chunks from previous builds do not accumulate in _next/static
# forever. Without it a browser holding a stale HTML file keeps finding the old
# ones and never notices it should have reloaded.
rsync -av $DRY --delete --exclude csp.conf out/ "${SERVER}:${WEB_ROOT}/"

if [[ -n "$DRY" ]]; then
  echo
  echo "Dry run. Nothing was written and Apache was not reloaded."
  exit 0
fi

echo "==> Reloading Apache"
# configtest first: a broken config that is reloaded takes down every site on
# this box, not just this one. A broken config that is merely tested does not.
ssh "$SERVER" 'apache2ctl configtest && systemctl reload apache2'

echo
echo "Done. Open the console, sign in, and reload with the browser console open."
echo "A CSP violation appears there and nowhere else — the page looks broken"
echo "with nothing on screen to say why."
