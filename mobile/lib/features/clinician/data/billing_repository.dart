import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/billing.dart';

/// Talks to `/billing`.
///
/// Reading is open to any doctor: knowing the clinic is on a trial that ends on
/// the 14th is not privileged, and hiding it until somebody holds a billing
/// permission is how a practice discovers its plan by being cut off. Every
/// write is `MANAGE_STAFF` on the server — committing a practice to a monthly
/// charge is not an ordinary clinical act.
class BillingRepository {
  BillingRepository(this._client);

  final ApiClient _client;

  Future<BillingStatus> status() async =>
      BillingStatus.fromJson(await _client.getJson('/billing'));

  /// Start a subscription and get somewhere to send the customer.
  ///
  /// Nothing about the practice changes here. The plan moves when Razorpay
  /// says the money arrived, which is the webhook's job — so the screen must
  /// not congratulate anybody on the strength of this returning.
  Future<CheckoutHandle> subscribe(String plan) async => CheckoutHandle.fromJson(
    await _client.postJson('/billing/subscribe', body: {'plan': plan}),
  );

  /// What each tier costs, from Razorpay via our server.
  ///
  /// A practice that has to open a checkout to find out what it would be
  /// charged has been told nothing before it commits.
  Future<List<PlanPrice>> plans() async {
    final json = await _client.getJson('/billing/plans');
    return ((json['plans'] as List?) ?? const [])
        .map((e) => PlanPrice.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Hand the checkout result to the server and let it decide.
  ///
  /// The SDK's success callback is not payment. It arrives on a device the
  /// customer controls, and a patched build could call it with anything. The
  /// server checks a signature only Razorpay could have produced, and even then
  /// records the checkout rather than granting the plan — the plan moves when
  /// the webhook says money arrived.
  ///
  /// So this must be called, and its failure must be visible: a payment that
  /// succeeded on the phone and never reached here is a customer who has been
  /// charged and is still on their old plan.
  Future<void> verify({
    required String subscriptionId,
    required String paymentId,
    required String signature,
  }) => _client.postJson(
    '/billing/verify',
    body: {
      'subscriptionId': subscriptionId,
      'paymentId': paymentId,
      'signature': signature,
    },
  );

  /// Ask the provider what it thinks, rather than trusting the row.
  ///
  /// For the case a webhook never arrived — a misconfigured secret, a deploy
  /// during a delivery, a URL that changed.
  Future<void> refresh() => _client.postJson('/billing/refresh', body: const {});

  Future<void> cancel({bool immediately = false}) =>
      _client.postJson('/billing/cancel', body: {'immediately': immediately});
}

final billingRepositoryProvider = Provider<BillingRepository>(
  (ref) => BillingRepository(ref.watch(apiClientProvider)),
);

final billingStatusProvider = FutureProvider.autoDispose<BillingStatus>(
  (ref) => ref.watch(billingRepositoryProvider).status(),
);

/// Prices, kept separate from the status so a Razorpay outage costs the price
/// line and not the whole screen.
final planPricesProvider = FutureProvider.autoDispose<List<PlanPrice>>(
  (ref) => ref.watch(billingRepositoryProvider).plans(),
);
