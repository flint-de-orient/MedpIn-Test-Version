import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { env } from '../src/config/env.js';

/**
 * An emergency written by a patient with two practices, before they chose one.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * The server asks such a patient which practice a message is for, with a 409,
 * rather than guess — and it asked before triage ran. So "I have severe chest
 * pain" raised no alert, paged no clinic and told the patient nothing, until
 * they had picked a doctor from a list and sent it again. The rule engine
 * exists so that escalation never waits on anything; here it waited on the
 * patient.
 *
 * ---- What must hold -------------------------------------------------------
 *
 * The question is still asked and nothing is written into a conversation the
 * patient did not choose. But the message is triaged first: an emergency pages
 * every practice caring for them and the refusal carries the written
 * instructions, in their language. When they then choose, the same alert is
 * linked, not raised a second time.
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

const CHEST_PAIN = 'I have severe chest pain';

let w;

/** Resolves once `check` returns something truthy, for the writes nobody awaits. */
async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function world() {
  const side = async (name) => {
    const practice = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    return { practice, doctor: await makeMember(practice, { name: `Dr ${name}`, isOwner: true }) };
  };
  const a = await side('Salt Lake');
  const b = await side('Behala');
  const patient = await makePatient({ name: 'Shared Patient', practices: [a.practice, b.practice] });
  await PatientProfile.create({ user: patient.user._id });
  return { a, b, patient, pid: patient.user._id };
}

describe('a patient with two practices writes an emergency without choosing one', () => {
  before(async () => {
    globalThis.fetch = localOnly;
    await boot();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    w = await world();
  });

  test('they are still asked which practice, and nothing is written into a conversation', async () => {
    const sent = await as(w.patient.token).post('/chat/message', { text: CHEST_PAIN, language: 'en' });

    assert.equal(sent.status, 409);
    assert.equal(sent.body.error.code, 'CONFLICT', 'the app recognises the question by this code');
    assert.equal(sent.body.error.details.reason, 'CHOOSE_PRACTICE');
    assert.equal(await ChatMessage.countDocuments({ content: CHEST_PAIN }), 0, 'the message was guessed into a practice');
  });

  test('the clinic is alerted before the answer, at every practice caring for them', async () => {
    const sent = await as(w.patient.token).post('/chat/message', { text: CHEST_PAIN, language: 'en' });

    assert.equal(sent.body.error.details.triage.urgency, 'emergency');
    const alerts = await ClinicalAlert.find({ patient: w.pid }).lean();
    assert.equal(alerts.length, 1, 'no alert was raised for an emergency the patient was asked about');
    assert.equal(alerts[0].severity, 'emergency');
    assert.equal(alerts[0].type, 'chest_pain');
    assert.equal(String(sent.body.error.details.alert.id), String(alerts[0]._id));
    assert.match(alerts[0].detail, /severe chest pain/, 'the clinic was not told what the patient wrote');

    // Paged by the alert, not by a conversation: both practices' doctors. The
    // record exists with its defaults from the start; `attemptedAt` is set only
    // once the page has actually gone out.
    const paged = await eventually(async () => {
      const n = (await ClinicalAlert.findById(alerts[0]._id).lean()).staffNotification;
      return n?.attemptedAt ? n : null;
    });
    assert.equal(paged?.recipients, 2, 'the doctors at both practices should be paged');
  });

  test('the patient is told what to do, in their language, with no clinic’s number guessed at', async () => {
    const saved = env.CLINIC_EMERGENCY_PHONE;
    env.CLINIC_EMERGENCY_PHONE = '+91 98300 55555';
    try {
      const en = await as(w.patient.token).post('/chat/message', { text: CHEST_PAIN, language: 'en' });
      assert.match(en.body.error.details.instructions, /nearest hospital emergency department/);
      assert.ok(
        !en.body.error.details.instructions.includes('98300 55555'),
        'one clinic’s number was offered to a patient who has not said which clinic',
      );

      const bn = await as(w.patient.token).post('/chat/message', { text: 'আমার বুকে ব্যথা করছে', language: 'bn' });
      assert.equal(bn.status, 409);
      assert.match(bn.body.error.details.instructions, /হাসপাতালের জরুরি বিভাগে/);
    } finally {
      env.CLINIC_EMERGENCY_PHONE = saved;
    }
  });

  test('once they choose, it is sent and linked to the same alert rather than paging twice', async () => {
    await as(w.patient.token).post('/chat/message', { text: CHEST_PAIN, language: 'en' });
    const first = await ClinicalAlert.findOne({ patient: w.pid }).lean();

    const chosen = await as(w.patient.token).post('/chat/message', {
      practiceId: String(w.a.practice._id),
      text: CHEST_PAIN,
      language: 'en',
    });

    assert.equal(chosen.status, 200);
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.pid }), 1, 'the clinic was paged twice for one message');
    const message = await ChatMessage.findOne({ content: CHEST_PAIN }).lean();
    assert.equal(String(message.alert), String(first._id));
  });

  test('a routine message is asked about and raises nothing', async () => {
    const sent = await as(w.patient.token).post('/chat/message', { text: 'what should I eat for breakfast' });

    assert.equal(sent.status, 409);
    assert.equal(sent.body.error.details.triage.urgency, 'routine');
    assert.equal(sent.body.error.details.alert, null);
    assert.equal(sent.body.error.details.instructions, null);
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.pid }), 0);
  });

  test('the streaming send escalates the same way', async () => {
    const streamed = await as(w.patient.token).post('/chat/message/stream', { text: CHEST_PAIN });

    assert.equal(streamed.status, 409);
    assert.equal(streamed.body.error.details.triage.urgency, 'emergency');
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.pid, severity: 'emergency' }), 1);
  });

  test('so does a message to the dietician', async () => {
    const sent = await as(w.patient.token).post('/chat/nutrition', { content: 'my sugar is 520', language: 'en' });

    assert.equal(sent.status, 409);
    assert.equal(sent.body.error.details.triage.urgency, 'emergency');
    const alert = await ClinicalAlert.findOne({ patient: w.pid }).lean();
    assert.equal(alert?.type, 'critical_hyperglycaemia');
    assert.match(alert.detail, /to the dietician/);
  });

  test('a voice note is triaged by what was said', async () => {
    const note = await MediaAsset.create({
      owner: w.pid,
      uploadedBy: w.pid,
      kind: 'voice_note',
      storageKey: 'voice/test.m4a',
      mimeType: 'audio/mp4',
      sizeBytes: 1024,
      transcript: CHEST_PAIN,
    });

    const sent = await as(w.patient.token).post('/chat/message', { text: '', attachments: [String(note._id)] });

    assert.equal(sent.status, 409);
    assert.equal(sent.body.error.details.triage.urgency, 'emergency', 'a spoken emergency was triaged as silence');
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.pid }), 1);
  });

  test('if the alert cannot be written, the patient is still asked rather than shown an error', async () => {
    const create = ClinicalAlert.create;
    ClinicalAlert.create = async () => {
      throw new Error('database unavailable');
    };
    try {
      const sent = await as(w.patient.token).post('/chat/message', { text: CHEST_PAIN });
      assert.equal(sent.status, 409, 'a failed escalation cost the patient their message');
      assert.equal(sent.body.error.details.reason, 'CHOOSE_PRACTICE');
    } finally {
      ClinicalAlert.create = create;
    }
  });

  test('a patient with one practice is never asked, and escalates as before', async () => {
    const solo = await makePatient({ name: 'Solo Patient', practices: [w.a.practice] });
    await PatientProfile.create({ user: solo.user._id });

    const sent = await as(solo.token).post('/chat/message', { text: CHEST_PAIN });

    assert.equal(sent.status, 200);
    assert.equal(sent.body.alert?.severity, 'emergency');
  });
});
