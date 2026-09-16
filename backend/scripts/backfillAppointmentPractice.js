#!/usr/bin/env node
/**
 * Say whose diary each existing appointment sits in.
 *
 *   node scripts/backfillAppointmentPractice.js           # report
 *   node scripts/backfillAppointmentPractice.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * An appointment carried a patient, a doctor and sometimes a clinic, and no
 * practice. Every route scoped by the practice's *doctors*, which answers "is
 * this one of ours" and not "whose is it" — and the difference showed the
 * moment two practices held requests for one patient: the rule "one open
 * request at a time" was written as a query with neither practice nor doctor
 * in it, so the second clinic's request overwrote the first clinic's row.
 *
 * The field is now written on every new appointment and the database enforces
 * one open request per patient per practice. This gives the existing rows the
 * same answer, so they are covered by the same rule.
 *
 * ---- Where the answer comes from ----------------------------------------
 *
 * The clinic's practice where the appointment has a clinic — a building
 * belongs to exactly one practice, and that is the strongest evidence there
 * is. Otherwise the doctor's current membership, which is how a teleconsult
 * with no building is placed.
 *
 * A doctor who has left, or who never had a membership, leaves the row
 * unplaced. It is reported rather than guessed: an appointment filed under the
 * wrong practice is one clinic reading another's diary.
 *
 * ---- Duplicates are reported, never resolved ----------------------------
 *
 * Two open requests that turn out to belong to one practice cannot both be
 * written — that is exactly what the new index forbids, and it is the state
 * the old query produced. The script lists them and writes neither, because
 * which of the two the patient actually wants is a question for the desk.
 *
 * Dry run by default. Rows that already carry a practice are never touched, so
 * a second run changes nothing.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';

/** The rows this script is for: written before the field existed. */
export const UNPLACED = { $or: [{ practice: null }, { practice: { $exists: false } }] };

/**
 * Which practice each unplaced appointment belongs to, without writing.
 *
 * @returns {Promise<{place: object[], unplaceable: object[], contested: object[]}>}
 */
export async function planAppointmentPractice() {
  const rows = await Appointment.find(UNPLACED)
    .select('_id patient doctor clinic status preferredFor scheduledFor')
    .sort({ createdAt: 1 })
    .lean();

  const clinicPractice = new Map();
  const doctorPractice = new Map();

  const place = [];
  const unplaceable = [];

  for (const row of rows) {
    let practice = null;

    if (row.clinic) {
      const key = String(row.clinic);
      if (!clinicPractice.has(key)) {
        const clinic = await Clinic.findById(row.clinic).select('practice').lean();
        clinicPractice.set(key, clinic?.practice ?? null);
      }
      practice = clinicPractice.get(key);
    }

    if (!practice && row.doctor) {
      const key = String(row.doctor);
      if (!doctorPractice.has(key)) {
        const membership = await Membership.findOne({
          user: row.doctor,
          status: MEMBERSHIP_STATUS.ACTIVE,
          endedOn: null,
        })
          .select('practice')
          .lean();
        doctorPractice.set(key, membership?.practice ?? null);
      }
      practice = doctorPractice.get(key);
    }

    if (practice) place.push({ row, practice });
    else unplaceable.push({ row });
  }

  /*
   * Which of these would collide once written. Only an open request for a day
   * is unique — the replacement row a reschedule leaves behind is 'requested'
   * too and carries no preferred day, and somebody who asked for an
   * appointment and also moved one wants two things.
   */
  const open = new Map();
  for (const entry of place) {
    if (entry.row.status !== 'requested' || !entry.row.preferredFor) continue;
    const key = `${entry.row.patient}:${entry.practice}`;
    if (!open.has(key)) open.set(key, []);
    open.get(key).push(entry);
  }

  const contested = [];
  const colliding = new Set();
  for (const [, entries] of open) {
    if (entries.length < 2) continue;
    contested.push(entries);
    for (const entry of entries) colliding.add(String(entry.row._id));
  }

  return {
    place: place.filter((e) => !colliding.has(String(e.row._id))),
    unplaceable,
    contested,
  };
}

/**
 * Write the practice onto each row that has one answer.
 *
 * The `UNPLACED` condition is repeated in the update rather than trusted from
 * the plan, so an appointment written between the dry run and this — which
 * carries its practice already — is left exactly as it is.
 */
export async function applyAppointmentPractice(plan) {
  let changed = 0;
  for (const { row, practice } of plan.place) {
    const result = await Appointment.updateOne(
      { _id: row._id, ...UNPLACED },
      { $set: { practice } },
    );
    changed += result.modifiedCount ?? 0;
  }
  return changed;
}

async function main(argv) {
  const apply = argv.includes('--apply');

  await connectDb();
  try {
    const plan = await planAppointmentPractice();
    const total = plan.place.length + plan.unplaceable.length;

    if (total === 0 && plan.contested.length === 0) {
      console.log('Nothing to do: every appointment already says whose it is.');
      return;
    }

    console.log(`${plan.place.length} appointment(s) can be placed.`);

    if (plan.unplaceable.length) {
      console.log(
        `\n  ${plan.unplaceable.length} cannot be placed — no clinic, and the doctor has no current membership.`,
      );
      console.log('  They keep working as they do today; every route still scopes by doctor.');
    }

    if (plan.contested.length) {
      console.log(
        `\n  ${plan.contested.length} patient(s) hold more than one open request at what turns out to be one practice.`,
      );
      console.log('  None of those rows is written. The desk should close the ones that are stale:');
      for (const entries of plan.contested) {
        console.log(`    patient ${entries[0].row.patient} — ${entries.length} open requests`);
        for (const { row } of entries) {
          console.log(`      ${row._id}  asked for ${row.preferredFor?.toISOString?.() ?? '—'}`);
        }
      }
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }

    const changed = await applyAppointmentPractice(plan);
    console.log(`\nWritten: ${changed} row(s).`);
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
