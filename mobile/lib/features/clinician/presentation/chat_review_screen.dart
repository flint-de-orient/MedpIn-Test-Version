import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';
import '../domain/chat_review.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_visuals.dart';

/// Assistant-conversation review: the threads the assistant or a patient
/// flagged for a clinician to check.
class ChatReviewScreen extends ConsumerStatefulWidget {
  const ChatReviewScreen({super.key, this.initialTab});

  /// `nutrition` | `all` | `flagged`. Null opens on the flagged queue.
  final String? initialTab;

  @override
  ConsumerState<ChatReviewScreen> createState() => _ChatReviewScreenState();
}

/// The two views of the review queue. (Nutrition conversations now have their
/// own top-level Nutrition tab, so they are no longer a filter here — chat
/// review is purely the clinical care threads.)
enum _ReviewTab { flagged, all }

class _ChatReviewScreenState extends ConsumerState<ChatReviewScreen> {
  late _ReviewTab _tab =
      widget.initialTab == 'all' ? _ReviewTab.all : _ReviewTab.flagged;

  ChatReviewQuery get _query => (
    flagged: _tab == _ReviewTab.flagged,
    urgency: null,
    kind: 'care',
  );

  /// What the doctor has typed into the search box.
  String _search = '';

  /// Name match, case-insensitive. A doctor looking for one conversation among
  /// a clinic's worth of them was scrolling for it — the flagged list is short,
  /// but "All chats" is every patient who has ever written.
  List<ChatReviewSession> _filter(List<ChatReviewSession> items) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where((s) => (s.patientName ?? '').toLowerCase().contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(chatReviewProvider(_query));
    // A refresh that fails keeps what was on screen, and says so once rather
    // than letting stale conversations pass for current.
    ref.listen(chatReviewProvider(_query), (previous, next) {
      if (next.hasError && next.hasValue && !(previous?.hasError ?? false)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not refresh. Showing what was last loaded.')),
        );
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat review'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(108),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.sm,
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (final (tab, label) in const [
                      (_ReviewTab.flagged, 'Flagged'),
                      (_ReviewTab.all, 'All chats'),
                    ]) ...[
                      ChoiceChip(
                        label: Text(label),
                        selected: _tab == tab,
                        onSelected: (_) => setState(() => _tab = tab),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  onChanged: (v) => setState(() => _search = v),
                  style: const TextStyle(fontSize: 15.5),
                  decoration: InputDecoration(
                    hintText: 'Search by patient name…',
                    prefixIcon: Icon(
                      Icons.search_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                    suffixIcon:
                        _search.isEmpty
                            ? null
                            : IconButton(
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () => setState(() => _search = ''),
                            ),
                    filled: true,
                    fillColor: scheme.surfaceContainerHigh.withValues(
                      alpha: 0.55,
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      // Flagged conversations arrive while the doctor is looking at the list.
      // The nutrition inbox beside it has always polled; this one waited for a
      // pull, so the two tabs disagreed about how much was waiting.
      body: AutoRefresh(
        onTick: (ref) => ref.invalidate(chatReviewProvider(_query)),
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(chatReviewProvider(_query)),
          child: async.when(
            // A refresh that fails keeps the list; it was wiped for an error.
            skipError: true,
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load conversations'),
                      const SizedBox(height: AppSpacing.sm),
                      OutlinedButton(
                        onPressed:
                            () => ref.invalidate(chatReviewProvider(_query)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
            data: (paged) {
              final shown = _filter(paged.items);
              if (shown.isEmpty) {
                return ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.2),
                    Icon(
                      Icons.forum_outlined,
                      size: 56,
                      color: scheme.outlineVariant,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Center(
                      child: Text(
                        // Says which of the two produced nothing — an empty
                        // list after typing is a search result, not an empty
                        // clinic, and confusing the two sends the reader
                        // looking for a bug.
                        _search.trim().isNotEmpty
                            ? 'No patient matches “${_search.trim()}”'
                            : switch (_tab) {
                              _ReviewTab.flagged => 'No flagged conversations',
                              _ReviewTab.all => 'No conversations',
                            },
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                );
              }
              return ListView.separated(
                padding: EdgeInsets.zero,
                itemCount: shown.length,
                separatorBuilder:
                    (_, _) => Divider(
                      height: 1,
                      indent: 76,
                      color: scheme.outlineVariant.withValues(alpha: 0.5),
                    ),
                itemBuilder:
                    (context, i) => _SessionRow(
                      session: shown[i],
                      onTap:
                          () => context.push(
                            '/clinician/chat-review/${shown[i].id}',
                          ),
                      onCleared:
                          () => ref.invalidate(chatReviewProvider(_query)),
                    ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _SessionRow extends ConsumerWidget {
  const _SessionRow({
    required this.session,
    required this.onTap,
    required this.onCleared,
  });

  final ChatReviewSession session;
  final VoidCallback onTap;

  /// Called after the flag is cleared, so the list can refetch.
  final VoidCallback onCleared;

  /// Clears the review flag without opening the conversation.
  ///
  /// The doctor could only unflag from inside a thread, so a queue of old
  /// flags could only be cleared by opening every one of them — and a queue
  /// nobody can clear stops being read at all, which is the failure mode that
  /// matters when the next flag is a real emergency.
  Future<void> _clearFlag(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(clinicianRepositoryProvider).markReviewed(session.id);
      onCleared();
      messenger.showSnackBar(const SnackBar(content: Text('Flag cleared')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// `10:42 AM` today, `Yesterday`, a weekday within the week, else `12 Oct` —
  /// the same stamp the Patients tab uses.
  String _stamp(DateTime at) {
    final now = DateTime.now();
    final day = DateTime(at.year, at.month, at.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(day).inDays;
    if (diff == 0) {
      final h = at.hour % 12 == 0 ? 12 : at.hour % 12;
      return '$h:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'AM' : 'PM'}';
    }
    if (diff == 1) return 'Yesterday';
    if (diff < 7)
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][at.weekday - 1];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${at.day} ${months[at.month - 1]}';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final s = session;
    final msg = s.lastMessage;
    final unread = s.unreadCount > 0;
    final urgent =
        s.highestUrgency == 'emergency' || s.highestUrgency == 'urgent';
    final urgencyColor = AppColors.forUrgencyOn(context, s.highestUrgency);

    // The same row the Patients tab uses: a face, the last thing said (and by
    // whom), when, and the review tags — so review reads like the inbox it is.
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 12,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            UserAvatar(
              name: s.patientName ?? 'Patient',
              avatarUrl: s.avatarUrl,
              accent: urgent ? AppColors.danger : AppColors.primary,
              size: 48,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          s.patientName ?? 'Patient',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight:
                                unread ? FontWeight.w800 : FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (msg != null)
                        Text(
                          _stamp(msg.at),
                          style: TextStyle(
                            fontSize: 14,
                            color:
                                unread
                                    ? AppColors.primary
                                    : scheme.onSurfaceVariant,
                            fontWeight:
                                unread ? FontWeight.w700 : FontWeight.w400,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              if (msg == null)
                                const TextSpan(text: 'No messages yet')
                              else ...[
                                if (msg.fromAssistant)
                                  const TextSpan(text: 'Assistant: ')
                                else if (!msg.fromPatient)
                                  const TextSpan(text: 'Clinic: '),
                                if (msg.mediaType != null)
                                  WidgetSpan(
                                    alignment: PlaceholderAlignment.middle,
                                    child: Padding(
                                      padding: const EdgeInsets.only(right: 4),
                                      child: Icon(
                                        _mediaIcon(msg.mediaType!),
                                        size: 15,
                                        color:
                                            unread
                                                ? scheme.onSurface
                                                : scheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                TextSpan(
                                  text: MarkdownText.toPreview(msg.preview),
                                ),
                              ],
                            ],
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.35,
                            color:
                                msg == null
                                    ? scheme.outline
                                    : unread
                                    ? scheme.onSurface
                                    : scheme.onSurfaceVariant,
                            fontWeight:
                                unread ? FontWeight.w600 : FontWeight.w400,
                          ),
                        ),
                      ),
                      if (unread) ...[
                        const SizedBox(width: 8),
                        Container(
                          constraints: const BoxConstraints(minWidth: 22),
                          height: 22,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.accentOn(context),
                            borderRadius: const BorderRadius.all(
                              Radius.circular(12),
                            ),
                          ),
                          child: Text(
                            s.unreadCount > 99 ? '99+' : '${s.unreadCount}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  // The review tags: urgency, the flag, and the clear/reviewed
                  // action that used to be the row's only real content.
                  Row(
                    children: [
                      if (s.highestUrgency != 'routine')
                        MiniPill(
                          label: s.highestUrgency.toUpperCase(),
                          color: urgencyColor,
                        ),
                      if (s.flaggedForReview) ...[
                        const SizedBox(width: 4),
                        Icon(
                          Icons.flag_rounded,
                          size: 16,
                          color: AppColors.warningOn(context),
                        ),
                      ],
                      const Spacer(),
                      if (s.flaggedForReview)
                        TextButton.icon(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            foregroundColor: scheme.onSurfaceVariant,
                          ),
                          onPressed: () => _clearFlag(context, ref),
                          icon: const Icon(Icons.flag_outlined, size: 15),
                          label: const Text(
                            'Clear flag',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        )
                      else if (s.reviewedAt != null)
                        Row(
                          children: [
                            Icon(
                              Icons.check_circle_rounded,
                              size: 13,
                              color: AppColors.successOn(context),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'Reviewed',
                              style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A subtle monochrome icon for a media last-message, matching the Patients tab.
IconData _mediaIcon(String type) {
  switch (type) {
    case 'voice':
      return Icons.mic_none_rounded;
    case 'photo':
      return Icons.photo_camera_rounded;
    case 'pdf':
      return Icons.picture_as_pdf_rounded;
    case 'document':
      return Icons.description_rounded;
    default:
      return Icons.attach_file_rounded;
  }
}
