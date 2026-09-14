import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { Prescription } from '../src/models/Prescription.js';
import { RECORD_STATE } from '../src/models/plugins/clinicalRecord.js';
import { Clinic } from '../src/models/Clinic.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Practice, PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { User, ROLES } from '../src/models/User.js';
import { signAccessToken } from '../src/services/tokens.js';
import { acknowledgeAlert, resolveAlert } from '../src/services/alerts.js';

/**
 * What the role-guard audit found.
 *
 * ---- How these got past the authorisation sweep -------------------------
 *
 * The sweep classified every mutating route, and it counted a role guard as a
 * guard. A role list answers "may somebody in this job do this kind of thing";
 * it says nothing about whether the thing belongs to their practice. Every
 * route here was role-guarded, took an id from the URL, and looked it up with
 * `findById` — which on a single-clinic product is correct, and on a platform
 * means any doctor, dietician or front desk anywhere may act on anybody's row.
 *
 * ---- And one that looked guarded and was not ----------------------------
 *
 * The dietician routes all call `requireAssigned`, which reads as a check and
 * restricted nothing. Two independent ways:
 *
 *   `if (assigned.length === 0) return {}` — a dietician with no assignments
 *   matched every patient on the platform. "Clinic-wide by default" was the
 *   rule, and it was written before there was more than one clinic.
 *
 *   `{ user: req.params.id, ...scope }` — when the dietician *had*
 *   assignments, the scope's `user` key replaced the requested id, so the
 *   guard found one of their own patients whatever id was asked for. The
 *   handlers then read by `req.params.id`.
 *
 * No test had ever exercised those routes over HTTP. The fixtures here create
 * `PatientProfile` rows explicitly; `makePatient` does not, which is part of
 * why nothing noticed.
 *
 * Every test names a member of practice A reaching into practice B, proves the
 * row is unmodified, and proves the owning practice can still do the thing.
 */

const ABSENT = '000000000000000000000000';

/*
 * No outbound calls from this file.
 *
 * The app runs in this process, so the Gemini SDK's requests go out through the
 * same global `fetch` as the harness's — the SDK reads it at call time. Creating
 * a passage embeds it in the background, and with a developer's `.env` loaded
 * that is a real, billed call to Google carrying test text. Requests to the
 * local server pass; anything else is refused, in wording `withRetry` does not
 * treat as retryable, so nothing lingers after the suite.
 */
const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let a;
let b;

async function side(label) {
  const practice = await makePractice(label, {
    practiceType: PRACTICE_TYPE.CLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: `Dr ${label}`, isOwner: true });
  const dietician = await makeMember(practice, { name: `${label} Dietician`, role: ROLES.DIETICIAN });
  const patient = await makePatient({ name: `${label} Patient`, practices: [practice] });
  const other = await makePatient({ name: `${label} Second Patient`, practices: [practice] });
  await PatientProfile.create([{ user: patient.user._id }, { user: other.user._id }]);
  return { label, practice, doctor, dietician, patient, other };
}

function lifecycle() {
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
    a = await side('Salt Lake');
    b = await side('Behala');
  });
}

describe('a dietician reaches their own practice’s patients and nobody else’s', () => {
  lifecycle();

  test('with no assignments, another practice’s patient is refused', async () => {
    const res = await as(a.dietician.token).get(`/dietician/patients/${b.patient.user._id}/overview`);
    assert.equal(res.status, 404, 'a dietician with no assignments opened another practice’s record');
  });

  test('and their own practice’s patients are still theirs — the clinic-wide default', async () => {
    const res = await as(a.dietician.token).get(`/dietician/patients/${a.patient.user._id}/overview`);
    assert.equal(res.status, 200, 'a dietician lost their own practice’s patients');
  });

  test('with assignments, an unassigned patient is refused — the requested id is not replaced', async () => {
    /*
     * The spread. `{ user: req.params.id, ...scope }` with a scope of
     * `{ user: { $in: [assigned] } }` found the assigned patient's profile for
     * any requested id, and the handler then read the requested one.
     */
    await PatientProfile.updateOne({ user: a.patient.user._id }, { assignedDietician: a.dietician.user._id });
    const res = await as(a.dietician.token).get(`/dietician/patients/${a.other.user._id}/overview`);
    assert.equal(res.status, 404, 'an unassigned patient passed the assignment guard');
  });

  test('and with assignments, another practice’s patient is refused too', async () => {
    await PatientProfile.updateOne({ user: a.patient.user._id }, { assignedDietician: a.dietician.user._id });
    const res = await as(a.dietician.token).get(`/dietician/patients/${b.patient.user._id}/overview`);
    assert.equal(res.status, 404);
  });

  test('an assignment that reached into another practice grants nothing', async () => {
    /*
     * The doctor-side assignment route did not scope the dietician either, so
     * a row like this can already exist. Counted, it would put another
     * practice's patient on this dietician's list.
     */
    await PatientProfile.updateOne({ user: b.patient.user._id }, { assignedDietician: a.dietician.user._id });
    const res = await as(a.dietician.token).get(`/dietician/patients/${b.patient.user._id}/overview`);
    assert.equal(res.status, 404, 'a stale cross-practice assignment opened the record');
  });

  test('but the assigned patient still opens', async () => {
    await PatientProfile.updateOne({ user: a.patient.user._id }, { assignedDietician: a.dietician.user._id });
    const res = await as(a.dietician.token).get(`/dietician/patients/${a.patient.user._id}/overview`);
    assert.equal(res.status, 200);
  });

  test('and the patient list holds no other practice’s patients', async () => {
    const res = await as(a.dietician.token).get('/dietician/patients');
    assert.equal(res.status, 200, 'the list route moved — this test would pass vacuously');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(String(b.patient.user._id)), 'another practice’s patient is in the list');
    assert.ok(!text.includes('Behala Patient'));
  });
});

describe('a patient can only be given a dietician from their own practice', () => {
  lifecycle();

  test('another practice’s dietician is refused', async () => {
    /*
     * The patient is scoped here and the dietician was not — and the
     * dietician routes trust the assignment. Assigning an outsider would hand
     * them this patient's clinical record through the overview.
     */
    const res = await as(a.doctor.token).patch(`/doctor/patients/${a.patient.user._id}/dietician`, {
      dieticianId: String(b.dietician.user._id),
    });
    assert.equal(res.status, 404, 'a dietician from another practice was assigned');
    const profile = await PatientProfile.findOne({ user: a.patient.user._id }).lean();
    assert.ok(!profile.assignedDietician, 'the assignment was written');
  });

  test('but their own practice’s dietician can be assigned', async () => {
    const res = await as(a.doctor.token).patch(`/doctor/patients/${a.patient.user._id}/dietician`, {
      dieticianId: String(a.dietician.user._id),
    });
    assert.equal(res.status, 200);
    const profile = await PatientProfile.findOne({ user: a.patient.user._id }).lean();
    assert.equal(String(profile.assignedDietician), String(a.dietician.user._id));
  });
});

describe('a doctor cannot close another practice’s clinical alert', () => {
  lifecycle();

  const alertFor = (who) =>
    ClinicalAlert.create({
      patient: who.patient.user._id,
      severity: 'urgent',
      type: 'other',
      title: 'Reading out of range',
      source: { kind: 'system' },
    });

  test('acknowledging is refused and the alert stays open', async () => {
    const alert = await alertFor(b);
    const res = await as(a.doctor.token).post(`/doctor/alerts/${alert._id}/acknowledge`, {});
    assert.equal(res.status, 404);
    assert.equal((await ClinicalAlert.findById(alert._id).lean()).status, 'open');
  });

  test('resolving is refused and the alert stays in their triage queue', async () => {
    /*
     * "This patient no longer needs a doctor" is the judgement requireDoctor
     * exists to protect — and it was open to every doctor on the platform
     * about every other practice's patients.
     */
    const alert = await alertFor(b);
    const res = await as(a.doctor.token).post(`/doctor/alerts/${alert._id}/resolve`, { notes: 'closed' });
    assert.equal(res.status, 404);
    assert.equal((await ClinicalAlert.findById(alert._id).lean()).status, 'open');
  });

  test('and the service will not change an alert without being given a scope', async () => {
    // An optional scope is how this comes back: the next caller leaves it off.
    const alert = await alertFor(a);
    await assert.rejects(acknowledgeAlert(alert._id, a.doctor.user._id), /practice scope/);
    await assert.rejects(resolveAlert(alert._id, a.doctor.user._id, 'notes'), /practice scope/);
    assert.equal((await ClinicalAlert.findById(alert._id).lean()).status, 'open');
  });

  test('but their own practice’s alert can be closed', async () => {
    const alert = await alertFor(a);
    const res = await as(a.doctor.token).post(`/doctor/alerts/${alert._id}/resolve`, { notes: 'seen' });
    assert.equal(res.status, 200);
    assert.equal((await ClinicalAlert.findById(alert._id).lean()).status, 'resolved');
  });

  test('and the refusal is indistinguishable from an alert that does not exist', async () => {
    const alert = await alertFor(b);
    const real = await as(a.doctor.token).post(`/doctor/alerts/${alert._id}/acknowledge`, {});
    const absent = await as(a.doctor.token).post(`/doctor/alerts/${ABSENT}/acknowledge`, {});
    assert.equal(real.status, absent.status);
    assert.deepEqual(real.body, absent.body);
  });
});

describe('a doctor cannot end another practice’s prescription', () => {
  lifecycle();

  let n = 0;
  const rxFor = (who, patient = who.patient) => {
    n += 1;
    return Prescription.create({
      patient: patient.user._id,
      doctor: who.doctor.user._id,
      referenceNo: `RX-AUDIT-${Date.now()}-${n}`,
      items: [{ name: 'Metformin 500 mg' }],
    });
  };
  const voiding = { state: RECORD_STATE.VOIDED, reason: 'Entered against the wrong patient' };

  test('voiding is refused and the prescription stays current', async () => {
    const rx = await rxFor(b);
    const res = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, voiding);
    assert.equal(res.status, 404, 'a doctor voided another practice’s prescription');
    assert.equal((await Prescription.findById(rx._id).lean()).recordState, RECORD_STATE.CURRENT);
  });

  test('but their own practice’s prescription can be voided', async () => {
    const rx = await rxFor(a);
    const res = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, voiding);
    assert.equal(res.status, 200);
    assert.equal((await Prescription.findById(rx._id).lean()).recordState, RECORD_STATE.VOIDED);
  });

  test('a correction cannot name another patient’s prescription as its replacement', async () => {
    /*
     * The same handler stored `replacedBy` unchecked. A correction pointing at
     * a different patient's prescription is a wrong-patient clinical record,
     * and across practices it is a link into somebody else's data.
     */
    const rx = await rxFor(a);
    const wrongPatient = await rxFor(a, a.other);
    const res = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, {
      state: RECORD_STATE.CORRECTED,
      reason: 'Dose corrected',
      replacedBy: String(wrongPatient._id),
    });
    assert.equal(res.status, 400);
    assert.equal((await Prescription.findById(rx._id).lean()).recordState, RECORD_STATE.CURRENT);
  });

  test('nor name itself', async () => {
    const rx = await rxFor(a);
    const res = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, {
      state: RECORD_STATE.CORRECTED,
      reason: 'Dose corrected',
      replacedBy: String(rx._id),
    });
    assert.equal(res.status, 400);
    assert.equal((await Prescription.findById(rx._id).lean()).recordState, RECORD_STATE.CURRENT);
  });

  test('but a replacement for the same patient is accepted', async () => {
    const rx = await rxFor(a);
    const replacement = await rxFor(a);
    const res = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, {
      state: RECORD_STATE.CORRECTED,
      reason: 'Dose corrected',
      replacedBy: String(replacement._id),
    });
    assert.equal(res.status, 200);
  });

  test('and the refusal is indistinguishable from a prescription that does not exist', async () => {
    const rx = await rxFor(b);
    const real = await as(a.doctor.token).post(`/records/prescriptions/${rx._id}/end`, voiding);
    const absent = await as(a.doctor.token).post(`/records/prescriptions/${ABSENT}/end`, voiding);
    assert.equal(real.status, absent.status);
    assert.deepEqual(real.body, absent.body);
  });
});

describe('another practice’s consent history is not readable', () => {
  lifecycle();

  test('refused', async () => {
    const res = await as(a.doctor.token).get(
      `/records/enrolments/${b.patient.enrollments[0]._id}/consent/latest`,
    );
    assert.equal(res.status, 404);
  });

  test('but their own is', async () => {
    const res = await as(a.doctor.token).get(
      `/records/enrolments/${a.patient.enrollments[0]._id}/consent/latest`,
    );
    assert.equal(res.status, 200);
  });
});

describe('a practice’s letterhead is its own', () => {
  lifecycle();

  test('a head doctor cannot rewrite another practice’s registration number', async () => {
    /*
     * `requirePermission(MANAGE_STAFF)` checks the caller's grant at their own
     * practice. It cannot answer whether practice :id is theirs — and the
     * fields here print on that practice's prescriptions.
     */
    const res = await as(a.doctor.token).patch(`/practices/${b.practice._id}`, {
      registrationNo: 'FORGED-001',
      doctorDisplayName: 'Dr Nobody',
    });
    assert.notEqual(res.status, 200, 'another practice’s letterhead was rewritten');
    const after = await Practice.findById(b.practice._id).lean();
    assert.notEqual(after.registrationNo, 'FORGED-001');
  });

  test('and the refusal does not confirm the practice exists', async () => {
    const real = await as(a.doctor.token).patch(`/practices/${b.practice._id}`, { name: 'Renamed' });
    const absent = await as(a.doctor.token).patch(`/practices/${ABSENT}`, { name: 'Renamed' });
    assert.equal(real.status, absent.status);
    assert.deepEqual(real.body, absent.body);
  });

  test('but their own practice can be edited', async () => {
    const res = await as(a.doctor.token).patch(`/practices/${a.practice._id}`, { tagline: 'Diabetes care' });
    assert.equal(res.status, 200);
  });
});

describe('a practice’s locations are its own', () => {
  lifecycle();

  const clinicFor = (who) => Clinic.create({ name: `${who.label} Clinic`, practice: who.practice._id });

  test('another practice’s location cannot be edited', async () => {
    const clinic = await clinicFor(b);
    const res = await as(a.doctor.token).patch(`/clinics/${clinic._id}`, { phone: '+910000000000' });
    assert.equal(res.status, 404, 'another practice’s location was edited');
    assert.notEqual((await Clinic.findById(clinic._id).lean()).phone, '+910000000000');
  });

  test('nor deactivated', async () => {
    const clinic = await clinicFor(b);
    const res = await as(a.doctor.token).del(`/clinics/${clinic._id}`);
    assert.equal(res.status, 404);
    assert.notEqual((await Clinic.findById(clinic._id).lean()).isActive, false);
  });

  test('but their own can be edited', async () => {
    const clinic = await clinicFor(a);
    const res = await as(a.doctor.token).patch(`/clinics/${clinic._id}`, { phone: '+913300000000' });
    assert.equal(res.status, 200);
  });

  test('and the refusal is indistinguishable from a location that does not exist', async () => {
    const clinic = await clinicFor(b);
    const real = await as(a.doctor.token).patch(`/clinics/${clinic._id}`, { phone: '+910000000000' });
    const absent = await as(a.doctor.token).patch(`/clinics/${ABSENT}`, { phone: '+910000000000' });
    assert.equal(real.status, absent.status);
    assert.deepEqual(real.body, absent.body);
  });
});

describe('the assistant’s knowledge is each practice’s own', () => {
  /*
   * The worst of these, because of where it lands.
   *
   * `knowledgeSchema` had no `practice` and the create route never set one,
   * so every passage any doctor wrote was `practice: null` — which the
   * retrieval layer serves to every practice's assistant. The list was
   * unfiltered and edit, approve and retire were unscoped. Any doctor on the
   * platform could write a passage, approve it themselves, and have every
   * practice's assistant cite it to patients.
   */
  lifecycle();

  let n = 0;
  const chunkFor = (practice, overrides = {}) => {
    n += 1;
    return KnowledgeChunk.create({
      docId: `audit-${n}`,
      title: 'Hypoglycaemia at night',
      content: 'If your sugar is below 70 at night, take fifteen grams of fast sugar and check again.',
      category: 'hypoglycaemia',
      language: 'en',
      status: 'pending_review',
      practice,
      // Present so approving does not try to embed over the network.
      embedding: [0.1, 0.2, 0.3],
      ...overrides,
    });
  };

  test('a passage a doctor writes belongs to their practice', async () => {
    const res = await as(a.doctor.token).post('/doctor/knowledge', {
      docId: 'salt-lake-hours',
      title: 'Our opening hours',
      content: 'The clinic is open from nine in the morning until one, Monday to Saturday.',
      category: 'clinic_info',
      language: 'en',
    });
    assert.equal(res.status, 201);
    const saved = await KnowledgeChunk.findOne({ docId: 'salt-lake-hours' }).lean();
    assert.equal(String(saved.practice), String(a.practice._id), 'the passage was created shared');
  });

  test('another practice’s passages are not listed', async () => {
    const theirs = await chunkFor(b.practice._id);
    const res = await as(a.doctor.token).get('/doctor/knowledge');
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(String(theirs._id)),
      'another practice’s passage is in the list',
    );
  });

  test('shared passages are listed, and say that they are shared', async () => {
    const shared = await chunkFor(null, { status: 'approved' });
    const mine = await chunkFor(a.practice._id);
    const res = await as(a.doctor.token).get('/doctor/knowledge');
    const byId = Object.fromEntries(res.body.items.map((c) => [String(c.id), c]));
    assert.equal(byId[String(shared._id)]?.isShared, true);
    assert.equal(byId[String(mine._id)]?.isShared, false);
  });

  test('another practice’s passage cannot be edited, approved or retired', async () => {
    const theirs = await chunkFor(b.practice._id);
    const doctor = as(a.doctor.token);

    assert.equal((await doctor.patch(`/doctor/knowledge/${theirs._id}`, { title: 'Rewritten' })).status, 404);
    assert.equal((await doctor.post(`/doctor/knowledge/${theirs._id}/approve`, {})).status, 404);
    assert.equal((await doctor.post(`/doctor/knowledge/${theirs._id}/retire`, {})).status, 404);

    const after = await KnowledgeChunk.findById(theirs._id).lean();
    assert.equal(after.title, 'Hypoglycaemia at night');
    assert.equal(after.status, 'pending_review');
  });

  test('a shared passage cannot be changed from a practice', async () => {
    /*
     * What every practice's assistant cites. A doctor at one practice
     * rewriting or retiring it changes clinical advice for all of them.
     */
    const shared = await chunkFor(null, { status: 'approved' });
    const doctor = as(a.doctor.token);

    assert.equal((await doctor.patch(`/doctor/knowledge/${shared._id}`, { title: 'Rewritten' })).status, 404);
    assert.equal((await doctor.post(`/doctor/knowledge/${shared._id}/retire`, {})).status, 404);

    const after = await KnowledgeChunk.findById(shared._id).lean();
    assert.equal(after.title, 'Hypoglycaemia at night');
    assert.equal(after.status, 'approved');
  });

  test('but a practice’s own passage can be edited, approved and retired', async () => {
    const mine = await chunkFor(a.practice._id);
    const doctor = as(a.doctor.token);

    assert.equal((await doctor.patch(`/doctor/knowledge/${mine._id}`, { title: 'Low sugar at night' })).status, 200);
    assert.equal((await doctor.post(`/doctor/knowledge/${mine._id}/approve`, {})).status, 200);
    assert.equal((await doctor.post(`/doctor/knowledge/${mine._id}/retire`, {})).status, 200);
    assert.equal((await KnowledgeChunk.findById(mine._id).lean()).status, 'retired');
  });

  test('a doctor with no practice is refused the knowledge base and changes nothing', async () => {
    /*
     * `practiceOf` is null for a doctor whose membership has ended. Treated as
     * "unknown, so permit", they would write shared passages — served to every
     * practice — and `{ practice: null }` would select the shared corpus as
     * theirs to edit.
     *
     * This test used to say "reads only shared passages", from when a missing
     * membership still permitted. On a platform with memberships, a member of
     * staff with no practice is now refused outright (NO_PRACTICE; see
     * unplacedStaff). That keeps every promise the old test made, and adds a
     * stronger one: nothing is listed at all.
     */
    const user = await User.create({
      name: 'Dr Former',
      phone: '+918800000001',
      role: ROLES.DOCTOR,
      isActive: true,
    });
    const former = as(signAccessToken(user));
    const shared = await chunkFor(null, { status: 'approved' });
    const theirs = await chunkFor(a.practice._id);

    const list = await former.get('/doctor/knowledge');
    assert.equal(list.status, 403);
    assert.equal(list.body.error.code, 'NO_PRACTICE');
    const said = JSON.stringify(list.body);
    assert.ok(!said.includes(String(theirs._id)), 'a practice’s passage was listed to a doctor with no practice');
    assert.ok(!said.includes(String(shared._id)), 'the refusal carried the shared corpus');

    const created = await former.post('/doctor/knowledge', {
      docId: 'unowned',
      title: 'Written from nowhere',
      content: 'Twenty or more characters of wording nobody reviewed.',
      category: 'general',
      language: 'en',
    });
    assert.equal(created.status, 403);
    assert.equal(await KnowledgeChunk.countDocuments({ docId: 'unowned' }), 0);

    assert.equal((await former.patch(`/doctor/knowledge/${shared._id}`, { title: 'Rewritten' })).status, 403);
    assert.equal((await KnowledgeChunk.findById(shared._id).lean()).title, 'Hypoglycaemia at night');
  });
});
