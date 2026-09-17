import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/presentation/widgets/dashboard_registry.dart';

/// The doctor's Home no longer draws its five shortcut buttons: three of them
/// opened the same patient list as the Care tab.
void main() {
  test('none of the doctor’s five shortcuts is drawn, whatever the specialty', () {
    // The general clinical set and the cardiology set, as the server offers them.
    expect(
      homeShortcuts(['START_CONSULTATION', 'ADD_PATIENT', 'RECORD_VITALS', 'WRITE_PRESCRIPTION', 'VIEW_ALERTS']),
      isEmpty,
    );
    expect(
      homeShortcuts(['START_CONSULTATION', 'RECORD_VITALS', 'WRITE_PRESCRIPTION', 'VIEW_LAB_REPORTS', 'VIEW_ALERTS']),
      isEmpty,
    );
  });

  test('a practice manager keeps shortcuts to screens that have no tab', () {
    expect(
      homeShortcuts(['MANAGE_TEAM', 'MANAGE_DEPARTMENTS', 'EXPORT_REPORT']),
      ['MANAGE_TEAM', 'MANAGE_DEPARTMENTS', 'EXPORT_REPORT'],
    );
    expect(homeShortcuts(['VIEW_LAB_REPORTS', 'EXPORT_REPORT']), ['EXPORT_REPORT']);
  });
}
