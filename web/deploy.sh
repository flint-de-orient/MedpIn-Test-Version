#!/usr/bin/env bash
#
# Build the operator console and ship it.
#
# The CSP names the hashes of the inline scripts *this* build emitted, so the
# export and the policy have to travel together. Uploading one without the other
# gives a page that loads and then refuses to run its own scripts — which looks
# like the app is broken and reads nowhere except the browser console.
#
# That coupling is the whole reason this is a script rather than five commands
# in a document somebody follows at 11pm.
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

API_ORIGIN="${API_ORIGIN:-https://clinq.flintdeorient.in}"
WEB_ROOT="${WEB_ROOT:-/var/www/medpin-admin}"
CSP_PATH="${CSP_PATH:-/etc/nginx/snippets/medpin-admin-csp.conf}"

cd "$(dirname "$0")"

echo "==> Building against ${API_ORIGIN}"
npm ci
npm run build
API_ORIGIN="$API_ORIGIN" node scripts/csp.mjs

# A build that emitted no inline scripts means the export changed shape and the
# policy is now allowing nothing it needs to. csp.mjs exits non-zero for that;
# `set -e` has already stopped us. This is the belt.
test -s out/csp.conf || { echo "csp.conf is empty — refusing to ship" >&2; exit 1; }
test -f out/index.html || { echo "no index.html — refusing to ship" >&2; exit 1; }

echo
echo "==> Policy for this build"
grep -o "script-src[^;]*" out/csp.conf | head -1
echo

# The policy first. A new policy with an old page refuses scripts the page does
# not have, which is harmless; an old policy with a new page refuses the ones it
# does, which is an outage. So the order matters, and this is the safe one.
echo "==> Uploading the policy"
rsync -av $DRY out/csp.conf "${SERVER}:${CSP_PATH}"

echo "==> Uploading the site"
# --delete so chunks from previous builds do not accumulate forever. Without it
# a browser holding a stale HTML file keeps finding the old chunks and never
# notices it should have reloaded.
rsync -av $DRY --delete --exclude csp.conf out/ "${SERVER}:${WEB_ROOT}/"

if [[ -n "$DRY" ]]; then
  echo
  echo "Dry run. Nothing was written and nginx was not reloaded."
  exit 0
fi

echo "==> Reloading nginx"
# `nginx -t` first: a bad config that is reloaded takes the site down, and a bad
# config that is merely tested does not.
ssh "$SERVER" 'nginx -t && systemctl reload nginx'

echo
echo "Done. Open the console, sign in, and reload with the browser console open."
echo "A CSP violation appears there and nowhere else — the page looks broken"
echo "with nothing on screen to say why."
