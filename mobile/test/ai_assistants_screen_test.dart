import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/clinician/data/clinician_repository.dart';
import 'package:medpin/features/clinician/domain/ai_assistant.dart';
import 'package:medpin/features/clinician/presentation/ai_assistants_screen.dart';

/// The doctor's AI assistants screen.
///
/// The rule it must never break: it shows ON only when the server says ON.
/// Everything it does is followed by a fresh read from the server, and these
/// tests make the server disagree with what the screen just asked for, to prove
/// the screen believes the server.

Map<String, dynamic> _json({
  String state = 'off',
  String reason = 'scope_not_approved',
  bool canApprove = true,
  bool canWithdraw = false,
  Map<String, dynamic>? approval,
  List<Map<String, String>> notes = const [
    {'title': 'Angina that is getting worse', 'detail': 'The drafts say same day; ESC says emergency.'},
  ],
}) => {
  'department': {'id': 'dep-cardio', 'key': 'cardiology', 'name': 'Cardiologist'},
  'state': state,
  'enabled': state == 'on',
  'reason': state == 'on' ? 'enabled' : reason,
  'knowledgeVersion': 'abc123def456',
  'scopeText': {
    'role': 'the cardiology assistant',
    'covers': ['High blood pressure and its treatment.', 'Heart failure self-care.'],
    'refuses': ['Changing any medicine or dose.'],
    'redFlags': ['Chest pain that does not go away.', 'Fainting with a pounding heartbeat.'],
    'sources': [{}, {}, {}],
    'version': 1,
    'isAiDrafted': true,
  },
  'knowledge': {
    'approved': {'total': state == 'on' ? 105 : 0, 'byLanguage': {'en': state == 'on' ? 35 : 0, 'bn': state == 'on' ? 35 : 0, 'hi': state == 'on' ? 35 : 0}},
    'pending': {'total': state == 'on' ? 0 : 105, 'byLanguage': {'en': state == 'on' ? 0 : 35, 'bn': state == 'on' ? 0 : 35, 'hi': state == 'on' ? 0 : 35}},
  },
  'reviewNotes': notes,
  'approval': approval,
  'canApprove': canApprove,
  'canWithdraw': canWithdraw,
  'updatesAvailable': false,
};

final _on = _json(
  state: 'on',
  canApprove: false,
  canWithdraw: true,
  approval: {'approvedAt': '2026-09-18T10:00:00Z', 'approvedBy': {'id': 'u1', 'name': 'Dr Sen'}},
);
final _withdrawn = _json(
  state: 'withdrawn',
  reason: 'scope_not_approved',
  approval: {
    'approvedAt': '2026-09-18T10:00:00Z',
    'approvedBy': {'id': 'u1', 'name': 'Dr Sen'},
    'withdrawnAt': '2026-09-19T10:00:00Z',
    'withdrawnBy': {'id': 'u1', 'name': 'Dr Sen'},
  },
);

/// A server the tests can script: what the list says, and what each action does.
class _Server extends ClinicianRepository {
  _Server(this.items) : super(ApiClient(secureStore: SecureStore()));

  List<Map<String, dynamic>> items;
  Object? listError;
  Completer<void>? hold;

  /// What the list says after an approval, and what the approve call returns.
  Map<String, dynamic>? afterApprove;
  Object? approveError;
  final approvals = <AiAssistant>[];
  int withdrawals = 0;
  int reads = 0;

  @override
  Future<List<AiAssistant>> aiAssistants() async {
    reads += 1;
    if (hold != null) await hold!.future;
    if (listError != null) throw listError!;
    return items.map(AiAssistant.fromJson).toList();
  }

  @override
  Future<AiAssistant> approveAiAssistant(AiAssistant assistant) async {
    approvals.add(assistant);
    if (approveError != null) throw approveError!;
    final next = afterApprove ?? _on;
    items = [next];
    return AiAssistant.fromJson(next);
  }

  @override
  Future<AiAssistant> withdrawAiAssistant(AiAssistant assistant) async {
    withdrawals += 1;
    items = [_withdrawn];
    return AiAssistant.fromJson(_withdrawn);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _Server server, {
  Size size = const Size(390, 844),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clinicianRepositoryProvider.overrideWithValue(server)],
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: const AiAssistantsScreen(),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

Future<void> _openApproval(WidgetTester tester) async {
  final approve = find.text('Approve & turn on');
  await tester.ensureVisible(approve);
  await tester.pumpAndSettle();
  await tester.tap(approve);
  await tester.pumpAndSettle();
}

/// Tick the box and confirm, both further down the scrollable dialog.
Future<void> _confirmApproval(WidgetTester tester) async {
  await tester.ensureVisible(find.byType(Checkbox));
  await tester.pumpAndSettle();
  await tester.tap(find.byType(Checkbox));
  await tester.pump();
  final confirm = find.widgetWithText(FilledButton, 'Approve & turn on').last;
  await tester.ensureVisible(confirm);
  await tester.pumpAndSettle();
  await tester.tap(confirm);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('loading, then the assistant OFF with what it covers and what to know before approving', (tester) async {
    final server = _Server([_json()])..hold = Completer<void>();
    await _pump(tester, server);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    server.hold!.complete();
    await tester.pumpAndSettle();
    expect(find.text('Cardiologist AI'), findsOneWidget);
    expect(find.text('OFF'), findsOneWidget);
    expect(find.text('ON'), findsNothing);
    expect(find.textContaining('awaiting approval by a doctor of this specialty'), findsOneWidget);
    expect(find.text('Before you approve'), findsOneWidget);
    expect(find.textContaining('What it covers'), findsOneWidget);
    expect(find.textContaining('Warning signs it treats as urgent'), findsOneWidget);
    expect(find.text('Withdraw approval'), findsNothing);
  });

  testWidgets('approving needs the tick, sends the versions shown, and ends ON only because the server says so', (tester) async {
    final server = _Server([_json()]);
    await _pump(tester, server);
    await _openApproval(tester);

    expect(find.text('Turn on Cardiologist AI?'), findsOneWidget);
    expect(find.textContaining('configuration version 1 and knowledge version abc123def456'), findsOneWidget);
    final confirm = find.widgetWithText(FilledButton, 'Approve & turn on').last;
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull, reason: 'approved without the doctor confirming');

    await _confirmApproval(tester);

    expect(server.approvals.single.version, 1);
    expect(server.approvals.single.knowledgeVersion, 'abc123def456');
    expect(find.text('ON'), findsOneWidget);
    expect(find.textContaining('Approved by Dr Sen'), findsOneWidget);
    expect(find.text('Withdraw approval'), findsOneWidget);
    expect(find.textContaining('is now ON'), findsOneWidget);
  });

  testWidgets('if the server does not turn it on, the screen does not say ON', (tester) async {
    final server = _Server([_json()])
      ..afterApprove = _json(reason: 'too_little_approved_knowledge', canApprove: false);
    await _pump(tester, server);
    await _openApproval(tester);
    await _confirmApproval(tester);

    expect(find.text('ON'), findsNothing, reason: 'the screen said ON while the server said off');
    expect(find.text('OFF'), findsOneWidget);
    expect(find.textContaining('not on yet'), findsOneWidget);
  });

  testWidgets('cancelling the dialog changes nothing', (tester) async {
    final server = _Server([_json()]);
    await _pump(tester, server);
    await _openApproval(tester);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(server.approvals, isEmpty);
    expect(find.text('OFF'), findsOneWidget);
  });

  testWidgets('withdrawing asks first, then shows WITHDRAWN and offers approval again', (tester) async {
    final server = _Server([_on]);
    await _pump(tester, server);
    expect(find.text('ON'), findsOneWidget);

    final withdraw = find.text('Withdraw approval');
    await tester.ensureVisible(withdraw);
    await tester.pumpAndSettle();
    await tester.tap(withdraw);
    await tester.pumpAndSettle();
    expect(find.textContaining('stops answering your practice’s patients'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Withdraw'));
    await tester.pumpAndSettle();

    expect(server.withdrawals, 1);
    expect(find.text('WITHDRAWN'), findsOneWidget);
    expect(find.textContaining('Withdrawn by Dr Sen'), findsOneWidget);
    expect(find.text('Approve & turn on'), findsOneWidget);
  });

  testWidgets('a changed assistant is refused and the doctor is told to review it again', (tester) async {
    final server = _Server([_json()])
      ..approveError = const ApiException(code: 'CONFLICT', message: 'changed', statusCode: 409);
    await _pump(tester, server);
    final readsBefore = server.reads;
    await _openApproval(tester);
    await _confirmApproval(tester);

    expect(find.textContaining('changed since you opened it'), findsOneWidget);
    expect(server.reads, greaterThan(readsBefore), reason: 'the list was not read again after a refusal');
    expect(find.text('OFF'), findsOneWidget);
  });

  testWidgets('no assistant for this doctor’s specialty says who can change that', (tester) async {
    await _pump(tester, _Server([]));
    expect(find.text('No assistant for your specialty here yet'), findsOneWidget);
  });

  testWidgets('a network failure offers a retry that works', (tester) async {
    final server = _Server([_json()])
      ..listError = const ApiException(code: 'NETWORK_ERROR', message: 'offline');
    await _pump(tester, server);
    expect(find.text('Retry'), findsOneWidget);

    server.listError = null;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Cardiologist AI'), findsOneWidget);
  });

  testWidgets('a refusal is shown as one, not as a connection problem', (tester) async {
    final server = _Server([])
      ..listError = const ApiException(code: 'FORBIDDEN', message: 'no', statusCode: 403);
    await _pump(tester, server);
    expect(find.text('Only doctors can manage AI assistants'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
  });

  for (final (label, size, scale) in [
    ('a small phone', const Size(320, 568), 1.0),
    ('large text', const Size(390, 844), 2.0),
    ('a small phone with large text', const Size(320, 568), 1.6),
  ]) {
    testWidgets('lays out without overflow on $label, in every state', (tester) async {
      for (final item in [_json(), _on, _withdrawn]) {
        await _pump(tester, _Server([item]), size: size, textScale: scale);
        // Scroll the whole card through the viewport; an overflow throws.
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
      await _pump(tester, _Server([_json()]), size: size, textScale: scale);
      await _openApproval(tester);
      await tester.drag(find.byType(Scrollable).last, const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'the approval dialog overflowed');
    });
  }
}
