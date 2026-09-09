import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/billing_repository.dart';
import '../data/checkout.dart';
import '../domain/billing.dart';

/// What this practice is on, what it is using, and what else there is.
///
/// ---- What this screen refuses to claim ----------------------------------
///
/// Starting a checkout changes nothing here. The plan moves when Razorpay says
/// the money arrived, which is the webhook's job — so there is no success
/// message on the way back from the browser, only a re-read. A screen that
/// congratulated somebody on returning would be reporting a payment it has no
/// way of knowing about, and the one time it is wrong is the time the card was
/// declined.
///
/// Every status carries its age for the same reason. A webhook that never
/// arrived leaves a row saying `active` for ever, and "active" with nothing
/// beside it is a claim this screen cannot support.
///
/// ---- "People", not "staff" ----------------------------------------------
///
/// The server field is `limits.staff` and the guard counts every active
/// membership, the owner and the doctors included. Saying "staff" here would
/// promise a solo practice more room than it has, and the promise would break
/// at the hire that fills it.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(billingStatusProvider);

    // Reading is open to any doctor; paying is not. A screen that offered a
    // button the server would refuse is the same bug the departments screen
    // had, from the other side.
    final mayPay = ref.watch(capabilitySetProvider).can(Perm.manageStaff);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Plan and billing')),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(billingStatusProvider.future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, __) => _Failed(
            onRetry: () => ref.invalidate(billingStatusProvider),
          ),
          data: (status) => _Body(status: status, mayPay: mayPay),
        ),
      ),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(T.s4),
    children: [
      SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Could not load your plan', style: T.title),
            const SizedBox(height: T.s2),
            Text(
              'The clinic is unaffected — this screen only reports what you '
              'are on.',
              style: T.body.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s4),
            OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    ],
  );
}

class _Body extends ConsumerWidget {
  const _Body({required this.status, required this.mayPay});

  final BillingStatus status;
  final bool mayPay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!status.hasPractice) {
      return ListView(
        padding: const EdgeInsets.all(T.s4),
        children: const [_NoPractice()],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(T.s4),
      children: [
        if (status.testMode) const _TestModeNotice(),
        if (status.testMode) const SizedBox(height: T.s3),

        _CurrentPlan(status: status, mayPay: mayPay),
        const SizedBox(height: T.s4),

        _Usage(status: status),
        const SizedBox(height: T.s4),

        if (status.canPay)
          _Plans(status: status, mayPay: mayPay)
        else
          const _PaymentsOff(),

        const SizedBox(height: T.s8),
      ],
    );
  }
}

class _NoPractice extends StatelessWidget {
  const _NoPractice();

  @override
  Widget build(BuildContext context) => SectionCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('No practice yet', style: T.title),
        const SizedBox(height: T.s2),
        Text(
          'This account is not linked to a practice, so there is nothing to '
          'bill. Everything you can already do stays as it is.',
          style: T.body.copyWith(color: T.inkMuted),
        ),
      ],
    ),
  );
}

/// Said plainly, because somebody trying a checkout is entitled to know.
class _TestModeNotice extends StatelessWidget {
  const _TestModeNotice();

  @override
  Widget build(BuildContext context) => InnerTile(
    tone: T.warningTint,
    padding: const EdgeInsets.all(T.s4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.science_outlined, size: 20, color: T.warning),
        const SizedBox(width: T.s3),
        Expanded(
          child: Text(
            'Test mode. No real payment will be taken and no card will be '
            'charged.',
            style: T.small.copyWith(color: T.warning),
          ),
        ),
      ],
    ),
  );
}

class _PaymentsOff extends StatelessWidget {
  const _PaymentsOff();

  @override
  Widget build(BuildContext context) => SectionCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Payments are not set up', style: T.title),
        const SizedBox(height: T.s2),
        Text(
          'This server cannot take a payment yet. Your practice is unaffected '
          'and keeps everything it has — there is simply nothing to buy here. '
          'Talk to us if you want to change plan.',
          style: T.body.copyWith(color: T.inkMuted),
        ),
      ],
    ),
  );
}

class _CurrentPlan extends ConsumerWidget {
  const _CurrentPlan({required this.status, required this.mayPay});

  final BillingStatus status;
  final bool mayPay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sub = status.subscription;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Current plan', style: T.label.copyWith(color: T.inkFaint)),
          const SizedBox(height: T.s2),
          Text(PlanOption.labelFor(status.plan), style: T.display),

          if (status.plan == 'trial') ...[
            const SizedBox(height: T.s2),
            Text(
              'You have the whole product while you decide.',
              style: T.body.copyWith(color: T.inkMuted),
            ),
          ],

          if (status.renewsOn != null) ...[
            const SizedBox(height: T.s3),
            _Fact(label: 'Renews on', value: _day(status.renewsOn!)),
          ],

          if (sub != null) ...[
            const SizedBox(height: T.s4),
            const Divider(height: 1, color: T.line),
            const SizedBox(height: T.s4),
            _SubscriptionState(sub: sub),
            const SizedBox(height: T.s4),
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [
                // Not decoration. A webhook that never arrived is the whole
                // reason the age above is on screen, and this is the fix for
                // it that does not need a shell.
                OutlinedButton.icon(
                  onPressed: () => _refresh(context, ref),
                  icon: const Icon(Icons.sync_rounded, size: 18),
                  label: const Text('Check with Razorpay'),
                ),
                // Only where there is something to cancel. Offering it on a
                // row that already says Cancelled is a button that can only
                // produce an error.
                if (mayPay && (sub.isActive || sub.isRetrying || sub.hasLapsed))
                  TextButton(
                    onPressed: () => _confirmCancel(context, ref),
                    child: const Text('Cancel subscription'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  static String _day(DateTime d) =>
      '${d.day} ${const [
        'January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December',
      ][d.month - 1]} ${d.year}';

  Future<void> _refresh(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(billingRepositoryProvider).refresh();
      ref.invalidate(billingStatusProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('Checked with Razorpay.')),
      );
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not reach Razorpay just now.')),
      );
    }
  }

  Future<void> _confirmCancel(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel this subscription?'),
        // What it does and what it does not. Cancelling at the end of the
        // period is not the same as losing the plan today, and a dialog that
        // did not say so would be asking for a decision nobody has the facts
        // for.
        content: const Text(
          'Billing stops at the end of the period you have already paid for. '
          'Nothing changes about your practice today.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Cancel subscription'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(billingRepositoryProvider).cancel();
      ref.invalidate(billingStatusProvider);
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not cancel just now.')),
      );
    }
  }
}

/// The status, and how old it is.
class _SubscriptionState extends StatelessWidget {
  const _SubscriptionState({required this.sub});

  final BillingSubscription sub;

  @override
  Widget build(BuildContext context) {
    // Every state gets a word as well as a colour. Red-green deficiency runs
    // alongside diabetes and half this app's readers are its clinicians.
    final (label, tone, detail) = switch (sub.status) {
      'active' => (
        'Active',
        T.success,
        'Billing normally.',
      ),
      'pending' => (
        'Payment retrying',
        T.warning,
        'A charge did not go through and Razorpay is trying again. Nothing '
            'has changed about your practice.',
      ),
      'halted' => (
        'Payment failed',
        T.danger,
        'Razorpay has stopped retrying. Nothing has been taken away — please '
            'get in touch so we can sort it out.',
      ),
      'cancelled' => ('Cancelled', T.inkMuted, 'This will not renew.'),
      'completed' => ('Completed', T.inkMuted, 'The agreed term has finished.'),
      'created' || 'authenticated' => (
        'Not started',
        T.inkMuted,
        'Checkout was opened and not finished. Nothing has been charged.',
      ),
      _ => (sub.status, T.inkMuted, ''),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
            ),
            const SizedBox(width: T.s2),
            Expanded(
              child: Text(label, style: T.bodyStrong.copyWith(color: tone)),
            ),
          ],
        ),
        if (detail.isNotEmpty) ...[
          const SizedBox(height: T.s2),
          Text(detail, style: T.small.copyWith(color: T.inkMuted)),
        ],
        const SizedBox(height: T.s2),
        Text(
          sub.confirmedAt == null
              // Not "just now". A row the provider has never confirmed is
              // exactly the case this line exists to expose.
              ? 'Never confirmed by Razorpay'
              : 'Confirmed by Razorpay ${_ago(sub.confirmedAt!)}',
          style: T.small.copyWith(color: T.inkFaint),
        ),
      ],
    );
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 2) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes} minutes ago';
    if (d.inHours < 24) return '${d.inHours} hours ago';
    if (d.inDays == 1) return 'yesterday';
    return '${d.inDays} days ago';
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: T.small.copyWith(color: T.inkFaint)),
      const SizedBox(width: T.s3),
      Expanded(
        child: Text(value, style: T.small, textAlign: TextAlign.end),
      ),
    ],
  );
}

class _Usage extends StatelessWidget {
  const _Usage({required this.status});

  final BillingStatus status;

  @override
  Widget build(BuildContext context) => SectionCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('What you are using', style: T.title),
        const SizedBox(height: T.s4),
        _Meter(label: 'Patients', allowance: status.patients),
        const SizedBox(height: T.s3),
        // "People" deliberately: the cap counts doctors and the owner too.
        _Meter(
          label: 'People',
          allowance: status.people,
          note: 'Doctors, front desk and dieticians, including you',
        ),
        const SizedBox(height: T.s3),
        _Meter(label: 'Locations', allowance: status.locations),
      ],
    ),
  );
}

class _Meter extends StatelessWidget {
  const _Meter({required this.label, required this.allowance, this.note});

  final String label;
  final Allowance allowance;
  final String? note;

  @override
  Widget build(BuildContext context) {
    final f = allowance.fraction;

    final (word, tone) = allowance.full
        ? ('Full', T.danger)
        : allowance.nearlyFull
            ? ('Nearly full', T.warning)
            : (null, T.inkMuted);

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: T.bodyStrong)),
              Text(
                allowance.unlimited
                    // Not "n of 0". No cap is the answer, and it is a good one.
                    ? '${allowance.used}'
                    : '${allowance.used} of ${allowance.cap}',
                style: T.bodyStrong.copyWith(color: T.inkMuted),
              ),
            ],
          ),
          if (note != null) ...[
            const SizedBox(height: T.s1),
            Text(note!, style: T.small.copyWith(color: T.inkFaint)),
          ],
          if (allowance.unlimited) ...[
            const SizedBox(height: T.s2),
            Text('No limit', style: T.small.copyWith(color: T.inkFaint)),
          ] else ...[
            const SizedBox(height: T.s3),
            ClipRRect(
              borderRadius: BorderRadius.circular(T.s1),
              child: LinearProgressIndicator(
                value: f,
                minHeight: 6,
                backgroundColor: T.line,
                valueColor: AlwaysStoppedAnimation(
                  allowance.full
                      ? T.danger
                      : allowance.nearlyFull
                          ? T.warning
                          : T.primary,
                ),
              ),
            ),
            if (word != null) ...[
              const SizedBox(height: T.s2),
              // The bar's colour is never the only carrier.
              Text(word, style: T.small.copyWith(color: tone)),
            ],
          ],
        ],
      ),
    );
  }
}

class _Plans extends ConsumerStatefulWidget {
  const _Plans({required this.status, required this.mayPay});

  final BillingStatus status;
  final bool mayPay;

  @override
  ConsumerState<_Plans> createState() => _PlansState();
}

class _PlansState extends ConsumerState<_Plans> {
  String? _busy;

  @override
  Widget build(BuildContext context) {
    final current = widget.status.plan;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Other plans', style: T.title),
          const SizedBox(height: T.s2),
          Text(
            widget.mayPay
                ? 'Prices are shown at checkout.'
                // Said rather than hidden. A doctor who cannot see why the
                // buttons are missing assumes the screen is broken.
                : 'Only someone who manages staff can change the plan.',
            style: T.body.copyWith(color: T.inkMuted),
          ),
          const SizedBox(height: T.s4),
          for (final plan in PlanOption.all) ...[
            _PlanTile(
              plan: plan,
              isCurrent: plan.id == current,
              busy: _busy == plan.id,
              onPick: widget.mayPay && plan.id != current
                  ? () => _start(plan)
                  : null,
            ),
            if (plan != PlanOption.all.last) const SizedBox(height: T.s3),
          ],
        ],
      ),
    );
  }

  final _checkout = RazorpayCheckout();

  @override
  void dispose() {
    // The plugin holds a platform-channel listener. Leaving it attached across
    // screens is how a later payment's callback arrives at a disposed widget.
    _checkout.dispose();
    super.dispose();
  }

  Future<void> _start(PlanOption plan) async {
    setState(() => _busy = plan.id);
    final messenger = ScaffoldMessenger.of(context);
    final repo = ref.read(billingRepositoryProvider);

    try {
      // The server creates the subscription. A client that could name its own
      // could name a cheaper one.
      final handle = await repo.subscribe(plan.id);

      if (!handle.canUseSdk) {
        await _fallbackToBrowser(handle, messenger);
        return;
      }

      final result = await _checkout.open(
        keyId: handle.keyId,
        subscriptionId: handle.subscriptionId,
        planName: '${plan.name} plan',
        brandName: handle.brandName,
        brandImageUrl: handle.brandLogoUrl,
      );

      switch (result.outcome) {
        case CheckoutOutcome.couldNotOpen:
          // The device could not run the sheet — no Play Services, a failed
          // install. A checkout in a browser is better than none.
          await _fallbackToBrowser(handle, messenger);

        case CheckoutOutcome.cancelled:
          if (result.message != null) {
            messenger.showSnackBar(SnackBar(content: Text(result.message!)));
          }

        case CheckoutOutcome.failed:
          messenger.showSnackBar(
            SnackBar(content: Text(result.message ?? 'The payment did not go through.')),
          );

        case CheckoutOutcome.paid:
          /*
           * The SDK says it worked. That is not payment.
           *
           * The three fields go to the server, which checks a signature only
           * Razorpay could have produced. If that call fails the customer has
           * been charged and we do not know it, so the failure is said out loud
           * rather than swallowed — it is the one error here worth interrupting
           * somebody for.
           */
          try {
            await repo.verify(
              subscriptionId: handle.subscriptionId,
              paymentId: result.paymentId ?? '',
              signature: result.signature ?? '',
            );
          } catch (_) {
            messenger.showSnackBar(
              const SnackBar(
                duration: Duration(seconds: 8),
                content: Text(
                  'Your payment went through but we could not confirm it here. '
                  'Pull to refresh in a moment, or use "Check with Razorpay".',
                ),
              ),
            );
          }
      }

      // No success message on any path. Whether money moved is Razorpay's
      // answer and it arrives by webhook, so this re-reads and shows whatever
      // is true — which straight after a checkout is usually "Not started".
      ref.invalidate(billingStatusProvider);
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not start checkout just now.')),
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// Razorpay's hosted page, for a device the SDK cannot run on.
  Future<void> _fallbackToBrowser(
    CheckoutHandle handle,
    ScaffoldMessengerState messenger,
  ) async {
    final url = handle.url;
    if (url == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Razorpay did not return a checkout page.')),
      );
      return;
    }

    final opened = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
    if (!opened) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not open the checkout page.')),
      );
    }
  }
}

class _PlanTile extends StatelessWidget {
  const _PlanTile({
    required this.plan,
    required this.isCurrent,
    required this.busy,
    required this.onPick,
  });

  final PlanOption plan;
  final bool isCurrent;
  final bool busy;
  final VoidCallback? onPick;

  @override
  Widget build(BuildContext context) {
    // A fixed height would clip "Unlimited patients and people" at the first
    // notch above 1.0, so the tile is sized by its content and the button is
    // given its own minimum.
    final scaled = MediaQuery.textScalerOf(context).scale(T.tap);

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      tone: isCurrent ? T.primaryTint : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(plan.name, style: T.bodyStrong)),
              if (isCurrent)
                Text(
                  'Current',
                  style: T.small.copyWith(color: T.primary),
                ),
            ],
          ),
          const SizedBox(height: T.s1),
          Text(plan.summary, style: T.small.copyWith(color: T.inkMuted)),
          const SizedBox(height: T.s3),
          for (final add in plan.adds)
            Padding(
              padding: const EdgeInsets.only(bottom: T.s1),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_rounded, size: 16, color: T.inkFaint),
                  const SizedBox(width: T.s2),
                  Expanded(
                    child: Text(add, style: T.small.copyWith(color: T.inkMuted)),
                  ),
                ],
              ),
            ),
          if (onPick != null) ...[
            const SizedBox(height: T.s3),
            SizedBox(
              width: double.infinity,
              height: scaled,
              child: FilledButton(
                onPressed: busy ? null : onPick,
                child: busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text('Choose ${plan.name}'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
