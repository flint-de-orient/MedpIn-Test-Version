import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';

import { env } from '../config/env.js';

/**
 * The platform's own mark, served publicly.
 *
 * ---- Why this is a route and not a file somebody uploads ---------------
 *
 * Razorpay's checkout takes an `image` URL and fetches it from the customer's
 * phone while they are typing a card number. So it has to be public, it has to
 * be reachable, and it has to still be there in a year.
 *
 * A file uploaded to a CDN by hand satisfies none of those reliably: nobody
 * redeploys a CDN when the repository changes, and the failure is silent — a
 * broken image on a payment screen looks like a phishing page rather than an
 * error. Serving it from the API means the logo ships with the code that
 * references it and cannot drift from it.
 *
 * ---- Unauthenticated, deliberately -------------------------------------
 *
 * It is a logo. Razorpay's servers and the customer's browser both fetch it
 * with no session, and there is nothing here worth protecting — the entire
 * content is already on every app icon.
 */
const router = Router();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARK = path.join(HERE, '..', 'assets', 'medpin-mark.png');

router.get('/logo.png', (req, res) => {
  // Immutable: the file changes only with a deploy, and a stale logo on a
  // payment sheet is worse than a byte of bandwidth.
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.type('image/png');
  res.sendFile(MARK);
});

/**
 * What the customer is paying, as a name and a picture.
 *
 * Sent to the app rather than hardcoded there, so a rebrand — or simply a
 * better logo — does not need a release, an install and a version-gate bump on
 * every phone.
 *
 * `logoUrl` is null where `PUBLIC_API_ORIGIN` is unset, and the client then
 * omits `image` entirely. Razorpay falls back to the first letter of the name,
 * which is what it was already doing and is a great deal better than a broken
 * image on a checkout sheet.
 */
export function brandForCheckout() {
  const origin = (env.PUBLIC_API_ORIGIN ?? '').trim().replace(/\/+$/, '');
  return {
    name: env.BRAND_NAME || 'MedPin',
    logoUrl: origin ? `${origin}/api/v1/brand/logo.png` : null,
  };
}

router.get('/', (req, res) => res.json(brandForCheckout()));

export default router;
