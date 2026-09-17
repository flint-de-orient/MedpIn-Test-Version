import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dayjs from 'dayjs';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { env } from '../src/config/env.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { DirectMessage } from '../src/models/DirectMessage.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Clinic } from '../src/models/Clinic.js';
import { Appointment } from '../src/models/Appointment.js';
import { Prescription } from '../src/models/Prescription.js';
import { FoodLog } from '../src/models/FoodLog.js';
import { LabResult } from '../src/models/LabResult.js';
import { FOOT_SITES } from '../src/models/FootAssessment.js';
import { User, ROLES } from '../src/models/User.js';
import { Practice, PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Files, inboxes and queues that reached across practices.
 *
 * Found by the patient-panel architecture review, not by the earlier sweeps —
 * because none of these routes names a patient in its URL, and every earlier
 * audit started from the ones that did.
 *
 * ---- Files --------------------------------------------------------------
 *
 * `GET /uploads/:id/raw` allowed `owner || role !== PATIENT`: any staff account
 * at any practice could download any patient's lab report by id. And every
 * route that accepts a file id stored it as sent, which mattered because the
 * record a file lands on decides who may read it next:
 *
 *   - a chat attachment is readable by the patient whose thread it is in, so a
 *     patient who attached somebody else's file id could then open that file;
 *   - a clinic logo and a staff avatar are readable by everyone signed in, so
 *     pointing either at a patient's file published it;
 *   - the vision readers send the id they are given to the model, so a
 *     prescription scan or a foot assessment could read another patient's
 *     photographs and file the description here.
 *
 * ---- Inboxes, notifications, education, the queue -----------------------
 *
 * `GET /messages/threads` aggregated every direct message on the platform with
 * no `$match` and returned each patient's name, phone and last message.
 * `POST /doctor/notifications/seen` cleared every practice's unread badge.
 * Eye education served every practice's approved passages. A patient's "today's
 * queue" was scoped by the caller's membership, which a patient does not have.
 *
 * Every refusal here is paired with the owning practice still succeeding, so a
 * wrong path cannot pass as a refusal.
 */

const ABSENT = '000000000000000000000000';
const ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);
const DIR = `test-file-scope-${process.pid}`;
const PDF = Buffer.from('%PDF-1.4\n% a lab report\n%%EOF\n');

/* No outbound calls — see httpCrossTenantAudit.test.js. */
const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let a;
let b;

/** A real file on disk, so a permitted download is a 200 and not "missing". */
async function file(ownerId, uploaderId, kind = 'lab_report') {
  const storageKey = `${DIR}/${crypto.randomUUID()}.pdf`;
  await fs.mkdir(path.join(ROOT, DIR), { recursive: true });
  await fs.writeFile(path.join(ROOT, storageKey), PDF);
  return MediaAsset.create({
    owner: ownerId,
    uploadedBy: uploaderId,
    kind,
    storageKey,
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
  });
}

async function side(label) {
  const practice = await makePractice(label, {
    practiceType: PRACTICE_TYPE.CLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: `Dr ${label}`, isOwner: true });
  const desk = await makeMember(practice, { name: `${label} Desk`, role: ROLES.STAFF });
  const dietician = await makeMember(practice, { name: `${label} Dietician`, role: ROLES.DIETICIAN });
  const patient = await makePatient({ name: `${label} Patient`, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  const clinic = await Clinic.create({ name: `${label} Clinic`, practice: practice._id, doctor: doctor.user._id });
  const report = await file(patient.user._id, patient.user._id);
  const session = await ChatSession.create({ patient: patient.user._id });
  return { label, practice, doctor, desk, dietician, patient, clinic, report, session };
}

function lifecycle() {
  before(async () => {
    globalThis.fetch = localOnly;
    await boot();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
    await fs.rm(path.join(ROOT, DIR), { recursive: true, force: true });
  });
  beforeEach(async () => {
    await wipe();
    a = await side('Salt Lake');
    b = await side('Behala');
  });
}

describe('a patient’s file is readable by their practice, not every practice', () => {
  lifecycle();

  test('another practice’s staff cannot download it, the same as a file that does not exist', async () => {
    const real = await as(a.doctor.token).get(`/uploads/${b.report._id}/raw`);
    const absent = await as(a.doctor.token).get(`/uploads/${ABSENT}/raw`);
    assert.equal(real.status, 404, 'a doctor downloaded another practice’s patient’s file');
    assert.deepEqual(real.body, absent.body);
  });

  test('but the patient’s own practice can', async () => {
    const res = await as(b.desk.token).get(`/uploads/${b.report._id}/raw`);
    assert.equal(res.status, 200);
  });

  test('and a colleague’s attachment in the patient’s thread stays readable to that practice', async () => {
    const note = await file(b.doctor.user._id, b.doctor.user._id, 'voice_note');
    await ChatMessage.create({
      session: b.session._id,
      patient: b.patient.user._id,
      seq: 1,
      role: 'clinician',
      sender: b.doctor.user._id,
      attachments: [note._id],
    });
    const res = await as(b.desk.token).get(`/uploads/${note._id}/raw`);
    assert.equal(res.status, 200);
  });
});

describe('a file can only be attached where it already belongs', () => {
  lifecycle();

  test('a patient cannot attach another patient’s file — and so cannot open it', async () => {
    const sent = await as(a.patient.token).post('/chat/message', {
      text: 'please look at this',
      attachments: [String(b.report._id)],
    });
    assert.equal(sent.status, 404, 'another patient’s file was attached to a message');
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);

    const opened = await as(a.patient.token).get(`/uploads/${b.report._id}/raw`);
    assert.notEqual(opened.status, 200, 'the attachment made another patient’s file readable');
  });

  test('nor to a streamed message', async () => {
    const sent = await as(a.patient.token).post('/chat/message/stream', {
      text: 'please look at this',
      attachments: [String(b.report._id)],
    });
    assert.equal(sent.status, 404);
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);
  });

  test('nor to the nutrition thread', async () => {
    const sent = await as(a.patient.token).post('/chat/nutrition', {
      content: 'please look at this',
      attachments: [String(b.report._id)],
    });
    assert.equal(sent.status, 404);
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);
  });

  test('but a patient attaches their own file', async () => {
    const sent = await as(a.patient.token).post('/chat/message', {
      text: 'my report',
      attachments: [String(a.report._id)],
    });
    assert.equal(sent.status, 200);
    assert.equal(await ChatMessage.countDocuments({ attachments: a.report._id }), 1);
  });

  test('staff cannot attach another practice’s file to their own patient’s thread', async () => {
    const res = await as(a.doctor.token).post(`/chat/patients/${a.patient.user._id}/clinician-message`, {
      content: 'for your records',
      attachments: [String(b.report._id)],
    });
    assert.equal(res.status, 404);
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);
  });

  test('nor through chat review', async () => {
    const res = await as(a.doctor.token).post(`/doctor/chat-review/${a.session._id}/message`, {
      content: 'for your records',
      attachments: [String(b.report._id)],
    });
    assert.equal(res.status, 404);
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);
  });

  test('nor as the dietician', async () => {
    const res = await as(a.dietician.token).post(`/dietician/patients/${a.patient.user._id}/message`, {
      content: 'for your records',
      attachments: [String(b.report._id)],
    });
    assert.equal(res.status, 404);
    assert.equal(await ChatMessage.countDocuments({ attachments: b.report._id }), 0);
  });

  test('but staff attach a file they uploaded for their own patient', async () => {
    const upload = await file(a.patient.user._id, a.doctor.user._id, 'other');
    const res = await as(a.doctor.token).post(`/chat/patients/${a.patient.user._id}/clinician-message`, {
      content: 'your result',
      attachments: [String(upload._id)],
    });
    assert.equal(res.status, 201);
  });

  test('a prescription scan reads and files only this patient’s file', async () => {
    const desk = as(a.desk.token);
    const base = `/patients/${a.patient.user._id}/prescriptions`;

    const read = await desk.post(`${base}/scan/read`, { assetId: String(b.report._id) });
    assert.equal(read.status, 404, 'the scan reader was pointed at another patient’s file');

    const filed = await desk.post(`${base}/scan`, { assetId: String(b.report._id) });
    assert.equal(filed.status, 404);
    assert.equal(await Prescription.countDocuments({ scanFile: b.report._id }), 0);
  });

  test('foot, eye and lab records take only this patient’s files', async () => {
    const doctor = as(a.doctor.token);
    const base = `/patients/${a.patient.user._id}`;
    const stranger = String(b.report._id);

    const foot = await doctor.post(`${base}/foot/assessments`, { site: FOOT_SITES[0], images: [stranger] });
    assert.equal(foot.status, 404, 'a foot assessment took another patient’s photograph');

    const eye = await doctor.post(`${base}/eye/reports`, {
      reportDate: new Date().toISOString(),
      files: [stranger],
    });
    assert.equal(eye.status, 404, 'an eye report took another patient’s file');

    const lab = await doctor.post(`${base}/labs`, {
      title: 'Lipid profile',
      testedOn: new Date().toISOString(),
      files: [stranger],
    });
    assert.equal(lab.status, 404, 'a lab report took another patient’s file');
  });

  test('food-log and lab-test photos take only this patient’s files', async () => {
    const patient = as(a.patient.token);
    const stranger = String(b.report._id);

    assert.equal((await patient.post('/patients/me/food-log', { photo: stranger })).status, 404);
    assert.equal((await patient.post('/patients/me/lab-tests', { testName: 'HbA1c', photo: stranger })).status, 404);
    assert.equal(await FoodLog.countDocuments({ photo: b.report._id }), 0);
    assert.equal(await LabResult.countDocuments({ photo: b.report._id }), 0);
  });

  test('an account picture or signature must be the account’s own upload', async () => {
    const doctor = as(a.doctor.token);
    const stranger = String(b.report._id);

    assert.equal((await doctor.patch('/auth/me', { avatarAssetId: stranger })).status, 404);
    assert.equal((await doctor.patch('/auth/me', { signatureAssetId: stranger })).status, 404);

    const user = await User.findById(a.doctor.user._id).lean();
    assert.ok(!user.avatarAssetId, 'an avatar now publishes another patient’s file');
    assert.ok(!user.signatureAssetId);
  });

  test('a clinic or practice logo must be this practice’s own artwork', async () => {
    const doctor = as(a.doctor.token);
    const stranger = String(b.report._id);

    assert.equal((await doctor.patch(`/clinics/${a.clinic._id}`, { logoLightAssetId: stranger })).status, 404);
    assert.equal((await doctor.patch(`/practices/${a.practice._id}`, { logoLightAssetId: stranger })).status, 404);
    assert.ok(!(await Clinic.findById(a.clinic._id).lean()).logoLightAssetId, 'a logo now publishes another patient’s file');
  });

  test('but a logo a colleague uploaded at the same practice is accepted', async () => {
    const logo = await file(a.desk.user._id, a.desk.user._id, 'clinic_logo');
    const res = await as(a.doctor.token).patch(`/clinics/${a.clinic._id}`, { logoLightAssetId: String(logo._id) });
    assert.equal(res.status, 200);
  });
});

describe('inboxes and badges stay in their practice', () => {
  lifecycle();

  test('the direct-message inbox is retired, and shows nobody’s messages', async () => {
    // It was one merged thread per patient with no practice on it (V-02), so a
    // second practice read and answered into the first's. Care chat replaced
    // it; the routes answer 410 and the stored messages stay where they are.
    await DirectMessage.create([
      { patient: a.patient.user._id, sender: a.patient.user._id, senderRole: 'patient', content: 'Salt Lake question' },
      { patient: b.patient.user._id, sender: b.patient.user._id, senderRole: 'patient', content: 'Behala question' },
    ]);

    const res = await as(a.doctor.token).get('/messages/threads');
    assert.equal(res.status, 410);
    const text = allText(res.body);
    assert.ok(!text.includes('Salt Lake question') && !text.includes('Behala question'), 'a retired inbox returned messages');
    assert.equal(await DirectMessage.countDocuments({}), 2);
  });

  test('marking messages seen clears this practice’s badge, not another’s', async () => {
    const mine = await ChatMessage.create({ session: a.session._id, patient: a.patient.user._id, seq: 1, role: 'user', content: 'hello' });
    const theirs = await ChatMessage.create({ session: b.session._id, patient: b.patient.user._id, seq: 1, role: 'user', content: 'hello' });

    const res = await as(a.doctor.token).post('/doctor/notifications/seen', {});
    assert.equal(res.status, 200);
    assert.ok((await ChatMessage.findById(mine._id).lean()).seenByClinicAt, 'the practice’s own messages were not marked');
    assert.ok(
      !(await ChatMessage.findById(theirs._id).lean()).seenByClinicAt,
      'another practice’s unread messages were marked seen',
    );
  });
});

describe('what a patient reads is their own practice’s', () => {
  lifecycle();

  test('eye education is shared guidance and their practice’s, not another practice’s', async () => {
    let n = 0;
    const chunk = (title, practice) => {
      n += 1;
      return KnowledgeChunk.create({
        docId: `eye-${n}`,
        title,
        content: 'Twenty or more characters of eye-care guidance for patients.',
        category: 'eye_care',
        language: 'en',
        status: 'approved',
        practice,
      });
    };
    await chunk('Shared retinopathy guide', null);
    await chunk('Salt Lake eye clinic hours', a.practice._id);
    await chunk('Behala eye clinic hours', b.practice._id);

    const res = await as(a.patient.token).get('/patients/me/eye/education?language=en');
    assert.equal(res.status, 200);
    const titles = res.body.items.map((i) => i.title);
    assert.ok(titles.includes('Shared retinopathy guide'));
    assert.ok(titles.includes('Salt Lake eye clinic hours'));
    assert.ok(!titles.includes('Behala eye clinic hours'), 'another practice’s passage was served');
  });

  test('a patient sees the queue they are standing in, not another practice’s', async () => {
    const today = dayjs().format('YYYY-MM-DD');
    const checkIn = (who, queueNumber) =>
      Appointment.create({
        patient: who.patient.user._id,
        doctor: who.doctor.user._id,
        clinic: who.clinic._id,
        scheduledFor: new Date(),
        status: 'checked_in',
        queueDate: today,
        queueNumber,
      });
    await checkIn(a, 1);
    await checkIn(b, 1);
    await checkIn(b, 2);

    const res = await as(a.patient.token).get('/appointments/queue/today');
    assert.equal(res.status, 200);
    assert.equal(res.body.entries.length, 1, 'another practice’s queue was shown to a patient');
    assert.equal(res.body.entries[0].isYou, true);
  });
});

/*
 * ---- Quoting ---------------------------------------------------------------
 *
 * A reply carries the id of the message it answers, and the send response
 * returns 160 characters of that message so the quote renders at once. Nothing
 * checked whose message the id was — so quoting was a way to read any message
 * on the platform, one id at a time.
 */
describe('a reply quotes only a message from its own conversation', () => {
  lifecycle();

  /** A message in the other practice's thread, with words that must never reach this one. */
  const theirs = () =>
    ChatMessage.create({
      session: b.session._id,
      patient: b.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Behala private symptom',
    });

  test('a patient cannot quote another patient’s message, and nothing of it is echoed', async () => {
    const quoted = await theirs();
    const sent = await as(a.patient.token).post('/chat/message', {
      text: 'what about this',
      replyTo: String(quoted._id),
    });
    assert.equal(sent.status, 404, 'another patient’s message was quoted');
    assert.ok(!allText(sent.body).includes('Behala private symptom'), 'the quoted text came back');
    assert.equal(await ChatMessage.countDocuments({ replyTo: quoted._id }), 0);
  });

  test('nor in a streamed message', async () => {
    const quoted = await theirs();
    const sent = await as(a.patient.token).post('/chat/message/stream', {
      text: 'what about this',
      replyTo: String(quoted._id),
    });
    assert.equal(sent.status, 404);
    assert.ok(!allText(sent.body).includes('Behala private symptom'));
    assert.equal(await ChatMessage.countDocuments({ replyTo: quoted._id }), 0);
  });

  test('nor in the nutrition thread', async () => {
    const quoted = await theirs();
    const sent = await as(a.patient.token).post('/chat/nutrition', {
      content: 'what about this',
      replyTo: String(quoted._id),
    });
    assert.equal(sent.status, 404);
    assert.equal(await ChatMessage.countDocuments({ replyTo: quoted._id }), 0);
  });

  test('and a care-thread message is not quoted into the dietician’s thread', async () => {
    // The composer only ever quotes from the thread it is in. A doctor's words
    // arriving as a quote in the dietician's conversation would hand the
    // dietician a thread they do not read.
    const care = await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'clinician',
      sender: a.doctor.user._id,
      content: 'Salt Lake doctor’s advice',
    });
    const sent = await as(a.patient.token).post('/chat/nutrition', {
      content: 'about this',
      replyTo: String(care._id),
    });
    assert.equal(sent.status, 404);
  });

  test('staff cannot quote another practice’s patient into their own patient’s thread', async () => {
    const quoted = await theirs();
    const doctor = as(a.doctor.token);

    const direct = await doctor.post(`/chat/patients/${a.patient.user._id}/clinician-message`, {
      content: 'noted',
      replyTo: String(quoted._id),
    });
    assert.equal(direct.status, 404, 'the clinician composer quoted another practice’s message');

    const review = await doctor.post(`/doctor/chat-review/${a.session._id}/message`, {
      content: 'noted',
      replyTo: String(quoted._id),
    });
    assert.equal(review.status, 404, 'chat review quoted another practice’s message');

    const dietician = await as(a.dietician.token).post(`/dietician/patients/${a.patient.user._id}/message`, {
      content: 'noted',
      replyTo: String(quoted._id),
    });
    assert.equal(dietician.status, 404, 'the dietician quoted another practice’s message');

    assert.equal(await ChatMessage.countDocuments({ replyTo: quoted._id }), 0);
  });

  test('but a patient quotes their own earlier message, and its preview comes back', async () => {
    const mine = await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Salt Lake earlier question',
    });
    const sent = await as(a.patient.token).post('/chat/message', {
      sessionId: String(a.session._id),
      text: 'following up',
      replyTo: String(mine._id),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.userMessage.replyPreview?.content, 'Salt Lake earlier question');
  });

  test('a quote stored before this check shows nothing of the other conversation, and a real one still shows', async () => {
    // Refused at the door from now on. A pointer already written is populated
    // again on every read of the thread, and must not keep rendering another
    // patient's words — while a genuine quote keeps its preview.
    const quoted = await theirs();
    const earlier = await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Salt Lake earlier question',
    });
    await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 2,
      role: 'user',
      content: 'crafted',
      replyTo: quoted._id,
    });
    await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 3,
      role: 'clinician',
      sender: a.doctor.user._id,
      content: 'answering',
      replyTo: earlier._id,
    });

    const reads = {
      'the patient’s thread': await as(a.patient.token).get('/chat/thread'),
      'the patient’s session': await as(a.patient.token).get(`/chat/sessions/${a.session._id}/messages`),
      'the clinician’s thread': await as(a.doctor.token).get(`/chat/patients/${a.patient.user._id}/thread`),
      'chat review': await as(a.doctor.token).get(`/doctor/chat-review/${a.session._id}`),
    };
    for (const [where, res] of Object.entries(reads)) {
      assert.equal(res.status, 200, where);
      assert.ok(
        !allText(res.body).includes('Behala private symptom'),
        `${where} showed a stored quote of another patient’s message`,
      );
      const answer = (res.body.items ?? res.body.messages ?? []).find((m) => m.content === 'answering');
      assert.equal(answer?.replyPreview?.content, 'Salt Lake earlier question', `${where} lost a genuine quote`);
    }

    const nutrition = await ChatSession.create({ patient: a.patient.user._id, kind: 'nutrition' });
    await ChatMessage.create({
      session: nutrition._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'crafted',
      replyTo: quoted._id,
    });
    // A dietician sees the patients assigned to them, so this one has to hold
    // the patient — on this practice's enrolment — before their thread can be
    // read at all.
    await Enrollment.updateOne(
      { patient: a.patient.patient._id, practice: a.practice._id },
      { $set: { dietician: a.dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
    );
    const dietician = await as(a.dietician.token).get(`/dietician/patients/${a.patient.user._id}/thread`);
    assert.equal(dietician.status, 200);
    assert.ok(
      !allText(dietician.body).includes('Behala private symptom'),
      'the dietician’s thread showed a stored quote of another patient’s message',
    );
  });

  test('and a message deleted for everyone is not quoted back', async () => {
    // Its words are withheld where it sits. They came back in full as the
    // quote under whatever had replied to it.
    const gone = await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Salt Lake words taken back',
      deletedForEveryoneAt: new Date(),
      deletedForEveryoneBy: a.patient.user._id,
    });
    await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 2,
      role: 'clinician',
      sender: a.doctor.user._id,
      content: 'replying',
      replyTo: gone._id,
    });

    const reads = [
      await as(a.patient.token).get('/chat/thread'),
      await as(a.doctor.token).get(`/chat/patients/${a.patient.user._id}/thread`),
      await as(a.doctor.token).get(`/doctor/chat-review/${a.session._id}`),
    ];
    for (const res of reads) {
      assert.equal(res.status, 200);
      assert.ok(!allText(res.body).includes('Salt Lake words taken back'), 'a deleted message came back as a quote');
    }
  });

  test('and the doctor quotes their own patient in that patient’s thread', async () => {
    const mine = await ChatMessage.create({
      session: a.session._id,
      patient: a.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Salt Lake earlier question',
    });
    const res = await as(a.doctor.token).post(`/chat/patients/${a.patient.user._id}/clinician-message`, {
      content: 'answering this',
      replyTo: String(mine._id),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.message.replyPreview?.content, 'Salt Lake earlier question');
  });
});

describe('the rest of the file rule', () => {
  lifecycle();

  test('another patient’s voice note is not answered as this patient’s words', async () => {
    // A voice-only message takes its text from the note's transcript. Sending
    // somebody else's note id with no text made their words this patient's
    // message — triaged, answered, and stored in this thread.
    const note = await MediaAsset.create({
      owner: b.patient.user._id,
      uploadedBy: b.patient.user._id,
      kind: 'voice_note',
      storageKey: `${DIR}/${crypto.randomUUID()}.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: 10,
      transcript: 'Behala patient describing their chest pain',
    });

    const sent = await as(a.patient.token).post('/chat/message', {
      text: '',
      attachments: [String(note._id)],
    });
    assert.equal(sent.status, 404);
    assert.ok(!allText(sent.body).includes('Behala patient'), 'another patient’s transcript came back');
    assert.equal(
      await ChatMessage.countDocuments({ content: /Behala patient/ }),
      0,
      'another patient’s spoken words were stored as this patient’s message',
    );
  });

  test('an HbA1c result takes only this patient’s report', async () => {
    const res = await as(a.doctor.token).post(`/patients/${a.patient.user._id}/hba1c`, {
      percentage: 7.1,
      testedOn: new Date().toISOString(),
      reportFile: String(b.report._id),
    });
    assert.equal(res.status, 404, 'an HbA1c result was filed against another patient’s report');
  });

  test('a practice’s logo is readable by its patients, as a location’s is', async () => {
    // The practice masthead is the letterhead a patient's app draws. Only a
    // location's logo was published, so the practice's own came back refused
    // and the masthead fell back to initials.
    const logo = await file(a.doctor.user._id, a.doctor.user._id, 'clinic_logo');
    await Practice.updateOne({ _id: a.practice._id }, { logoLightAssetId: logo._id });

    const res = await as(a.patient.token).get(`/uploads/${logo._id}/raw`);
    assert.equal(res.status, 200);
  });
});
