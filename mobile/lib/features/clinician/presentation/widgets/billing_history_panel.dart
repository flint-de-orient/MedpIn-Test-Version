import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../data/billing_repository.dart';
import '../../domain/billing.dart';

/// What this practice has been charged, and what they can do about it.
///
/// ---- The recovery action is the point ----------------------------------
///
/// "Your payment failed" is a notice. A notice about money, with no way to act
/// on it, sends a practice manager to ring somebody — and the thing they need
/// is a link to the unpaid bill, which Razorpay already hosts and will take a
/// card on.
///
/// So an outstanding invoice is promoted out of the list and given a button.
/// Where there is no such invoice the panel says nothing about recovery rather
/// than offering an action that goes nowhere: a dead "Retry payment" is worse
/// than an honest "we are waiting on the bank".
///
/// ---- Hidden when there is nothing to say -------------------------------
///
/// A practice on a trial has never been charged, and an empty "Payment history"
/// card on their screen is a box that says nothing. It appears once there is a
/// subscription — at which point an empty history is informative, because it
/// means the first charge has not landed yet.
class BillingHistoryPanel extends ConsumerWidget {
  const BillingHistoryPanel({super.key, required this.hasSubscription});

  /// Nothing has ever been billed without one, so the panel is noise until then.
  final bool hasSubscription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!hasSubscription) return const SizedBox.shrink();

    final async = ref.watch(billingHistoryProvider);

    return async.when(
      // Silent while loading and silent on failure. This panel is supporting
      // information; a spinner or an error where it sits would interrupt
      // somebody reading the plan above it, which is what they came for.
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (history) => _Panel(history: history),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.history});

  final BillingHistory history;

  @override
  Widget build(BuildContext context) {
    final payable = history.payable;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (payable != null) ...[
          _Outstanding(invoice: payable),
          const SizedBox(height: T.s4),
        ],

        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Payments', style: T.title),
              const SizedBox(height: T.s4),

              if (history.payments.isEmpty)
                // Informative rather than noise: they have a subscription and
                // nothing has been charged, which is a real and temporary state.
                Text(
                  'Nothing has been charged yet.',
                  style: T.body.copyWith(color: T.inkMuted),
                )
              else
                for (final p in history.payments) ...[
                  _PaymentRow(
                    payment: p,
                    invoice: _invoiceFor(p),
                  ),
                  if (p != history.payments.last) const SizedBox(height: T.s3),
                ],
            ],
          ),
        ),
      ],
    );
  }

  /// The bill a charge settled, matched by amount and month.
  ///
  /// The server sends the two lists separately because a failed payment has no
  /// invoice and an unpaid invoice has no payment. Pairing them here is a
  /// convenience for the receipt link and is allowed to fail — an unmatched
  /// payment simply shows without one.
  InvoiceRecord? _invoiceFor(PaymentRecord p) {
    for (final i in history.invoices) {
      if (i.totalPaise != p.amountPaise) continue;
      final a = p.at;
      final b = i.issuedAt;
      if (a == null || b == null) continue;
      if (a.year == b.year && a.month == b.month) return i;
    }
    return null;
  }
}

/// A bill they can still settle. Promoted out of the list and given an action.
class _Outstanding extends StatelessWidget {
  const _Outstanding({required this.invoice});

  final InvoiceRecord invoice;

  @override
  Widget build(BuildContext context) {
    final scaled = MediaQuery.textScalerOf(context).scale(T.tap);

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline_rounded, size: 20, color: T.warning),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  'A payment is outstanding',
                  style: T.bodyStrong.copyWith(color: T.warning),
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s2),
          Text(
            '${invoice.formatted} has not been settled. Your clinic is working '
            'normally — patient records, prescribing and messaging are unaffected.',
            style: T.small.copyWith(color: T.inkMuted, height: 1.5),
          ),
          const SizedBox(height: T.s4),
          SizedBox(
            width: double.infinity,
            height: scaled,
            child: FilledButton.icon(
              onPressed: () => launchUrl(
                Uri.parse(invoice.url!),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
              label: const Text('Settle this bill'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PaymentRow extends StatelessWidget {
  const _PaymentRow({required this.payment, required this.invoice});

  final PaymentRecord payment;
  final InvoiceRecord? invoice;

  @override
  Widget build(BuildContext context) {
    // Every status gets a word as well as a colour.
    final (label, tone) = switch (payment.status) {
      'captured' => ('Paid', T.success),
      'failed' => ('Failed', T.danger),
      'refunded' => ('Refunded', T.inkMuted),
      'authorized' => ('Authorised', T.inkMuted),
      _ => (payment.status, T.inkMuted),
    };

    final receipt = invoice;

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      onTap: receipt != null && receipt.openable
          ? () => launchUrl(
                Uri.parse(receipt.url!),
                mode: LaunchMode.externalApplication,
              )
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  payment.at == null ? 'Date unknown' : _day(payment.at!),
                  style: T.bodyStrong,
                ),
              ),
              Text(payment.formatted, style: T.bodyStrong),
            ],
          ),
          const SizedBox(height: T.s1),
          /*
           * `Expanded` on the left group, and no `Spacer`.
           *
           * A Spacer beside inflexible text takes all the free space and then
           * overflows the moment the text needs more than what is left — which
           * a longer status word or a raised text scale does immediately. The
           * repo has a linter for exactly this pairing; it found this row.
           */
          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(label, style: T.small.copyWith(color: tone)),
                    if (payment.method != null) ...[
                      Text('  ·  ', style: T.small.copyWith(color: T.inkFaint)),
                      Flexible(
                        child: Text(
                          _methodLabel(payment.method!),
                          overflow: TextOverflow.ellipsis,
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (receipt != null && receipt.openable) ...[
                const SizedBox(width: T.s2),
                Text('Receipt', style: T.small.copyWith(color: T.primary)),
              ],
            ],
          ),
          // The provider's own reason, because a generic failure sends somebody
          // to re-enter a card that was never the problem.
          if (payment.failed && payment.failureReason != null) ...[
            const SizedBox(height: T.s2),
            Text(
              payment.failureReason!,
              style: T.small.copyWith(color: T.inkMuted, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }

  static String _methodLabel(String m) => switch (m) {
    'card' => 'Card',
    'upi' => 'UPI',
    'netbanking' => 'Net banking',
    'wallet' => 'Wallet',
    'emandate' => 'Bank mandate',
    _ => m,
  };

  static String _day(DateTime d) =>
      '${d.day} ${const [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ][d.month - 1]} ${d.year}';
}
