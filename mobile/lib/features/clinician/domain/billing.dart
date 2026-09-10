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
    required this.hasPracticeFlag,
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

  /// Whether this account belongs to a practice at all.
  ///
  /// Sent by the server. It used to be inferred here as `plan != null`, which
  /// is also true of a practice created before the plan field existed — so the
  /// founding practice, which has no plan written on it, was shown "No practice
  /// yet" on its own billing screen.
  ///
  /// Null only when talking to a server that predates the field, where the old
  /// inference is still the best available guess.
  final bool? hasPracticeFlag;

  bool get hasPractice => hasPracticeFlag ?? (plan != null);

  /// A practice that exists and has never been put on a plan.
  ///
  /// Ordinary rather than broken: every practice predating the field is in this
  /// state, and `capabilities.js` grants an unknown plan everything. It is not
  /// a trial and must not be drawn as one — there is no date for it to end on.
  bool get planUnrecorded => hasPractice && plan == null;

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
      // Absent on a server older than the field; `hasPractice` falls back to
      // the old inference in that case rather than deciding there is no
      // practice because a key is missing.
      hasPracticeFlag: json['hasPractice'] as bool?,
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

/// One charge, as the provider recorded it.
///
/// Rendered from the server's copy rather than fetched from Razorpay, because a
/// clinic holds no account there — "why was I charged this" is a question they
/// ask us.
@immutable
class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.amountPaise,
    required this.currency,
    required this.status,
    required this.method,
    required this.failureReason,
    required this.at,
  });

  final String id;
  final int amountPaise;
  final String? currency;

  /// `captured`, `authorized`, `failed`, `refunded`. The server's word, kept as
  /// a string so a status this app has not been taught still displays.
  final String status;

  /// `card`, `upi`, `netbanking`. The word only — no card detail exists
  /// anywhere in this system to show.
  final String? method;

  /// The provider's reason, where there is one. "Your card was declined" and
  /// "your bank is down" need different actions from the practice.
  final String? failureReason;

  final DateTime? at;

  bool get succeeded => status == 'captured';
  bool get failed => status == 'failed';

  String get formatted =>
      PlanPrice(plan: '', amountPaise: amountPaise, currency: currency, period: null, interval: null)
          .formatted;

  factory PaymentRecord.fromJson(Map<String, dynamic> json) => PaymentRecord(
    id: json['id'] as String? ?? '',
    amountPaise: (json['amount'] as num?)?.toInt() ?? 0,
    currency: json['currency'] as String?,
    status: json['status'] as String? ?? '',
    method: json['method'] as String?,
    failureReason: json['failureReason'] as String?,
    at: json['at'] == null ? null : DateTime.tryParse(json['at'].toString())?.toLocal(),
  );
}

/// One bill. The document itself lives at [url] on Razorpay.
@immutable
class InvoiceRecord {
  const InvoiceRecord({
    required this.id,
    required this.number,
    required this.totalPaise,
    required this.currency,
    required this.status,
    required this.url,
    required this.issuedAt,
  });

  final String id;

  /// The provider's human-facing number, which is what an accountant quotes
  /// back. Null where they did not give one.
  final String? number;

  final int totalPaise;
  final String? currency;

  /// `issued`, `paid`, `expired`, `cancelled`.
  final String status;

  /// Razorpay's hosted invoice. Null means no document to open, and the row
  /// then renders without a link rather than with one that goes nowhere.
  final String? url;

  final DateTime? issuedAt;

  bool get paid => status == 'paid';

  /// Raised and not settled — the one a practice can still act on.
  bool get outstanding => status == 'issued';

  /// Only ever an https link, for the same reason the brand logo is: anything
  /// else fails silently on a modern handset.
  bool get openable => url != null && url!.startsWith('https://');

  String get formatted =>
      PlanPrice(plan: '', amountPaise: totalPaise, currency: currency, period: null, interval: null)
          .formatted;

  factory InvoiceRecord.fromJson(Map<String, dynamic> json) => InvoiceRecord(
    id: json['id'] as String? ?? '',
    number: json['number'] as String?,
    totalPaise: (json['total'] as num?)?.toInt() ?? 0,
    currency: json['currency'] as String?,
    status: json['status'] as String? ?? '',
    url: (json['url'] as String?)?.trim(),
    issuedAt:
        json['issuedAt'] == null ? null : DateTime.tryParse(json['issuedAt'].toString())?.toLocal(),
  );
}

/// Everything a practice has been charged.
@immutable
class BillingHistory {
  const BillingHistory({required this.payments, required this.invoices});

  final List<PaymentRecord> payments;
  final List<InvoiceRecord> invoices;

  bool get isEmpty => payments.isEmpty && invoices.isEmpty;

  /// The bill they can still do something about, if there is one. This is what
  /// turns "your payment failed" from a notice into an action.
  InvoiceRecord? get payable {
    for (final i in invoices) {
      if (i.outstanding && i.openable) return i;
    }
    return null;
  }

  factory BillingHistory.fromJson(Map<String, dynamic> json) => BillingHistory(
    payments: ((json['payments'] as List?) ?? const [])
        .map((e) => PaymentRecord.fromJson(e as Map<String, dynamic>))
        .toList(),
    invoices: ((json['invoices'] as List?) ?? const [])
        .map((e) => InvoiceRecord.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// What one plan costs, as Razorpay records it.
///
/// The price is not in this app and not in our database. It is in Razorpay,
/// because that is what the customer is actually charged, and a copy anywhere
/// else is a second source of truth for money — whose failure mode is showing
/// somebody one number and taking another.
@immutable
class PlanPrice {
  const PlanPrice({
    required this.plan,
    required this.amountPaise,
    required this.currency,
    required this.period,
    required this.interval,
  });

  final String plan;

  /// Paise. Null when the price could not be fetched, and then the screen says
  /// "shown at checkout" rather than inventing a figure.
  final int? amountPaise;

  final String? currency;

  /// `monthly`, `yearly`, `weekly`, `daily` — Razorpay's word, not ours.
  final String? period;

  /// How many periods between charges. 1 for an ordinary monthly plan.
  final int? interval;

  bool get known => amountPaise != null;

  /// `₹3,999` — whole rupees, because every plan here is priced in them and a
  /// trailing `.00` on a payment confirmation reads as machine output.
  String get formatted {
    final paise = amountPaise;
    if (paise == null) return '';
    final symbol = currency == 'INR' || currency == null ? '₹' : '$currency ';
    final rupees = paise / 100;
    // Grouped either way. The decimal branch used to skip it and produce
    // ₹3999.50, which is the same number and the wrong shape on a screen
    // where somebody is checking a figure they are about to authorise.
    final fixed = rupees.toStringAsFixed(2);
    final dot = fixed.indexOf('.');
    final body = rupees.truncateToDouble() == rupees
        ? _grouped(fixed.substring(0, dot))
        : '${_grouped(fixed.substring(0, dot))}${fixed.substring(dot)}';
    return '$symbol$body';
  }

  /// How often, in words somebody reads rather than a field name.
  ///
  /// "every month" and not "monthly": the sentence around it is "then ₹3,999
  /// every month", and "then ₹3,999 monthly" is not English.
  String get everyPhrase {
    final n = interval ?? 1;
    final unit = switch (period) {
      'daily' => 'day',
      'weekly' => 'week',
      'yearly' => 'year',
      'monthly' => 'month',
      _ => null,
    };
    if (unit == null) return '';
    return n == 1 ? 'every $unit' : 'every $n ${unit}s';
  }

  /// The first date a renewal would fall on, from a first payment today.
  ///
  /// Approximate by construction and labelled that way on screen. Razorpay
  /// decides the real schedule from when the mandate is authorised, which has
  /// not happened yet at the moment this is shown.
  DateTime? renewalAfter(DateTime first) {
    final n = interval ?? 1;
    return switch (period) {
      'daily' => first.add(Duration(days: n)),
      'weekly' => first.add(Duration(days: 7 * n)),
      'monthly' => DateTime(first.year, first.month + n, first.day),
      'yearly' => DateTime(first.year + n, first.month, first.day),
      _ => null,
    };
  }

  static String _grouped(String digits) {
    // Indian grouping: the last three, then twos. 1234567 -> 12,34,567.
    if (digits.length <= 3) return digits;
    final last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    return '${parts.join(',')},$last3';
  }

  factory PlanPrice.fromJson(Map<String, dynamic> json) => PlanPrice(
    plan: json['plan'] as String? ?? '',
    amountPaise: (json['amount'] as num?)?.toInt(),
    currency: json['currency'] as String?,
    period: json['period'] as String?,
    interval: (json['interval'] as num?)?.toInt(),
  );
}

/// What the server hands back when a checkout is started.
@immutable
class CheckoutHandle {
  const CheckoutHandle({
    required this.subscriptionId,
    required this.keyId,
    required this.url,
    this.brandName = 'MedPin',
    this.brandLogoUrl,
  });

  /// Created by the server, never by the app. A client that could name its own
  /// subscription could name a cheaper one.
  final String subscriptionId;

  /// The publishable half of the key pair, which the SDK needs to open.
  final String keyId;

  /// Razorpay's hosted page, kept as the fallback for a device the SDK cannot
  /// run on. Null means the provider gave us none, which is a state to say out
  /// loud rather than open an empty browser for.
  final String? url;

  /// Who the customer is paying, as the server describes them.
  ///
  /// Read from the response rather than compiled in, so a wrong logo on a
  /// payment sheet is fixed by a deploy and not by an app release, an install
  /// and a version gate on every phone.
  final String brandName;

  /// Absolute and public, because Razorpay fetches it from the handset while
  /// somebody is typing a card number. Null means the server has no public
  /// origin configured, and the client then sends no image at all — Razorpay
  /// falls back to the first letter of the name, which is far better than a
  /// broken image on a checkout sheet.
  final String? brandLogoUrl;

  /// Whether the native sheet can be opened at all.
  bool get canUseSdk => keyId.isNotEmpty && subscriptionId.isNotEmpty;

  factory CheckoutHandle.fromJson(Map<String, dynamic> json) {
    final brand = json['brand'] as Map<String, dynamic>? ?? const {};
    final logo = (brand['logoUrl'] as String?)?.trim();
    return CheckoutHandle(
      subscriptionId: json['subscriptionId'] as String? ?? '',
      keyId: json['keyId'] as String? ?? '',
      url: json['shortUrl'] as String?,
      brandName: (brand['name'] as String?)?.trim().isNotEmpty == true
          ? (brand['name'] as String).trim()
          // Only if the server said nothing at all. An empty merchant name on a
          // payment sheet is worse than a slightly stale one.
          : 'MedPin',
      // An https URL or nothing. Razorpay will not load http from a modern
      // handset, and passing one produces a silently missing logo rather than
      // an error anybody sees.
      brandLogoUrl:
          logo != null && logo.startsWith('https://') ? logo : null,
    );
  }
}
