import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../shared/widgets/clinic_brand.dart';

/// What patients have said about the clinic and about the app.
///
/// Kept out of the clinical-alert queue on purpose: a five-star note and a
/// hypo report must never share a list, or the list that matters gets skimmed.
///
/// Read-only by design. Feedback is written in the patient panel and read here;
/// the server enforces that split, so a clinician cannot post one and a patient
/// cannot read anyone else's.
final _feedbackProvider = FutureProvider.autoDispose<List<_Entry>>((ref) async {
  final data = await ref
      .read(apiClientProvider)
      .getJson('/feedback', query: {'limit': 100});
  final items = (data['items'] as List?) ?? const [];
  return items.map((e) => _Entry.fromJson(e as Map<String, dynamic>)).toList();
});

class FeedbackInboxScreen extends ConsumerStatefulWidget {
  const FeedbackInboxScreen({super.key});

  @override
  ConsumerState<FeedbackInboxScreen> createState() =>
      _FeedbackInboxScreenState();
}

class _FeedbackInboxScreenState extends ConsumerState<FeedbackInboxScreen> {
  String? _about;

  static const _filters = [
    (null, 'All'),
    ('clinic', 'The clinic'),
    ('app', 'The app'),
  ];

  Future<void> _markReviewed(_Entry entry) async {
    await ref
        .read(apiClientProvider)
        .postJson('/feedback/${entry.id}/reviewed');
    ref.invalidate(_feedbackProvider);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(authControllerProvider).user;
    final async = ref.watch(_feedbackProvider);

    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _BrandHeader(name: user?.name ?? '', avatarUrl: user?.avatarUrl),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => ref.invalidate(_feedbackProvider),
                child: async.when(
                  loading:
                      () => const Center(child: CircularProgressIndicator()),
                  error:
                      (_, _) => ListView(
                        children: [
                          const SizedBox(height: 140),
                          const Center(child: Text('Could not load feedback')),
                          const SizedBox(height: AppSpacing.md),
                          Center(
                            child: OutlinedButton(
                              onPressed:
                                  () => ref.invalidate(_feedbackProvider),
                              child: const Text('Retry'),
                            ),
                          ),
                        ],
                      ),
                  data: (all) {
                    final items =
                        _about == null
                            ? all
                            : all.where((e) => e.about == _about).toList();

                    return ListView(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.md,
                        AppSpacing.lg,
                        AppSpacing.md,
                        AppSpacing.xl,
                      ),
                      children: [
                        const Text(
                          'Patient Feedback',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w800,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          'Review and manage recent experiences reported by your patients.',
                          style: TextStyle(
                            fontSize: 16,
                            height: 1.4,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        Row(
                          children: [
                            for (final (value, label) in _filters) ...[
                              _FilterChip(
                                label: label,
                                selected: _about == value,
                                onTap: () => setState(() => _about = value),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                            ],
                          ],
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        if (items.isEmpty)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 70),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.rate_review_outlined,
                                  size: 50,
                                  color: scheme.outlineVariant,
                                ),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  _about == null
                                      ? 'Nothing here yet'
                                      : 'Nothing under this filter',
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Feedback patients send from their profile appears here.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          for (final entry in items)
                            _FeedbackCard(
                              entry: entry,
                              onReviewed: () => _markReviewed(entry),
                            ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.name, this.avatarUrl});

  final String name;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.sm,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.md,
      ),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: () => context.pop(),
            icon: Icon(Icons.arrow_back_rounded, color: scheme.onSurface),
          ),
          const Expanded(child: ClinicWordmark(height: 28, maxWidth: 180)),
          const SizedBox(width: AppSpacing.sm),
          UserAvatar(
            name: name,
            avatarUrl: avatarUrl,
            accent: AppColors.accentOn(context),
            size: 38,
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primary : AppColors.infoBgOn(context),
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : AppColors.primary,
            ),
          ),
        ),
      ),
    );
  }
}

class _FeedbackCard extends StatelessWidget {
  const _FeedbackCard({required this.entry, required this.onReviewed});

  final _Entry entry;
  final VoidCallback onReviewed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final unread = !entry.reviewed;
    final ink = unread ? scheme.onSurface : scheme.onSurfaceVariant;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The unread marker. A stripe rather than a dot: it runs the height
            // of the card, so a long list shows at a glance how much is still
            // outstanding without reading a word of it.
            Container(
              width: 5,
              color: unread ? AppColors.primary : Colors.transparent,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            entry.heading,
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              height: 1.25,
                              color: ink,
                            ),
                          ),
                        ),
                        // Stars only when the patient actually gave a rating.
                        // Five hollow stars over an unrated note would read as
                        // one star — the worst score they never gave.
                        if (entry.rating != null) ...[
                          const SizedBox(width: AppSpacing.sm),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              for (var i = 1; i <= 5; i++)
                                Icon(
                                  entry.rating! >= i
                                      ? Icons.star_rounded
                                      : Icons.star_outline_rounded,
                                  size: 20,
                                  color:
                                      unread
                                          ? AppColors.primary
                                          : scheme.onSurfaceVariant,
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                    if (entry.message.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        entry.message,
                        style: TextStyle(
                          fontSize: 14,
                          height: 1.45,
                          color: ink,
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.md),
                    Divider(
                      height: 1,
                      color: scheme.outlineVariant.withValues(alpha: 0.7),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        UserAvatar(
                          name: entry.patientName ?? '',
                          avatarUrl: entry.patientAvatarUrl,
                          accent: AppColors.accentOn(context),
                          size: 34,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          // Name, subject and the full timestamp on two lines
                          // rather than one ellipsised one. Under "All" the
                          // doctor cannot otherwise tell a complaint about care
                          // from one about the app — and a date cut off by an
                          // ellipsis is a date the doctor has to open the row
                          // to read.
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                entry.patientName ?? 'Patient',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                entry.aboutLabel +
                                    (entry.createdAt != null
                                        ? '  ·  ${DateFormat('d MMM yyyy, h:mm a').format(entry.createdAt!.toLocal())}'
                                        : ''),
                                maxLines: 2,
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
                    // The action on its own line, right-aligned. Beside the
                    // name it took a third of the row, so a patient with a
                    // long name and a subject-plus-timestamp underneath had
                    // both squeezed into an ellipsis by the button.
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (unread)
                          Material(
                            color: AppColors.infoBgOn(context),
                            borderRadius: BorderRadius.circular(20),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(20),
                              onTap: onReviewed,
                              child: Padding(
                                padding: EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons.check_circle_outline_rounded,
                                      size: 17,
                                      color: AppColors.accentOn(context),
                                    ),
                                    SizedBox(width: 4),
                                    Text(
                                      'Mark reviewed',
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
                          )
                        else
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                            decoration: BoxDecoration(
                              color: scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.done_all_rounded,
                                  size: 17,
                                  color: scheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  'Reviewed',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Entry {
  _Entry({
    required this.id,
    required this.about,
    required this.rating,
    required this.message,
    required this.reviewed,
    required this.createdAt,
    required this.patientName,
    this.patientAvatarUrl,
  });

  final String id;
  final String about;
  final int? rating;
  final String message;
  final bool reviewed;
  final DateTime? createdAt;
  final String? patientName;
  final String? patientAvatarUrl;

  String get aboutLabel => about == 'app' ? 'The app' : 'The clinic';

  /// The card's headline. Taken from the patient's own opening words rather
  /// than a separate subject field — asking for a title before they can say
  /// what happened is a second hurdle in front of a complaint, and the
  /// first clause is almost always what the note is about anyway.
  String get heading {
    final text = message.trim();
    if (text.isEmpty)
      return rating != null ? 'Rated $rating out of 5' : aboutLabel;

    final stop = text.indexOf(RegExp(r'[.!?\n]'));
    var head = stop > 0 ? text.substring(0, stop) : text;
    if (head.length > 42) head = '${head.substring(0, 42).trimRight()}…';
    return head;
  }

  factory _Entry.fromJson(Map<String, dynamic> json) => _Entry(
    id: json['id'].toString(),
    about: json['about'] as String? ?? 'clinic',
    rating: (json['rating'] as num?)?.toInt(),
    message: json['message'] as String? ?? '',
    reviewed: json['reviewed'] as bool? ?? false,
    createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
    patientName: json['patientName'] as String?,
    patientAvatarUrl: json['patientAvatarUrl'] as String?,
  );
}
