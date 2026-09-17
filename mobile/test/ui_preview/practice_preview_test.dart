import 'dart:async';

import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/features/clinician/data/billing_repository.dart';
import 'package:medpin/features/clinician/data/practice_repository.dart';
import 'package:medpin/features/clinician/domain/billing.dart';
import 'package:medpin/features/clinician/domain/department.dart';
import 'package:medpin/features/clinician/domain/knowledge_chunk.dart';
import 'package:medpin/features/clinician/domain/practice.dart';
import 'package:medpin/features/clinician/presentation/billing_screen.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/departments_screen.dart';
import 'package:medpin/features/clinician/presentation/knowledge_edit_screen.dart';
import 'package:medpin/features/clinician/presentation/knowledge_screen.dart';
import 'package:medpin/features/clinician/presentation/practice_screen.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_api.dart';
import 'staff_preview_harness.dart';

/// The practice's own screens: the practice, its plan, its knowledge base and
/// its departments.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'practice';

  Capabilities caps({
    Set<String> permissions = const {Perm.manageStaff, Perm.manageDepartment},
    Set<String> practice = const {Cap.department, Cap.aiAssistant},
    Set<String>? effective,
  }) => Capabilities(
    resolved: true,
    practiceType: 'polyclinic',
    specialty: null,
    plan: 'trial',
    practice: practice,
    effective: effective ?? practice,
    role: 'doctor',
    isOwner: true,
    permissions: permissions,
  );

  List<Override> common({Capabilities? capabilities}) => [
    ...baseOverrides(),
    apiClientProvider.overrideWithValue(
      FakeApi((path, query) {
        if (path == '/doctor/settings') return {'dietReviewIntervalDays': 14};
        return const <String, dynamic>{};
      }),
    ),
    capabilitySetProvider.overrideWith((ref) => capabilities ?? caps()),
    planPricesProvider.overrideWith((ref) async => const <PlanPrice>[]),
    billingHistoryProvider.overrideWith(
      (ref) async => const BillingHistory(payments: [], invoices: []),
    ),
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

  // ---- practice ----------------------------------------------------------------

  PracticeOverview practice({bool complete = false}) => PracticeOverview(
    id: 'pr-1',
    name: 'Dr. Dey’s Diabetes Obesity & Metabolic Clinic',
    tagline: 'Diabetes, thyroid and weight care',
    doctorDisplayName: 'Dr. Amit Kumar Dey',
    registrationNo: complete ? 'WBMC 64521' : null,
    logoLightUrl: null,
    verification: 'unverified',
    gaps:
        complete
            ? const []
            : const [
              PracticeGap(
                key: 'registrationNo',
                label: 'Registration number',
                prints:
                    'Printed under the doctor’s name on every prescription.',
                blocking: true,
              ),
              PracticeGap(
                key: 'address',
                label: 'Address',
                prints:
                    'Printed in the letterhead so a pharmacist can verify it.',
                blocking: true,
              ),
              PracticeGap(
                key: 'tagline',
                label: 'Tagline',
                prints: 'The line under the practice name.',
                blocking: false,
              ),
              PracticeGap(
                key: 'logo',
                label: 'Logo',
                prints: 'Printed at the top of the letterhead.',
                blocking: false,
              ),
            ],
    canPrintPrescription: complete,
    locations: const [
      PracticeLocation(
        id: 'l1',
        name: 'Salt Lake',
        city: 'Kolkata',
        isActive: true,
        overridesBrand: false,
        weeklyHourCount: 6,
      ),
      PracticeLocation(
        id: 'l2',
        name: 'Behala',
        city: 'Kolkata',
        isActive: true,
        overridesBrand: true,
        weeklyHourCount: 0,
      ),
      PracticeLocation(
        id: 'l3',
        name: 'Garia (old chamber)',
        city: 'Kolkata',
        isActive: false,
        overridesBrand: false,
        weeklyHourCount: 2,
      ),
    ],
    doctors: 2,
    staff: 3,
    dieticians: 1,
  );

  List<Department> departments() => const [
    Department(
      id: 'd1',
      key: 'diabetic_foot_clinic',
      name: 'Diabetic Foot Clinic',
      isShared: false,
      isActive: true,
      hasAssistant: true,
      widgets: ['a', 'b', 'c', 'd', 'e'],
      usingDefault: false,
    ),
    Department(
      id: 'd2',
      key: 'weight_management',
      name: 'Weight Management',
      isShared: false,
      isActive: false,
      widgets: ['a', 'b', 'c'],
    ),
    Department(
      id: 's1',
      key: 'cardiology',
      name: 'Cardiology',
      isShared: true,
      isActive: true,
      hasAssistant: true,
      widgets: ['a', 'b', 'c', 'd', 'e', 'f'],
    ),
    Department(
      id: 's2',
      key: 'diabetology',
      name: 'Diabetology',
      isShared: true,
      isActive: true,
      hasAssistant: true,
      widgets: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    ),
    Department(
      id: 's3',
      key: 'general_medicine',
      name: 'General Medicine',
      isShared: true,
      isActive: true,
      widgets: ['a', 'b', 'c', 'd'],
    ),
  ];

  testWidgets('practice, gaps to fill', (tester) async {
    await open(tester, const PracticeScreen(), [
      ...common(),
      practiceOverviewProvider.overrideWith((ref) async => practice()),
      departmentsProvider.overrideWith((ref) async => departments()),
    ], height: 1700);
    await snap(tester, area, 'practice_gaps');
  });

  testWidgets('practice, complete', (tester) async {
    await open(tester, const PracticeScreen(), [
      ...common(),
      practiceOverviewProvider.overrideWith(
        (ref) async => practice(complete: true),
      ),
      departmentsProvider.overrideWith((ref) async => departments()),
    ]);
    await snap(tester, area, 'practice_complete');
  });

  testWidgets('practice, failed', (tester) async {
    await open(tester, const PracticeScreen(), [
      ...common(),
      practiceOverviewProvider.overrideWith(
        (ref) async => throw Exception('offline'),
      ),
      departmentsProvider.overrideWith((ref) async => departments()),
    ]);
    await snap(tester, area, 'practice_failed');
  });

  testWidgets('practice, loading', (tester) async {
    await open(tester, const PracticeScreen(), [
      ...common(),
      practiceOverviewProvider.overrideWith(
        (ref) => Completer<PracticeOverview?>().future,
      ),
      departmentsProvider.overrideWith((ref) async => departments()),
    ], settle: false);
    await snap(tester, area, 'practice_loading');
  });

  // ---- billing -----------------------------------------------------------------

  BillingStatus billing({bool capped = false}) => BillingStatus.fromJson({
    'plan': capped ? 'essential' : 'trial',
    if (capped) 'limits': {'patients': 1000, 'staff': 10, 'locations': 1},
    'usage': {
      'patients': capped ? 912 : 312,
      'staff': capped ? 10 : 6,
      'locations': 1,
    },
    'renewsOn': DateTime.now().add(const Duration(days: 12)).toIso8601String(),
    if (capped)
      'subscription': {
        'id': 'sub_1',
        'plan': 'essential',
        'status': 'active',
        'confirmedAt':
            DateTime.now().subtract(const Duration(hours: 5)).toIso8601String(),
      },
    'canPay': true,
    'testMode': !capped,
    'hasPractice': true,
  });

  testWidgets('billing, uncapped trial', (tester) async {
    await open(tester, const BillingScreen(), [
      ...common(),
      billingStatusProvider.overrideWith((ref) async => billing()),
    ], height: 2300);
    await snap(tester, area, 'billing_trial');
  });

  testWidgets('billing, capped and nearly full', (tester) async {
    await open(tester, const BillingScreen(), [
      ...common(),
      billingStatusProvider.overrideWith((ref) async => billing(capped: true)),
    ], height: 2400);
    await snap(tester, area, 'billing_capped');
  });

  testWidgets('billing, failed', (tester) async {
    await open(tester, const BillingScreen(), [
      ...common(),
      billingStatusProvider.overrideWith(
        (ref) async => throw Exception('offline'),
      ),
    ]);
    await snap(tester, area, 'billing_failed');
  });

  testWidgets('billing, text at 1.3', (tester) async {
    await open(
      tester,
      const BillingScreen(),
      [
        ...common(),
        billingStatusProvider.overrideWith(
          (ref) async => billing(capped: true),
        ),
      ],
      height: 3000,
      scale: PreviewScale.large,
    );
    await snap(tester, area, 'billing_large_text');
  });

  // ---- knowledge -----------------------------------------------------------------

  KnowledgeChunk chunk(
    String id,
    String title,
    String status, {
    bool shared = false,
    bool embedded = true,
    String language = 'en',
    String category = 'diet',
    int version = 1,
  }) => KnowledgeChunk.fromJson({
    'id': id,
    'docId': 'doc-$id',
    'title': title,
    'content':
        'Eat three small meals and two snacks at the same times each day. '
        'Keep rice to one katori and fill half the plate with vegetables.',
    'language': language,
    'category': category,
    'status': status,
    'version': version,
    'hasEmbedding': embedded,
    'isShared': shared,
  });

  List<KnowledgeChunk> chunks() => [
    chunk(
      'k1',
      'Low sugar at night',
      'approved',
      category: 'hypoglycaemia',
      version: 3,
    ),
    chunk(
      'k2',
      'Rice and roti portions for a diabetic plate',
      'pending_review',
    ),
    chunk('k3', 'Foot care in the monsoon', 'draft', category: 'foot_care'),
    chunk(
      'k4',
      'Sick day rules when you cannot eat',
      'approved',
      shared: true,
      category: 'sick_day_rules',
      version: 2,
    ),
    chunk(
      'k5',
      'Insulin storage while travelling',
      'approved',
      embedded: false,
      category: 'insulin',
    ),
    chunk('k6', 'Old fasting guidance', 'retired', language: 'bn'),
  ];

  Paged<KnowledgeChunk> pagedChunks(List<KnowledgeChunk> items) => Paged(
    items: items,
    page: 1,
    limit: 100,
    total: items.length,
    hasMore: false,
  );

  testWidgets('knowledge, busy', (tester) async {
    await open(tester, const KnowledgeScreen(), [
      ...common(),
      knowledgeProvider.overrideWith((ref, q) async => pagedChunks(chunks())),
    ], height: 1500);
    await snap(tester, area, 'knowledge_busy');
  });

  testWidgets('knowledge, empty', (tester) async {
    await open(tester, const KnowledgeScreen(), [
      ...common(),
      knowledgeProvider.overrideWith((ref, q) async => pagedChunks(const [])),
    ]);
    await snap(tester, area, 'knowledge_empty');
  });

  testWidgets('knowledge, failed', (tester) async {
    await open(tester, const KnowledgeScreen(), [
      ...common(),
      knowledgeProvider.overrideWith(
        (ref, q) async => throw Exception('offline'),
      ),
    ]);
    await snap(tester, area, 'knowledge_failed');
  });

  testWidgets('knowledge, new entry', (tester) async {
    await open(tester, const KnowledgeEditScreen(), common(), height: 1300);
    await snap(tester, area, 'knowledge_new');
  });

  testWidgets('knowledge, editing one waiting for approval', (tester) async {
    await open(
      tester,
      KnowledgeEditScreen(chunk: chunks()[1]),
      common(),
      height: 1400,
    );
    await snap(tester, area, 'knowledge_edit_pending');
  });

  testWidgets('knowledge, a shared entry', (tester) async {
    await open(
      tester,
      KnowledgeEditScreen(chunk: chunks()[3]),
      common(),
      height: 1400,
    );
    await snap(tester, area, 'knowledge_shared');
  });

  // ---- departments ---------------------------------------------------------------

  testWidgets('departments, managed', (tester) async {
    await open(tester, const DepartmentsScreen(), [
      ...common(),
      departmentsProvider.overrideWith((ref) async => departments()),
    ], height: 1300);
    await snap(tester, area, 'departments_manage');
  });

  testWidgets('departments, read only', (tester) async {
    await open(tester, const DepartmentsScreen(), [
      ...common(capabilities: caps(permissions: const {})),
      departmentsProvider.overrideWith((ref) async => departments()),
    ], height: 1300);
    await snap(tester, area, 'departments_read_only');
  });

  testWidgets('departments, failed', (tester) async {
    await open(tester, const DepartmentsScreen(), [
      ...common(),
      departmentsProvider.overrideWith(
        (ref) async => throw Exception('offline'),
      ),
    ]);
    await snap(tester, area, 'departments_failed');
  });
}
