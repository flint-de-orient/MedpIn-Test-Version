import 'dart:async';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/features/auth/domain/user.dart';
import 'package:akd_care/features/clinician/domain/chat_review.dart';
import 'package:akd_care/features/clinician/domain/chat_summary.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/clinician/presentation/chat_review_screen.dart';
import 'package:akd_care/features/clinician/presentation/chat_summaries_screen.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/nutrition_inbox_screen.dart';
import 'package:akd_care/features/clinician/presentation/patient_thread_screen.dart';
import 'package:akd_care/features/clinician/presentation/widgets/inbox_states.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:akd_care/shared/widgets/user_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_preview/desk_fixtures.dart';
import 'ui_preview/fake_api.dart';
import 'ui_preview/inbox_fixtures.dart';
import 'ui_preview/preview_harness.dart';

/// The clinic's inboxes keep four states apart and never trade a real list
/// for a blank one.
///
///   - a role without access to conversations is told so, not that the load
///     failed, and nothing is fetched on its behalf;
///   - a failed first load says it failed; a failed refresh keeps the list
///     and says since when;
///   - who spoke last is named truly — the assistant is never "You";
///   - urgency and unread are words, not only colours;
///   - an empty day says what it means and offers the next look.
void main() {
  setUpAll(loadPreviewFonts);

  const doctor = AppUser(
    id: 'u-doc',
    name: 'Dr. Amit Dey',
    phone: '+919830000001',
    role: 'doctor',
    language: 'en',
  );

  const offline = ApiException(
    code: 'NETWORK_ERROR',
    message: 'Could not reach the server',
  );

  const refused = ApiException(
    code: 'FORBIDDEN',
    message: 'Your role at this practice does not allow that',
    statusCode: 403,
  );

  Capabilities member(Set<String> permissions) => Capabilities(
    resolved: true,
    practiceType: 'polyclinic',
    specialty: null,
    plan: null,
    practice: const {Cap.aiAssistant},
    effective: const {Cap.aiAssistant},
    role: 'lab_technician',
    isOwner: false,
    permissions: permissions,
  );

  List<Override> common({Capabilities? caps, JsonRoute? api}) => [
    ...baseOverrides(),
    ...signedInAs(doctor),
    apiClientProvider.overrideWithValue(
      FakeApi(
        api ??
            (path, query) =>
                path.endsWith('/thread')
                    ? threadJson()
                    : const <String, dynamic>{},
      ),
    ),
    brandClinicProvider.overrideWith((ref) async => deskClinic),
    overviewProvider.overrideWith((ref) async => overview()),
    patientSummaryProvider.overrideWith(
      (ref, id) => Completer<PatientSummary>().future,
    ),
    if (caps != null) capabilitySetProvider.overrideWith((ref) => caps),
  ];

  Future<void> open(
    WidgetTester tester,
    Widget screen,
    List<Override> overrides, {
    bool settle = true,
  }) async {
    usePhone(tester, height: 2400);
    await tester.pumpWidget(previewApp(overrides: overrides, home: screen));
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await pumpFrames(tester);
    }
  }

  group('who may read conversations', () {
    test('unknown, or no membership, asks the server rather than refusing', () {
      expect(mayReadConversations(Capabilities.unknown), isTrue);
      const noMembership = Capabilities(
        resolved: true,
        practiceType: null,
        specialty: null,
        plan: null,
        practice: {},
        effective: {},
        role: null,
        isOwner: false,
      );
      // The server lets an account with no membership through; saying "not
      // your role" to it would be a refusal the server never made.
      expect(mayReadConversations(noMembership), isTrue);
    });

    test('a membership without the grant may not; with it, may', () {
      expect(mayReadConversations(member(const {Perm.viewPatient})), isFalse);
      expect(mayReadConversations(member(const {Perm.chatRead})), isTrue);
      expect(mayReplyInConversations(member(const {Perm.chatRead})), isFalse);
    });

    test('a title is not an initial', () {
      expect(nameForInitial('Dr. Amit Dey'), 'Amit Dey');
      expect(nameForInitial('dr amit dey'), 'amit dey');
      expect(nameForInitial('Drishti Sen'), 'Drishti Sen');
      expect(nameForInitial('Dr.'), 'Dr.');
    });
  });

  group('chat review', () {
    testWidgets('a role without conversations is told so, and nothing is '
        'fetched', (tester) async {
      var fetched = 0;
      await open(tester, const ChatReviewScreen(), [
        ...common(caps: member(const {Perm.viewPatient})),
        chatReviewProvider.overrideWith((ref, q) async {
          fetched++;
          return pagedSessions(flaggedSessions());
        }),
      ]);

      expect(find.text('Not available to your role'), findsOneWidget);
      expect(find.textContaining('Could not load'), findsNothing);
      expect(fetched, 0);
    });

    testWidgets('the server’s refusal reads as the role, not the network', (
      tester,
    ) async {
      await open(tester, const ChatReviewScreen(), [
        ...common(),
        chatReviewProvider.overrideWith((ref, q) async => throw refused),
      ]);
      expect(find.text('Not available to your role'), findsOneWidget);
      expect(find.textContaining('Could not load'), findsNothing);
    });

    testWidgets('a failed first load says it failed', (tester) async {
      await open(tester, const ChatReviewScreen(), [
        ...common(),
        chatReviewProvider.overrideWith((ref, q) async => throw offline),
      ]);
      expect(find.text('Could not load the conversations'), findsOneWidget);
      expect(find.text('Nothing flagged'), findsNothing);
    });

    testWidgets('a failed refresh keeps the list and says since when', (
      tester,
    ) async {
      var failing = false;
      await open(tester, const ChatReviewScreen(), [
        ...common(),
        chatReviewProvider.overrideWith(
          (ref, q) async =>
              failing ? throw offline : pagedSessions(flaggedSessions()),
        ),
      ]);
      expect(find.text('Raj Dhara'), findsOneWidget);

      failing = true;
      containerOf(
        tester,
        find.byType(ChatReviewScreen),
      ).invalidate(chatReviewProvider);
      await tester.pumpAndSettle();

      expect(find.text('Raj Dhara'), findsOneWidget);
      expect(find.text('Could not refresh the conversations'), findsOneWidget);
      expect(find.textContaining('Showing what loaded at'), findsOneWidget);
      expect(find.text('Could not load the conversations'), findsNothing);
    });

    testWidgets('the last speaker is named truly, and urgency is a word', (
      tester,
    ) async {
      await open(tester, const ChatReviewScreen(), [
        ...common(),
        chatReviewProvider.overrideWith(
          (ref, q) async => pagedSessions(flaggedSessions()),
        ),
      ]);

      expect(find.textContaining('You:'), findsNothing);
      expect(find.textContaining('Assistant: Please do not'), findsOneWidget);
      expect(find.textContaining('Clinic: Bring the report'), findsOneWidget);
      expect(find.text('Emergency'), findsOneWidget);
      expect(find.text('Urgent'), findsOneWidget);
      expect(find.text('3 unread'), findsOneWidget);
    });

    testWidgets('nothing flagged explains itself and offers the rest', (
      tester,
    ) async {
      await open(tester, const ChatReviewScreen(), [
        ...common(),
        chatReviewProvider.overrideWith(
          (ref, q) async =>
              q.flagged
                  ? pagedSessions(const [])
                  : pagedSessions(flaggedSessions()),
        ),
      ]);

      expect(find.text('Nothing flagged'), findsOneWidget);
      await tester.tap(find.text('Show all conversations'));
      await tester.pumpAndSettle();
      expect(find.text('Raj Dhara'), findsOneWidget);
    });
  });

  group('conversation summaries', () {
    testWidgets('an empty day says what it means and offers the practice', (
      tester,
    ) async {
      await open(tester, const ChatSummariesScreen(), [
        ...common(),
        chatSummariesProvider.overrideWith(
          (ref, q) async =>
              q.scope == 'mine' ? summaryDay(const []) : busySummaries(),
        ),
      ]);

      expect(find.text('None of your patients wrote today.'), findsOneWidget);
      await tester.tap(find.text('Show the whole practice'));
      await tester.pumpAndSettle();
      expect(find.text('Raj Dhara'), findsOneWidget);
    });

    testWidgets('a role without conversations is told so', (tester) async {
      await open(tester, const ChatSummariesScreen(), [
        ...common(caps: member(const {Perm.viewPatient})),
        chatSummariesProvider.overrideWith((ref, q) async => busySummaries()),
      ]);
      expect(find.text('Not available to your role'), findsOneWidget);
      expect(find.text('Raj Dhara'), findsNothing);
    });
  });

  group('nutrition inbox', () {
    testWidgets('the doctor’s avatar takes the name’s initial, not the '
        'title’s', (tester) async {
      await open(tester, const NutritionInboxScreen(), [
        ...common(),
        chatReviewProvider.overrideWith(
          (ref, q) async => pagedSessions(nutritionSessions()),
        ),
      ], settle: false);

      final avatars = tester.widgetList<UserAvatar>(find.byType(UserAvatar));
      expect(avatars.any((a) => a.name == 'Amit Dey'), isTrue);
      expect(avatars.any((a) => a.name.startsWith('Dr')), isFalse);
      // The clinic's name heads the tab, not the product's.
      expect(find.textContaining('MedPin'), findsNothing);
      expect(
        find.text('Dr. Dey’s Diabetes Obesity & Metabolic Clinic'),
        findsOneWidget,
      );
      // Urgency in words, not a red rail alone.
      expect(find.text('Urgent'), findsOneWidget);
    });
  });

  group('patient thread', () {
    testWidgets('a poll that fails keeps the messages and marks them', (
      tester,
    ) async {
      var failing = false;
      await open(
        tester,
        const PatientThreadScreen(
          patientId: 'patient-kalyani',
          patientName: 'Kalyani Bandyopadhyay',
        ),
        common(
          api: (path, query) {
            if (path.endsWith('/thread')) {
              if (failing) throw offline;
              return threadJson();
            }
            return const <String, dynamic>{};
          },
        ),
        settle: false,
      );
      expect(
        find.textContaining('Please come in on Friday evening'),
        findsOneWidget,
      );

      failing = true;
      await tester.pump(const Duration(seconds: 3));
      await pumpFrames(tester);

      expect(
        find.textContaining('Please come in on Friday evening'),
        findsOneWidget,
      );
      expect(find.text('Could not refresh the conversation'), findsOneWidget);
      expect(find.text('Could not load the conversation'), findsNothing);
    });

    testWidgets('a role that may read but not reply gets no composer', (
      tester,
    ) async {
      await open(
        tester,
        const PatientThreadScreen(
          patientId: 'patient-kalyani',
          patientName: 'Kalyani Bandyopadhyay',
        ),
        common(caps: member(const {Perm.viewPatient, Perm.chatRead})),
        settle: false,
      );

      expect(
        find.text('Your role can read this conversation but not reply to it.'),
        findsOneWidget,
      );
      expect(find.byType(TextField), findsNothing);
    });
  });
}
