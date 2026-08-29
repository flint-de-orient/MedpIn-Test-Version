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
      router.contains(
        "bool _isDoctor(AuthState s) => s.user?.role == 'doctor';",
      ),
      isTrue,
    );
    expect(
      router.contains("_isClinician"),
      isFalse,
      reason: 'the merged doctor-or-staff check must be gone entirely',
    );
  });

  test('the desk shell offers the three tabs it should', () {
    final shell =
        File(
          'lib/features/staff/presentation/staff_shell.dart',
        ).readAsStringSync();
    for (final tab in ['Today', 'Patients', 'Profile']) {
      expect(shell.contains("label: '$tab'"), isTrue, reason: 'missing $tab');
    }
  });

  test('there is no second tab onto the same screen', () {
    // "Messages" and "Patients" both routed to PatientsScreen. Two labels for
    // one screen is worse than one label: a reader who taps both learns the
    // navigation is not telling the truth about what the app has.
    final shell =
        File(
          'lib/features/staff/presentation/staff_shell.dart',
        ).readAsStringSync();
    expect(shell.contains("label: 'Messages'"), isFalse);

    final router = File('lib/core/router/app_router.dart').readAsStringSync();
    expect(router.contains("path: '/staff/messages'"), isFalse);
  });

  test('the desk can open a patient record', () {
    // There was no /staff/patients/:id, so every route to a patient pushed
    // /clinician/... — which the redirect bounces staff out of. Finishing a
    // registration left the receptionist looking at a white screen.
    final router = File('lib/core/router/app_router.dart').readAsStringSync();
    expect(
      router.contains("path: '/staff/patients/:id'"),
      isTrue,
      reason: 'the desk has nowhere to open a patient',
    );
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

  test('every /staff path the app pushes is a route that exists', () {
    // The failure this catches: a screen shared by the doctor and the desk
    // pushing a hardcoded /clinician path. For the doctor it works; for staff
    // the router bounces them back to Today and nothing says why, so the
    // screen simply looks broken. Three of them did exactly that — the patient
    // rows, the register button and the post-registration redirect.
    final dart = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'));

    final used = <String>{};
    final pushed = RegExp(r"'(/staff/[^']*)'");
    for (final f in dart) {
      for (final m in pushed.allMatches(f.readAsStringSync())) {
        // Normalise an interpolated id to the route's parameter form.
        used.add(m.group(1)!.replaceAll(RegExp(r'\$\{[^}]*\}'), ':id'));
      }
    }

    final router = File('lib/core/router/app_router.dart').readAsStringSync();
    final declared =
        RegExp(
          r"path: '(/staff/[^']*)'",
        ).allMatches(router).map((m) => m.group(1)!).toSet();

    final missing = used.difference(declared);
    expect(
      missing,
      isEmpty,
      reason: 'these are pushed but have no route: $missing',
    );
  });
}
