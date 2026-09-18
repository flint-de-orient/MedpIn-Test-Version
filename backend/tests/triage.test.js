import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyGlucose,
  classifyBloodPressure,
  classifyFootSymptoms,
  extractVitalsFromText,
  triageMessage,
} from '../src/services/triage/engine.js';
import { matchRedFlags } from '../src/services/triage/redFlagRules.js';

describe('classifyGlucose', () => {
  test('flags critically high sugar above 400 as an emergency', () => {
    const r = classifyGlucose(450, 'random');
    assert.equal(r.flag, 'critical_high');
    assert.equal(r.urgency, 'emergency');
  });

  test('the brief\'s example of 350 mg/dL is urgent, not routine', () => {
    const r = classifyGlucose(350, 'random');
    assert.equal(r.flag, 'very_high');
    assert.equal(r.urgency, 'urgent');
  });

  test('flags severe hypoglycaemia below 54', () => {
    const r = classifyGlucose(45, 'random');
    assert.equal(r.flag, 'severe_low');
    assert.equal(r.urgency, 'emergency');
  });

  test('flags level-1 hypoglycaemia below 70', () => {
    assert.equal(classifyGlucose(62, 'random').flag, 'low');
    assert.equal(classifyGlucose(62, 'random').urgency, 'urgent');
  });

  test('respects context when judging against target', () => {
    // 150 is above the fasting ceiling but below the post-meal ceiling.
    assert.equal(classifyGlucose(150, 'fasting').flag, 'high');
    assert.equal(classifyGlucose(150, 'post_meal').flag, 'in_range');
  });

  test('honours patient-specific targets over clinic defaults', () => {
    const relaxed = { fastingMax: 160 };
    assert.equal(classifyGlucose(150, 'fasting', relaxed).flag, 'in_range');
  });

  test('boundary values land on the safe side', () => {
    assert.equal(classifyGlucose(54, 'random').flag, 'low'); // not severe_low
    assert.equal(classifyGlucose(53, 'random').flag, 'severe_low');
    assert.equal(classifyGlucose(400, 'random').flag, 'very_high');
    assert.equal(classifyGlucose(401, 'random').flag, 'critical_high');
  });
});

describe('classifyBloodPressure', () => {
  test('detects hypertensive crisis', () => {
    const r = classifyBloodPressure(190, 125);
    assert.equal(r.flag, 'hypertensive_crisis');
    assert.equal(r.urgency, 'emergency');
  });

  test('crisis fires on either limb alone', () => {
    assert.equal(classifyBloodPressure(185, 95).flag, 'hypertensive_crisis');
    assert.equal(classifyBloodPressure(150, 122).flag, 'hypertensive_crisis');
  });

  test('detects hypotension', () => {
    assert.equal(classifyBloodPressure(85, 55).flag, 'hypotension');
  });

  test('grades ordinary hypertension without escalating', () => {
    assert.equal(classifyBloodPressure(145, 92).flag, 'stage2');
    assert.equal(classifyBloodPressure(132, 82).flag, 'stage1');
    assert.equal(classifyBloodPressure(115, 75).flag, 'normal');
  });
});

describe('extractVitalsFromText', () => {
  test('reads the brief\'s example sentence', () => {
    const v = extractVitalsFromText('My blood sugar is 350 mg/dL. What should I do?');
    assert.equal(v.glucoseMgDl, 350);
  });

  test('converts mmol/L to mg/dL', () => {
    const v = extractVitalsFromText('my glucose is 19.4 mmol/L');
    assert.equal(v.glucoseMgDl, 350); // 19.4 * 18.0182 -> 350
  });

  test('reads blood pressure in several phrasings', () => {
    assert.deepEqual(
      { s: extractVitalsFromText('bp is 160/100').systolic, d: extractVitalsFromText('bp is 160/100').diastolic },
      { s: 160, d: 100 },
    );
    assert.equal(extractVitalsFromText('blood pressure 150 over 95').systolic, 150);
  });

  test('does not mistake a BP reading for a sugar value', () => {
    const v = extractVitalsFromText('my bp is 140/90 today');
    assert.equal(v.systolic, 140);
    assert.equal(v.glucoseMgDl, undefined);
  });

  test('reads sugar written in Bengali', () => {
    assert.equal(extractVitalsFromText('আমার সুগার ৩৫০ নয়, sugar 420 হয়েছে').glucoseMgDl, 420);
  });

  test('reads sugar written in Hindi', () => {
    assert.equal(extractVitalsFromText('मेरा शुगर 380 है').glucoseMgDl, 380);
  });

  test('reads sugar written in Bengali numerals', () => {
    assert.equal(extractVitalsFromText('আমার সুগার ৩৫০').glucoseMgDl, 350);
    assert.equal(extractVitalsFromText('সুগার ৪৮০ হয়েছে').glucoseMgDl, 480);
  });

  test('reads sugar written in Devanagari numerals', () => {
    assert.equal(extractVitalsFromText('मेरा शुगर ३५०').glucoseMgDl, 350);
    assert.equal(extractVitalsFromText('शुगर ४८० है').glucoseMgDl, 480);
  });

  test('reads blood pressure written in native numerals', () => {
    const v = extractVitalsFromText('আমার প্রেসার ১৮৫/১২০');
    assert.equal(v.systolic, 185);
    assert.equal(v.diastolic, 120);
  });

  test('ignores sentences with no vitals', () => {
    assert.deepEqual(extractVitalsFromText('I feel fine today, thank you'), {});
  });
});

describe('matchRedFlags — multilingual', () => {
  const cases = [
    ['I have severe chest pain', 'RF_CHEST_PAIN'],
    ['আমার বুকে ব্যথা হচ্ছে', 'RF_CHEST_PAIN'],
    ['मुझे सीने में दर्द हो रहा है', 'RF_CHEST_PAIN'],
    ['I cannot breathe properly', 'RF_BREATHING'],
    ['আমার শ্বাসকষ্ট হচ্ছে', 'RF_BREATHING'],
    ['मुझे सांस लेने में तकलीफ है', 'RF_BREATHING'],
    ['I have sudden vision loss in my left eye', 'RF_VISION_LOSS'],
    ['अचानक दिखाई नहीं दे रहा', 'RF_VISION_LOSS'],
    ['my father is unconscious', 'RF_UNCONSCIOUS'],
    ['রোগী অজ্ঞান হয়ে গেছে', 'RF_UNCONSCIOUS'],
    ['there is a wound on my foot', 'RF_FOOT_WOUND'],
    ['my toe is black and there is pus', 'RF_FOOT_INFECTION'],
    ['পায়ে ঘা হয়েছে', 'RF_FOOT_WOUND'],
    ['I forgot to take my insulin', 'RF_MISSED_INSULIN'],
    ['ইনসুলিন নিতে ভুলে গেছি', 'RF_MISSED_INSULIN'],
    ['मैं इंसुलिन लेना भूल गया', 'RF_MISSED_INSULIN'],
    ['I feel dizzy after taking my medicine', 'RF_MED_SIDE_EFFECT'],
    ['my face is drooping and speech is slurred', 'RF_STROKE'],
  ];

  for (const [text, expectedId] of cases) {
    test(`"${text}" -> ${expectedId}`, () => {
      const ids = matchRedFlags(text).map((r) => r.id);
      assert.ok(ids.includes(expectedId), `expected ${expectedId}, got [${ids.join(', ')}]`);
    });
  }

  test('ordinary conversation raises no flags', () => {
    assert.deepEqual(matchRedFlags('Thank you doctor, I am feeling much better today'), []);
    assert.deepEqual(matchRedFlags('what should I eat for breakfast?'), []);
  });
});

/**
 * The warning signs the cardiology and general-medicine assistants were given
 * in their prompts, now caught without the model too. Each was routine before:
 * "my heart is racing and I feel faint" paged nobody, and neither did a typed
 * pulse of 150 that the same number tapped in would have flagged.
 */
describe('heart and general-medicine warning signs, without the model', () => {
  const cases = [
    ['my heart is racing and I feel faint', 'RF_PALPITATIONS_WITH_WARNING', 'emergency'],
    ['হৃদস্পন্দন খুব দ্রুত আর মাথা ঘোরাচ্ছে', 'RF_PALPITATIONS_WITH_WARNING', 'emergency'],
    ['धड़कन बहुत तेज़ है और चक्कर आ रहा है', 'RF_PALPITATIONS_WITH_WARNING', 'emergency'],
    ['angina pain not going away after rest', 'RF_ANGINA_NOT_SETTLING', 'emergency'],
    ['my lips are turning blue', 'RF_CYANOSIS', 'emergency'],
    ['ঠোঁট নীল হয়ে গেছে', 'RF_CYANOSIS', 'emergency'],
    ['I am on apixaban and my stool is black', 'RF_SERIOUS_BLEEDING', 'emergency'],
    ['রক্ত বমি হয়েছে', 'RF_SERIOUS_BLEEDING', 'emergency'],
    ['खून की उल्टी हुई', 'RF_SERIOUS_BLEEDING', 'emergency'],
    ['my bp is very high and I have a severe headache', 'RF_HIGH_BP_WITH_SYMPTOMS', 'emergency'],
    ['बीपी बहुत ज्यादा है और सिर दर्द', 'RF_HIGH_BP_WITH_SYMPTOMS', 'emergency'],
    ['my ankles are swollen and I am short of breath', 'RF_HEART_FAILURE_WARNING', 'emergency'],
    ['I cannot lie flat at night', 'RF_HEART_FAILURE_WARNING', 'emergency'],
    ['my throat is swelling after the injection', 'RF_ANAPHYLAXIS', 'emergency'],
    ['जीभ सूज गई है', 'RF_ANAPHYLAXIS', 'emergency'],
    ['fever and a rash that does not fade when pressed', 'RF_SEPSIS', 'emergency'],
    ['জ্বর আর ভুল বকছে', 'RF_SEPSIS', 'emergency'],
    ['fever with stiff neck', 'RF_MENINGITIS', 'emergency'],
    ['बुखार और गर्दन में अकड़न', 'RF_MENINGITIS', 'emergency'],
    ['sudden severe headache like never before', 'RF_SUDDEN_SEVERE_HEADACHE', 'emergency'],
    ['হঠাৎ প্রচণ্ড মাথা ব্যথা', 'RF_SUDDEN_SEVERE_HEADACHE', 'emergency'],
    ['he hit his head and is vomiting', 'RF_HEAD_INJURY_WARNING', 'emergency'],
    ['सिर पर चोट लगी और उल्टी हो रही है', 'RF_HEAD_INJURY_WARNING', 'emergency'],
    ['dengue and severe stomach pain', 'RF_DENGUE_WARNING', 'emergency'],
    ['ডেঙ্গু হয়েছে, মাড়ি থেকে রক্ত', 'RF_DENGUE_WARNING', 'emergency'],
    ['my father has heat stroke', 'RF_HEATSTROKE', 'emergency'],
    ['लू लग गई है', 'RF_HEATSTROKE', 'emergency'],
    ['back pain and I cannot control my bladder', 'RF_CAUDA_EQUINA', 'emergency'],
    ['diarrhoea and very drowsy', 'RF_SEVERE_DEHYDRATION', 'emergency'],
    ['পাতলা পায়খানা আর প্রস্রাব হচ্ছে না', 'RF_SEVERE_DEHYDRATION', 'emergency'],
    ['a snake bit me', 'RF_SNAKEBITE', 'emergency'],
    ['সাপে কেটেছে', 'RF_SNAKEBITE', 'emergency'],
    ['a stray dog bit my son', 'RF_ANIMAL_BITE', 'urgent'],
    ['कुत्ते ने काट लिया', 'RF_ANIMAL_BITE', 'urgent'],
  ];

  for (const [text, id, urgency] of cases) {
    test(`"${text}" -> ${id}`, () => {
      const r = triageMessage({ text });
      assert.ok(r.matchedRules.includes(id), `expected ${id}, got [${r.matchedRules.join(', ')}]`);
      assert.equal(r.urgency, urgency);
    });
  }

  test('a pulse or a fever typed in the chat is graded like one tapped in', () => {
    assert.equal(extractVitalsFromText('my pulse is 150').pulse, 150);
    assert.equal(extractVitalsFromText('পালস 140').pulse, 140);
    assert.equal(extractVitalsFromText('140 bpm').pulse, 140);
    assert.equal(extractVitalsFromText('fever 103').temperatureC, 39.4);
    assert.equal(extractVitalsFromText('temperature 39.5').temperatureC, 39.5);
    for (const text of ['my pulse is 150', 'heart rate 38 today', 'पल्स 150 है', 'fever 103 since morning', 'জ্বর 104']) {
      assert.equal(triageMessage({ text }).urgency, 'urgent', `"${text}" should be urgent`);
    }
  });

  test('and ordinary talk about the same things stays ordinary', () => {
    const ordinary = [
      'how do I avoid heat stroke in summer',
      'what is angina?',
      'I get palpitations sometimes when I drink tea',
      'my legs are swollen in the evening',
      'blood test report came normal',
      'stool test is due',
      'back pain since morning',
      'I had a headache yesterday, better now',
      'my lips are dry',
      'my cat scratched the sofa',
      'fever for 3 days',
      'pulse 72',
      'temperature 98.6',
      'sugar 180 2 hr after food',
      'I wore a blue shirt',
    ];
    for (const text of ordinary) {
      const r = triageMessage({ text });
      assert.ok(['routine', 'advice'].includes(r.urgency), `"${text}" escalated to ${r.urgency} [${r.matchedRules.join(', ')}]`);
    }
  });
});

describe('triageMessage — end to end', () => {
  test('the brief\'s five example queries all triage above routine', () => {
    const examples = [
      'My blood sugar is 350 mg/dL. What should I do?',
      'I forgot to take my insulin.',
      'I have a wound on my foot.',
      'I feel dizzy after taking my medicine.',
      'My blood pressure is high.',
    ];
    for (const text of examples) {
      const r = triageMessage({ text });
      assert.notEqual(r.urgency, 'routine', `"${text}" should not be routine`);
    }
  });

  test('chest pain is an emergency decided without the model', () => {
    const r = triageMessage({ text: 'I have chest pain and cannot breathe' });
    assert.equal(r.urgency, 'emergency');
    assert.equal(r.ruleDriven, true);
    assert.ok(r.matchedRules.includes('RF_CHEST_PAIN'));
    assert.ok(r.matchedRules.includes('RF_BREATHING'));
  });

  test('a critical number in free text escalates on its own', () => {
    const r = triageMessage({ text: 'sugar 480 right now' });
    assert.equal(r.urgency, 'emergency');
    assert.equal(r.alertType, 'critical_hyperglycaemia');
  });

  test('a recent critical reading escalates a vague follow-up message', () => {
    const r = triageMessage({
      text: 'I still feel unwell',
      latestGlucose: { valueMgDl: 470, measuredAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    assert.equal(r.urgency, 'urgent');
    assert.ok(r.matchedRules.includes('CTX_RECENT_CRITICAL_READING'));
  });

  test('a stale critical reading does not escalate forever', () => {
    const r = triageMessage({
      text: 'I still feel unwell',
      latestGlucose: { valueMgDl: 470, measuredAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
    });
    assert.equal(r.urgency, 'routine');
  });

  test('small talk stays routine', () => {
    const r = triageMessage({ text: 'Good morning doctor, when is the clinic open?' });
    assert.equal(r.urgency, 'routine');
    assert.equal(r.ruleDriven, false);
  });
});

describe('classifyFootSymptoms', () => {
  test('black tissue is always urgent', () => {
    const r = classifyFootSymptoms({ blackTissue: true });
    assert.equal(r.riskLevel, 'urgent');
    assert.equal(r.urgency, 'emergency');
  });

  test('purulent + malodorous wound is urgent', () => {
    assert.equal(classifyFootSymptoms({ discharge: true, foulSmell: true }).riskLevel, 'urgent');
  });

  test('a wound open for two weeks is high risk regardless of appearance', () => {
    const r = classifyFootSymptoms({ durationDays: 15 });
    assert.equal(r.riskLevel, 'high');
    assert.ok(r.matchedRules.includes('FT_NON_HEALING_14D'));
  });

  test('numbness alone is moderate', () => {
    assert.equal(classifyFootSymptoms({ numbness: true }).riskLevel, 'moderate');
  });

  test('no symptoms is low risk', () => {
    assert.equal(classifyFootSymptoms({}).riskLevel, 'low');
  });
});

// ---------------------------------------------------------------------------
// Endocrine emergencies beyond diabetes. Each of these is time-critical and
// each must escalate without the language model being involved.
// ---------------------------------------------------------------------------
describe('endocrine red flags', () => {
  const emergency = (text, rule) => {
    const r = triageMessage({ text });
    assert.equal(r.urgency, 'emergency', `${rule} should be emergency: ${text}`);
    assert.ok(r.matchedRules.includes(rule), `${rule} not matched in: ${text}`);
    assert.equal(r.ruleDriven, true);
  };

  test('thyroid storm — thyroid context plus fever and racing heart', () => {
    emergency('I have a fever and my heart is racing, I take thyroid medicine', 'RF_THYROID_STORM');
    emergency('thyrotoxicosis and now high temperature and palpitations', 'RF_THYROID_STORM');
  });

  test('thyroid storm — Bengali and Hindi', () => {
    emergency('থাইরয়েডের ওষুধ খাই, জ্বর আর বুক ধড়ফড় করছে', 'RF_THYROID_STORM');
    emergency('थायराइड की दवा लेता हूँ, बुखार और धड़कन तेज है', 'RF_THYROID_STORM');
  });

  test('a routine thyroid question must NOT escalate', () => {
    const r = triageMessage({ text: 'my thyroid report came yesterday, what does TSH mean' });
    assert.equal(r.urgency, 'routine');
    assert.ok(!r.matchedRules.includes('RF_THYROID_STORM'));
  });

  test('adrenal crisis — steroids plus vomiting and weakness', () => {
    // "steroids" not "steroid": \b does not fall inside the plural.
    emergency(
      'I am on steroids and vomiting, cannot keep them down, feel very weak',
      'RF_ADRENAL_CRISIS',
    );
    emergency('I have Addison and I am vomiting and dizzy', 'RF_ADRENAL_CRISIS');
  });

  test('adrenal crisis — Bengali and Hindi', () => {
    emergency('স্টেরয়েড নিই, বমি হচ্ছে আর খুব দুর্বল লাগছে', 'RF_ADRENAL_CRISIS');
    emergency('स्टेरॉयड लेता हूँ, उल्टी हो रही है और बहुत कमज़ोर', 'RF_ADRENAL_CRISIS');
  });

  test('HHS — very high sugar with confusion or drowsiness', () => {
    emergency('my sugar is very high and I feel confused and drowsy', 'RF_HHS');
    emergency('बहुत ज्यादा प्यास और सुस्ती लग रही है', 'RF_HHS');
  });

  test('statin myalgia escalates to urgent, not routine', () => {
    const r = triageMessage({ text: 'muscle pain since starting atorvastatin' });
    assert.equal(r.urgency, 'urgent');
    assert.ok(r.matchedRules.includes('RF_STATIN_MYALGIA'));
  });

  test('dark urine is caught on its own — it separates myalgia from rhabdomyolysis', () => {
    const r = triageMessage({ text: 'my urine has gone dark brown' });
    assert.ok(r.matchedRules.includes('RF_STATIN_MYALGIA'));
  });

  test('acute hot swollen joint is urgent — gout or septic arthritis', () => {
    const r = triageMessage({ text: 'my big toe is swollen and red, terrible pain' });
    assert.equal(r.urgency, 'urgent');
    assert.ok(r.matchedRules.includes('RF_ACUTE_JOINT'));
  });

  test('loss of hypo warning symptoms is urgent — it is a prescribing decision', () => {
    const r = triageMessage({ text: 'I dont get any warning symptoms when my sugar is low' });
    assert.equal(r.urgency, 'urgent');
    assert.ok(r.matchedRules.includes('RF_HYPO_UNAWARENESS'));
  });

  test('diabetes distress is never treated as small talk', () => {
    const r = triageMessage({ text: 'I am so fed up of this diabetes and injections' });
    assert.ok(r.matchedRules.includes('RF_MOOD_DISTRESS'));
    assert.notEqual(r.urgency, 'routine');
  });

  test('self-harm still outranks distress', () => {
    const r = triageMessage({ text: 'I am fed up of this diabetes, I want to end my life' });
    assert.equal(r.urgency, 'emergency');
    assert.ok(r.matchedRules.includes('RF_SUICIDAL'));
  });
});
