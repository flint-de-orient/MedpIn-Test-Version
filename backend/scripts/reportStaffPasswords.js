#!/usr/bin/env node
/**
 * Who still signs in with a password, and whether they need to.
 *
 *   node scripts/reportStaffPasswords.js
 *
 * Reads only. Nothing in this script writes, and there is no --apply.
 *
 * ---- Why it exists ----------------------------------------------------------
 *
 * §30 retired passwords for new staff: nobody may set a colleague's password,
 * and every account made since signs in with a code texted to its own number.
 * The passwords that already exist were left working on purpose — a counter
 * handset signed in that way must not stop working the morning a release
 * lands — until the product owner approves a date to retire them.
 *
 * Retiring them is a data change, and it needs to know first who would be
 * affected. This is that list: each account holding a password, the practices
 * it works at, and the last time it signed in each way. An account whose last
 * sign-in was by code has already moved; one that only ever uses its password
 * is a handset somebody has to sign in by code once — or give a second line
 * with scripts/addLoginNumber.js — before the password is removed.
 *
 * Reads `.env` from the directory it runs in: run it from the deployment's own
 * `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { User, ROLES } from '../src/models/User.js';
import { Membership } from '../src/models/Membership.js';
import { Practice } from '../src/models/Practice.js';
import { AuditLog } from '../src/models/AuditLog.js';

/**
 * Every account holding a password hash, with what retiring it would touch.
 *
 * @returns {Promise<{staff: object[], patients: number}>}
 */
export async function planStaffPasswordReport() {
  const holders = await User.find({ passwordHash: { $exists: true, $nin: [null, ''] } })
    .select('_id name role isActive')
    .lean();

  // Patients were never meant to hold one; the demo seed gave some. Counted,
  // not listed — a patient's name has no business in a staff report.
  const patients = holders.filter((u) => u.role === ROLES.PATIENT).length;
  const staffAccounts = holders.filter((u) => u.role !== ROLES.PATIENT);

  const staff = [];
  for (const user of staffAccounts) {
    const [memberships, lastPassword, lastCode] = await Promise.all([
      Membership.find({ user: user._id }).select('practice role status endedOn').lean(),
      AuditLog.findOne({ actor: user._id, action: 'login' }).sort({ at: -1 }).select('at').lean(),
      AuditLog.findOne({ actor: user._id, action: 'login_otp' }).sort({ at: -1 }).select('at').lean(),
    ]);
    const practiceNames = new Map(
      (await Practice.find({ _id: { $in: memberships.map((m) => m.practice) } }).select('name').lean()).map((p) => [
        String(p._id),
        p.name,
      ]),
    );

    staff.push({
      id: String(user._id),
      name: user.name,
      role: user.role,
      accountActive: user.isActive !== false,
      practices: memberships.map((m) => ({
        name: practiceNames.get(String(m.practice)) ?? String(m.practice),
        current: m.status === 'active' && m.endedOn == null,
      })),
      lastPasswordSignIn: lastPassword?.at ?? null,
      lastCodeSignIn: lastCode?.at ?? null,
      // Still depends on the password: it has used it, and never a code since.
      reliesOnPassword: Boolean(lastPassword && (!lastCode || lastCode.at < lastPassword.at)),
    });
  }

  return { staff, patients };
}

async function main() {
  await connectDb();
  try {
    const { staff, patients } = await planStaffPasswordReport();
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'never');

    console.log(`Staff accounts holding a password: ${staff.length}`);
    for (const s of staff) {
      const where = s.practices.map((p) => `${p.name}${p.current ? '' : ' (ended)'}`).join(', ') || 'no practice';
      console.log(
        `  ${s.name} — ${s.role}${s.accountActive ? '' : ' (switched off)'} — ${where}\n` +
          `    last password sign-in: ${day(s.lastPasswordSignIn)}; last code sign-in: ${day(s.lastCodeSignIn)}` +
          (s.reliesOnPassword ? '  ← still relies on the password' : ''),
      );
    }
    console.log(`Patient accounts holding a password (from demo data): ${patients}`);
    console.log('\nNothing was written. See deploy/STAGING.md, "Staff passwords", for what happens next.');
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
