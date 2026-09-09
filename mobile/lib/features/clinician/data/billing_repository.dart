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
