import { Practice } from '../../models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { deliver } from '../notifications.js';
import { logger } from '../../config/logger.js';

/**
 * Telling a practice it is running out of room, once.
 *
 * ---- The whole problem is repetition ------------------------------------
 *
 * A practice at 85% of its patient cap crosses no new line when it registers
 * the next patient, or the one after that. A check that fires on every add
 * sends four notifications in an afternoon, all saying the same thing, and what
 * it teaches is that this app's notifications are noise — which is a cost paid
 * later by a clinical alert nobody opens.
 *
 * So the highest threshold already announced is remembered on the practice, and
 * a notice goes out only when the next one is crossed. Eighty, ninety, a
 * hundred: three messages over the life of a plan, not thirty.
 *
 * ---- And it steps back down ---------------------------------------------
 *
 * When an operator raises the cap, or people leave, the mark is lowered to
 * whatever band they are in now. Without that, a practice that was warned at
 * 90%, upgraded, and grew back to 90% would never be warned again — the one
 * time the warning matters most, because they have already been told once that
 * this is how it goes.
 *
 * ---- Who hears it -------------------------------------------------------
 *
 * Whoever holds MANAGE_STAFF. A receptionist who cannot raise a limit does not
 * need telling it is close, and a doctor mid-consultation least of all. This is
 * a message for the person who can act on it.
 */

/** The bands, high to low. The first one crossed is the one announced. */
const BANDS = [100, 90, 80];

const WORDS = {
  patients: { one: 'patient', many: 'patients' },
  staff: { one: 'person', many: 'people' },
  locations: { one: 'location', many: 'locations' },
};

/** The band this usage falls in, or 0 for comfortably below. */
export function bandFor(used, cap) {
  if (!cap || cap <= 0) return 0;
  const pct = (used / cap) * 100;
  for (const b of BANDS) if (pct >= b) return b;
  return 0;
}

function sentence(which, used, cap, band) {
  const w = WORDS[which] ?? { one: which, many: which };
  const noun = cap === 1 ? w.one : w.many;

  if (band === 100) {
    return {
      title: `You have reached your ${noun} limit`,
      // What stops, and what does not. "Limit reached" alone reads as though
      // the clinic has stopped working.
      body:
        `${used} of ${cap} ${noun}. You cannot add any more until the limit is ` +
        `raised. Everything already here is unaffected.`,
    };
  }
  if (band === 90) {
    return {
      title: `Nearly at your ${noun} limit`,
      body: `${used} of ${cap} ${noun}. Worth sorting out before it stops you mid-clinic.`,
    };
  }
  return {
    title: `Approaching your ${noun} limit`,
    body: `${used} of ${cap} ${noun}.`,
  };
}

/** The people who can actually do something about it. */
async function managersOf(practiceId) {
  const rows = await Membership.find({
    practice: practiceId,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  })
    .select('user permissions role isOwner')
    .lean();

  const ids = rows
    // `permissionsOf` resolves an empty grant to the role preset, which is the
    // same rule the rest of the app reads. An owner always qualifies.
    .filter((m) => m.isOwner || (m.permissions ?? []).includes(PERMISSIONS.MANAGE_STAFF))
    .map((m) => m.user);

  if (ids.length === 0) return [];
  return User.find({ _id: { $in: ids }, isActive: true }).select('deviceTokens').lean();
}

/**
 * Check one limit and tell somebody if a new band has been crossed.
 *
 * Called after a successful add, never before: a notice sent alongside a
 * refusal is a second message about something the person is already reading.
 *
 * Never throws. A notification that fails must not roll back a patient
 * registration — the clinic's work is the point and this is a courtesy.
 */
export async function noticeUsage(practiceId, which, used) {
  if (!practiceId || !WORDS[which]) return null;

  try {
    const practice = await Practice.findById(practiceId).select('limits limitNotices name');
    if (!practice) return null;

    const cap = practice.limits?.[which] ?? null;
    // No cap is every practice today. Nothing to approach.
    if (cap === null || cap === undefined) return null;

    const band = bandFor(used, cap);
    const announced = practice.limitNotices?.[which] ?? 0;

    // Stepped back down: a raised cap or departed staff re-arms the warning.
    if (band < announced) {
      practice.limitNotices[which] = band;
      await practice.save();
      return null;
    }

    if (band === 0 || band === announced) return null;

    practice.limitNotices[which] = band;
    await practice.save();

    const staff = await managersOf(practiceId);
    const tokens = staff.flatMap((s) => s.deviceTokens ?? []);
    const { title, body } = sentence(which, used, cap, band);

    if (tokens.length > 0) {
      await deliver({ tokens, title, body, data: { type: 'usage_limit', which, band: String(band) } });
    }

    logger.info(
      { practice: String(practiceId), which, used, cap, band, reached: tokens.length },
      'usage limit notice',
    );
    return { which, band, used, cap };
  } catch (err) {
    // The clinic's work is the point; this is a courtesy that failed.
    logger.warn({ err, practice: String(practiceId), which }, 'could not send a usage notice');
    return null;
  }
}
