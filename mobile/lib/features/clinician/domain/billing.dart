import 'package:flutter/foundation.dart';

/// What a practice is on, what it is using, and whether anything is being paid.
///
/// ---- Null is not zero ---------------------------------------------------
///
/// Every limit is nullable and null means *unlimited*, which is what every
/// practice on the platform has today. Read as 0 it would render as "no places
/// left" — the exact opposite — so nothing in this file coalesces a limit to a
/// number, and the screen asks [Allowance.unlimited] rather than comparing.

/// One capped thing: how many there are, and how many are allowed.
@immutable
class Allowance {
  const Allowance({required this.used, required this.cap});

  final int used;

  /// Null is no limit at all, not a limit of nothing.
  final int? cap;

  bool get unlimited => cap == null;

  /// Null when there is no cap — a fraction of infinity is not a number.
  double? get fraction {
    final c = cap;
    if (c == null || c <= 0) return null;
    return (used / c).clamp(0.0, 1.0);
  }

  /// At or over the cap, so the next one will be refused.
  bool get full => cap != null && used >= cap!;

  /// Within one of the cap. Worth saying before somebody is stopped mid-task.
  bool get nearlyFull {
    final f = fraction;
    return !full && f != null && f >= 0.8;
  }
}

/// The provider's side of the arrangement, when there is one.
@immutable
class BillingSubscription {
  const BillingSubscription({
    required this.id,
    required this.plan,
    required this.status,
    required this.currentPeriodEnd,
    required this.confirmedAt,
  });

  final String id;
  final String plan;

  /// `created`, `authenticated`, `active`, `pending`, `halted`, `cancelled`,
  /// `completed`, `expired`. Kept as the server's string rather than an enum:
  /// a status this app has not been taught yet must still display, and an enum
  /// with a fallback case shows the fallback instead of the truth.
  final String status;

  final DateTime? currentPeriodEnd;

  /// When the provider last confirmed this status.
  ///
  /// Shown, because a webhook that never arrived leaves a row looking healthy
  /// for ever. A status with no age beside it is a claim the screen cannot
  /// support.
  final DateTime? confirmedAt;

  bool get isActive => status == 'active';

  /// Retries exhausted. Nothing has been taken away — that decision is not
  /// made anywhere yet — but somebody needs to know.
  bool get hasLapsed => status == 'halted';

  /// Money is expected and has not arrived. The clinic keeps working.
  bool get isRetrying => status == 'pending';
}

@immutable
class BillingStatus {
  const BillingStatus({
    required this.plan,
    required this.patients,
    required this.people,
    required this.locations,
    required this.renewsOn,
    required this.subscription,
    required this.canPay,
    required this.testMode,
  });

  /// Null when this account has no practice yet — a real state with its own
  /// answer on screen, not an error.
  final String? plan;

  final Allowance patients;

  /// Named `people`, not `staff`.
  ///
  /// The server field is `limits.staff` and the guard counts *every* active
  /// membership, the owner and the doctors included. Calling it "staff" on
  /// screen would promise a practice more room than it has, and the promise
  /// would break at the hire that fills it.
  final Allowance people;

  final Allowance locations;

  final DateTime? renewsOn;
  final BillingSubscription? subscription;

  /// Whether this deployment can take a payment at all. False is an ordinary
  /// state — the clinic works, the billing surface is simply not there — and
  /// it must not be rendered as a button that fails.
  final bool canPay;

  /// True when the keys are Razorpay's test keys. Shown plainly: somebody
  /// trying a checkout is entitled to know no money will move.
  final bool testMode;

  bool get hasPractice => plan != null;

  static DateTime? _date(Object? v) =>
      v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

  static int _int(Object? v) => v is num ? v.toInt() : 0;

  static int? _cap(Object? v) => v is num ? v.toInt() : null;

  factory BillingStatus.fromJson(Map<String, dynamic> json) {
    final limits = json['limits'] as Map<String, dynamic>? ?? const {};
    final usage = json['usage'] as Map<String, dynamic>? ?? const {};
    final sub = json['subscription'] as Map<String, dynamic>?;

    Allowance of(String usageKey, String limitKey) => Allowance(
      used: _int(usage[usageKey]),
      cap: _cap(limits[limitKey]),
    );

    return BillingStatus(
      plan: json['plan'] as String?,
      patients: of('patients', 'patients'),
      people: of('staff', 'staff'),
      locations: of('locations', 'locations'),
      renewsOn: _date(json['renewsOn']),
      subscription:
          sub == null
              ? null
              : BillingSubscription(
                id: sub['id'] as String? ?? '',
                plan: sub['plan'] as String? ?? '',
                status: sub['status'] as String? ?? '',
                currentPeriodEnd: _date(sub['currentPeriodEnd']),
                confirmedAt: _date(sub['confirmedAt']),
              ),
      canPay: json['canPay'] as bool? ?? false,
      testMode: json['testMode'] as bool? ?? false,
    );
  }
}

/// What a plan is called and what it is for, for the screen only.
///
/// The capability list is deliberately short. A practice choosing a tier needs
/// the difference between them, not the whole product — and a feature grid
/// copied from a marketing page ages the moment the resolver changes.
@immutable
class PlanOption {
  const PlanOption({
    required this.id,
    required this.name,
    required this.summary,
    required this.adds,
  });

  final String id;
  final String name;
  final String summary;

  /// What this tier adds over the one below it.
  final List<String> adds;

  static const all = <PlanOption>[
    PlanOption(
      id: 'essential',
      name: 'Essential',
      summary: 'One practice at one address.',
      adds: ['Prescriptions and labs', 'Patient assistant'],
    ),
    PlanOption(
      id: 'professional',
      name: 'Professional',
      summary: 'Several addresses and departments.',
      adds: ['Multiple locations', 'Departments', 'Analytics and exports'],
    ),
    PlanOption(
      id: 'enterprise',
      name: 'Enterprise',
      summary: 'No limits, agreed with us.',
      adds: ['Unlimited patients and people', 'Scheduled reports'],
    ),
  ];

  static String labelFor(String? id) => switch (id) {
    'trial' => 'Trial',
    'essential' => 'Essential',
    'professional' => 'Professional',
    'enterprise' => 'Enterprise',
    _ => 'No plan',
  };
}

/// What the server hands back when a checkout is started.
@immutable
class CheckoutHandle {
  const CheckoutHandle({required this.subscriptionId, required this.url});

  final String subscriptionId;

  /// Razorpay's hosted page for this subscription. Null would mean the
  /// provider did not give us one, which is a state to say out loud rather
  /// than open an empty browser for.
  final String? url;

  factory CheckoutHandle.fromJson(Map<String, dynamic> json) => CheckoutHandle(
    subscriptionId: json['subscriptionId'] as String? ?? '',
    url: json['shortUrl'] as String?,
  );
}
