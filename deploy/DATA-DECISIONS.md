# Data and product decisions

Decisions taken for the MedPin remediation (verification report "MedPin 10/10
Verification", findings V-01…V-55). The user granted full authority to decide
these on 16–17 September 2026; each follows the recommendation the verification
made, and each is recorded here so it is not re-litigated by accident.

## 1. Shared patients: ownership, with sharing for continuity

A practice reads the clinical records it authored, plus what the patient
explicitly shares with it. A second practice no longer reads the first one's
prescriptions, labs, eye, foot or ECG records merely because both enrolled the
patient (V-06, V-48).

The exception is the patient's **medication list**: every practice caring for
the patient sees what the patient is taking, because a list missing another
clinic's anticoagulant is more dangerous than one that shows it.

## 2. Patient-written records are private by default

Glucose logs, food diaries and photographs a patient records themselves are
theirs. A practice sees them when the patient shares them — offered at the
enrolment consent step ("share my own health logs with this clinic"), and
changeable later — and the clinic is told what it is not seeing.

## 3. The founding-practice migration (4 September 2026)

`scripts/backfillPractices.js` and `scripts/backfillEnrollments.js` ran once in
production. They created the founding practice, attached the existing clinics
and clinicians to it, and enrolled every existing patient there ACTIVE, without a
consent code, backdated to each patient's first record.

That data stays as it is. It is recorded as a **one-time historical exception**:
the practices model arrived after the clinic had been running for months, and the
rows describe relationships that already existed.

The pattern is forbidden from here on. Both scripts are retired (they print why
and exit with an error), and a test keeps any script from giving a practice
patients, clinics or clinicians by default, or writing an enrolment without
consent.

## 4. Is a clinic a wall?

A per-member setting. Staff can be limited to named locations; the default is
practice-wide, so nothing changes for anyone already working today (V-21).

## 5. Lab roles and the practice manager

No care chat and no patient records. Lab roles record results; a practice manager
runs rosters, departments and billing. Both were removed from chat in C1 (V-17).

## 6. Staff passwords

Retired for new staff. Nobody sets a colleague's password; sign-in is by one-time
code. Existing password sign-ins keep working until each is moved; a shared
counter handset stays signed in rather than sharing a secret.

## 7. Finished medicine courses

They leave the active medicine list on the day the update ships — correct, and
visible — with a one-line note in the app so it is not silent.
