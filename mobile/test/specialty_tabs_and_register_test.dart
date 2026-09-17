import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/auth/data/auth_repository.dart';
import 'package:medpin/features/auth/presentation/auth_controller.dart';
import 'package:medpin/features/clinician/data/clinician_repository.dart';
import 'package:medpin/features/clinician/domain/patient_registration.dart';
import 'package:medpin/features/clinician/presentation/add_patient_screen.dart';
import 'package:medpin/features/clinician/presentation/clinician_tabs.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/providers/core_providers.dart';

Capabilities _caps(Set<String> effective, {bool hasDietician = false, String? specialty}) => Capabilities(
  practiceType: null,
  specialty: null,
  plan: null,
  practice: effective,
  effective: effective,
  role: 'doctor',
  isOwner: false,
  resolved: true,
  hasDietician: hasDietician,
  ui: DashboardConfig(widgets: const [], quickActions: const [], specialty: specialty),
);

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

/// A number that already has a MedPin account, as the server answers it.
class _ExistingNumberAuth implements AuthRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #requestOtp) {
      return Future<OtpSent>.error(
        const ApiException(code: 'CONFLICT', message: 'An account with this phone already exists', statusCode: 409),
      );
    }
    return super.noSuchMethod(invocation);
  }
}

class _Registrations implements ClinicianRepository {
  int created = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #createPatient) {
      created++;
      return Future<PatientRegistration>.value(
        const PatientRegistration(
          id: '',
          name: 'Existing Patient',
          existing: true,
          consentRequired: false,
          enrollmentId: null,
          message: 'ok',
        ),
      );
    }
    return super.noSuchMethod(invocation);
  }
}

void main() {
  group('the Nutrition tab by specialty', () {
    test('a cardiologist or general physician sees it only with a dietician at the practice', () {
      for (final specialty in ['cardiology', 'general_physician']) {
        expect(visibleBranches(_caps({Cap.aiAssistant}, specialty: specialty)), [0, 1, 3], reason: specialty);
        expect(visibleBranches(_caps({Cap.aiAssistant}, specialty: specialty, hasDietician: true)), [0, 1, 2, 3],
            reason: specialty);
      }
    });

    test('diabetology, and a server that does not say, keep it as before', () {
      expect(visibleBranches(_caps({Cap.aiAssistant}, specialty: 'diabetology')), [0, 1, 2, 3]);
      expect(visibleBranches(_caps({Cap.aiAssistant})), [0, 1, 2, 3]);
      expect(visibleBranches(_caps({})), [0, 1, 3]);
    });

    test('the specialty is read from the server’s Home settings', () {
      final ui = DashboardConfig.fromJson({'widgets': [], 'quickActions': [], 'specialty': 'cardiology'});
      expect(ui?.specialty, 'cardiology');
      expect(DashboardConfig.fromJson({'widgets': [], 'quickActions': []})?.specialty, isNull);
    });
  });

  testWidgets('registering a number that already has an account is not a dead end', (tester) async {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final registrations = _Registrations();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStoreProvider.overrideWithValue(_NoSession()),
          authRepositoryProvider.overrideWithValue(_ExistingNumberAuth()),
          clinicianRepositoryProvider.overrideWithValue(registrations),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const AddPatientScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'Full name'), 'Existing Patient');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone'), '9230592845');
    await tester.enterText(find.widgetWithText(TextFormField, 'Address'), 'Salt Lake');
    await tester.enterText(find.widgetWithText(TextFormField, 'Age'), '52');
    await tester.tap(find.text('Gender'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Female').last);
    await tester.pumpAndSettle();
    await tester.pump();

    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Open it from the patient list'), findsNothing, reason: 'the old dead end');
    expect(find.textContaining('already has a MedPin account'), findsOneWidget);

    final register = find.ancestor(of: find.text('Register patient'), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton)).first;
    await tester.ensureVisible(register);
    await tester.tap(register);
    await tester.pumpAndSettle();

    expect(find.text('Register without verifying?'), findsNothing, reason: 'warned that an existing account cannot sign in');
    expect(registrations.created, 1, reason: 'the registration was not sent');
  });
}
