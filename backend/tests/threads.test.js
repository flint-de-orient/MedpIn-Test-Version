import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ChatSession } from '../src/models/ChatSession.js';

/**
 * Threads that belong to a relationship, not to a person.
 *
 * A patient who sees two doctors has two conversations and neither should be
 * able to read the other. But the test of whether this is right rather than
 * merely finished is the other direction: a patient with one practice has to
 * come out of it with one thread, opening straight into the conversation, with
 * no list and no chooser — because that is what they have now and nothing about
 * their care changed.
 */
const service = readFileSync(new URL('../src/services/threads.js', import.meta.url), 'utf8');
const backfill = readFileSync(new URL('../scripts/backfillThreads.js', import.meta.url), 'utf8');

describe('one practice renders as today', () => {
  test('no enrollments returns the threads as one unlabelled group', () => {
    // Pre-migration. There is nothing to group by, and inventing a grouping
    // would put a practice heading above a conversation that never had one.
    assert.match(service, /if \(!enrollments\.length\)/);
    assert.match(service, /practice: null, enrollment: null, threads:/);
  });

  test('a thread with no enrollment is attributed to the first practice', () => {
    // It is the only practice the patient had when the row was written.
    assert.match(service, /const primary = enrollments\[0\];/);
    assert.match(service, /s\.enrollment \? String\(s\.enrollment\) : primary\.id/);
  });

  test('a null department is a real answer, not a gap', () => {
    // It is the practice's general thread, which is what a single-specialty
    // clinic has and what every existing session is.
    assert.match(service, /department: departmentId \?\? null/);
    assert.match(service, /null department \*is\* the practice's general thread/);
  });
});

describe('the history-vanishing trap is respected', () => {
  test('every read asks $ne nutrition, never kind equals care', () => {
    // Sessions written before `kind` existed have none at all, and an equality
    // check made every patient's history disappear the last time it shipped.
    // The model carries the warning; this is the enforcement.
    // Code only — the rule is also written down in a comment, and counting
    // that would be the test marking its own explanation as a violation.
    const code = service
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

    const reads = code.match(/kind: \{ \$ne: 'nutrition' \}/g) ?? [];
    assert.ok(reads.length >= 2, 'a read path is not using $ne');

    // The one literal 'care' allowed is on create, where a default is correct.
    const equality = code.match(/kind: 'care'/g) ?? [];
    assert.equal(equality.length, 1, 'kind is being compared by equality somewhere');
    assert.match(service, /kind: 'care',\s*\n\s*language,/);
  });

  test('the backfill reads the same way', () => {
    assert.match(backfill, /kind: \{ \$ne: 'nutrition' \}/);
  });
});

describe('the thread is per department, not per doctor', () => {
  test('the model says why', () => {
    const model = readFileSync(new URL('../src/models/ChatSession.js', import.meta.url), 'utf8');
    // A thread per doctor breaks the moment a department has four of them.
    assert.match(model, /Deliberately the department and not the doctor/);
    assert.ok(!Object.keys(ChatSession.schema.paths).includes('doctor'));
  });

  test('one thread per enrollment per department', () => {
    const idx = ChatSession.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.enrollment === 1 && i.f.department === 1);
    assert.ok(unique, 'no enrollment+department index');
    assert.equal(unique.o.unique, true);
  });

  test('the index is partial, or every legacy row collides', () => {
    // The overwhelming majority of rows have neither field, and a plain unique
    // index would collide them all on (null, null).
    const idx = ChatSession.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.enrollment === 1 && i.f.department === 1);
    assert.ok(unique.o.partialFilterExpression, 'the unique index is not partial');
  });
});

describe('a department with no assistant gets silence', () => {
  test('the thread reports whether it can be answered', () => {
    // So the composer can say so rather than accept a message nothing will
    // reply to.
    assert.match(service, /export async function threadHasAssistant/);
    assert.match(service, /hasAssistant: d \? Boolean\(d\.assistantScope\?\.role\) : true/);
  });

  test("the practice's general thread keeps the assistant it always had", () => {
    // Null department is Dr. Dey's thread, and nothing about it changed.
    assert.match(service, /if \(!session\?\.department\) return true;/);
  });
});

describe('the migration', () => {
  test('links the enrollment and leaves the department alone', () => {
    // Filling in diabetology would relabel every existing conversation: the
    // patient opens a thread that used to be theirs and finds a specialty
    // heading on it.
    assert.match(backfill, /\$set: \{ enrollment: firstFor\.get/);
    assert.ok(!/department:/.test(backfill.split('$set')[1] ?? ''), 'the backfill sets a department');
    assert.match(backfill, /No message or department was touched/);
  });

  test('it skips a patient with no enrollment rather than guessing', () => {
    assert.match(backfill, /the patient has no active enrollment/);
    assert.match(backfill, /Run backfillEnrollments\.js first/);
  });

  test('it picks the earliest enrollment, not an arbitrary one', () => {
    assert.match(backfill, /\.sort\(\{ enrolledOn: 1 \}\)/);
    assert.match(backfill, /if \(!firstFor\.has\(String\(e\.patient\)\)\)/);
  });

  test('does not write unless asked', () => {
    assert.match(backfill, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(backfill, /if \(!apply\)/);
  });
});

describe('the app can actually reach any of this', () => {
  const dashboard = readFileSync(new URL('../src/routes/dashboard.js', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/routes/chat.js', import.meta.url), 'utf8');

  test('home cards and the family list ride on the existing call', () => {
    // Not new endpoints. The screen renders as one thing, and a patient on a
    // patchy connection should not watch half of it arrive.
    assert.match(dashboard, /async function homeShape/);
    assert.match(dashboard, /conditionsFor\(patientId, \{ profile \}\)/);
    assert.match(dashboard, /patientsForLogin\(loginId\)/);
    assert.match(dashboard, /\.\.\.\(await homeShape\(patientId, profile, req\.user\?\._id\)\)/);
  });

  test('the grouped thread list is exposed', () => {
    assert.match(chat, /router\.get\(\s*\n\s*'\/threads'/);
    assert.match(chat, /threadsFor\(req\.user\._id/);
  });

  test('the services are no longer dead code', () => {
    // Both were written a phase early and called by nothing. This is the wiring
    // that makes A1 and B1 visible to a patient.
    for (const [name, src] of [['conditionsFor', dashboard], ['patientsForLogin', dashboard]]) {
      assert.ok(src.includes(name), `${name} is still unused`);
    }
  });
});
