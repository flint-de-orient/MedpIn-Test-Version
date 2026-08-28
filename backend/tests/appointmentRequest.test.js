import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVE_STATUSES } from '../src/services/scheduling.js';
import { Appointment } from '../src/models/Appointment.js';

/**
 * The request path, and the two ways it went wrong before it shipped.
 *
 * A request is a patient asking for an appointment without choosing a slot —
 * "can I see the doctor on Tuesday?" from the care thread. The desk turns it
 * into a time. Both faults below came from treating that wish as though it were
 * already a booking.
 */
describe('an appointment request', () => {
  test('a request must not hold a slot', () => {
    // 'requested' counts as active, and the slot engine treats every active
    // appointment as taken. So a request carrying a time in scheduledFor would
    // block that hour for everyone — including the desk trying to confirm the
    // very request that blocked it.
    //
    // The guarantee is therefore about the field, not the status: a request has
    // no scheduledFor at all, so it cannot collide with anything.
    assert.ok(
      ACTIVE_STATUSES.includes('requested'),
      'if requested ever leaves ACTIVE_STATUSES, re-read this test: the guarantee below is what replaced holding the slot',
    );

    const requested = new Appointment({
      patient: '6a65f8f7227b3030a53e4af5',
      doctor: '6a65f8f7227b3030a53e4af6',
      status: 'requested',
      preferredFor: new Date('2026-09-01T00:00:00Z'),
    });

    assert.equal(requested.scheduledFor, undefined, 'a request must carry no scheduled time');
    assert.ok(requested.preferredFor, 'the day the patient asked for is kept separately');
  });

  test('a request validates without a scheduled time', async () => {
    const requested = new Appointment({
      patient: '6a65f8f7227b3030a53e4af5',
      doctor: '6a65f8f7227b3030a53e4af6',
      status: 'requested',
      preferredFor: new Date('2026-09-01T00:00:00Z'),
    });
    await assert.doesNotReject(() => requested.validate());
  });

  test('a confirmed appointment still requires its time', async () => {
    // The other half of the conditional rule: relaxing it for requests must not
    // let a confirmed appointment exist without an hour attached to it.
    const confirmed = new Appointment({
      patient: '6a65f8f7227b3030a53e4af5',
      doctor: '6a65f8f7227b3030a53e4af6',
      status: 'confirmed',
    });
    await assert.rejects(() => confirmed.validate(), /scheduledFor/);
  });
});
