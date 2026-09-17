import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Feedback } from '../src/models/Feedback.js';
import { planFeedbackRouting, applyFeedbackRouting } from '../scripts/backfillFeedbackRouting.js';

/**
 * The feedback already on record, before rows said where they went.
 *
 * Written straight to the collection in the old shape — a patient, a subject,
 * the words, sometimes a practice-wide reviewed mark — exactly as the old route
 * left them.
 */

async function legacy(fields) {
  const { insertedId } = await Feedback.collection.insertOne({
    about: 'clinic',
    rating: 3,
    message: 'An old note',
    createdAt: new Date(Date.now() - 86_400_000),
    updatedAt: new Date(Date.now() - 86_400_000),
    ...fields,
  });
  return insertedId;
}

describe('backfilling where old feedback went', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('old rows become private and unattributed; new rows are untouched; the report writes nothing; a second run changes nothing', async () => {
    const salt = await makePractice('Salt Lake');
    const doctor = await makeMember(salt, { name: 'Dr Salt', isOwner: true });
    const patient = await makePatient({ name: 'Anita', practices: [salt] });

    const reviewed = await legacy({ patient: patient.user._id, reviewedAt: new Date(), reviewedBy: doctor.user._id });
    const app = await legacy({ patient: patient.user._id, about: 'app', message: 'Old app note' });

    const sent = await as(patient.token).post('/feedback', { about: 'clinic', message: 'A new note' });
    assert.equal(sent.status, 201);

    const plan = await planFeedbackRouting();
    assert.equal(plan.rows.length, 2);
    assert.deepEqual(plan.about, { app: 1, clinic: 1 });
    assert.equal((await Feedback.findById(reviewed).lean()).origin, undefined, 'the report wrote something');

    assert.equal(await applyFeedbackRouting(plan), 2);

    for (const id of [reviewed, app]) {
      const row = await Feedback.findById(id).lean();
      assert.equal(row.origin, 'legacy_unattributed');
      assert.equal(row.route, 'none');
      assert.equal(row.practice ?? null, null, 'an old row was given a practice');
      assert.equal(String(row.createdBy), String(patient.user._id));
    }
    // The old mark is history, and stays.
    assert.ok((await Feedback.findById(reviewed).lean()).reviewedAt);

    const fresh = await Feedback.findById(sent.body.id).lean();
    assert.equal(fresh.origin, 'patient_app');
    assert.equal(fresh.route, 'practice');

    // Still in no inbox, and still the author's.
    const inbox = await as(doctor.token).get('/feedback');
    assert.deepEqual(inbox.body.items.map((i) => i.message), ['A new note']);
    const mine = await as(patient.token).get('/feedback/mine');
    assert.equal(mine.body.items.length, 3);
    assert.deepEqual(
      mine.body.items.filter((i) => i.routedTo === 'private').map((i) => i.message).sort(),
      ['An old note', 'Old app note'],
    );

    assert.equal(await applyFeedbackRouting(await planFeedbackRouting()), 0, 'a second run changed something');
  });
});
