import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/billing.dart';

/// What the billing screen is allowed to claim.
///
/// The parsing is the whole risk here. Every limit is nullable and null means
/// *unlimited*, which is what every practice on the platform has today — so a
/// single `?? 0` anywhere in this path turns "no limit" into "no places left"
/// on the one screen where a practice manager decides whether to buy something.
void main() {
  group('a missing limit is unlimited, not empty', () {
    test('null cap reads as no limit', () {
      const a = Allowance(used: 7, cap: null);
      expect(a.unlimited, isTrue);
      expect(a.full, isFalse, reason: 'an uncapped practice was reported full');
      expect(a.nearlyFull, isFalse);
      expect(a.fraction, isNull, reason: 'a fraction of infinity is not a number');
    });

    test('and the server omitting limits entirely does the same', () {
      // The pre-backfill shape, and the founding clinic's shape today.
      final s = BillingStatus.fromJson({
        'plan': 'trial',
        'usage': {'patients': 4, 'staff': 3, 'locations': 1},
        'canPay': true,
      });
      expect(s.patients.unlimited, isTrue);
      expect(s.people.unlimited, isTrue);
      expect(s.locations.unlimited, isTrue);
      expect(s.patients.used, 4);
    });

    test('a zero cap is not mistaken for unlimited', () {
      // The opposite error. Zero is a real, if unkind, limit somebody typed.
      const a = Allowance(used: 0, cap: 0);
      expect(a.unlimited, isFalse);
      expect(a.full, isTrue);
    });
  });

  group('full and nearly full', () {
    test('at the cap is full, because the next one is refused', () {
      expect(const Allowance(used: 10, cap: 10).full, isTrue);
      expect(const Allowance(used: 11, cap: 10).full, isTrue,
          reason: 'a practice over its cap must still read as full');
      expect(const Allowance(used: 9, cap: 10).full, isFalse);
    });

    test('nearly full warns before somebody is stopped mid-task', () {
      expect(const Allowance(used: 8, cap: 10).nearlyFull, isTrue);
      expect(const Allowance(used: 7, cap: 10).nearlyFull, isFalse);
      // Full is its own state and must not also claim to be nearly full, or
      // the screen shows two words for one fact.
      expect(const Allowance(used: 10, cap: 10).nearlyFull, isFalse);
    });

    test('the bar never overflows its track', () {
      expect(const Allowance(used: 30, cap: 10).fraction, 1.0);
    });
  });

  group('the staff limit is people', () {
    test('the server’s `staff` key lands on `people`', () {
      // Named apart on purpose: the guard counts every membership, doctors and
      // the owner included, so "staff" on screen would promise a solo practice
      // more room than it has.
      final s = BillingStatus.fromJson({
        'plan': 'essential',
        'limits': {'patients': 1000, 'staff': 10, 'locations': 1},
        'usage': {'patients': 312, 'staff': 4, 'locations': 1},
        'canPay': true,
      });
      expect(s.people.used, 4);
      expect(s.people.cap, 10);
    });
  });

  group('the subscription is reported, not interpreted', () {
    test('an unknown status still displays', () {
      // Kept as the server's string. An enum with a fallback case would show
      // the fallback instead of the truth the moment a status is added.
      final s = BillingStatus.fromJson({
        'plan': 'professional',
        'subscription': {'id': 'x', 'plan': 'professional', 'status': 'paused'},
        'canPay': true,
      });
      expect(s.subscription!.status, 'paused');
      expect(s.subscription!.isActive, isFalse);
    });

    test('a never-confirmed row says so rather than looking fresh', () {
      final s = BillingStatus.fromJson({
        'plan': 'professional',
        'subscription': {'id': 'x', 'plan': 'professional', 'status': 'active'},
        'canPay': true,
      });
      expect(s.subscription!.confirmedAt, isNull,
          reason: 'a missing confirmation must not be filled in with a date');
      expect(s.subscription!.isActive, isTrue);
    });

    test('halted is a lapse and takes nothing away by itself', () {
      final s = BillingStatus.fromJson({
        'plan': 'professional',
        'subscription': {'id': 'x', 'plan': 'professional', 'status': 'halted'},
        'canPay': true,
      });
      expect(s.subscription!.hasLapsed, isTrue);
      // The practice keeps its plan. What a lapse costs is an open decision on
      // the server and this app must not anticipate it.
      expect(s.plan, 'professional');
    });
  });

  group('a deployment that cannot take money', () {
    test('canPay defaults to false rather than true', () {
      // The safe direction. A missing field must not render a button that
      // fails against a server with no keys.
      final s = BillingStatus.fromJson({'plan': 'trial'});
      expect(s.canPay, isFalse);
      expect(s.testMode, isFalse);
    });

    test('no practice is a state, not an error', () {
      final s = BillingStatus.fromJson({'plan': null, 'canPay': false});
      expect(s.hasPractice, isFalse);
    });
  });

  group('checkout', () {
    test('a missing url is null, not an empty string', () {
      // An empty string would be launched, opening a blank browser tab and
      // looking like the payment page failed to load.
      final h = CheckoutHandle.fromJson({'subscriptionId': 'sub_1'});
      expect(h.url, isNull);
    });
  });

  group('plan labels', () {
    test('every sellable plan has a name', () {
      for (final p in PlanOption.all) {
        expect(PlanOption.labelFor(p.id), isNot('No plan'));
      }
    });

    test('trial is named but is not offered for sale', () {
      // A trial is granted, not purchased. Listing it would be a checkout
      // taking money for what is already being given away.
      expect(PlanOption.labelFor('trial'), 'Trial');
      expect(PlanOption.all.map((p) => p.id), isNot(contains('trial')));
    });

    test('and an unknown plan does not render as null', () {
      expect(PlanOption.labelFor(null), 'No plan');
      expect(PlanOption.labelFor('something_new'), 'No plan');
    });
  });
}
