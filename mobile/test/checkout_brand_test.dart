import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/billing.dart';

/// Whether the checkout sheet gets a logo.
///
/// Razorpay draws a letter when it is given no `image`, which is what the sheet
/// was showing. The parameter existed and was never supplied — so this covers
/// the whole path from the server's JSON to the value handed to the SDK, and
/// covers it as a test rather than as a screenshot, because the interesting
/// cases are the ones that produce a *silently* missing logo.
void main() {
  /// The live response, as `GET /api/v1/brand` returns it today.
  Map<String, dynamic> handle({Object? brand = _absent}) => {
    'subscriptionId': 'sub_R8xK2mQp',
    'keyId': 'rzp_test_abc123',
    'shortUrl': 'https://rzp.io/i/abc',
    if (!identical(brand, _absent)) 'brand': brand,
  };

  group('the brand reaches the sheet', () {
    test('a live response yields an https logo', () {
      final h = CheckoutHandle.fromJson(
        handle(
          brand: {
            'name': 'MedPin',
            'logoUrl': 'https://clinq.flintdeorient.in/api/v1/brand/logo.png',
          },
        ),
      );
      expect(h.brandName, 'MedPin');
      expect(h.brandLogoUrl, 'https://clinq.flintdeorient.in/api/v1/brand/logo.png');
      expect(h.canUseSdk, isTrue);
    });

    test('a server with no public origin sends null, and we send no image', () {
      // Razorpay then falls back to the first letter — which is what it did
      // before, and much better than a broken image on a payment sheet.
      final h = CheckoutHandle.fromJson(
        handle(brand: {'name': 'MedPin', 'logoUrl': null}),
      );
      expect(h.brandLogoUrl, isNull);
      expect(h.brandName, 'MedPin');
    });

    test('an http url is refused rather than passed on', () {
      // A modern handset will not load it, so passing it produces a missing
      // logo with no error anywhere. Refusing gives the letter fallback, which
      // at least looks deliberate.
      final h = CheckoutHandle.fromJson(
        handle(brand: {'name': 'MedPin', 'logoUrl': 'http://clinq.example.in/logo.png'}),
      );
      expect(h.brandLogoUrl, isNull);
    });

    test('an older server that sends no brand at all still names us', () {
      // The version this replaces. An empty merchant name on a payment sheet is
      // worse than a slightly stale one, so the default is a name and never ''.
      final h = CheckoutHandle.fromJson(handle());
      expect(h.brandName, 'MedPin');
      expect(h.brandLogoUrl, isNull);
    });

    test('and an empty name does not reach checkout', () {
      final h = CheckoutHandle.fromJson(
        handle(brand: {'name': '   ', 'logoUrl': null}),
      );
      expect(h.brandName, 'MedPin');
    });

    test('whitespace around a url does not break the https check', () {
      final h = CheckoutHandle.fromJson(
        handle(brand: {
          'name': 'MedPin',
          'logoUrl': '  https://clinq.flintdeorient.in/api/v1/brand/logo.png  ',
        }),
      );
      expect(h.brandLogoUrl, 'https://clinq.flintdeorient.in/api/v1/brand/logo.png');
    });
  });

  group('the handle still knows whether the SDK can run', () {
    test('no key id means the hosted page instead', () {
      final h = CheckoutHandle.fromJson({
        'subscriptionId': 'sub_1',
        'shortUrl': 'https://rzp.io/i/abc',
      });
      expect(h.canUseSdk, isFalse);
      expect(h.url, isNotNull, reason: 'the fallback must survive');
    });

    test('and no subscription id means neither', () {
      final h = CheckoutHandle.fromJson({'keyId': 'rzp_test_abc'});
      expect(h.canUseSdk, isFalse);
      expect(h.url, isNull);
    });
  });
}

const _absent = Object();
