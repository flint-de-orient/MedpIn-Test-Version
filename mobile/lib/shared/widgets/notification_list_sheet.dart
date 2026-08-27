import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import 'user_avatar.dart';

/// One thing waiting for a clinician, whichever panel they are in.
class PanelNotification {
  const PanelNotification({
    required this.id,
    required this.kind,
    required this.patientId,
    required this.patientName,
    required this.text,
    this.avatarUrl,
    this.at,
    this.unread = false,
    this.handledBy,
  });

  final String id;

  /// urgent | alert | message | nutrition | review | plan
  ///
  /// Drives the mark and its colour, so the list can be triaged without reading
  /// every line.
  final String kind;

  final String patientId;
  final String patientName;
  final String text;
  final String? avatarUrl;
  final DateTime? at;
  final bool unread;

  /// Another clinician is already answering this conversation, by name.
  ///
  /// Null when nobody is, which is the only case in a single-clinician clinic.
  /// The row is shown either way — this list is the worklist, and hiding a
  /// patient's message because someone else replied last would mean that if
  /// they are away, nobody sees it at all. Saying who has it turns a duplicate
  /// alert into something the reader can act on.
  final String? handledBy;

  factory PanelNotification.fromJson(Map<String, dynamic> j) =>
      PanelNotification(
        id: j['id']?.toString() ?? '',
        kind: j['kind']?.toString() ?? 'message',
        patientId: j['patientId']?.toString() ?? '',
        patientName: j['patientName']?.toString() ?? '',
        text: j['text']?.toString() ?? '',
        avatarUrl: j['avatarUrl']?.toString(),
        at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
        unread: j['unread'] == true,
        handledBy: j['handledBy']?.toString(),
      );
}

/// What is waiting, as a sheet from the bottom of the screen.
///
/// A sheet rather than a screen because this is a glance, not a destination:
/// the reader wants to know whether anything needs them before deciding to go
/// anywhere, and a full screen with a back arrow makes that a trip.
///
/// Shared by the doctor and the dietician so the two cannot drift apart. What
/// differs between them is the data and where a row leads, both passed in.
class NotificationListSheet extends StatelessWidget {
  const NotificationListSheet({
    super.key,
    required this.items,
    required this.unread,
    required this.loading,
    required this.failed,
    required this.onRefresh,
    required this.onOpen,
    this.onMarkAllRead,
    this.emptyTitle = 'Nothing waiting',
    this.emptyBody = 'No unread messages and nothing flagged.',
  });

  final List<PanelNotification> items;
  final int unread;
  final bool loading;
  final bool failed;
  final VoidCallback onRefresh;

  /// Where a row leads. The sheet closes itself first.
  final void Function(PanelNotification item) onOpen;

  /// Clear the unread mark now, without closing. Omit it and no such action
  /// appears.
  final VoidCallback? onMarkAllRead;

  /// The rows a "seen" call actually clears: patient messages.
  ///
  /// The doctor's list also carries open alerts, and those arrive flagged
  /// unread because they are genuinely waiting — but nothing clears an alert
  /// except resolving it. Offering "Mark all read" over a list of five alerts
  /// and no messages gave the doctor a button that visibly did nothing: every
  /// row stayed tinted and the badge did not move. It is offered only when
  /// there is something it can honestly clear.
  static const _clearableKinds = {'message', 'nutrition'};

  Iterable<PanelNotification> get _clearable =>
      items.where((i) => i.unread && _clearableKinds.contains(i.kind));

  final String emptyTitle;
  final String emptyBody;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // Sized to what is in it. A fixed 62% of the screen meant one open alert
    // sat above half a screen of empty sheet, and a dozen items opened already
    // needing a scroll. Roughly one row per 88 logical pixels, plus the header,
    // clamped so it is never a sliver and never the whole screen.
    final rows = items.isEmpty ? 3 : items.length;
    final screen = MediaQuery.of(context).size.height;
    final initial = ((rows * 88 + 140) / screen).clamp(0.35, 0.92);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: initial,
      minChildSize: 0.35,
      maxChildSize: 0.92,
      builder:
          (context, controller) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  0,
                  AppSpacing.md,
                  AppSpacing.sm,
                ),
                child: Row(
                  children: [
                    const Text(
                      'Notifications',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (unread > 0)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.accentOn(context),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          unread > 99 ? '99+' : '$unread',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    const Spacer(),
                    // Clearing the badge without having to leave. It clears on
                    // close either way; this is for the reader who has looked and
                    // wants to see it go while they are still here.
                    if (onMarkAllRead != null && _clearable.isNotEmpty)
                      TextButton(
                        onPressed: onMarkAllRead,
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.accentOn(context),
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          visualDensity: VisualDensity.compact,
                        ),
                        // Named for what it will leave behind. On the
                        // dietician's list every unread row is a message, so
                        // it clears the lot; on the doctor's, the alerts stay,
                        // and a button saying "all" would have been claiming
                        // otherwise.
                        child: Text(
                          _clearable.length ==
                                  items.where((i) => i.unread).length
                              ? 'Mark all read'
                              : 'Mark messages read',
                          style: const TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    IconButton(
                      onPressed: onRefresh,
                      icon: const Icon(Icons.refresh_rounded),
                      tooltip: 'Refresh',
                      color: scheme.onSurfaceVariant,
                    ),
                  ],
                ),
              ),
              Divider(
                height: 1,
                color: scheme.outlineVariant.withValues(alpha: 0.5),
              ),
              Expanded(
                child: switch ((loading, failed, items.isEmpty)) {
                  (true, _, true) => const Center(
                    child: CircularProgressIndicator(),
                  ),
                  (_, true, _) => _Empty(
                    icon: Icons.cloud_off_rounded,
                    title: 'Could not load notifications',
                    body: 'Check your connection and try again.',
                  ),
                  (_, _, true) => _Empty(
                    icon: Icons.done_all_rounded,
                    title: emptyTitle,
                    body: emptyBody,
                  ),
                  _ => ListView.separated(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      AppSpacing.sm,
                      AppSpacing.md,
                      AppSpacing.xl,
                    ),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 4),
                    itemBuilder:
                        (context, i) => _Row(item: items[i], onOpen: onOpen),
                  ),
                },
              ),
            ],
          ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.item, required this.onOpen});

  final PanelNotification item;
  final void Function(PanelNotification item) onOpen;

  /// "4m", "3h", "2d" — enough to say how stale, in the space of a chip.
  static String _ago(DateTime? at) {
    if (at == null) return '';
    final d = DateTime.now().difference(at);
    if (d.inMinutes < 1) return 'now';
    if (d.inMinutes < 60) return '${d.inMinutes}m';
    if (d.inHours < 24) return '${d.inHours}h';
    if (d.inDays < 7) return '${d.inDays}d';
    return DateFormat('d MMM').format(at);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);

    // Red is spent only on the one kind that means somebody may be unwell. A
    // list where everything is red is a list nobody triages.
    final (IconData icon, Color tint) = switch (item.kind) {
      'urgent' => (Icons.priority_high_rounded, AppColors.dangerOn(context)),
      'alert' => (Icons.warning_amber_rounded, AppColors.warningOn(context)),
      'review' => (Icons.flag_rounded, AppColors.warningOn(context)),
      'nutrition' => (Icons.restaurant_rounded, accent),
      'plan' => (Icons.assignment_outlined, accent),
      _ => (Icons.chat_bubble_rounded, accent),
    };
    final urgent = item.kind == 'urgent';

    return Material(
      color:
          urgent
              ? AppColors.dangerOn(context).withValues(alpha: 0.06)
              : item.unread
              ? accent.withValues(alpha: 0.06)
              : scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => onOpen(item),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.sm + 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color:
                  urgent
                      ? AppColors.dangerOn(context).withValues(alpha: 0.35)
                      : item.unread
                      ? accent.withValues(alpha: 0.25)
                      : scheme.outlineVariant.withValues(alpha: 0.55),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  UserAvatar(
                    name: item.patientName,
                    avatarUrl: item.avatarUrl,
                    accent: accent,
                    size: 42,
                  ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      width: 19,
                      height: 19,
                      decoration: BoxDecoration(
                        color: tint,
                        shape: BoxShape.circle,
                        border: Border.all(color: scheme.surface, width: 2),
                      ),
                      child: Icon(icon, size: 10, color: Colors.white),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.patientName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight:
                                  item.unread
                                      ? FontWeight.w800
                                      : FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _ago(item.at),
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 0),
                    Text(
                      item.text,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.35,
                        color:
                            urgent
                                ? AppColors.dangerOn(context)
                                : item.unread
                                ? scheme.onSurface
                                : scheme.onSurfaceVariant,
                      ),
                    ),
                    if (item.handledBy != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(
                            Icons.how_to_reg_outlined,
                            size: 14,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              '${item.handledBy} is answering this',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
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

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 42, color: scheme.outlineVariant),
            const SizedBox(height: AppSpacing.md),
            Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            Text(
              body,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                height: 1.4,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
