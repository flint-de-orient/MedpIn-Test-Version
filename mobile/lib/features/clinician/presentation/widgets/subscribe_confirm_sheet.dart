import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/billing.dart';

/// What somebody is agreeing to, before Razorpay opens.
///
/// ---- Why this exists ----------------------------------------------------
///
/// A subscription is not a purchase. It is a standing instruction to a bank,
/// and the screen that used to precede it said "Prices are shown at checkout"
/// — so the first place a doctor saw a number was inside a payment sheet, one
/// tap from authorising a recurring debit. That is a decision made with the
/// facts arriving after the commitment.
///
/// ---- What it deliberately does not say ----------------------------------
///
/// No regulatory wording. It is tempting to write a confident sentence about
/// e-mandates and RBI limits, and every such sentence would be this app's
/// invention: the actual terms are Razorpay's, they are presented in their
/// sheet, and they differ by payment method — a UPI mandate, a card mandate and
/// a net-banking debit are three different agreements with three different
/// screens.
///
/// So this states only what MedPin knows for certain: the plan, the amount, how
/// often, that it repeats without being asked again, and how to stop it. The
/// bank's terms are on the next screen and are theirs to present.
///
/// The renewal date is labelled as approximate for the same reason. Razorpay
/// sets the real schedule from when the mandate is authorised, which has not
/// happened at the moment this is on screen.
class SubscribeConfirmSheet extends StatelessWidget {
  const SubscribeConfirmSheet({
    super.key,
    required this.plan,
    required this.price,
    required this.testMode,
  });

  final PlanOption plan;

  /// Null when the price could not be fetched. The sheet still opens and says
  /// so — hiding it would send somebody into a payment screen with less
  /// information, which is the problem this exists to fix.
  final PlanPrice? price;

  final bool testMode;

  /// Returns true when the customer chose to continue.
  static Future<bool> show(
    BuildContext context, {
    required PlanOption plan,
    required PlanPrice? price,
    required bool testMode,
  }) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: T.surface,
      builder: (_) => SubscribeConfirmSheet(
        plan: plan,
        price: price,
        testMode: testMode,
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final known = price?.known == true;
    final every = price?.everyPhrase ?? '';
    final renews = price?.renewalAfter(DateTime.now());

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Confirm ${plan.name}', style: T.title),
              const SizedBox(height: T.s1),
              Text(plan.summary, style: T.small.copyWith(color: T.inkMuted)),
              const SizedBox(height: T.s4),

              if (testMode) ...[
                InnerTile(
                  tone: T.warningTint,
                  padding: const EdgeInsets.all(T.s3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.science_outlined, size: 18, color: T.warning),
                      const SizedBox(width: T.s2),
                      Expanded(
                        child: Text(
                          'Test mode. Nothing will be charged.',
                          style: T.small.copyWith(color: T.warning),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: T.s3),
              ],

              InnerTile(
                padding: const EdgeInsets.all(T.s4),
                child: Column(
                  children: [
                    _Line(
                      label: 'You pay today',
                      value: known ? price!.formatted : 'Shown at checkout',
                      strong: true,
                    ),
                    if (known && every.isNotEmpty) ...[
                      const SizedBox(height: T.s3),
                      _Line(label: 'Then', value: '${price!.formatted} $every'),
                    ],
                    if (renews != null) ...[
                      const SizedBox(height: T.s3),
                      // "About" is load-bearing. Razorpay sets the real date
                      // from when the mandate is authorised, and that has not
                      // happened yet.
                      _Line(label: 'Next payment', value: 'about ${_day(renews)}'),
                    ],
                    const SizedBox(height: T.s3),
                    const _Line(label: 'Renews', value: 'automatically'),
                  ],
                ),
              ),

              const SizedBox(height: T.s4),

              // Plain, and only what we know. The mandate's own terms belong to
              // the bank and appear on the next screen, where they differ by
              // payment method.
              _Point(
                icon: Icons.autorenew_rounded,
                text: known && every.isNotEmpty
                    ? 'This sets up an automatic payment of ${price!.formatted} $every. '
                        'You will not be asked again each time.'
                    : 'This sets up an automatic recurring payment. You will not be '
                        'asked again each time.',
              ),
              const SizedBox(height: T.s3),
              _Point(
                icon: Icons.account_balance_outlined,
                text: 'Razorpay will ask your bank to approve it on the next screen. '
                    'The exact terms depend on how you pay.',
              ),
              const SizedBox(height: T.s3),
              _Point(
                icon: Icons.event_busy_outlined,
                // What stopping actually does, because "cancel" is ambiguous
                // and the wrong reading — losing access immediately — is the
                // one that stops somebody cancelling when they should.
                text: 'You can cancel any time on this screen. Cancelling stops future '
                    'payments; the period you have already paid for carries on.',
              ),

              const SizedBox(height: T.s5),

              SizedBox(
                width: double.infinity,
                height: MediaQuery.textScalerOf(context).scale(T.tap),
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  child: const Text('Continue to payment'),
                ),
              ),
              const SizedBox(height: T.s2),
              SizedBox(
                width: double.infinity,
                height: MediaQuery.textScalerOf(context).scale(T.tap),
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Not now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _day(DateTime d) =>
      '${d.day} ${const [
        'January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December',
      ][d.month - 1]} ${d.year}';
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value, this.strong = false});

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: Text(label, style: T.small.copyWith(color: T.inkMuted))),
      const SizedBox(width: T.s3),
      Text(
        value,
        textAlign: TextAlign.end,
        style: strong ? T.bodyStrong : T.small,
      ),
    ],
  );
}

class _Point extends StatelessWidget {
  const _Point({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 18, color: T.inkFaint),
      const SizedBox(width: T.s3),
      Expanded(
        child: Text(text, style: T.small.copyWith(color: T.inkMuted, height: 1.5)),
      ),
    ],
  );
}
