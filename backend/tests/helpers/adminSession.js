import { env } from '../../src/config/env.js';
import { PlatformAdmin } from '../../src/models/PlatformAdmin.js';
import { signAdminToken } from '../../src/services/adminTokens.js';

/**
 * An operator, for suites that drive the admin namespace over HTTP.
 *
 * The namespace answers 404 unless `ADMIN_JWT_SECRET` is in the process
 * environment, and signs with the parsed copy — so both are set, and both put
 * back afterwards. A suite that set only one passed on a machine whose `.env`
 * happened to hold the other and 404'd everywhere else.
 */
const SECRET = 'a_test_admin_secret_for_the_c10_suites_0123456789';

let saved = null;

export function switchAdminOn() {
  saved = { parsed: env.ADMIN_JWT_SECRET, process: process.env.ADMIN_JWT_SECRET };
  env.ADMIN_JWT_SECRET = SECRET;
  process.env.ADMIN_JWT_SECRET = SECRET;
}

export function switchAdminBack() {
  if (!saved) return;
  env.ADMIN_JWT_SECRET = saved.parsed;
  if (saved.process === undefined) delete process.env.ADMIN_JWT_SECRET;
  else process.env.ADMIN_JWT_SECRET = saved.process;
  saved = null;
}

/** A fresh operator account and a bearer token for it. Call after `wipe()`. */
export async function makeOperator(email = 'ops@example.com') {
  const admin = await PlatformAdmin.create({ email, name: 'Ops', passwordHash: 'x', isActive: true });
  return { admin, token: signAdminToken(admin) };
}
