import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/core/theme/tokens.dart';
import 'package:akd_care/features/auth/data/auth_repository.dart';
import 'package:akd_care/features/auth/presentation/auth_controller.dart';
import 'package:akd_care/features/clinician/data/clinician_repository.dart';
import 'package:akd_care/features/clinician/domain/team_member.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/team_screen.dart';
import 'package:akd_care/features/clinician/presentation/widgets/verified_phone_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The People screen shows everybody the server says works here.
///
/// It drew doctors, the desk and dieticians, and counted everyone else in the
/// "11 of 12 people" above a list that never showed them. It could hire into
/// three roles of seven. It could not add anybody who already used MedPin,
/// because it asked for a registration code, which the server refuses for a
/// number with an account. And opening somebody who had left and saving any
/// change sent them back in.

TeamMember _member(
  String name,
  String role, {
  String status = 'active',
  bool isOwner = false,
}) => TeamMember(
  id: 'm-$name',
  userId: 'u-$name',
  name: name,
  phone: '+919830000000',
  role: role,
  isOwner: isOwner,
  status: status,
  permissions: const [],
  usingPreset: true,
);

TeamRoster _roster(List<TeamMember> people) => TeamRoster(
  items: people,
  canManage: true,
  departments: const [],
  locations: const [],
  staffCap: null,
  staffUsed: people.length,
);

/// The seven roles, as this screen names them.
const _roleNames = [
  'Doctor',
  'Front desk',
  'Dietician',
  'Doctor’s assistant',
  'Laboratory manager',
  'Laboratory technician',
  'Practice manager',
];

/// The team routes, recorded.
class _Team implements ClinicianRepository {
  final sentTo = <String>[];
  final checked = <(String, String)>[];
  final hired = <({String role, String name, String phoneToken})>[];
  final updates = <({String id, String? role, String? status})>[];

  /// What `POST /team` says about the number: true when it already had an
  /// account and this practice was added to it.
  bool existing = false;
  Object? hireFails;
  Object? updateFails;

  @override
  Future<void> requestHireCode(String phone) async => sentTo.add(phone);

  @override
  Future<String> verifyHireCode(String phone, String code) async {
    checked.add((phone, code));
    return 'hire-token-for-$phone';
  }

  @override
  Future<bool> hire({
    required String role,
    required String name,
    required String phoneToken,
    String? password,
    String? departmentId,
    String? locationId,
    String? qualifications,
    String? registrationNo,
  }) async {
    if (hireFails != null) throw hireFails!;
    hired.add((role: role, name: name, phoneToken: phoneToken));
    return existing;
  }

  @override
  Future<void> updateMember(
    String membershipId, {
    String? role,
    Object? departmentId,
    Object? locationId,
    String? status,
  }) async {
    if (updateFails != null) throw updateFails!;
    updates.add((id: membershipId, role: role, status: status));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Registration's codes, recorded — which the hire sheet must no longer use.
class _Registration implements AuthRepository {
  final requested = <(String, String)>[];
  final verified = <(String, String)>[];

  @override
  Future<OtpSent> requestOtp({
    required String phone,
    required String purpose,
  }) async {
    requested.add((phone, purpose));
    return const OtpSent(
      expiresInSeconds: 600,
      resendAfterSeconds: 45,
      simulated: true,
    );
  }

  @override
  Future<String> verifyRegisterOtp({
    required String phone,
    required String code,
  }) async {
    verified.add((phone, code));
    return 'register-token';
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  // The app's own face for everything that takes it from the theme, so raised
  // text is laid out with real glyph widths. The role chips' labels do not
  // take it, and stay in the test font — whose glyphs are a full em wide, so
  // a name that fits here fits on a phone.
  setUpAll(() async {
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  late _Team team;
  late _Registration registration;

  setUp(() {
    team = _Team();
    registration = _Registration();
  });

  Future<void> open(
    WidgetTester tester,
    TeamRoster roster, {
    TextScaler textScaler = TextScaler.noScaling,
  }) async {
    // A 360dp phone, tall enough that the whole roster is laid out at once.
    tester.view.physicalSize = const Size(1080, 4200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          teamProvider.overrideWith((ref) async => roster),
          clinicianRepositoryProvider.overrideWithValue(team),
          authRepositoryProvider.overrideWithValue(registration),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          builder:
              (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(textScaler: textScaler),
                child: child!,
              ),
          home: const TeamScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openHireSheet(WidgetTester tester) async {
    await tester.tap(find.text('Add someone'));
    await tester.pumpAndSettle();
  }

  Future<void> openMember(WidgetTester tester, String name) async {
    await tester.tap(find.text(name));
    await tester.pumpAndSettle();
  }

  Future<void> tapInSheet(WidgetTester tester, String label) async {
    final target = find.text(label);
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  /// Sends a code to 98300 12345 and reads 123456 back.
  Future<void> verifyNumber(WidgetTester tester) async {
    final fields = find.descendant(
      of: find.byType(VerifiedPhoneField),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.first, '9830012345');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    await tester.enterText(fields.last, '123456');
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();
  }

  void expectEveryRole(WidgetTester tester) {
    expect(find.byType(ChoiceChip), findsNWidgets(_roleNames.length));
    expect(find.byType(SegmentedButton<String>), findsNothing);
    for (final name in _roleNames) {
      final chip = find.widgetWithText(ChoiceChip, name);
      expect(chip, findsOneWidget, reason: name);
      final rect = tester.getRect(chip);
      // A tap target, and all of it on the phone: wrapped, not cut off.
      expect(rect.height, greaterThanOrEqualTo(T.tap), reason: name);
      expect(rect.left, greaterThanOrEqualTo(0), reason: name);
      expect(rect.right, lessThanOrEqualTo(360), reason: name);
    }
  }

  group('the roster', () {
    testWidgets('shows a laboratory technician and a practice manager', (
      tester,
    ) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Bina Sen', 'lab_technician'),
          _member('Paresh Roy', 'practice_manager'),
        ]),
      );

      expect(find.text('Laboratory technicians'), findsOneWidget);
      expect(find.text('Bina Sen'), findsOneWidget);
      expect(find.text('Practice managers'), findsOneWidget);
      expect(find.text('Paresh Roy'), findsOneWidget);

      // What each may do, in words, and neither claims to prescribe.
      expect(
        find.text('Record results at the bench. They do not prescribe.'),
        findsOneWidget,
      );
      expect(
        find.textContaining('They cannot open a patient’s record.'),
        findsOneWidget,
      );
    });

    testWidgets('hides the extra groups nobody holds, and keeps the first three', (
      tester,
    ) async {
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));

      for (final heading in [
        'Doctor’s assistants',
        'Laboratory managers',
        'Laboratory technicians',
        'Practice managers',
        'Others',
      ]) {
        expect(find.text(heading), findsNothing, reason: heading);
      }

      expect(find.text('Doctors'), findsOneWidget);
      expect(find.text('Front desk'), findsOneWidget);
      expect(find.text('Dieticians'), findsOneWidget);
      // Nobody on the desk and no dietician are facts worth stating.
      expect(find.textContaining('Nobody yet.'), findsNWidgets(2));
    });

    testWidgets('puts a role it has no heading for under Others, named', (
      tester,
    ) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Mitali Das', 'ward_nurse'),
        ]),
      );

      expect(find.text('Others'), findsOneWidget);
      expect(find.text('Mitali Das'), findsOneWidget);
      expect(find.text('Ward nurse'), findsOneWidget);
    });
  });

  group('the role pickers', () {
    testWidgets('the hire sheet offers all seven, and only a doctor is asked '
        'for qualifications', (tester) async {
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));
      await openHireSheet(tester);

      expectEveryRole(tester);

      // Front desk is chosen to begin with.
      expect(find.widgetWithText(TextFormField, 'Qualifications'), findsNothing);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Laboratory manager'));
      await tester.pump();
      expect(find.widgetWithText(TextFormField, 'Qualifications'), findsNothing);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Doctor'));
      await tester.pump();
      expect(find.widgetWithText(TextFormField, 'Qualifications'), findsOneWidget);
      expect(
        find.widgetWithText(TextFormField, 'Registration number'),
        findsOneWidget,
      );
    });

    testWidgets('the edit sheet offers all seven, and says what a new role '
        'does to permissions', (tester) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      expectEveryRole(tester);
      expect(
        tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Front desk')).selected,
        isTrue,
      );

      await tester.tap(find.widgetWithText(ChoiceChip, 'Laboratory technician'));
      await tester.pump();
      expect(
        find.text(
          'Their permissions will change to the defaults for a laboratory '
          'technician.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a long role name wraps inside its chip at twice the text size', (
      tester,
    ) async {
      await open(
        tester,
        _roster([_member('Amit Dey', 'doctor', isOwner: true)]),
        textScaler: const TextScaler.linear(2),
      );
      await openHireSheet(tester);

      // Chosen, so the filled chip is measured too.
      await tester.tap(find.widgetWithText(ChoiceChip, 'Laboratory technician'));
      await tester.pumpAndSettle();

      for (final name in _roleNames) {
        final chipFinder = find.widgetWithText(ChoiceChip, name);
        // The chip's own label: "Front desk" is also a heading on the roster
        // behind the sheet.
        final labelFinder = find.descendant(
          of: chipFinder,
          matching: find.text(name),
        );
        final chip = tester.getRect(chipFinder);
        final text = tester.getRect(labelFinder);
        final label = tester.renderObject<RenderParagraph>(labelFinder);

        // All of the name: no line dropped, none cut off by the chip's height,
        // and every line inside the chip on the phone.
        expect(label.didExceedMaxLines, isFalse, reason: name);
        expect(
          label.size.height,
          greaterThanOrEqualTo(label.getMaxIntrinsicHeight(label.size.width) - 0.5),
          reason: name,
        );
        expect(text.top, greaterThanOrEqualTo(chip.top - 0.5), reason: name);
        expect(text.bottom, lessThanOrEqualTo(chip.bottom + 0.5), reason: name);
        expect(chip.right, lessThanOrEqualTo(360), reason: name);
        expect(chip.height, greaterThanOrEqualTo(T.tap), reason: name);
      }
      expect(tester.takeException(), isNull);
    });
  });

  group('the edit sheet', () {
    testWidgets('somebody who left opens suspended, and says how to bring them '
        'back', (tester) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff', status: 'left'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue,
      );
      expect(
        find.text(
          'They left this practice. Turn this off to give them their access '
          'back.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('somebody suspended opens suspended, with nothing about leaving', (
      tester,
    ) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff', status: 'suspended'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue,
      );
      expect(find.textContaining('They left this practice.'), findsNothing);
    });

    testWidgets('saving another change does not send somebody who left back in', (
      tester,
    ) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff', status: 'left'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      await tester.tap(find.widgetWithText(ChoiceChip, 'Doctor’s assistant'));
      await tester.pump();
      await tapInSheet(tester, 'Save');

      expect(team.updates, hasLength(1));
      expect(team.updates.single.role, 'doctor_assistant');
      // Not `active` — and nothing about status at all, since the switch was
      // never moved.
      expect(team.updates.single.status, isNull);
    });

    testWidgets('turning the switch off is what gives their access back', (
      tester,
    ) async {
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff', status: 'left'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
      expect(
        find.text('They left this practice. Saving gives them their access back.'),
        findsOneWidget,
      );

      await tapInSheet(tester, 'Save');
      expect(team.updates.single.status, 'active');
    });

    testWidgets('a practice at its limit is told so in the server’s words', (
      tester,
    ) async {
      team.updateFails = const ApiException(
        code: 'CONFLICT',
        message: 'This practice is at its limit of 12 people.',
        statusCode: 409,
      );
      await open(
        tester,
        _roster([
          _member('Amit Dey', 'doctor', isOwner: true),
          _member('Rina Paul', 'staff', status: 'left'),
        ]),
      );
      await openMember(tester, 'Rina Paul');

      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
      await tapInSheet(tester, 'Save');

      expect(find.text('This practice is at its limit of 12 people.'), findsOneWidget);
      expect(find.textContaining('ApiException'), findsNothing);
    });
  });

  group('hiring', () {
    testWidgets('sends and checks the code through the team, not registration', (
      tester,
    ) async {
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));
      await openHireSheet(tester);

      await verifyNumber(tester);

      expect(team.sentTo, ['+919830012345']);
      expect(team.checked, [('+919830012345', '123456')]);
      expect(registration.requested, isEmpty);
      expect(registration.verified, isEmpty);
      expect(find.byIcon(Icons.verified_rounded), findsOneWidget);
    });

    testWidgets('somebody who already uses MedPin is added, and told they keep '
        'their account', (tester) async {
      team.existing = true;
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));
      await openHireSheet(tester);

      expect(
        find.text(
          'If they already use MedPin, they keep their account and sign in as '
          'before.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Only for a new account'), findsOneWidget);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Doctor'));
      await tester.pump();
      await verifyNumber(tester);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Full name'),
        'Asha Roy',
      );
      await tapInSheet(tester, 'Add to the practice');

      expect(team.hired.single, (
        role: 'doctor',
        name: 'Asha Roy',
        phoneToken: 'hire-token-for-+919830012345',
      ));
      // The sheet has gone, and the screen says what happened.
      expect(find.text('Add to the practice'), findsNothing);
      expect(
        find.text(
          'They already use MedPin, so they keep their account and now work '
          'here too.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a new account is added without that message', (tester) async {
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));
      await openHireSheet(tester);

      await verifyNumber(tester);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Full name'),
        'Rina Paul',
      );
      await tapInSheet(tester, 'Add to the practice');

      expect(team.hired.single.role, 'staff');
      expect(find.text('Add to the practice'), findsNothing);
      expect(find.textContaining('already use MedPin, so'), findsNothing);
    });

    testWidgets('a refusal is shown in the server’s own sentence', (tester) async {
      team.hireFails = const ApiException(
        code: 'CONFLICT',
        message: 'This number belongs to a patient, so it cannot be added as staff.',
        statusCode: 409,
      );
      await open(tester, _roster([_member('Amit Dey', 'doctor', isOwner: true)]));
      await openHireSheet(tester);

      await verifyNumber(tester);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Full name'),
        'Rina Paul',
      );
      await tapInSheet(tester, 'Add to the practice');

      expect(
        find.text('This number belongs to a patient, so it cannot be added as staff.'),
        findsOneWidget,
      );
      expect(find.textContaining('ApiException'), findsNothing);
      // Still on the sheet, where it can be put right.
      expect(find.text('Add to the practice'), findsOneWidget);
    });
  });

  group('VerifiedPhoneField without callbacks', () {
    testWidgets('still asks registration for the code, exactly as before', (
      tester,
    ) async {
      String? token;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authRepositoryProvider.overrideWithValue(registration)],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: Padding(
                padding: const EdgeInsets.all(T.s4),
                child: VerifiedPhoneField(onToken: (t) => token = t),
              ),
            ),
          ),
        ),
      );

      await tester.enterText(find.byType(TextField), '9830012345');
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(registration.requested, [('+919830012345', 'register')]);

      await tester.enterText(find.byType(TextField).last, '654321');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();
      expect(registration.verified, [('+919830012345', '654321')]);
      expect(token, 'register-token');
    });
  });
}
