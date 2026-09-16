import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/billing.dart';

/// The numbers on a payment confirmation.
///
/// Every one of these is a sentence somebody reads immediately before
/// authorising a recurring debit, so being wrong here is worse than being
/// wrong almost anywhere else in the app: it is a figure they agreed to.
void main() {
  PlanPrice price({
    int? amount = 399900,
    String? currency = 'INR',
    String? period = 'monthly',
    int? interval = 1,
  }) => PlanPrice(
    plan: 'professional',
    amountPaise: amount,
    currency: currency,
    period: period,
    interval: interval,
  );

  group('paise become rupees', () {
    test('a whole-rupee plan shows no decimals', () {
      // ₹3,999.00 on a confirmation reads as machine output.
      expect(price().formatted, '₹3,999');
    });

    test('and Indian grouping is used, not thousands', () {
      // 12,34,567 — not 1,234,567. The audience is Indian clinics.
      expect(price(amount: 123456700).formatted, '₹12,34,567');
      expect(price(amount: 99900).formatted, '₹999');
      expect(price(amount: 1000000).formatted, '₹10,000');
      expect(price(amount: 100000000).formatted, '₹10,00,000');
    });

    test('a non-whole amount keeps its paise', () {
      // Not a plan we sell today, and rounding it away would understate a
      // charge somebody is about to authorise.
      expect(price(amount: 399950).formatted, '₹3,999.50');
    });

    test('a price we could not fetch renders as nothing, never as zero', () {
      // The screen substitutes "Shown at checkout". A ₹0 on a payment
      // confirmation is the worst possible wrong number.
      expect(price(amount: null).known, isFalse);
      expect(price(amount: null).formatted, '');
    });

    test('a currency that is not rupees is not labelled with a rupee sign', () {
      expect(price(currency: 'USD').formatted, startsWith('USD'));
    });
  });

  group('how often, in words', () {
    test('every month, not monthly', () {
      // The sentence is "then ₹3,999 every month". "then ₹3,999 monthly" is
      // not English.
      expect(price().everyPhrase, 'every month');
      expect(price(period: 'yearly').everyPhrase, 'every year');
    });

    test('an interval above one is spelled out', () {
      expect(price(interval: 3).everyPhrase, 'every 3 months');
      expect(price(period: 'weekly', interval: 2).everyPhrase, 'every 2 weeks');
    });

    test('a period we do not recognise says nothing rather than guessing', () {
      // The screen then omits the line. Inventing "every period" would be
      // worse than silence on a payment confirmation.
      expect(price(period: 'fortnightly').everyPhrase, '');
      expect(price(period: null).everyPhrase, '');
    });
  });

  group('the next payment date', () {
    test('a month later, from the first payment', () {
      final from = DateTime(2026, 9, 9);
      expect(price().renewalAfter(from), DateTime(2026, 10, 9));
    });

    test('and it crosses a year boundary', () {
      expect(price().renewalAfter(DateTime(2026, 12, 15)), DateTime(2027, 1, 15));
    });

    test('yearly, weekly and daily all work', () {
      final from = DateTime(2026, 9, 9);
      expect(price(period: 'yearly').renewalAfter(from), DateTime(2027, 9, 9));
      expect(price(period: 'weekly').renewalAfter(from), DateTime(2026, 9, 16));
      expect(price(period: 'daily').renewalAfter(from), DateTime(2026, 9, 10));
    });

    test('an unknown period yields no date rather than a wrong one', () {
      // The screen omits the line. A date this app made up, on the screen where
      // somebody authorises a recurring debit, is exactly the invention the
      // brief forbids.
      expect(price(period: null).renewalAfter(DateTime(2026, 9, 9)), isNull);
      expect(price(period: 'fortnightly').renewalAfter(DateTime(2026, 9, 9)), isNull);
    });
  });

  group('parsing what the server sends', () {
    test('a priced row', () {
      final p = PlanPrice.fromJson({
        'plan': 'professional',
        'amount': 399900,
        'currency': 'INR',
        'period': 'monthly',
        'interval': 1,
      });
      expect(p.known, isTrue);
      expect(p.formatted, '₹3,999');
    });

    test('and an unpriced one, which is a real state', () {
      // What the server sends when it cannot reach Razorpay.
      final p = PlanPrice.fromJson({
        'plan': 'enterprise',
        'amount': null,
        'currency': null,
        'period': null,
        'interval': null,
      });
      expect(p.known, isFalse);
      expect(p.everyPhrase, '');
      expect(p.renewalAfter(DateTime.now()), isNull);
    });
  });
}
