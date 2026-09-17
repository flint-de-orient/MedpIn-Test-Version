import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { User } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { specialtyHomeFor } from '../src/services/uiConfig.js';

/**
 * A cardiologist and a general physician no longer open a diabetes clinic's Home.
 *
 * The Home cards were chosen from the doctor's department alone, so a doctor at
 * a practice with no departments — every solo doctor — got the general set,
 * built for diabetes: a blood-sugar snapshot and a Live Triage ranked by a risk
 * score worked out from sugar and HbA1c.
 */

const DIABETES_CARDS = ['ANALYTICS_SUMMARY', 'TRIAGE_QUEUE'];

describe('which specialty’s Home, when no department says', () => {
  test('the practice’s specialty first', () => {
    assert.equal(specialtyHomeFor({ practiceSpecialty: 'cardiology' }), 'cardiology');
    assert.equal(specialtyHomeFor({ practiceSpecialty: 'general_physician', userSpecialty: 'Cardiologist' }), 'general_physician');
  });

  test('then the doctor’s own profile, matched narrowly', () => {
    assert.equal(specialtyHomeFor({ userSpecialty: 'Consultant Cardiologist' }), 'cardiology');
    assert.equal(specialtyHomeFor({ userSpecialty: 'General Physician' }), 'general_physician');
    assert.equal(specialtyHomeFor({ userSpecialty: 'MD (Internal Medicine)' }), 'general_physician');
    assert.equal(specialtyHomeFor({ userSpecialty: 'Diabetologist' }), 'diabetology');
    assert.equal(specialtyHomeFor({ userSpecialty: 'Endocrinologist' }), 'diabetology');
  });

  test('and nothing guessed at', () => {
    assert.equal(specialtyHomeFor({ userSpecialty: 'Orthopaedic surgeon' }), null);
    assert.equal(specialtyHomeFor({ practiceSpecialty: 'laboratory' }), null);
    assert.equal(specialtyHomeFor({}), null);
  });
});

describe('the Home each doctor opens', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function doctorAt({ practiceSpecialty = null, userSpecialty = null }) {
    const practice = await makePractice('Solo Practice', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
      specialty: practiceSpecialty,
    });
    const doctor = await makeMember(practice, { name: 'Dr Solo', isOwner: true });
    if (userSpecialty) await User.updateOne({ _id: doctor.user._id }, { $set: { specialty: userSpecialty } });
    const res = await as(doctor.token).get('/auth/me/capabilities');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.ui;
  }

  test('a cardiology practice: heart cards, and no diabetes cards', async () => {
    const ui = await doctorAt({ practiceSpecialty: 'cardiology' });
    assert.equal(ui.specialty, 'cardiology');
    for (const card of ['TODAYS_CLINIC', 'BP_CONTROL', 'HEART_RATE_FLAGS', 'RECENT_ECGS', 'LIPID_CONTROL', 'FOLLOW_UPS_DUE']) {
      assert.ok(ui.widgets.includes(card), `no ${card}`);
    }
    for (const card of DIABETES_CARDS) assert.ok(!ui.widgets.includes(card), `a cardiologist was shown ${card}`);
  });

  test('a general physician by their own profile: a GP’s cards, and no diabetes cards', async () => {
    const ui = await doctorAt({ userSpecialty: 'General Physician' });
    assert.equal(ui.specialty, 'general_physician');
    for (const card of ['TODAYS_CLINIC', 'FOLLOW_UPS_DUE', 'BP_CONTROL', 'CONDITION_REGISTRY']) {
      assert.ok(ui.widgets.includes(card), `no ${card}`);
    }
    for (const card of DIABETES_CARDS) assert.ok(!ui.widgets.includes(card), `a general physician was shown ${card}`);
  });

  test('a diabetology practice, and one nobody classified, keep the Home they had', async () => {
    const diabetology = await doctorAt({ practiceSpecialty: 'diabetology' });
    const unknown = await doctorAt({});
    assert.deepEqual(diabetology.widgets, unknown.widgets);
    for (const card of DIABETES_CARDS) assert.ok(unknown.widgets.includes(card), `the general Home lost ${card}`);
    assert.equal(unknown.specialty, null);
  });
});
