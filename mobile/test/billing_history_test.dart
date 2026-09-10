import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/features/clinician/data/billing_repository.dart';
import 'package:akd_care/features/clinician/domain/billing.dart';
import 'package:akd_care/features/clinician/presentation/widgets/billing_history_panel.dart';

/// What a practice is shown about money it has already spent.
///
/// The recovery path is the part worth testing hardest. "Your payment failed"
/// with no way to act on it sends a practice manager to ring somebody, and the
/// thing they need — a link to the unpaid bill, which Razorpay hosts and will
/// take a card on — either appears or it does not.
void main() {
  Map<String, dynamic> payment({
    String id = 'p1',
    int amount = 399900,
    String status = 'captured',
    String? method = 'card',
    String? reason,
    String at = '2026-08-01T10:00:00Z',
  }) => {
    'id': id,
    'amount': amount,
    'currency': 'INR',
    'status': status,
    'method': method,
    'failureReason': reason,
    'at': at,
  };

  Map<String, dynamic> invoice({
    String id = 'i1',
    int total = 399900,
    String status = 'paid',
    String? url = 'https://rzp.io/i/inv1',
    String issued = '2026-08-01T10:00:00Z',
  }) => {
    'id': id,
    'number': 'INV-0007',
    'total': total,
    'currency': 'INR',
    'status': status,
    'url': url,
    'issuedAt': issued,
  };

  Widget panel(BillingHistory history, {bool hasSubscription = true}) => ProviderScope(
    overrides: [billingHistoryProvider.overrideWith((ref) async => history)],
    child: MaterialApp(
      home: Scaffold(
        body: ListView(
          children: [BillingHistoryPanel(hasSubscription: hasSubscription)],
        ),
      ),
    ),
  );

  Future<void> pump(WidgetTester tester, Widget w) async {
    tester.view.physicalSize = const Size(360 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(w);
    await tester.pumpAndSettle();
  }

  group('an outstanding bill becomes an action', () {
    testWidgets('a payable invoice is promoted with a button', (tester) async {
      final history = BillingHistory.fromJson({
        'payments': [payment(status: 'failed', reason: 'Your card was declined.')],
        'invoices': [invoice(status: 'issued')],
      });

      await pump(tester, panel(history));

      expect(find.text('A payment is outstanding'), findsOneWidget);
      expect(find.text('Settle this bill'), findsOneWidget);
      // And it says what is unaffected, so a manager does not assume the worst.
      expect(find.textContaining('patient records, prescribing and messaging'), findsOneWidget);
    });

    testWidgets('an unpaid invoice with no link offers no dead button', (tester) async {
      // A "Settle this bill" that goes nowhere is worse than saying nothing.
      final history = BillingHistory.fromJson({
        'payments': [payment(status: 'failed')],
        'invoices': [invoice(status: 'issued', url: null)],
      });

      await pump(tester, panel(history));
      expect(find.text('Settle this bill'), findsNothing);
    });

    testWidgets('an http link is not treated as openable', (tester) async {
      // Same rule as the brand logo: a modern handset refuses it, and the
      // failure is a button that does nothing.
      final history = BillingHistory.fromJson({
        'payments': const [],
        'invoices': [invoice(status: 'issued', url: 'http://rzp.io/i/inv1')],
      });

      await pump(tester, panel(history));
      expect(find.text('Settle this bill'), findsNothing);
    });

    testWidgets('a settled history promotes nothing', (tester) async {
      final history = BillingHistory.fromJson({
        'payments': [payment()],
        'invoices': [invoice()],
      });

      await pump(tester, panel(history));
      expect(find.text('A payment is outstanding'), findsNothing);
    });
  });

  group('the list itself', () {
    testWidgets('every status carries a word, not only a colour', (tester) async {
      final history = BillingHistory.fromJson({
        'payments': [
          payment(id: 'p1'),
          payment(id: 'p2', status: 'failed', at: '2026-07-01T10:00:00Z'),
        ],
        'invoices': const [],
      });

      await pump(tester, panel(history));
      expect(find.text('Paid'), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget);
    });

    testWidgets('a failure shows the provider’s reason', (tester) async {
      // A generic "payment failed" sends somebody to re-enter a card that was
      // never the problem.
      final history = BillingHistory.fromJson({
        'payments': [payment(status: 'failed', reason: 'Insufficient funds.')],
        'invoices': const [],
      });

      await pump(tester, panel(history));
      expect(find.text('Insufficient funds.'), findsOneWidget);
    });

    testWidgets('the method is a word and never a card detail', (tester) async {
      // There is no card detail anywhere in this system to leak, and this is
      // the screen somebody would be tempted to add "•••• 1111" to.
      final history = BillingHistory.fromJson({
        'payments': [payment(method: 'upi')],
        'invoices': const [],
      });

      await pump(tester, panel(history));
      expect(find.text('UPI'), findsOneWidget);
      expect(find.textContaining('••••'), findsNothing);
    });

    // Two tests rather than two pumps in one. Replacing the tree mid-test left
    // the first ProviderScope's result reachable, so the second assertion was
    // reading the first render — a test that failed for its own reason rather
    // than the code's.
    testWidgets('a receipt link appears where there is a document', (tester) async {
      await pump(
        tester,
        panel(BillingHistory.fromJson({
          'payments': [payment()],
          'invoices': [invoice()],
        })),
      );
      expect(find.text('Receipt'), findsOneWidget);
    });

    testWidgets('and not where there is none', (tester) async {
      await pump(
        tester,
        panel(BillingHistory.fromJson({
          'payments': [payment()],
          'invoices': const [],
        })),
      );
      expect(find.text('Receipt'), findsNothing);
    });
  });

  group('when to say nothing at all', () {
    testWidgets('a practice with no subscription sees no panel', (tester) async {
      // A trial practice has never been charged, and an empty "Payments" card
      // is a box that says nothing.
      await pump(
        tester,
        panel(
          BillingHistory.fromJson({'payments': const [], 'invoices': const []}),
          hasSubscription: false,
        ),
      );
      expect(find.text('Payments'), findsNothing);
    });

    testWidgets('but a subscription with no charges yet says so', (tester) async {
      // Informative rather than noise: they are subscribed and the first charge
      // has not landed, which is real and temporary.
      await pump(
        tester,
        panel(BillingHistory.fromJson({'payments': const [], 'invoices': const []})),
      );
      expect(find.text('Payments'), findsOneWidget);
      expect(find.text('Nothing has been charged yet.'), findsOneWidget);
    });
  });

  group('parsing', () {
    test('payable finds the settleable bill and ignores the rest', () {
      final h = BillingHistory.fromJson({
        'payments': const [],
        'invoices': [
          invoice(id: 'paid', status: 'paid'),
          invoice(id: 'dead', status: 'expired'),
          invoice(id: 'open', status: 'issued'),
        ],
      });
      expect(h.payable?.id, 'open');
    });

    test('and returns null where there is nothing to act on', () {
      final h = BillingHistory.fromJson({
        'payments': const [],
        'invoices': [invoice(status: 'paid')],
      });
      expect(h.payable, isNull);
    });

    test('an empty response is empty, not an error', () {
      final h = BillingHistory.fromJson({});
      expect(h.isEmpty, isTrue);
      expect(h.payable, isNull);
    });
  });
}
