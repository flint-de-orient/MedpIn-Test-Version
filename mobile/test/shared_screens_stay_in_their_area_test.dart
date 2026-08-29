import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Screens the doctor and the front desk both use must not name an area.
///
/// The two roles share the patient roll, the chat thread, the record and the
/// prescription list, but they live under different route prefixes and the
/// router bounces anyone who strays into the other's tree. A shared screen that
/// pushes `/clinician/...` outright therefore works perfectly for the doctor
/// and dead-ends for the desk — and the dead end is silent. The receptionist
/// taps a patient's face, the redirect throws them back to Today, and what they
/// see is a blank page with the wrong tab lit. Nothing says why.
///
/// It was fixed once, in the obvious places, and came back: the thread header's
/// tap target and three buttons on the record were still literals. That is the
/// signature of a rule that needs a test rather than another careful edit —
/// there is no error, no exception and no log line, so the only way to notice
/// is to be the receptionist.
///
/// [areaPrefix] is the fix. This is the guard.
void main() {
  /// Every screen reachable from a `/staff/...` route in the router.
  ///
  /// Kept by hand because it is a claim about routing, not about files, and a
  /// list derived from the router would agree with the router by construction —
  /// including when the router is what is wrong. Add to it when a staff route
  /// starts pointing at another screen.
  const shared = <String>[
    'lib/features/clinician/presentation/patients_screen.dart',
    'lib/features/clinician/presentation/patient_thread_screen.dart',
    'lib/features/clinician/presentation/patient_profile_screen.dart',
    'lib/features/clinician/presentation/prescription_list_screen.dart',
    'lib/features/clinician/presentation/add_patient_screen.dart',
    // Not a route, but reachable from the desk's own header on every tab —
    // and every row in it was a literal, so the bell counted and each tap
    // landed on a blank page.
    'lib/features/clinician/presentation/widgets/clinician_notification_sheet.dart',
  ];

  for (final path in shared) {
    test('${path.split('/').last} never hard-codes an area', () {
      final file = File(path);
      expect(
        file.existsSync(),
        isTrue,
        reason:
            '$path is in the shared list but does not exist. If it moved, '
            'update this list; if it is no longer shared, remove it.',
      );

      final offenders = <String>[];
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i += 1) {
        final line = lines[i];
        // Comments discuss the prefixes constantly — this is about code.
        if (line.trimLeft().startsWith('//')) continue;
        // Naming an area is not the offence. Asking which one you are in is
        // fine (`areaPrefix(ref) == '/staff'`), and so is sending the two
        // roles to genuinely different places — the doctor's More tab and the
        // desk's Profile tab are different screens, not one screen under two
        // prefixes.
        //
        // The offence is a *patient record* addressed by literal, because that
        // is the one destination both roles reach and only one of them is
        // allowed into.
        if (line.contains("'/clinician/patients") ||
            line.contains("'/staff/patients")) {
          offenders.add('  ${i + 1}: ${line.trim()}');
        }
      }

      expect(
        offenders,
        isEmpty,
        reason:
            'A screen both roles use named one of their areas. Use '
            "areaPrefix(ref) instead — see core/router/area.dart.\n"
            '${offenders.join('\n')}',
      );
    });
  }

  test('areaPrefix still answers with both areas', () {
    // The helper is what the screens above are required to use, so a rename or
    // a quiet change of its return values would make every test above pass
    // while the app broke.
    final src =
        File('lib/core/router/area.dart').readAsStringSync();
    expect(src, contains("'/staff'"));
    expect(src, contains("'/clinician'"));
  });
}
