import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { LabResult } from '../src/models/LabResult.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ShareGrant } from '../src/models/ShareGrant.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { revokeEnrolment } from '../src/services/enrollments.js';

/**
 * A patient sharing their earlier records with one of their practices.
 *
 * ---- The world ------------------------------------------------------------
 *
 * Rahul was a patient of his own app for a month before Salt Lake enrolled him
 * ten days ago. So his record has two halves: what happened before Salt Lake
 * (a prescription, a reading, a blood pressure, a lab report) and what happened
 * since. Salt Lake reads the second half by enrolment. The first half is his to
 * share, a category at a time, with the practice or one doctor there, for as
 * long as he chooses — and every read it allows is written down.
 *
 * Behala has never met him, and no grant changes that.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

let salt;
let behala;
let rahul;

async function world() {
  const practice = async (name) => {
    const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    return {
      practice: p,
      owner: await makeMember(p, { name: `Dr ${name} Owner`, isOwner: true }),
      doctor: await makeMember(p, { name: `Dr ${name} Colleague` }),
      desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
    };
  };
  salt = await practice('Salt Lake');
  behala = await practice('Behala');

  rahul = await makePatient({ name: 'Rahul Bose', practices: [salt.practice] });
  await Enrollment.updateOne({ _id: rahul.enrollments[0]._id }, { $set: { enrolledOn: ago(10) } });

  const id = rahul.user._id;
  const doctor = salt.owner.user._id;
  rahul.before = {
    prescription: await Prescription.create({
      patient: id,
      doctor,
      referenceNo: 'SHR-BEFORE-000001',
      issuedOn: ago(30),
      items: [{ name: 'Glimepiride', strength: '1mg' }],
    }),
    glucose: await GlucoseReading.create({ patient: id, valueMgDl: 287, context: 'fasting', measuredAt: ago(30) }),
    vital: await VitalRecord.create({ patient: id, systolic: 171, diastolic: 99, recordedAt: ago(30) }),
  };
  // `createdAt` is the window's field for a lab report, and Mongoose will not
  // backdate a timestamp it manages — so the row goes in through the driver.
  const { insertedId } = await LabResult.collection.insertOne({
    patient: id,
    testName: 'Lipid profile from before',
    createdAt: ago(30),
    updatedAt: ago(30),
  });
  rahul.before.labResult = insertedId;

  rahul.after = {
    prescription: await Prescription.create({
      patient: id,
      doctor,
      referenceNo: 'SHR-AFTER-000001',
      issuedOn: ago(2),
      items: [{ name: 'Metformin', strength: '500mg' }],
    }),
    glucose: await GlucoseReading.create({ patient: id, valueMgDl: 131, context: 'fasting', measuredAt: ago(2) }),
  };
}

const references = (res) => (res.body.items ?? []).map((p) => p.referenceNo);
const values = (res) => (res.body.items ?? []).map((g) => g.valueMgDl);

function share(body, token = rahul.token, headers) {
  return as(token).post('/sharing/grants', { practiceId: String(salt.practice._id), ...body }, headers);
}

describe('without a grant, an enrolment reads only from its own date', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('the prescription and the reading from before are hidden, the ones since are not', async () => {
    const rx = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.equal(rx.status, 200);
    assert.deepEqual(references(rx), ['SHR-AFTER-000001']);

    const glucose = await as(salt.owner.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(values(glucose), [131]);
  });

  test('and a named date range does not reach back past it either', async () => {
    // The fuller set is recordWindowDateRange.test.js. Asked here too because
    // a grant means nothing if a query string does the same without one.
    const glucose = await as(salt.owner.token).get(`/patients/${rahul.user._id}/glucose?from=${ago(365).toISOString()}`);
    assert.equal(glucose.status, 200);
    assert.deepEqual(values(glucose), [131], 'a date range reached past the enrolment');
  });
});

describe('a grant widens exactly what it names', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('prescriptions shared with the practice: its doctors read them from before, and nothing else widens', async () => {
    const res = await share({ categories: ['prescriptions'] });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    for (const who of [salt.owner, salt.doctor]) {
      const rx = await as(who.token).get(`/patients/${rahul.user._id}/prescriptions`);
      assert.deepEqual(references(rx).sort(), ['SHR-AFTER-000001', 'SHR-BEFORE-000001']);
      const one = await as(who.token).get(`/patients/${rahul.user._id}/prescriptions/${rahul.before.prescription._id}`);
      assert.equal(one.status, 200, 'the list shows it and its own URL refuses it');
    }

    // Readings were not shared.
    const glucose = await as(salt.owner.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(values(glucose), [131], 'a prescriptions grant widened readings');

    // Nor lab reports, though the lab-tests screen reads prescriptions too.
    const labs = await as(salt.owner.token).get(`/patients/${rahul.user._id}/lab-tests`);
    assert.equal(labs.status, 200);
    assert.ok(!allText(labs.body).includes('Lipid profile from before'), 'a prescriptions grant widened lab results');
  });

  test('a grant naming one doctor widens nothing for anybody else at the practice', async () => {
    const res = await share({ categories: ['readings'], doctorId: String(salt.doctor.user._id) });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const named = await as(salt.doctor.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(values(named).sort(), [131, 287]);

    const colleague = await as(salt.owner.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(values(colleague), [131], 'the grant reached a doctor it did not name');

    const desk = await as(salt.desk.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(values(desk), [131], 'the grant reached the desk');
  });

  test('a doctor who is not at that practice cannot be named', async () => {
    const res = await share({ categories: ['readings'], doctorId: String(behala.owner.user._id) });
    assert.equal(res.status, 400);
    assert.equal(await ShareGrant.countDocuments(), 0);
  });

  test('another practice gets nothing from it, and cannot be shared with while it has not enrolled him', async () => {
    await share({ categories: ['prescriptions', 'readings'] });

    const reach = await as(behala.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.equal(reach.status, 403);
    assert.ok(!allText(reach.body).includes('SHR-'), 'the refusal carried a prescription');

    const toBehala = await as(rahul.token).post('/sharing/grants', {
      practiceId: String(behala.practice._id),
      categories: ['prescriptions'],
    });
    assert.equal(toBehala.status, 409, 'a patient shared with a practice they are not registered with');
    assert.equal(await ShareGrant.countDocuments({ practice: behala.practice._id }), 0);
  });

  test('expired is nothing, immediately — and an end date in the past is refused', async () => {
    const past = await share({ categories: ['prescriptions'], expiresAt: ago(1).toISOString() });
    assert.equal(past.status, 400);

    const res = await share({ categories: ['prescriptions'], expiresAt: new Date(Date.now() + DAY).toISOString() });
    assert.equal(res.status, 201);
    assert.equal(references(await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`)).length, 2);

    // A minute past its end. No job has run; the next read is already narrower.
    await ShareGrant.updateOne({ _id: res.body.grant.id }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    const after = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(references(after), ['SHR-AFTER-000001'], 'an expired grant still widened the read');
  });

  test('revoked is nothing, immediately', async () => {
    const res = await share({ categories: ['prescriptions'] });
    assert.equal(references(await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`)).length, 2);

    const revoked = await as(rahul.token).post(`/sharing/grants/${res.body.grant.id}/revoke`, {});
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.grant.status, 'revoked');

    const after = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(references(after), ['SHR-AFTER-000001']);

    // Twice is once.
    const again = await as(rahul.token).post(`/sharing/grants/${res.body.grant.id}/revoke`, {});
    assert.equal(again.status, 200);
  });

  test('nobody else can take it back or make one: not the practice, not another patient', async () => {
    const res = await share({ categories: ['prescriptions'] });

    const byPractice = await as(salt.owner.token).post(`/sharing/grants/${res.body.grant.id}/revoke`, {});
    assert.equal(byPractice.status, 403);

    const stranger = await makePatient({ name: 'Somebody Else', practices: [salt.practice] });
    const byStranger = await as(stranger.token).post(`/sharing/grants/${res.body.grant.id}/revoke`, {});
    assert.equal(byStranger.status, 404);

    const forRahul = await as(stranger.token).post('/sharing/grants', {
      patientId: String(rahul.user._id),
      practiceId: String(salt.practice._id),
      categories: ['readings'],
    });
    assert.equal(forRahul.status, 403, 'a patient shared somebody else’s record');

    const practiceMakes = await as(salt.owner.token).post('/sharing/grants', {
      patientId: String(rahul.user._id),
      practiceId: String(salt.practice._id),
      categories: ['readings'],
    });
    assert.equal(practiceMakes.status, 403, 'a practice granted itself access');

    assert.equal((await ShareGrant.findById(res.body.grant.id).lean()).state, 'active');
    assert.equal(await ShareGrant.countDocuments(), 1);
  });

  test('a grant never lets the practice change what it was shown', async () => {
    await share({ categories: ['prescriptions', 'lab_results'] });

    // Superseding the prescription from before, which the grant lets the
    // doctor read, finds nothing to supersede.
    const supersede = await as(salt.owner.token).post(`/patients/${rahul.user._id}/prescriptions`, {
      items: [{ name: 'Glimepiride', strength: '2mg' }],
      supersedes: String(rahul.before.prescription._id),
    });
    assert.equal(supersede.status, 404, `answered ${supersede.status}`);
    assert.equal((await Prescription.findById(rahul.before.prescription._id).lean()).recordState, 'current');

    // Deleting the lab report from before, likewise.
    const del = await as(salt.owner.token).del(`/patients/${rahul.user._id}/lab-tests/${rahul.before.labResult}`);
    assert.equal(del.status, 404);
    assert.ok(await LabResult.exists({ _id: rahul.before.labResult }), 'a shared lab report was deleted');
  });

  test('every read it widens is written down, with the grant', async () => {
    const res = await share({ categories: ['prescriptions'] });

    await as(salt.doctor.token).get(`/patients/${rahul.user._id}/prescriptions`);
    // A read the grant does not touch writes no shared-read row.
    await as(salt.doctor.token).get(`/patients/${rahul.user._id}/glucose`);
    // Nor does the patient reading their own.
    await as(rahul.token).get('/patients/me/prescriptions');

    // The audit write is fire-and-forget after the response; give it a moment.
    await new Promise((r) => setTimeout(r, 200));
    const rows = await AuditLog.find({ action: 'read.shared' }).lean();
    assert.equal(rows.length, 1, `expected one shared read, found ${rows.length}`);
    assert.equal(String(rows[0].resourceId), res.body.grant.id);
    assert.equal(String(rows[0].actor), String(salt.doctor.user._id));
    assert.equal(String(rows[0].subjectPatient), String(rahul.user._id));
    assert.equal(rows[0].meta.category, 'prescriptions');
    assert.equal(rows[0].meta.practice, String(salt.practice._id));
  });

  test('the same request twice makes one grant, even at the same moment', async () => {
    await ShareGrant.createIndexes();
    const headers = { 'Idempotency-Key': 'share-once-0001' };
    const [one, two] = await Promise.all([
      share({ categories: ['readings'] }, rahul.token, headers),
      share({ categories: ['readings'] }, rahul.token, headers),
    ]);
    assert.ok([200, 201].includes(one.status) && [200, 201].includes(two.status), `${one.status} ${two.status}`);
    assert.equal(one.body.grant.id, two.body.grant.id);
    assert.equal(await ShareGrant.countDocuments(), 1);

    const different = await share({ categories: ['prescriptions'] }, rahul.token, headers);
    assert.equal(different.status, 409, 'a key reused for a different grant was answered with the old one');
  });

  test('a guardian shares for the child they look after, and for nobody else’s', async () => {
    const child = await Patient.create({ login: rahul.user._id, name: 'Aarav Bose', relationship: RELATIONSHIP.CHILD });
    await Enrollment.create({ patient: child._id, practice: salt.practice._id, status: 'active', enrolledOn: ago(5) });

    const res = await as(rahul.token).post('/sharing/grants', {
      patientId: String(child._id),
      practiceId: String(salt.practice._id),
      categories: ['readings'],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.grant.patient, String(child._id));

    const overview = await as(rahul.token).get(`/sharing?patientId=${child._id}`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.connected[0].shared.length, 1);
  });

  test('when the practice’s enrolment ends, its grants end with it and do not come back', async () => {
    const res = await share({ categories: ['prescriptions'] });
    await revokeEnrolment({ enrollmentId: rahul.enrollments[0]._id, actor: rahul.user._id });

    const grant = await ShareGrant.findById(res.body.grant.id).lean();
    assert.equal(grant.state, 'revoked');
    assert.equal(grant.revokeReason, 'enrolment_ended');

    // Enrolled again by some other route: the old grant stays ended.
    await Enrollment.updateOne({ _id: rahul.enrollments[0]._id }, { $set: { status: 'active', revokedAt: null } });
    const rx = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(references(rx), ['SHR-AFTER-000001'], 'a grant from an ended relationship came back');
  });
});

describe('the patient can see who can see their records, and what happened', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('every practice with access, why, and what is shared on top', async () => {
    await share({ categories: ['prescriptions'], doctorId: String(salt.doctor.user._id) });

    const res = await as(rahul.token).get('/sharing');
    assert.equal(res.status, 200);
    assert.equal(res.body.connected.length, 1);
    const [row] = res.body.connected;
    assert.equal(row.practice.name, 'Salt Lake');
    assert.equal(row.reason, 'registered');
    assert.equal(new Date(row.since).toISOString().slice(0, 10), ago(10).toISOString().slice(0, 10));
    assert.equal(row.shared.length, 1);
    assert.deepEqual(row.shared[0].categories, ['prescriptions']);
    assert.equal(row.shared[0].doctor.name, 'Dr Salt Lake Colleague');
    assert.ok(!allText(res.body).includes('Behala'), 'a practice with no access was listed');
  });

  test('the history lists sharing, each read it allowed, and taking it back', async () => {
    const res = await share({ categories: ['prescriptions'] });
    await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    await new Promise((r) => setTimeout(r, 200));
    await as(rahul.token).post(`/sharing/grants/${res.body.grant.id}/revoke`, {});

    const history = await as(rahul.token).get('/sharing/history');
    assert.equal(history.status, 200);
    const kinds = history.body.items.map((i) => i.kind);
    for (const kind of ['shared', 'viewed', 'share_revoked']) {
      assert.ok(kinds.includes(kind), `the history has no "${kind}": ${kinds.join(', ')}`);
    }
    const viewed = history.body.items.find((i) => i.kind === 'viewed');
    assert.equal(viewed.by, 'Dr Salt Lake Owner');
    assert.equal(viewed.practice.name, 'Salt Lake');
  });

  test('a clinician cannot read a patient’s sharing screens, and a patient cannot read the practice’s', async () => {
    assert.equal((await as(salt.owner.token).get('/sharing')).status, 403);
    assert.equal((await as(salt.owner.token).get('/sharing/history')).status, 403);
    assert.equal((await as(rahul.token).get(`/sharing/patients/${rahul.user._id}`)).status, 403);
  });

  test('the practice sees what it was given, and nothing another practice was given', async () => {
    const other = await makePatient({ name: 'Two Clinics', practices: [salt.practice, behala.practice] });
    await as(other.token).post('/sharing/grants', { practiceId: String(behala.practice._id), categories: ['readings'] });
    await as(other.token).post('/sharing/grants', { practiceId: String(salt.practice._id), categories: ['prescriptions'] });

    const res = await as(salt.owner.token).get(`/sharing/patients/${other.user._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.shared.length, 1);
    assert.deepEqual(res.body.shared[0].categories, ['prescriptions']);
    assert.ok(!allText(res.body).includes('Behala'), 'a practice was told what the patient shares elsewhere');
  });
});
