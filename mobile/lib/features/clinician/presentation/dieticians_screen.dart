import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';

final _dieticiansProvider = FutureProvider.autoDispose<List<_Dietician>>((
  ref,
) async {
  final data = await ref.read(apiClientProvider).getJson('/doctor/dieticians');
  final items = (data['items'] as List?) ?? const [];
  return items
      .whereType<Map<String, dynamic>>()
      .map(_Dietician.fromJson)
      .toList();
});

/// The clinic's dietician invite code — shared so a dietician can self-register
/// with their own password. Null when this deployment has no code configured,
/// in which case the invite card is hidden and only direct "Add" remains.
final _inviteCodeProvider = FutureProvider.autoDispose<String?>((ref) async {
  final data = await ref
      .read(apiClientProvider)
      .getJson('/doctor/dietician-invite');
  return data['code']?.toString();
});

/// How often a patient's food log should be reviewed, clinic-wide.
final _reviewIntervalProvider = FutureProvider.autoDispose<int>((ref) async {
  final data = await ref.read(apiClientProvider).getJson('/doctor/settings');
  return (data['dietReviewIntervalDays'] as num?)?.toInt() ?? 14;
});

/// The clinic's dieticians.
///
/// A dietician added here covers every patient straight away — a clinic has one
/// or two of them and hundreds of patients, so requiring the doctor to assign
/// each patient by hand made "nobody is watching this patient's diet" the
/// default and left it to memory to fix.
class DieticiansScreen extends ConsumerStatefulWidget {
  const DieticiansScreen({super.key});

  @override
  ConsumerState<DieticiansScreen> createState() => _DieticiansScreenState();
}

class _DieticiansScreenState extends ConsumerState<DieticiansScreen> {
  /// Issues a new invite code, retiring the current one.
  ///
  /// Confirmed first, and the confirmation says what actually happens: the old
  /// code stops working. Someone mid-registration with the old one will be
  /// turned away, and the doctor should know that before rotating rather than
  /// after a dietician calls to say the code was refused.
  Future<void> _regenerateInvite(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Generate a new invite code?'),
            content: const Text(
              'The current code stops working immediately. Anyone you have already '
              'sent it to will need the new one.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Generate'),
              ),
            ],
          ),
    );
    if (ok != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(apiClientProvider)
          .postJson('/doctor/dietician-invite/generate');
      ref.invalidate(_inviteCodeProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('New invite code generated')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _add() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _AddDieticianSheet(),
    );
    if (created == true) ref.invalidate(_dieticiansProvider);
  }

  Future<void> _editInterval(int current) async {
    final messenger = ScaffoldMessenger.of(context);
    final picked = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _IntervalSheet(current: current),
    );
    if (picked == null) return;

    try {
      await ref
          .read(apiClientProvider)
          .patchJson(
            '/doctor/settings',
            body: {'dietReviewIntervalDays': picked},
          );
      ref.invalidate(_reviewIntervalProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(_dieticiansProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Clinic care')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: const Text('Add dietician'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_dieticiansProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => ListView(
                children: [
                  const SizedBox(height: 140),
                  const Center(child: Text('Could not load dieticians')),
                  const SizedBox(height: AppSpacing.md),
                  Center(
                    child: OutlinedButton(
                      onPressed: () => ref.invalidate(_dieticiansProvider),
                      child: const Text('Retry'),
                    ),
                  ),
                ],
              ),
          data:
              (items) => ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.md,
                  AppSpacing.md,
                  100,
                ),
                children: [
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.infoBgOn(context),
                      borderRadius: BorderRadius.circular(
                        AppSpacing.cardRadius,
                      ),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline_rounded,
                          size: 19,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Text(
                            'A dietician you add here sees every patient and can write a '
                            'diet plan for any of them. Set how often a patient’s food log '
                            'should be reviewed on that patient’s record.',
                            style: TextStyle(
                              fontSize: 14,
                              height: 1.45,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Clinic-wide, not per patient: with one dietician covering
                  // hundreds of patients, a cadence set per patient meant almost
                  // every patient had none, and so was never due for review.
                  Consumer(
                    builder: (context, ref, _) {
                      final days =
                          ref.watch(_reviewIntervalProvider).valueOrNull;
                      return Material(
                        color: scheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(
                          AppSpacing.cardRadius,
                        ),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(
                            AppSpacing.cardRadius,
                          ),
                          onTap:
                              days == null ? null : () => _editInterval(days),
                          child: Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(
                                AppSpacing.cardRadius,
                              ),
                              border: Border.all(
                                color: scheme.outlineVariant.withValues(
                                  alpha: 0.7,
                                ),
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 42,
                                  height: 42,
                                  decoration: BoxDecoration(
                                    color: AppColors.accentSoftOn(context),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(
                                    Icons.event_repeat_outlined,
                                    size: 21,
                                    color: AppColors.accentOn(context),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Food-log review',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      const SizedBox(height: 0),
                                      Text(
                                        days == null
                                            ? 'Loading…'
                                            : '${intervalLabel(days)}, for every patient',
                                        style: TextStyle(
                                          fontSize: 14,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (days != null)
                                  Text(
                                    'Change',
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.accentOn(context),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  // Invite a dietician to self-register with the clinic code — an
                  // alternative to creating their account and password by hand.
                  Consumer(
                    builder: (context, ref, _) {
                      final code = ref.watch(_inviteCodeProvider).valueOrNull;
                      if (code == null || code.isEmpty)
                        return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.lg),
                        child: Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: scheme.surfaceContainerLowest,
                            borderRadius: BorderRadius.circular(
                              AppSpacing.cardRadius,
                            ),
                            border: Border.all(
                              color: scheme.outlineVariant.withValues(
                                alpha: 0.7,
                              ),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(
                                    Icons.mail_outline_rounded,
                                    size: 20,
                                    color: AppColors.accentOn(context),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  const Text(
                                    'Invite a dietician',
                                    style: TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Share this code. They install the app, register, and enter it to '
                                'join as a dietician — with their own password.',
                                style: TextStyle(
                                  fontSize: 14,
                                  height: 1.4,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                              const SizedBox(height: AppSpacing.md),
                              // Full width and a single line — it used to share a
                              // row with the Copy button, where the Expanded around
                              // it collapsed and the code stacked one letter per row.
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 12,
                                ),
                                decoration: BoxDecoration(
                                  color: AppColors.accentSoftOn(context),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  code,
                                  textAlign: TextAlign.center,
                                  maxLines: 1,
                                  softWrap: false,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 2,
                                  ),
                                ),
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.accentOn(
                                          context,
                                        ),
                                        minimumSize: const Size.fromHeight(48),
                                      ),
                                      onPressed:
                                          () => _regenerateInvite(context, ref),
                                      icon: const Icon(
                                        Icons.autorenew_rounded,
                                        size: 18,
                                      ),
                                      label: const Text('Generate new'),
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: FilledButton.icon(
                                      style: FilledButton.styleFrom(
                                        backgroundColor: AppColors.primary,
                                        foregroundColor: Colors.white,
                                        minimumSize: const Size.fromHeight(48),
                                      ),
                                      onPressed: () {
                                        Clipboard.setData(
                                          ClipboardData(text: code),
                                        );
                                        ScaffoldMessenger.of(
                                          context,
                                        ).showSnackBar(
                                          const SnackBar(
                                            content: Text('Invite code copied'),
                                          ),
                                        );
                                      },
                                      icon: const Icon(
                                        Icons.copy_rounded,
                                        size: 18,
                                      ),
                                      label: const Text('Copy'),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                  if (items.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 60),
                      child: Column(
                        children: [
                          Icon(
                            Icons.restaurant_menu_rounded,
                            size: 50,
                            color: scheme.outlineVariant,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          const Text(
                            'No dieticians yet',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Add one and they can start guiding your patients.',
                            style: TextStyle(
                              fontSize: 14,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    Container(
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(
                          AppSpacing.cardRadius,
                        ),
                        border: Border.all(
                          color: scheme.outlineVariant.withValues(alpha: 0.7),
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        children: [
                          for (var i = 0; i < items.length; i++) ...[
                            if (i > 0)
                              Divider(
                                height: 1,
                                color: scheme.outlineVariant.withValues(
                                  alpha: 0.5,
                                ),
                              ),
                            ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: AppSpacing.md,
                                vertical: 4,
                              ),
                              leading: GestureDetector(
                                onTap:
                                    items[i].avatarUrl == null
                                        ? null
                                        : () => FullscreenPhoto.show(
                                          context,
                                          items[i].avatarUrl!,
                                        ),
                                child: UserAvatar(
                                  name: items[i].name,
                                  avatarUrl: items[i].avatarUrl,
                                  accent: AppColors.accentOn(context),
                                  size: 44,
                                ),
                              ),
                              title: Text(
                                items[i].name,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              subtitle: Text(
                                items[i].phone,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                ],
              ),
        ),
      ),
    );
  }
}

/// The cadences a clinic actually works to.
///
/// Named rhythms rather than raw day counts, and only rhythms someone would
/// genuinely choose: 21 and 45 days are not intervals anyone thinks in, and
/// reviewing a *food* log after 60 days means reading what a patient ate two
/// months ago — an archive, not a review.
const _intervalOptions = <({int days, String label, String fits})>[
  (
    days: 1,
    label: 'Daily',
    fits: 'New diagnosis, insulin titration, pregnancy',
  ),
  (
    days: 3,
    label: 'Every 3 days',
    fits: 'Close watch while something is being changed',
  ),
  (days: 7, label: 'Weekly', fits: 'Active management'),
  (days: 14, label: 'Every 2 weeks', fits: 'Steady patients'),
  (days: 30, label: 'Monthly', fits: 'Stable, maintenance'),
];

String intervalLabel(int days) =>
    _intervalOptions
        .where((o) => o.days == days)
        .map((o) => o.label)
        .firstOrNull ??
    'Every $days days';

/// Picks the clinic-wide review cadence. Preset chips rather than a free number
/// field: the useful answers are a handful of rhythms, and a mistyped number
/// would drop the entire patient list into the dietician's queue at once.
class _IntervalSheet extends StatefulWidget {
  const _IntervalSheet({required this.current});

  final int current;

  @override
  State<_IntervalSheet> createState() => _IntervalSheetState();
}

class _IntervalSheetState extends State<_IntervalSheet> {
  late int _selected = widget.current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Food-log review',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'How often the dietician should review each patient’s food log. '
            'A patient becomes due once this many days have passed since the '
            'dietician last wrote to them.',
            style: TextStyle(
              fontSize: 14,
              height: 1.45,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final option in _intervalOptions)
            _IntervalRow(
              label: option.label,
              fits: option.fits,
              selected: _selected == option.days,
              onTap: () => setState(() => _selected = option.days),
            ),
          // A tight cadence is right for one patient and overwhelming as a
          // clinic default — every patient lands in the queue at once. Said
          // before they save, not discovered after.
          if (_selected <= 3) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.warningBgOn(context),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: Color(0xFFB45309),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      _selected == 1
                          ? 'Every patient will be due for review every day. Useful for a small '
                              'list; heavy going for a large one.'
                          : 'Every patient will be due every 3 days.',
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: Color(0xFFB45309),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            height: AppSpacing.minTapTarget + 6,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: () => Navigator.pop(context, _selected),
              child: const Text(
                'Save',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}

class _IntervalRow extends StatelessWidget {
  const _IntervalRow({
    required this.label,
    required this.fits,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String fits;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? AppColors.accentSoftOn(context) : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: 12,
          ),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 21,
                color: selected ? AppColors.primary : scheme.outline,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: selected ? AppColors.primary : scheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 0),
                    Text(
                      fits,
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Dietician {
  const _Dietician({
    required this.id,
    required this.name,
    required this.phone,
    this.avatarUrl,
  });

  final String id;
  final String name;
  final String phone;

  /// The dietician's own photo, whatever it is right now — the doctor should
  /// recognise the person they are handing patients to.
  final String? avatarUrl;

  factory _Dietician.fromJson(Map<String, dynamic> j) => _Dietician(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    phone: j['phone']?.toString() ?? '',
    avatarUrl: j['avatarUrl']?.toString(),
  );
}

/// Creates a dietician account. Validated against the same rules the login and
/// register forms use, so an account made here behaves like any other.
class _AddDieticianSheet extends ConsumerStatefulWidget {
  const _AddDieticianSheet();

  @override
  ConsumerState<_AddDieticianSheet> createState() => _AddDieticianSheetState();
}

class _AddDieticianSheetState extends ConsumerState<_AddDieticianSheet> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();

  /// Hidden until the first submit attempt, exactly as the login and register
  /// forms behave — errors that appear while someone is still typing the first
  /// character read as the form scolding them.
  AutovalidateMode _autovalidateMode = AutovalidateMode.disabled;

  String? _serverError;
  bool _obscure = true;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _serverError = null);
    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidateMode = AutovalidateMode.onUserInteraction);
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .addDietician(
            name: _name.text.trim(),
            phone: AuthValidators.toE164(_phone.text),
            password: _password.text,
          );
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _serverError = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
        MediaQuery.viewInsetsOf(context).bottom + AppSpacing.lg,
      ),
      child: Form(
        key: _formKey,
        autovalidateMode: _autovalidateMode,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'New dietician',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            Text(
              'They can sign in with this number and password.',
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              maxLength: AuthValidators.maxNameLength,
              decoration: const InputDecoration(
                labelText: 'Full name',
                prefixIcon: Icon(Icons.person_outline_rounded),
                counterText: '',
              ),
              validator: (v) {
                final name = (v ?? '').trim();
                if (name.isEmpty) return 'Enter their name.';
                if (name.length < AuthValidators.minNameLength) {
                  return 'Name must be at least ${AuthValidators.minNameLength} characters.';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              // Same as the login field: one limiter, in the formatters, so the
              // caret survives an edit in the middle of a full number.
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(10),
              ],
              decoration: const InputDecoration(
                labelText: 'Mobile number',
                hintText: '9830012345',
                prefixIcon: Icon(Icons.phone_outlined),
                prefixText: '${AuthValidators.countryCode} ',
                counterText: '',
              ),
              validator: (v) {
                final digits = AuthValidators.digitsOnly(v ?? '');
                if (digits.isEmpty) return 'Enter their mobile number.';
                if (digits.length != 10)
                  return 'A mobile number is exactly 10 digits.';
                if (!AuthValidators.isValidPhone(digits)) {
                  return 'Indian mobile numbers start with 6, 7, 8 or 9.';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _password,
              obscureText: _obscure,
              textInputAction: TextInputAction.done,
              maxLength: AuthValidators.maxPasswordLength,
              onFieldSubmitted: (_) => _saving ? null : _save(),
              decoration: InputDecoration(
                labelText: 'Password',
                prefixIcon: const Icon(Icons.lock_outline_rounded),
                counterText: '',
                // The rule stated before it is broken. It was only ever shown
                // as a validation error after a short password had been typed
                // and submitted, which teaches the requirement by failing the
                // person rather than by telling them.
                helperText:
                    'At least ${AuthValidators.minPasswordLength} characters. '
                    'They can change it after signing in.',
                helperMaxLines: 2,
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
              validator: (v) {
                final password = v ?? '';
                if (password.isEmpty) return 'Set a password for them.';
                if (password.length < AuthValidators.minPasswordLength) {
                  return 'At least ${AuthValidators.minPasswordLength} characters.';
                }
                return null;
              },
            ),
            if (_serverError != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _serverError!,
                style: TextStyle(
                  fontSize: 14,
                  color: AppColors.dangerOn(context),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            SizedBox(
              height: AppSpacing.minTapTarget + 6,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: _saving ? null : _save,
                child:
                    _saving
                        ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                        : const Text(
                          'Add dietician',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextButton(
              onPressed: _saving ? null : () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}
