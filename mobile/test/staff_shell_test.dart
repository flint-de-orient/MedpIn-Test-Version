import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The front desk gets its own area, and the doctor's stays his.
///
/// Staff used to be routed into the clinician panel wholesale. Their Home
/// opened on Live Triage — HbA1c figures and clinical alerts, which answer "who
/// needs a doctor", a question a receptionist should not be deciding — and
/// their Profile offered the prescription letterhead, the professional details
/// and the digital signature, two of which are the doctor's identity.
///
/// Read as source rather than driven through a live router: the failure being
/// guarded is a role landing in the wrong tree, which is a routing rule, not a
/// rendering. The server refuses prescribing and alert-resolution for staff
/// besides — a screen that is absent is a convenience, a guard that is absent
/// is a false medical record.
void main() {
  final router = File('lib/core/router/app_router.dart').readAsStringSync();

  test('staff are routed to their own area, not the doctor\'s', () {
    expect(
      router.contains("const staffHome = '/staff/today';"),
      isTrue,
      reason: 'staff need a landing route of their own',
    );
    expect(
      router.contains('if (_isStaff(authState)) {'),
      isTrue,
      reason: 'the redirect must branch on staff separately',
    );
  });

  test('the doctor check no longer counts staff as a doctor', () {
    // The old helper was `role == 'doctor' || role == 'staff'`, and that single
    // `||` is what put a receptionist on the clinical Home.
    expect(
      router.contains("bool _isDoctor(AuthState s) => s.user?.role == 'doctor';"),
      isTrue,
    );
    expect(
      router.contains("_isClinician"),
      isFalse,
      reason: 'the merged doctor-or-staff check must be gone entirely',
    );
  });

  test('the desk shell offers the four tabs it should', () {
    final shell =
        File(
          'lib/features/staff/presentation/staff_shell.dart',
        ).readAsStringSync();
    for (final tab in ['Today', 'Patients', 'Messages', 'Profile']) {
      expect(shell.contains("label: '$tab'"), isTrue, reason: 'missing $tab');
    }
  });

  test('the desk profile does not carry the doctor\'s identity', () {
    final profile =
        File(
          'lib/features/staff/presentation/staff_profile_screen.dart',
        ).readAsStringSync();
    // A signature and a letterhead are how a prescription says who wrote it.
    // They belong to one person and must not sit in a shared desk account.
    for (final his in [
      'Digital signature',
      'Prescription letterhead',
      'Professional details',
      'Knowledge base',
    ]) {
      expect(
        profile.contains(his),
        isFalse,
        reason: '"$his" is the doctor\'s, not the desk\'s',
      );
    }
  });
}
