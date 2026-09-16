import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { planReadingBands, applyReadingBands } from '../scripts/backfillReadingBands.js';

/**
 * Readings the clinic took before clinic readings were banded.
 *
 * Written straight to the collection with no band, exactly as the consultation
 * and registration paths used to leave them.
 */

const patient = () => new mongoose.Types.ObjectId();

describe('banding the clinic’s older readings', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('a crisis and a normal pressure are banded as what they are', async () => {
    const who = patient();
    const [crisis, normal] = Object.values(
      (await VitalRecord.collection.insertMany([
        { patient: who, systolic: 190, diastolic: 120, recordedAt: new Date('2026-03-01') },
        { patient: who, systolic: 118, diastolic: 76, recordedAt: new Date('2026-03-02') },
      ])).insertedIds,
    );

    await applyReadingBands(await planReadingBands());

    assert.equal((await VitalRecord.findById(crisis).lean()).flag, 'hypertensive_crisis');
    assert.equal((await VitalRecord.findById(normal).lean()).flag, 'normal');
  });

  test('a sugar is banded, and nobody is paged about March', async () => {
    const who = patient();
    const { insertedId } = await GlucoseReading.collection.insertOne({
      patient: who,
      valueMgDl: 420,
      context: 'random',
      source: 'clinic',
      measuredAt: new Date('2026-03-01'),
    });

    await applyReadingBands(await planReadingBands());

    const reading = await GlucoseReading.findById(insertedId).lean();
    assert.ok(reading.flag && reading.flag !== 'in_range');
    assert.equal(await ClinicalAlert.countDocuments({}), 0, 'history raised an alert');
  });

  test('a reading already banded is left exactly as it is', async () => {
    const who = patient();
    const { insertedId } = await VitalRecord.collection.insertOne({
      patient: who,
      systolic: 190,
      diastolic: 120,
      flag: 'stage2',
      recordedAt: new Date('2026-03-01'),
    });

    const plan = await planReadingBands();
    assert.equal(plan.vitals.length, 0);
    await applyReadingBands(plan);
    assert.equal((await VitalRecord.findById(insertedId).lean()).flag, 'stage2');
  });

  test('half a blood pressure has nothing to band', async () => {
    const who = patient();
    await VitalRecord.collection.insertOne({ patient: who, weightKg: 72, recordedAt: new Date() });

    const plan = await planReadingBands();
    assert.equal(plan.vitals.length, 0);
    assert.equal(plan.skipped, 1);
  });

  test('running it twice changes nothing the second time', async () => {
    const who = patient();
    await VitalRecord.collection.insertOne({ patient: who, systolic: 150, diastolic: 96, recordedAt: new Date() });

    await applyReadingBands(await planReadingBands());
    const second = await planReadingBands();
    assert.equal(second.vitals.length + second.glucose.length, 0);
    assert.equal(await applyReadingBands(second), 0);
  });
});
