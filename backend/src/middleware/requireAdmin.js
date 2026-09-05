import { verifyAdminToken, secretsAreSeparate } from '../services/adminTokens.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { unauthorized, forbidden, asyncHandler } from './errors.js';

/**
 * The door to the admin namespace.
 *
 * ---- Off unless deliberately switched on --------------------------------
 *
 * With no `ADMIN_JWT_SECRET` set, every route behind this returns 404 as though
 * the namespace did not exist. That is the state of every deployment today, and
 * it should stay the state of any deployment that is not running the panel: an
 * admin API that is present but unused is an attack surface kept for nothing.
 *
 * A 404 rather than a 401, because a 401 confirms the namespace is there.
 *
 * ---- And off if the secrets are the same --------------------------------
 *
 * Setting `ADMIN_JWT_SECRET` to the same string as the clinic's would let a
 * clinician's token verify here — the exact failure the separate key exists to
 * prevent, arrived at by an operator pasting the wrong value. Refused loudly,
 * because a misconfiguration that silently grants platform access is worse than
 * one that stops the panel working.
 */
export const requireAdmin = asyncHandler(async (req, res, next) => {
  if (!process.env.ADMIN_JWT_SECRET) {
    // Not `throw`: the namespace should look absent, not protected.
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });
  }

  if (!secretsAreSeparate()) {
    throw forbidden(
      'The admin panel is misconfigured: ADMIN_JWT_SECRET must differ from the clinic key.',
    );
  }

  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();

  // Verified against the admin key. A clinic token fails here on the signature,
  // not on a claim — there is no role check to forget.
  const payload = verifyAdminToken(token);

  const admin = await PlatformAdmin.findById(payload.sub).lean();
  if (!admin || !admin.isActive) throw unauthorized('Account is inactive');

  req.admin = admin;
  next();
});
