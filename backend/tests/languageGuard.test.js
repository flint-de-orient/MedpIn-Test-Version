import test from 'node:test';
import assert from 'node:assert/strict';

import { dominantScript, replyIsWrongLanguage } from '../src/services/ai/languageGuard.js';

const BN_GREETING = 'নমস্কার! আপনার কী ধরনের সাহায্য দরকার আজকে বলুন তো';
const BN_QUESTION = 'আমার সকালে খুব দুর্বল লাগে এবং মাথা ঘোরে, আমি কী করব';
const HI_ANSWER = 'विटामिन डी आपके शरीर को भोजन से कैल्शियम सोखने में मदद करता है';
const EN_ANSWER = 'Hello! How can I help you today with your diabetes care?';

test('dominantScript reads each of the clinic three', () => {
  assert.equal(dominantScript(EN_ANSWER), 'latin');
  assert.equal(dominantScript(BN_GREETING), 'bengali');
  assert.equal(dominantScript(HI_ANSWER), 'devanagari');
});

test('dominantScript declines to guess on too little text', () => {
  // The failure that matters: calling these Latin would flag a healthy Bengali
  // thread as wrong on every short reply.
  assert.equal(dominantScript('OK'), null);
  assert.equal(dominantScript('125 mg/dL'), null);
  assert.equal(dominantScript(''), null);
  assert.equal(dominantScript(null), null);
});

test('a native-script reply survives Latin drug names and units', () => {
  const mixed = 'আপনার Metformin 500 mg ওষুধটি খাবারের পরে খাবেন, প্রতিদিন সকালে';
  assert.equal(dominantScript(mixed), 'bengali');
  assert.equal(
    replyIsWrongLanguage({ reply: mixed, language: 'bn', patientText: 'ওষুধ' }),
    false,
  );
});

test('catches the three failures seen against the live server', () => {
  // English app, English "Hi", Bengali reply.
  assert.equal(
    replyIsWrongLanguage({ reply: BN_GREETING, language: 'en', patientText: 'Hi' }),
    true,
  );
  // Bengali app, Bengali expected, English reply.
  assert.equal(
    replyIsWrongLanguage({ reply: EN_ANSWER, language: 'bn', patientText: 'Hi' }),
    true,
  );
  // Hindi app, Hindi expected, Bengali reply.
  assert.equal(
    replyIsWrongLanguage({
      reply: BN_GREETING,
      language: 'hi',
      patientText: 'Vitamin D — why it matters',
    }),
    true,
  );
});

test('a reply that follows the patient is not wrong', () => {
  // The exception the prompt allows: an English app, but the patient wrote a
  // full Bengali sentence, so a Bengali answer is the correct one.
  assert.equal(
    replyIsWrongLanguage({
      reply: BN_GREETING,
      language: 'en',
      patientText: BN_QUESTION,
    }),
    false,
  );
});

test('a correct reply is never flagged', () => {
  assert.equal(
    replyIsWrongLanguage({ reply: EN_ANSWER, language: 'en', patientText: 'Hi' }),
    false,
  );
  assert.equal(
    replyIsWrongLanguage({ reply: BN_GREETING, language: 'bn', patientText: 'Hi' }),
    false,
  );
  assert.equal(
    replyIsWrongLanguage({ reply: HI_ANSWER, language: 'hi', patientText: 'Vitamin D' }),
    false,
  );
});
