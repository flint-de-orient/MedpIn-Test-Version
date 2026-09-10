import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { enrolByPhone } from '../src/services/enrolByPhone.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { OtpChallenge } from '../src/models/OtpChallenge.js';
import { env } from '../src/config/env.js';

/**
 * Registering somebody who already uses MedPin.
 *
 * ---- What was reported --------------------------------------------------
 *
 * "I added one patient from Dr. Test's panel but it did not show any patient."
 *
 * Correct, and invisible. A practice reaching for a record it did not create
 * gets a PENDING enrolment that grants nothing until the patient reads back a
 * code, and every clinical list is scoped to ACTIVE ones — so the patient is
 * rightly absent. The desk was told "registered" and walked into their record
 * regardless, which from the counter is indistinguishable from a failure.
 *
 * The app half of that is a screen change. This is the server half: the only
 * way a desk can chase a pending enrolment is to register the person again,
 * and doing so returned `consentRequired: true` while sending nothing — so
 * "we have texted them a code, ask them to read it out" referred to a code
 * sent hours earlier and long expired.
 */

const PHONE_A = '+919812345671';
const PHONE_B = '+919812345672';

async function codeFor(phone) {
  return OtpChallenge.findOne({ phone, purpose: 'enrol' }).lean();
}

describe('a second practice reaching for an existing patient', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  /** Two practices, and a patient already enrolled at the first. */
  async function alreadyElsewhere(phone = PHONE_A) {
    const first = await makePractice('Dr Dey Diabetes Care');
    const second = await makePractice('Test Practice');
    const deskAtSecond = await makeMember(second, { name: 'Desk' });

    await enrolByPhone({ phone, name: 'Anita Sengupta', practiceId: first._id });
    return { first, second, deskAtSecond };
  }

  test('starts pending, so the patient is not in the second practice yet', async () => {
    const { second } = await alreadyElsewhere();

    const out = await enrolByPhone({
      phone: PHONE_A,
      name: 'Anita Sengupta',
      practiceId: second._id,
    });

    assert.equal(out.consentRequired, true);
    assert.equal(out.enrollment.status, ENROLLMENT_STATUS.PENDING);

    // The reason nothing appeared. Not a bug — the row grants nothing yet.
    const active = await Enrollment.countDocuments({
      practice: second._id,
      status: ENROLLMENT_STATUS.ACTIVE,
    });
    assert.equal(active, 0);
  });

  test('and the first practice is untouched by the second asking', async () => {
    const { first, second } = await alreadyElsewhere();
    await enrolByPhone({ phone: PHONE_A, name: 'Anita Sengupta', practiceId: second._id });

    const atFirst = await Enrollment.findOne({ practice: first._id }).lean();
    assert.equal(atFirst.status, ENROLLMENT_STATUS.ACTIVE);
  });

  test('registering the same person again sends a fresh code', async () => {
    /*
     * The fix. The desk's only way to chase a pending enrolment is to register
     * the person again, so that is the moment a new code has to go out —
     * otherwise the sentence on screen refers to a code that has expired.
     */
    const { second } = await alreadyElsewhere();
    await enrolByPhone({ phone: PHONE_A, name: 'Anita Sengupta', practiceId: second._id });

    const first = await codeFor(PHONE_A);
    assert.ok(first, 'no code was sent the first time');

    // Past the cooldown, which is the ordinary case: the desk comes back to a
    // pending patient later in the day.
    const cooldown = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    await OtpChallenge.updateOne(
      { _id: first._id },
      { $set: { lastSentAt: new Date(Date.now() - cooldown - 1000) } },
    );

    const out = await enrolByPhone({
      phone: PHONE_A,
      name: 'Anita Sengupta',
      practiceId: second._id,
    });
    assert.equal(out.consentRequired, true);

    const second_ = await codeFor(PHONE_A);
    assert.notEqual(
      second_.codeHash,
      first.codeHash,
      'the desk was told a code had been sent and none was',
    );
  });

  test('and being asked twice inside the cooldown is not an error', async () => {
    /*
     * `requestOtp` refuses a resend inside its cooldown, which exists so the
     * clinic's SMS bill stays finite. That refusal must not become a failed
     * registration: it means a code went out a moment ago and is still live,
     * which is the same instruction to the person at the counter.
     */
    const { second } = await alreadyElsewhere();
    await enrolByPhone({ phone: PHONE_A, name: 'Anita Sengupta', practiceId: second._id });

    const out = await enrolByPhone({
      phone: PHONE_A,
      name: 'Anita Sengupta',
      practiceId: second._id,
    });
    assert.equal(out.consentRequired, true, 'a cooldown turned into a failed registration');
  });

  test('a patient nobody has a record for is enrolled outright', async () => {
    // The other half. Narrowing when consent is needed is only safe if the
    // ordinary case still works: a first practice asks for nothing.
    const practice = await makePractice('Test Practice');

    const out = await enrolByPhone({
      phone: PHONE_B,
      name: 'Farida Rahman',
      practiceId: practice._id,
    });

    assert.equal(out.consentRequired, false);
    assert.equal(out.enrollment.status, ENROLLMENT_STATUS.ACTIVE);
    assert.equal(await codeFor(PHONE_B), null, 'a code went out for a first enrolment');
  });
});
