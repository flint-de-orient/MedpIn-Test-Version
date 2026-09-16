/**
 * Seeds demo accounts and realistic clinical history for development.
 *
 *   npm run seed              # create demo doctor, staff and patients
 *   npm run seed -- --reset   # wipe clinical collections first
 *
 * Never run with --reset against a production database.
 */
import dayjs from 'dayjs';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';

import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { Medication } from '../src/models/Medication.js';
import { MedicationLog } from '../src/models/MedicationLog.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';

import { classifyGlucose, classifyBloodPressure } from '../src/services/triage/engine.js';
import { recomputePatientRisk } from '../src/services/analytics.js';

const reset = process.argv.includes('--reset');

if (env.NODE_ENV === 'production') {
  console.error('Refusing to run the seed script with NODE_ENV=production.');
  process.exit(1);
}

// Deterministic pseudo-random so repeated seeds produce the same demo data.
let seedState = 42;
const rand = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};
const between = (min, max) => min + rand() * (max - min);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

async function upsertUser({ name, phone, password, role, language, dateOfBirth, gender }) {
  let user = await User.findOne({ phone });
  if (!user) {
    user = new User({ name, phone, role, language, dateOfBirth, gender, consent: {
      termsAcceptedAt: new Date(), dataProcessingAcceptedAt: new Date(), aiDisclaimerAcceptedAt: new Date(),
    } });
    await user.setPassword(password);
    await user.save();
    logger.info({ role, phone }, 'created user');
  }
  return user;
}

async function main() {
  await connectDb();

  if (reset) {
    logger.warn('--reset: clearing clinical collections');
    await Promise.all([
      GlucoseReading.deleteMany({}), Hba1cRecord.deleteMany({}), VitalRecord.deleteMany({}),
      Medication.deleteMany({}), MedicationLog.deleteMany({}), LifestyleLog.deleteMany({}),
      Appointment.deleteMany({}), ChatSession.deleteMany({}), ChatMessage.deleteMany({}),
      ClinicalAlert.deleteMany({}), Clinic.deleteMany({}),
    ]);
  }

  // ---- Clinic staff -------------------------------------------------------
  const doctor = await upsertUser({
    // An invented demo doctor. This took the configured doctor's name, which
    // defaulted to a real one.
    name: 'Dr. Demo Doctor',
    phone: '+919830000001',
    password: 'Doctor@1234',
    role: ROLES.DOCTOR,
    language: 'en',
    gender: 'male',
  });

  await upsertUser({
    name: 'Clinic Reception',
    phone: '+919830000002',
    password: 'Staff@1234',
    role: ROLES.STAFF,
    language: 'en',
  });

  await upsertUser({
    name: 'Priya Nutritionist',
    phone: '+919830000003',
    password: 'Diet@1234',
    role: ROLES.DIETICIAN,
    language: 'en',
  });

  // ---- Clinics + weekly availability -------------------------------------
  const clinics = await seedClinics(doctor);

  // ---- Patients -----------------------------------------------------------
  const patientSpecs = [
    {
      name: 'Rahul Das', phone: '+919830000011', language: 'bn', gender: 'male',
      dateOfBirth: '1968-03-14', diabetesType: 'type2', diagnosedOn: '2012-06-01',
      profile: 'poor',  // poorly controlled, on insulin
      comorbidities: ['hypertension', 'dyslipidaemia'],
    },
    {
      name: 'Sunita Sharma', phone: '+919830000012', language: 'hi', gender: 'female',
      dateOfBirth: '1979-11-02', diabetesType: 'type2', diagnosedOn: '2019-02-20',
      profile: 'good',
      comorbidities: [],
    },
    {
      name: 'Ayesha Rahman', phone: '+919830000013', language: 'en', gender: 'female',
      dateOfBirth: '1995-07-25', diabetesType: 'type1', diagnosedOn: '2008-09-10',
      profile: 'variable',
      comorbidities: ['retinopathy'],
    },
  ];

  for (const spec of patientSpecs) {
    const user = await upsertUser({
      name: spec.name, phone: spec.phone, password: 'Patient@1234',
      role: ROLES.PATIENT, language: spec.language,
      dateOfBirth: new Date(spec.dateOfBirth), gender: spec.gender,
    });

    await PatientProfile.findOneAndUpdate(
      { user: user._id },
      {
        user: user._id,
        diabetesType: spec.diabetesType,
        diagnosedOn: new Date(spec.diagnosedOn),
        heightCm: spec.gender === 'male' ? 170 : 158,
        comorbidities: spec.comorbidities,
        assignedDoctor: doctor._id,
        emergencyContact: { name: 'Family member', phone: '+919830000099', relation: 'spouse' },
      },
      { upsert: true, new: true },
    );

    await seedClinicalHistory(user, spec, doctor, clinics);
    await recomputePatientRisk(user._id);
    logger.info({ patient: spec.name }, 'seeded clinical history');
  }

  await printSummary();
  await disconnectDb();
}

/**
 * Two clinics with realistic weekly availability, so the booking flow has
 * live schedules to render against. dayOfWeek: 0 = Sunday … 6 = Saturday.
 */
async function seedClinics(doctor) {
  if ((await Clinic.countDocuments()) > 0) {
    return Clinic.find().sort({ sortIndex: 1 });
  }

  const weekdays = [1, 2, 3, 4, 5]; // Mon–Fri
  const saltLakeHours = [
    // Morning and evening sittings on weekdays, morning only on Saturday.
    ...weekdays.flatMap((d) => [
      { dayOfWeek: d, start: '10:00', end: '14:00' },
      { dayOfWeek: d, start: '17:00', end: '20:00' },
    ]),
    { dayOfWeek: 6, start: '10:00', end: '14:00' },
  ];
  const behalaHours = [2, 4, 6].map((d) => ({ dayOfWeek: d, start: '18:00', end: '21:00' }));

  const created = [];
  created.push(
    await Clinic.create({
      name: 'Salt Lake Diabetes & Endocrine Centre',
      addressLine: 'DD-24, Sector 1, Salt Lake City',
      city: 'Kolkata',
      phone: '+913340000001',
      doctor: doctor._id,
      slotMinutes: 15,
      weeklyHours: saltLakeHours,
      sortIndex: 0,
    }),
  );
  created.push(
    await Clinic.create({
      name: 'Behala Evening Clinic',
      addressLine: '14 Diamond Harbour Road, Behala',
      city: 'Kolkata',
      phone: '+913340000002',
      doctor: doctor._id,
      slotMinutes: 20,
      weeklyHours: behalaHours,
      sortIndex: 1,
    }),
  );

  logger.info({ count: created.length }, 'created clinics');
  return created;
}

async function seedClinicalHistory(user, spec, doctor, clinics) {
  const existing = await GlucoseReading.countDocuments({ patient: user._id });
  if (existing > 0) {
    logger.info({ patient: spec.name }, 'history already present, skipping');
    return;
  }

  // --- Glucose: 60 days, 2-4 readings/day ---
  const bands = {
    good: { fasting: [95, 125], post: [120, 165] },
    poor: { fasting: [150, 230], post: [200, 320] },
    variable: { fasting: [65, 190], post: [90, 280] },
  }[spec.profile];

  const readings = [];
  for (let d = 60; d >= 0; d -= 1) {
    const day = dayjs().subtract(d, 'day');
    const slots = [
      { context: 'fasting', hour: 7, range: bands.fasting },
      { context: 'post_meal', hour: 14, range: bands.post },
      { context: 'bedtime', hour: 22, range: bands.post },
    ];

    for (const slot of slots) {
      // Not every reading gets logged — real adherence is patchy.
      if (rand() > (spec.profile === 'good' ? 0.85 : 0.6)) continue;
      let value = Math.round(between(slot.range[0], slot.range[1]));

      // Give the demo data a couple of genuine emergencies to exercise the
      // alerting and doctor-dashboard paths.
      if (spec.profile === 'poor' && d === 3 && slot.context === 'post_meal') value = 438;
      if (spec.profile === 'variable' && d === 8 && slot.context === 'fasting') value = 48;

      const measuredAt = day.hour(slot.hour).minute(Math.floor(between(0, 59))).toDate();
      // Today's later slots have not happened yet — a demo dashboard showing a
      // reading timestamped in the future looks broken.
      if (measuredAt > new Date()) continue;

      const assessment = classifyGlucose(value, slot.context);
      readings.push({
        patient: user._id, valueMgDl: value, context: slot.context,
        measuredAt, source: 'manual', flag: assessment.flag,
      });
    }
  }
  await GlucoseReading.insertMany(readings);

  // Raise alerts for the critical demo readings so the doctor dashboard has
  // something real to show.
  for (const r of readings.filter((x) => ['severe_low', 'critical_high'].includes(x.flag))) {
    const a = classifyGlucose(r.valueMgDl, r.context);
    await ClinicalAlert.create({
      patient: user._id,
      severity: 'emergency',
      type: a.alertType ?? 'abnormal_trend',
      title: a.summary,
      detail: `Recorded ${r.valueMgDl} mg/dL (${r.context}) on ${dayjs(r.measuredAt).format('DD MMM YYYY, h:mm A')}.`,
      source: { kind: 'glucose' },
      matchedRules: [a.rule],
      status: 'open',
      createdAt: r.measuredAt,
    });
  }

  // --- HbA1c: quarterly ---
  const a1cBase = { good: 6.6, poor: 9.4, variable: 8.1 }[spec.profile];
  for (let q = 4; q >= 1; q -= 1) {
    await Hba1cRecord.create({
      patient: user._id,
      percentage: Number((a1cBase + between(-0.4, 0.4)).toFixed(1)),
      testedOn: dayjs().subtract(q * 3, 'month').toDate(),
      labName: 'Kolkata Diagnostics',
    });
  }

  // --- Vitals ---
  const bpBase = spec.comorbidities.includes('hypertension') ? [138, 88] : [122, 78];
  let weight = spec.gender === 'male' ? 82 : 68;
  for (let d = 60; d >= 0; d -= 3) {
    const systolic = Math.round(bpBase[0] + between(-8, 14));
    const diastolic = Math.round(bpBase[1] + between(-6, 10));
    weight += between(-0.3, 0.25);
    const assessment = classifyBloodPressure(systolic, diastolic);
    await VitalRecord.create({
      patient: user._id,
      systolic, diastolic,
      pulse: Math.round(between(66, 88)),
      weightKg: Number(weight.toFixed(1)),
      recordedAt: dayjs().subtract(d, 'day').hour(8).toDate(),
      flag: assessment?.flag,
    });
  }

  // --- Medications ---
  const medSets = {
    good: [{ name: 'Metformin', strength: '500 mg', dose: '1 tablet', form: 'tablet', times: ['08:00', '20:00'] }],
    poor: [
      { name: 'Metformin', strength: '1000 mg', dose: '1 tablet', form: 'tablet', times: ['08:00', '20:00'] },
      { name: 'Glimepiride', strength: '2 mg', dose: '1 tablet', form: 'tablet', times: ['08:00'] },
      { name: 'Insulin Glargine', strength: '100 IU/mL', dose: '18 units', form: 'insulin', times: ['22:00'] },
      { name: 'Telmisartan', strength: '40 mg', dose: '1 tablet', form: 'tablet', times: ['08:00'] },
    ],
    variable: [
      { name: 'Insulin Glargine', strength: '100 IU/mL', dose: '22 units', form: 'insulin', times: ['22:00'] },
      { name: 'Insulin Aspart', strength: '100 IU/mL', dose: '8 units', form: 'insulin', times: ['08:00', '13:00', '20:00'] },
    ],
  }[spec.profile];

  const adherenceRate = { good: 0.93, poor: 0.62, variable: 0.8 }[spec.profile];

  for (const m of medSets) {
    const med = await Medication.create({
      patient: user._id,
      name: m.name, strength: m.strength, dose: m.dose, form: m.form,
      schedule: m.times.map((time) => ({ time, relationToMeal: m.form === 'insulin' ? 'any' : 'after_meal' })),
      startDate: dayjs().subtract(6, 'month').toDate(),
      prescribedBy: doctor._id,
      isActive: true,
    });

    // 30 days of dose logs at the profile's adherence rate.
    const logs = [];
    for (let d = 30; d >= 1; d -= 1) {
      const day = dayjs().subtract(d, 'day');
      for (const time of m.times) {
        const [hh, mm] = time.split(':').map(Number);
        const scheduledFor = day.hour(hh).minute(mm).second(0).millisecond(0).toDate();
        if (rand() > adherenceRate) continue;
        logs.push({
          patient: user._id, medication: med._id, scheduledFor,
          status: 'taken', takenAt: scheduledFor,
          ...(m.form === 'insulin'
            ? { unitsAdministered: parseInt(m.dose, 10), injectionSite: pick(['abdomen', 'left_thigh', 'right_thigh']) }
            : {}),
        });
      }
    }
    if (logs.length) await MedicationLog.insertMany(logs, { ordered: false }).catch(() => {});
  }

  // --- Lifestyle ---
  const lifestyle = [];
  for (let d = 14; d >= 0; d -= 1) {
    const day = dayjs().subtract(d, 'day');
    if (rand() > 0.35) {
      lifestyle.push({
        patient: user._id, kind: 'exercise', loggedAt: day.hour(6).toDate(),
        activityType: 'walking', durationMinutes: Math.round(between(20, 45)),
        intensity: 'moderate', steps: Math.round(between(2500, 6000)),
      });
    }
    for (let i = 0; i < Math.round(between(3, 7)); i += 1) {
      lifestyle.push({ patient: user._id, kind: 'water', loggedAt: day.hour(8 + i * 2).toDate(), volumeMl: 250 });
    }
    lifestyle.push({
      patient: user._id, kind: 'meal', loggedAt: day.hour(13).toDate(), mealType: 'lunch',
      foodItems: [
        { name: 'Rice', quantity: '1 cup', carbsGrams: 45, calories: 205 },
        { name: 'Dal', quantity: '1 bowl', carbsGrams: 20, calories: 120 },
        { name: 'Mixed vegetables', quantity: '1 bowl', carbsGrams: 10, calories: 80 },
      ],
      totalCarbsGrams: 75, totalCalories: 405,
    });
  }
  await LifestyleLog.insertMany(lifestyle);

  // --- Appointments ---
  const clinic = clinics?.[0] ?? null;
  const isTele = spec.profile === 'variable';
  await Appointment.create({
    patient: user._id, doctor: doctor._id,
    clinic: clinic?._id,
    scheduledFor: dayjs().subtract(45, 'day').hour(11).toDate(),
    status: 'completed', mode: 'in_clinic', durationMinutes: clinic?.slotMinutes ?? 15,
    reason: 'Routine diabetes review',
    consultationNotes: 'Reviewed sugar diary. Reinforced diet advice and foot care.',
  });
  await Appointment.create({
    patient: user._id, doctor: doctor._id,
    clinic: isTele ? undefined : clinic?._id,
    scheduledFor: dayjs().add(spec.profile === 'poor' ? 2 : 12, 'day').hour(11).minute(30).toDate(),
    status: 'confirmed', mode: isTele ? 'teleconsult' : 'in_clinic',
    durationMinutes: clinic?.slotMinutes ?? 15, reason: 'Follow-up',
  });
}

async function printSummary() {
  const [patients, readings, alerts, meds] = await Promise.all([
    User.countDocuments({ role: ROLES.PATIENT }),
    GlucoseReading.countDocuments(),
    ClinicalAlert.countDocuments({ status: 'open' }),
    Medication.countDocuments(),
  ]);

  console.log(`
────────────────────────────────────────────────────
  Seed complete
────────────────────────────────────────────────────
  Patients ............ ${patients}
  Glucose readings .... ${readings}
  Medications ......... ${meds}
  Open alerts ......... ${alerts}

  Demo logins (password shown):
    Doctor    +919830000001  Doctor@1234
    Staff     +919830000002  Staff@1234
    Patient   +919830000011  Patient@1234   (Rahul Das — poor control, Bengali)
    Patient   +919830000012  Patient@1234   (Sunita Sharma — good control, Hindi)
    Patient   +919830000013  Patient@1234   (Ayesha Rahman — Type 1, English)

  Next: npm run seed:knowledge
────────────────────────────────────────────────────
`);
}

main().catch(async (err) => {
  logger.fatal({ err }, 'seed failed');
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
