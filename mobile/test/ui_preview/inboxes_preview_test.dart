import 'dart:async';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/features/auth/domain/user.dart';
import 'package:akd_care/features/clinician/domain/chat_review.dart';
import 'package:akd_care/features/clinician/domain/chat_summary.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/clinician/presentation/chat_review_detail_screen.dart';
import 'package:akd_care/features/clinician/presentation/chat_review_screen.dart';
import 'package:akd_care/features/clinician/presentation/chat_summaries_screen.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/nutrition_inbox_screen.dart';
import 'package:akd_care/features/clinician/presentation/patient_thread_screen.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'desk_fixtures.dart';
import 'fake_api.dart';
import 'inbox_fixtures.dart';
import 'preview_harness.dart';

/// The clinic's inboxes, drawn busy, crowded, empty, loading, failed, stale,
/// at a large text size, and for a role that may not read them.
///
/// Run: flutter test test/ui_preview/inboxes_preview_test.dart
/// Look: build/ui_previews/inboxes/*.png
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'inboxes';

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

  /// A laboratory technician: in the clinician area, no conversations.
  const labTechnician = Capabilities(
    resolved: true,
    practiceType: 'polyclinic',
    specialty: null,
    plan: null,
    practice: {Cap.aiAssistant},
    effective: {Cap.aiAssistant},
    role: 'lab_technician',
    isOwner: false,
    permissions: {Perm.viewPatient},
  );

  List<Override> common({JsonRoute? api, Capabilities? caps}) => [
    ...baseOverrides(),
    ...signedInAs(doctor),
    apiClientProvider.overrideWithValue(
      FakeApi(
        api ??
            (path, query) {
              if (path.endsWith('/thread')) return threadJson();
              if (path.endsWith('/assistant')) {
                return {'assistantEnabled': true, 'heldByPresence': false};
              }
              return const <String, dynamic>{};
            },
      ),
    ),
    brandClinicProvider.overrideWith((ref) async => deskClinic),
    overviewProvider.overrideWith((ref) async => overview(unread: 3)),
    patientSummaryProvider.overrideWith(
      (ref, id) => Completer<PatientSummary>().future,
    ),
    if (caps != null) capabilitySetProvider.overrideWith((ref) => caps),
  ];

  Future<void> open(
    WidgetTester tester,
    Widget screen,
    List<Override> overrides, {
    double height = 780,
    PreviewScale scale = PreviewScale.production,
    bool settle = true,
  }) async {
    usePhone(tester, height: height);
    await tester.pumpWidget(
      previewApp(overrides: overrides, home: screen, scale: scale),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await pumpFrames(tester);
    }
  }

  // ---- conversation summaries --------------------------------------------

  Override summaries(FutureOr<ChatSummaryDay> Function() day) =>
      chatSummariesProvider.overrideWith((ref, q) async => await day());

  testWidgets('summaries, busy', (tester) async {
    await open(tester, const ChatSummariesScreen(), [
      ...common(),
      summaries(busySummaries),
    ], height: 2000);
    await snap(tester, area, 'summaries_busy');
  });

  testWidgets('summaries, nobody wrote', (tester) async {
    await open(tester, const ChatSummariesScreen(), [
      ...common(),
      summaries(() => summaryDay(const [])),
    ]);
    await snap(tester, area, 'summaries_empty');
  });

  testWidgets('summaries, loading', (tester) async {
    await open(tester, const ChatSummariesScreen(), [
      ...common(),
      summaries(() => Completer<ChatSummaryDay>().future),
    ], settle: false);
    await snap(tester, area, 'summaries_loading');
  });

  testWidgets('summaries, failed', (tester) async {
    await open(tester, const ChatSummariesScreen(), [
      ...common(),
      summaries(() => throw offline),
    ]);
    await snap(tester, area, 'summaries_failed');
  });

  testWidgets('summaries, not this role', (tester) async {
    await open(tester, const ChatSummariesScreen(), [
      ...common(caps: labTechnician),
      summaries(busySummaries),
    ]);
    await snap(tester, area, 'summaries_role');
  });

  // ---- chat review ---------------------------------------------------------

  Override review(FutureOr<Paged<ChatReviewSession>> Function() list) =>
      chatReviewProvider.overrideWith((ref, q) async => await list());

  testWidgets('review, flagged', (tester) async {
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(() => pagedSessions(flaggedSessions())),
    ], height: 1100);
    await snap(tester, area, 'review_busy');
  });

  testWidgets('review, forty conversations', (tester) async {
    await open(tester, const ChatReviewScreen(initialTab: 'all'), [
      ...common(),
      review(() => pagedSessions(manySessions(40), hasMore: true)),
    ], height: 1400);
    await snap(tester, area, 'review_many');
  });

  testWidgets('review, nothing flagged', (tester) async {
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(() => pagedSessions(const [])),
    ]);
    await snap(tester, area, 'review_empty');
  });

  testWidgets('review, loading', (tester) async {
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(() => Completer<Paged<ChatReviewSession>>().future),
    ], settle: false);
    await snap(tester, area, 'review_loading');
  });

  testWidgets('review, failed', (tester) async {
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(() => throw offline),
    ]);
    await snap(tester, area, 'review_failed');
  });

  testWidgets('review, a refresh failed', (tester) async {
    var failing = false;
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(() => failing ? throw offline : pagedSessions(flaggedSessions())),
    ], height: 1100);
    failing = true;
    containerOf(
      tester,
      find.byType(ChatReviewScreen),
    ).invalidate(chatReviewProvider);
    await tester.pumpAndSettle();
    await snap(tester, area, 'review_stale');
  });

  testWidgets('review, refused by the server', (tester) async {
    await open(tester, const ChatReviewScreen(), [
      ...common(),
      review(
        () =>
            throw const ApiException(
              code: 'FORBIDDEN',
              message: 'Your role at this practice does not allow that',
              statusCode: 403,
            ),
      ),
    ]);
    await snap(tester, area, 'review_role');
  });

  testWidgets('review, text at 1.3', (tester) async {
    await open(
      tester,
      const ChatReviewScreen(),
      [...common(), review(() => pagedSessions(flaggedSessions()))],
      scale: PreviewScale.large,
      height: 1500,
    );
    await snap(tester, area, 'review_large_text');
  });

  testWidgets('review detail', (tester) async {
    await open(tester, const ChatReviewDetailScreen(sessionId: 's2'), [
      ...common(),
      chatReviewDetailProvider.overrideWith((ref, id) async => flaggedDetail()),
    ], height: 1500);
    await snap(tester, area, 'review_detail');
  });

  testWidgets('review detail, failed', (tester) async {
    await open(tester, const ChatReviewDetailScreen(sessionId: 's2'), [
      ...common(),
      chatReviewDetailProvider.overrideWith((ref, id) async => throw offline),
    ]);
    await snap(tester, area, 'review_detail_failed');
  });

  testWidgets('review detail, may read and not reply', (tester) async {
    await open(tester, const ChatReviewDetailScreen(sessionId: 's2'), [
      ...common(
        caps: labTechnician.copyWithPermissions(const {
          Perm.viewPatient,
          Perm.chatRead,
        }),
      ),
      chatReviewDetailProvider.overrideWith((ref, id) async => flaggedDetail()),
    ]);
    await snap(tester, area, 'review_detail_read_only');
  });

  // ---- the patient thread ----------------------------------------------------

  testWidgets('thread', (tester) async {
    await open(
      tester,
      const PatientThreadScreen(
        patientId: 'patient-kalyani',
        patientName: 'Kalyani Bandyopadhyay',
      ),
      common(),
      settle: false,
    );
    await snap(tester, area, 'thread');
  });

  testWidgets('thread, no messages yet', (tester) async {
    await open(
      tester,
      const PatientThreadScreen(
        patientId: 'patient-new',
        patientName: 'Rina Paul',
      ),
      common(
        api: (path, query) {
          if (path.endsWith('/thread')) return threadJson(empty: true);
          return const <String, dynamic>{};
        },
      ),
      settle: false,
    );
    await snap(tester, area, 'thread_empty');
  });

  testWidgets('thread, failed', (tester) async {
    await open(
      tester,
      const PatientThreadScreen(
        patientId: 'patient-x',
        patientName: 'Rina Paul',
      ),
      common(
        api: (path, query) {
          if (path.endsWith('/thread')) throw offline;
          return const <String, dynamic>{};
        },
      ),
      settle: false,
    );
    await snap(tester, area, 'thread_failed');
  });

  testWidgets('thread, a refresh failed', (tester) async {
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
    failing = true;
    // The two-second poll meets the failure.
    await tester.pump(const Duration(seconds: 3));
    await pumpFrames(tester);
    await snap(tester, area, 'thread_stale');
  });

  testWidgets('thread, not this role', (tester) async {
    await open(
      tester,
      const PatientThreadScreen(
        patientId: 'patient-kalyani',
        patientName: 'Kalyani Bandyopadhyay',
      ),
      common(caps: labTechnician),
      settle: false,
    );
    await snap(tester, area, 'thread_role');
  });

  // ---- the nutrition inbox -----------------------------------------------------

  testWidgets('nutrition, busy', (tester) async {
    await open(tester, const NutritionInboxScreen(), [
      ...common(),
      review(() => pagedSessions(nutritionSessions())),
    ], settle: false);
    await snap(tester, area, 'nutrition_busy');
  });

  testWidgets('nutrition, empty', (tester) async {
    await open(tester, const NutritionInboxScreen(), [
      ...common(),
      review(() => pagedSessions(const [])),
    ], settle: false);
    await snap(tester, area, 'nutrition_empty');
  });

  testWidgets('nutrition, failed', (tester) async {
    await open(tester, const NutritionInboxScreen(), [
      ...common(),
      review(() => throw offline),
    ], settle: false);
    await snap(tester, area, 'nutrition_failed');
  });

  testWidgets('nutrition, not this role', (tester) async {
    await open(tester, const NutritionInboxScreen(), [
      ...common(caps: labTechnician),
      review(() => pagedSessions(nutritionSessions())),
    ], settle: false);
    await snap(tester, area, 'nutrition_role');
  });
}

extension on Capabilities {
  Capabilities copyWithPermissions(Set<String> permissions) => Capabilities(
    resolved: resolved,
    practiceType: practiceType,
    specialty: specialty,
    plan: plan,
    practice: practice,
    effective: effective,
    role: role,
    isOwner: isOwner,
    permissions: permissions,
  );
}
