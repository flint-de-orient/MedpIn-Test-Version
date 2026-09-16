#!/usr/bin/env node
/**
 * What each practice will be called once identity stops borrowing.
 *
 *   node scripts/checkPracticeIdentity.js
 *
 * Read-only. Writes nothing, and has no --apply: what it finds is fixed by a
 * person, in the operator console or the practice's own settings.
 *
 * ---- Why run it before the deploy ---------------------------------------
 *
 * Until this release a practice that had not filled something in was covered
 * for by `CLINIC_NAME` and `DOCTOR_DISPLAY_NAME`, and the name printed at the
 * top of a prescription was the practice's first location's rather than the
 * practice's. Both change at once:
 *
 *   - a practice with no printed doctor name and no head doctor is introduced
 *     by the assistant as working for "your doctor";
 *   - a practice whose name differs from its location's now prints the
 *     practice's name on new prescriptions and in the assistant.
 *
 * Neither is wrong, and both are worth seeing before patients do — the live
 * clinic above all, whose practice row was copied from its clinic row when
 * practices were introduced and may have drifted since.
 *
 * Exit 0 when nothing needs a look, 1 when something does.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Practice } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';
import { User } from '../src/models/User.js';

/** Every practice, with what its identity resolves to and what deserves a look. */
export async function planIdentityCheck() {
  const practices = await Practice.find({}).select('name doctorDisplayName headDoctor status').lean();
  const heads = new Map(
    (
      await User.find({ _id: { $in: practices.map((p) => p.headDoctor).filter(Boolean) } })
        .select('name')
        .lean()
    ).map((u) => [String(u._id), u.name]),
  );

  const rows = [];
  for (const p of practices) {
    const locations = await Clinic.find({ practice: p._id, isActive: true })
      .sort({ sortIndex: 1, createdAt: 1 })
      .select('name doctorDisplayName')
      .lean();
    const first = locations[0] ?? null;

    const doctor = p.doctorDisplayName || first?.doctorDisplayName || heads.get(String(p.headDoctor)) || null;
    const notes = [];
    if (!doctor) {
      notes.push('no printed doctor name and no head doctor: the assistant will say "your doctor"');
    }
    if (first?.name && p.name && first.name.trim() !== p.name.trim()) {
      notes.push(`name changes on new prescriptions and in the assistant: "${first.name}" becomes "${p.name}"`);
    }

    rows.push({
      id: String(p._id),
      name: p.name,
      status: p.status,
      doctor,
      firstLocation: first?.name ?? null,
      notes,
    });
  }

  // Locations that belong to no practice resolve only from their own row now.
  const unlinked = await Clinic.countDocuments({ practice: null, isActive: true });

  return { rows, unlinked, needsLook: rows.some((r) => r.notes.length) || unlinked > 0 };
}

async function main() {
  await connectDb();
  try {
    const { rows, unlinked, needsLook } = await planIdentityCheck();
    console.log(`\n  ${rows.length} practice(s):`);
    for (const r of rows) {
      console.log(`\n    ${r.name}  [${r.status}]  ${r.id}`);
      console.log(`      doctor named: ${r.doctor ?? '(none — "your doctor")'}`);
      for (const n of r.notes) console.log(`      ! ${n}`);
    }
    if (unlinked) {
      console.log(`\n  ! ${unlinked} active location(s) belong to no practice and borrow no brand.`);
    }
    console.log(needsLook ? '\n  Something above deserves a look.\n' : '\n  Nothing needs a look.\n');
    process.exitCode = needsLook ? 1 : 0;
  } finally {
    await disconnectDb();
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
