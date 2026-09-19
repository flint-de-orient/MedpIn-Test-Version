import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { Department } from '../src/models/Department.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Membership } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { currentDoctorOf, displayNameOf } from '../src/services/careDoctor.js';
import { buildSystemPrompt, fallbackReply } from '../src/services/ai/prompts.js';
import { assessFootImages, explainEyeReport } from '../src/services/ai/vision.js';
import { forgetClinicIdentity } from '../src/services/clinicIdentity.js';

/**
 * The doctor a patient is told about is their own, everywhere, and nobody else.
 *
 * The assistant named the practice's display name or head doctor, while the
 * chat header named the doctor on the patient's enrolment, so a patient of
 * Dr. Rahman at a practice headed by somebody else was told to contact the
 * head. Every patient-facing sentence now asks careDoctor.js.
 *
 * Emergency wording: emergency care first and never conditional; then who
 * was alerted, who else to contact, and not to wait for a reply here. Urgent:
 * contact the doctor today, urgent care if they cannot be reached or it gets
 * worse.
 *
 * Google is replaced: every request is recorded, so a test can read the exact
 * system prompt the model was given.
 */

const realFetch = globalThis.fetch;
let prompts = [];
let modelDown = false;

function google(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  if (url.includes(':embedContent')) {
    return Promise.resolve(new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } })));
  }
  if (url.includes(':generateContent')) {
    const body = JSON.parse(init.body);
    prompts.push(body.systemInstruction?.parts?.map((p) => p.text).join('\n') ?? '');
    if (modelDown) return Promise.resolve(new Response('{"error":{"code":403,"message":"down"}}', { status: 403 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'An answer.' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      ),
    );
  }
  return Promise.reject(new Error(`unexpected request to ${url}`));
}

const lastPrompt = () => prompts.at(-1) ?? '';

let w;

async function world() {
  await Department.create({
    key: 'diabetology',
    names: { en: 'Diabetes & Endocrinology' },
    practice: null,
    assistantScope: { role: 'the AI health assistant' },
  });
  for (let i = 0; i < 10; i += 1) {
    await KnowledgeChunk.create({
      docId: `diab-${i}`,
      title: `Diabetes passage ${i}`,
      content: `Plain-language diabetes guidance number ${i}, long enough to be a real passage.`,
      category: i === 0 ? 'emergency' : 'preventive_care',
      language: 'en',
      status: 'approved',
      practice: null,
      department: null,
      embedding: [0.1, 0.2, 0.3],
      embeddedAt: new Date(),
    });
  }

  // Practice A has a head doctor and a display name, and neither is the
  // doctor of any patient below: both are what the assistant used to say.
  const a = await makePractice('Salt Lake Diabetes Clinic', { doctorDisplayName: 'Dr. Practice Display' });
  const head = await makeMember(a, { name: 'Dr. Head Doctor', isOwner: true });
  await a.updateOne({ headDoctor: head.user._id });
  const rahman = await makeMember(a, { name: 'Rahman' });
  const sen = await makeMember(a, { name: 'Dr. Sen' });
  const desk = await makeMember(a, { name: 'Front Desk', role: ROLES.STAFF });

  const b = await makePractice('Lake Town Clinic');
  const iyer = await makeMember(b, { name: 'Dr. Iyer', isOwner: true });

  const patientOf = async (name, practices, doctor) => {
    const p = await makePatient({ name, practices, primaryDoctor: doctor?.user ?? null });
    await PatientProfile.create({ user: p.user._id });
    return p;
  };
  const withRahman = await patientOf('Patient Of Rahman', [a], rahman);
  const withSen = await patientOf('Patient Of Sen', [a], sen);
  const unassigned = await patientOf('Patient With Nobody', [a], null);

  // Cared for at both practices, by a different doctor at each.
  const both = await patientOf('Patient At Both', [a], rahman);
  await Enrollment.create({ patient: both.user._id, practice: b._id, status: ENROLLMENT_STATUS.ACTIVE, primaryDoctor: iyer.user._id });

  return { a, b, head, rahman, sen, desk, iyer, withRahman, withSen, unassigned, both };
}

async function say(patient, text, extra = {}) {
  const session = await ChatSession.findOne({ patient: patient.user._id }).lean();
  return as(patient.token).post('/chat/message', {
    ...(session ? { sessionId: String(session._id) } : {}),
    text,
    language: 'en',
    ...extra,
  });
}

const OTHERS = ['Head Doctor', 'Practice Display', 'Iyer'];
function namesOnly(text, doctor, notThese) {
  assert.ok(text.includes(doctor), `${doctor} is not named`);
  for (const other of notThese) assert.ok(!text.includes(other), `${other} was named to a patient of ${doctor}`);
}

describe('the patient’s own doctor is the one named, over HTTP', () => {
  before(async () => {
    globalThis.fetch = google;
    await boot();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    forgetClinicIdentity();
    prompts = [];
    modelDown = false;
    w = await world();
  });

  test('A: Rahman’s patient: the header and the emergency prompt both name Dr. Rahman, and the alert is raised', async () => {
    const threads = await as(w.withRahman.token).get('/chat/threads');
    assert.equal(threads.body.groups[0].doctor.name, 'Dr. Rahman', 'the chat header names somebody else');

    const res = await say(w.withRahman, 'I have chest pain');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.withRahman.user._id }), 1, 'the emergency raised no alert');

    const prompt = lastPrompt();
    namesOnly(prompt, 'Dr. Rahman', [...OTHERS, 'Dr. Sen']);
    assert.ok(prompt.includes('Please go to the nearest hospital emergency department or call an ambulance now.'));
    assert.ok(prompt.includes('"Dr. Rahman has been alerted."'));
    assert.ok(prompt.includes('You can also contact Dr. Rahman or your healthcare team'));
    assert.ok(prompt.includes('Do not wait for a reply in this chat.'));
    assert.match(prompt, /Never tell them to contact Dr\. Rahman first/);
  });

  test('A (fallback): with the model down, the scripted emergency reply names Dr. Rahman', async () => {
    modelDown = true;
    const res = await say(w.withRahman, 'I have chest pain');
    assert.equal(res.status, 200);
    const reply = res.body.reply.content;
    namesOnly(reply, 'Dr. Rahman', [...OTHERS, 'Dr. Sen']);
    assert.ok(reply.includes('Please go to the nearest hospital emergency department or call an ambulance now.'));
    assert.ok(reply.includes('Dr. Rahman has been alerted.'));
    assert.ok(reply.includes('You can also contact Dr. Rahman or your healthcare team'));
    assert.ok(reply.includes('Do not wait for a reply in this chat.'));
  });

  test('A (streamed): the streamed reply path names Dr. Rahman as well', async () => {
    // Streaming requests are refused here, so this is the stream's own
    // fallback: the same lookup, through the other reply path.
    const res = await as(w.withRahman.token).post('/chat/message/stream', { text: 'I have chest pain', language: 'en' });
    assert.equal(res.status, 200);
    const events = String(res.body);
    assert.ok(events.includes('Dr. Rahman has been alerted.'), events.slice(0, 600));
    for (const other of [...OTHERS, 'Dr. Sen']) assert.ok(!events.includes(other), `${other} was named`);
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.withRahman.user._id }), 1);
  });

  test('B: Sen’s patient at the same practice is told Dr. Sen, never Dr. Rahman or the head', async () => {
    const res = await say(w.withSen, 'I have chest pain');
    assert.equal(res.status, 200);
    namesOnly(lastPrompt(), 'Dr. Sen', [...OTHERS, 'Rahman']);
    const threads = await as(w.withSen.token).get('/chat/threads');
    assert.equal(threads.body.groups[0].doctor.name, 'Dr. Sen');
  });

  test('C: a patient with no doctor is named nobody', async () => {
    const threads = await as(w.unassigned.token).get('/chat/threads');
    assert.equal(threads.body.groups[0].doctor, null, 'the header invented a doctor');
    assert.equal(await currentDoctorOf({ patientId: w.unassigned.user._id, practiceId: w.a._id }), null);
  });

  test('C: a doctor who has left is nobody’s doctor any more', async () => {
    await Membership.updateOne({ user: w.rahman.user._id, practice: w.a._id }, { $set: { endedOn: new Date() } });
    assert.equal(await currentDoctorOf({ patientId: w.withRahman.user._id, practiceId: w.a._id }), null);
    const threads = await as(w.withRahman.token).get('/chat/threads');
    assert.equal(threads.body.groups[0].doctor, null);
  });

  test('D: a patient at two practices hears each practice’s own doctor, and never the other’s', async () => {
    const atA = await currentDoctorOf({ patientId: w.both.user._id, practiceId: w.a._id });
    const atB = await currentDoctorOf({ patientId: w.both.user._id, practiceId: w.b._id });
    assert.equal(atA.displayName, 'Dr. Rahman');
    assert.equal(atB.displayName, 'Dr. Iyer');

    // An enrolment at one practice answers nothing at another.
    const enrolmentAtA = await Enrollment.findOne({ patient: w.both.user._id, practice: w.a._id }).lean();
    assert.equal(await currentDoctorOf({ enrollmentId: enrolmentAtA._id, practiceId: w.b._id }), null);

    const res = await say(w.both, 'I have chest pain', { practiceId: String(w.a._id) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    namesOnly(lastPrompt(), 'Dr. Rahman', OTHERS);
  });

  test('D: before a practice is chosen, the emergency instructions name nobody', async () => {
    const res = await say(w.both, 'I have chest pain');
    assert.equal(res.status, 409);
    const text = JSON.stringify(res.body);
    assert.ok(text.includes('Your healthcare team has been alerted.'), text);
    for (const name of ['Rahman', 'Iyer', 'Head Doctor', 'Practice Display']) assert.ok(!text.includes(name), `${name} was named`);
  });

  test('E: a new doctor is named on the very next message, with nothing stale in between', async () => {
    await say(w.withRahman, 'I have chest pain');
    namesOnly(lastPrompt(), 'Dr. Rahman', ['Dr. Sen']);

    await Enrollment.updateOne({ patient: w.withRahman.user._id, practice: w.a._id }, { $set: { primaryDoctor: w.sen.user._id } });
    await say(w.withRahman, 'what is a normal sugar');
    namesOnly(lastPrompt(), 'Dr. Sen', ['Rahman']);
  });

  test('the photo readers name the patient’s own doctor too', async () => {
    const images = [{ mimeType: 'image/png', base64: 'AAAA' }];
    await assessFootImages({ images, symptoms: '', patientContext: '', practiceId: w.a._id, patientId: w.withSen.user._id });
    namesOnly(lastPrompt(), 'Dr. Sen', [...OTHERS, 'Rahman']);
    await explainEyeReport({ reportText: 'Mild NPDR', images: [], patientContext: '', practiceId: w.a._id, patientId: w.withSen.user._id });
    namesOnly(lastPrompt(), 'Dr. Sen', [...OTHERS, 'Rahman']);
  });
});

describe('the wording, whoever the doctor is', () => {
  const base = {
    language: 'en',
    patientContext: '',
    groundingContext: '',
    careTeamNotes: '',
    identity: { clinicName: 'Test Clinic', doctorName: 'Dr. Head Doctor', emergencyPhone: null },
  };

  test('E: emergency care comes first, and the doctor is never a condition for it', () => {
    const prompt = buildSystemPrompt({ ...base, triage: { urgency: 'emergency' }, careDoctorName: 'Dr. Rahman', alerted: true });
    const rule = prompt.slice(prompt.indexOf('3. If the verdict is EMERGENCY'), prompt.indexOf('3b.'));
    assert.ok(rule.indexOf('call an ambulance now') < rule.indexOf('Dr. Rahman has been alerted'), 'the doctor comes before emergency care');
    assert.match(rule, /Never tell them to contact Dr\. Rahman first, or to go to hospital only if they cannot reach anyone/);
    assert.ok(!prompt.includes('Head Doctor'), 'the practice head doctor reached the prompt');
  });

  test('E: nobody is said to have been alerted when no alert was raised', () => {
    // The model may raise the urgency itself; no alert went out for that.
    const prompt = buildSystemPrompt({ ...base, triage: { urgency: 'routine' }, careDoctorName: 'Dr. Rahman', alerted: false });
    assert.ok(!prompt.includes('has been alerted."'));
    assert.match(prompt, /Nothing about anyone having been alerted/);
  });

  test('F: urgent means the doctor today, and urgent care if they cannot be reached or it gets worse', () => {
    const named = buildSystemPrompt({ ...base, triage: { urgency: 'urgent' }, careDoctorName: 'Dr. Rahman', alerted: true });
    assert.ok(
      named.includes(
        'Please contact Dr. Rahman or your healthcare team today. If you cannot reach them promptly, or your condition gets worse, seek urgent medical care.',
      ),
    );
    const neutral = buildSystemPrompt({ ...base, triage: { urgency: 'urgent' }, careDoctorName: null, alerted: true });
    assert.ok(
      neutral.includes(
        'Please contact your healthcare team today. If you cannot reach them promptly, or your condition gets worse, seek urgent medical care.',
      ),
    );
    assert.ok(!neutral.includes('Head Doctor'));
  });

  test('C: with no doctor, the prompt says "your doctor" and "your healthcare team", and invents nobody', () => {
    const prompt = buildSystemPrompt({ ...base, triage: { urgency: 'emergency' }, careDoctorName: null, alerted: true });
    assert.ok(prompt.includes('"Your healthcare team has been alerted."'));
    assert.ok(prompt.includes('You can also contact your healthcare team.'));
    assert.ok(prompt.includes('only your doctor can change a prescription'));
    assert.ok(!/Dr\. /.test(prompt), 'a doctor was named to a patient with none');
  });

  test('G: the scripted emergency reply, in each language, names the doctor or the team', () => {
    const phrases = {
      en: { named: 'Dr. Rahman has been alerted.', team: 'Your healthcare team has been alerted.', hospital: 'call an ambulance now', wait: 'Do not wait for a reply in this chat.' },
      bn: { named: 'Dr. Rahman-কে জানানো হয়েছে।', team: 'আপনার চিকিৎসা দলকে জানানো হয়েছে।', hospital: 'অ্যাম্বুলেন্স ডাকুন', wait: 'এই চ্যাটে উত্তরের জন্য অপেক্ষা করবেন না।' },
      hi: { named: 'Dr. Rahman को सूचित कर दिया गया है।', team: 'आपकी स्वास्थ्य देखभाल टीम को सूचित कर दिया गया है।', hospital: 'एम्बुलेंस बुलाएँ', wait: 'इस चैट में जवाब का इंतज़ार न करें।' },
    };
    for (const [language, p] of Object.entries(phrases)) {
      const named = fallbackReply('emergency', language, base.identity, { doctorName: 'Dr. Rahman', alerted: true });
      assert.ok(named.includes(p.named), `${language}: ${named}`);
      assert.ok(named.includes(p.hospital) && named.includes(p.wait), `${language}: ${named}`);
      assert.ok(named.indexOf(p.hospital) < named.indexOf('Dr. Rahman'), `${language}: the doctor comes before emergency care`);
      assert.ok(!named.includes('Head Doctor') && !/{{/.test(named), `${language}: ${named}`);

      const team = fallbackReply('emergency', language, base.identity, { doctorName: null, alerted: true });
      assert.ok(team.includes(p.team), `${language}: ${team}`);
      assert.ok(!team.includes('Dr.'), `${language}: a doctor was invented: ${team}`);

      const unalerted = fallbackReply('emergency', language, base.identity, { doctorName: 'Dr. Rahman', alerted: false });
      assert.ok(!unalerted.includes(p.named), `${language}: said alerted when nobody was`);
    }
  });

  test('a doctor’s name reads with "Dr." once, and only for a doctor', () => {
    assert.equal(displayNameOf('Rahman', ROLES.DOCTOR), 'Dr. Rahman');
    assert.equal(displayNameOf('Dr. Sen', ROLES.DOCTOR), 'Dr. Sen');
    assert.equal(displayNameOf('dr sen', ROLES.DOCTOR), 'dr sen');
    assert.equal(displayNameOf('Drishti Sen', ROLES.DOCTOR), 'Dr. Drishti Sen');
    assert.equal(displayNameOf('Asha Roy', ROLES.STAFF), 'Asha Roy');
    assert.equal(displayNameOf('  ', ROLES.DOCTOR), null);
  });
});
