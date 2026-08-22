import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/chat_review.dart';
import 'clinician_providers.dart';
import 'widgets/panel_ui.dart';
import 'widgets/clinician_notification_sheet.dart';

/// The doctor's Nutrition tab: every dietician↔patient conversation as an inbox,
/// built to read exactly like the Patients tab — a brand header carrying the
/// doctor's own photo, a search field, then one row per patient showing their
/// photo, the latest message and when it landed. Tapping a row opens the thread
/// in the same WhatsApp chat UI, where the doctor reads the exchange and can
/// step in to guide when something needs correcting.
class NutritionInboxScreen extends ConsumerStatefulWidget {
  const NutritionInboxScreen({super.key});

  @override
  ConsumerState<NutritionInboxScreen> createState() =>
      _NutritionInboxScreenState();
}

class _NutritionInboxScreenState extends ConsumerState<NutritionInboxScreen>
    with WidgetsBindingObserver {
  static const ChatReviewQuery _query = (
    flagged: false,
    urgency: null,
    kind: 'nutrition',
  );

  final _searchController = TextEditingController();
  String _search = '';
  Timer? _debounce;
  Timer? _poll;

  /// Only unread conversations, when the doctor wants the queue and nothing else.
  bool _unreadOnly = false;

  /// Same cadence as the Patients inbox: no socket, so it re-reads on a short
  /// timer while on screen and immediately on resume, so a new dietician or
  /// patient message appears without the list looking broken.
  static const _pollInterval = Duration(seconds: 3);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) => _refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (mounted) ref.invalidate(chatReviewProvider(_query));
  }

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _search = v.trim().toLowerCase());
    });
  }

  /// Unread first, then newest message, then name — the same ordering as the
  /// Patients tab, so a waiting thread is always at the top.
  List<ChatReviewSession> _ordered(List<ChatReviewSession> items) {
    final list = [...items];
    list.sort((a, b) {
      if ((a.unreadCount > 0) != (b.unreadCount > 0))
        return a.unreadCount > 0 ? -1 : 1;
      final at = a.lastMessage?.at ?? a.lastMessageAt;
      final bt = b.lastMessage?.at ?? b.lastMessageAt;
      final an = a.patientName ?? '';
      final bn = b.patientName ?? '';
      if (at == null && bt == null) return an.compareTo(bn);
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
    return list;
  }

  /// Client-side filter over name and last message — the nutrition list is
  /// small enough that a round trip per keystroke would be wasted.
  bool _matches(ChatReviewSession s) {
    if (_search.isEmpty) return true;
    final name = (s.patientName ?? '').toLowerCase();
    final preview = (s.lastMessage?.preview ?? s.title).toLowerCase();
    return name.contains(_search) || preview.contains(_search);
  }

  @override
  Widget build(BuildContext context) {
    final asyncRaw = ref.watch(chatReviewProvider(_query));
    // Same hold as the Care inbox: the poll was replacing the list with a
    // spinner on every tick, which reads as a flicker when you tap the filter.
    final loaded = asyncRaw.valueOrNull;
    final async = loaded != null ? AsyncData(loaded) : asyncRaw;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const _InboxHeader(),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    AppSpacing.md,
                    AppSpacing.md,
                    AppSpacing.xl,
                  ),
                  children: [
                    _SectionBar(
                      unreadOnly: _unreadOnly,
                      onSelect: (v) => setState(() => _unreadOnly = v),
                    ),
                    _SearchField(
                      controller: _searchController,
                      onChanged: _onSearchChanged,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    async.when(
                      loading:
                          () => const Padding(
                            padding: EdgeInsets.symmetric(vertical: 60),
                            child: Center(child: CircularProgressIndicator()),
                          ),
                      error:
                          (_, _) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 40),
                            child: Column(
                              children: [
                                const Text('Could not load conversations'),
                                const SizedBox(height: AppSpacing.sm),
                                OutlinedButton(
                                  onPressed: _refresh,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                      data: (paged) {
                        var items =
                            _ordered(paged.items).where(_matches).toList();
                        if (_unreadOnly)
                          items =
                              items.where((s) => s.unreadCount > 0).toList();

                        if (items.isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 40),
                            child: Column(
                              children: [
                                Icon(
                                  _unreadOnly
                                      ? Icons.mark_email_read_outlined
                                      : Icons.restaurant_menu_rounded,
                                  size: 52,
                                  color: scheme.outlineVariant,
                                ),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  _search.isNotEmpty
                                      ? 'No matches'
                                      : _unreadOnly
                                      ? 'Nothing unread'
                                      : 'No nutrition conversations yet',
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                if (_unreadOnly && _search.isEmpty) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Every conversation has been read.',
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                  const SizedBox(height: AppSpacing.md),
                                  FilledButton.tonalIcon(
                                    onPressed:
                                        () => setState(() => _unreadOnly = false),
                                    icon: const Icon(
                                      Icons.forum_outlined,
                                      size: 18,
                                    ),
                                    label: const Text('Show all conversations'),
                                  ),
                                ],
                                if (_search.isEmpty && !_unreadOnly) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Dietician–patient chats appear here',
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          );
                        }

                        // A separate card per conversation (per the redesign),
                        // with a red rail on anything flagged urgent/emergency.
                        return Column(
                          children: [
                            for (final it in items)
                              Container(
                                margin: const EdgeInsets.only(
                                  bottom: AppSpacing.sm,
                                ),
                                decoration: BoxDecoration(
                                  color: scheme.surfaceContainerLowest,
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(
                                    color: scheme.outlineVariant.withValues(
                                      alpha: 0.22,
                                    ),
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(
                                        alpha: 0.04,
                                      ),
                                      blurRadius: 14,
                                      offset: const Offset(0, 3),
                                    ),
                                  ],
                                ),
                                clipBehavior: Clip.antiAlias,
                                child: IntrinsicHeight(
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      if (it.highestUrgency == 'emergency' ||
                                          it.highestUrgency == 'urgent')
                                        Container(
                                          width: 4,
                                          color: AppColors.danger,
                                        ),
                                      Expanded(
                                        child: Material(
                                          color: Colors.transparent,
                                          child: _ConversationRow(
                                            session: it,
                                            onTap:
                                                () => context.push(
                                                  '/clinician/chat-review/${it.id}',
                                                ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        );
                      },
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

/// Brand row. The app's own mark plus the doctor's photo, tapping through to
/// their settings — identical to the Patients tab so the tabs feel like one app.
class _InboxHeader extends ConsumerWidget {
  const _InboxHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(authControllerProvider).user;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
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
          Image.asset(
            'assets/brand/medpin_emblem.png',
            height: 30,
            errorBuilder:
                (_, _, _) => Icon(
                  Icons.forum_rounded,
                  size: 26,
                  color: AppColors.accentOn(context),
                ),
          ),
          const SizedBox(width: 8),
          Text(
            'MedPin',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.accentOn(context),
            ),
          ),
          const Spacer(),
          PanelNotificationBell(
            onTap: () => showClinicianNotifications(context),
          ),
          const SizedBox(width: 4),
          GestureDetector(
            // `go`, not `push`: Profile is one of this shell's own tabs, so
            // pushing it stacked a copy while the bar kept the old tab lit.
            onTap: () => context.go('/clinician/more'),
            child: UserAvatar(
              name: user?.name ?? '',
              avatarUrl: user?.avatarUrl,
              accent: AppColors.accentOn(context),
              size: 38,
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: const TextStyle(fontSize: 16),
      decoration: InputDecoration(
        hintText: 'Search patients or messages…',
        prefixIcon: Icon(Icons.search_rounded, color: scheme.onSurfaceVariant),
        filled: true,
        fillColor: scheme.surfaceContainerHigh.withValues(alpha: 0.55),
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.35),
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.35),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(
            color: AppColors.accentOn(context),
            width: 1.6,
          ),
        ),
      ),
    );
  }
}

class _SectionBar extends StatelessWidget {
  const _SectionBar({required this.unreadOnly, required this.onSelect});

  final bool unreadOnly;
  final ValueChanged<bool> onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Title and filter share a line, matching the Care inbox exactly — the
        // heading names the screen, the control sits at the far edge.
        Row(
          children: [
            const Expanded(
              child: Text(
                'Nutrition Inbox',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _Seg(
                    label: 'Unread',
                    selected: unreadOnly,
                    onTap: () => onSelect(true),
                  ),
                  _Seg(
                    label: 'All',
                    selected: !unreadOnly,
                    onTap: () => onSelect(false),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
      ],
    );
  }
}

class _Seg extends StatelessWidget {
  const _Seg({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          // Filled, not merely lifted. The selected pill used to be
          // surfaceContainerLowest on surfaceContainerHigh — two neighbouring
          // greys, which is a difference the reader has to look for rather than
          // one they see.
          color: selected ? AppColors.accentOn(context) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : scheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

/// One nutrition conversation. Reads top-to-bottom as: who, when, what was last
/// said (and by whom), and whether it is waiting on the doctor.
class _ConversationRow extends StatelessWidget {
  const _ConversationRow({required this.session, required this.onTap});

  final ChatReviewSession session;
  final VoidCallback onTap;

  /// `10:42 AM` today, `Yesterday`, a weekday within the week, else `12 Oct`.
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
    if (diff < 7) {
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][at.weekday - 1];
    }
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

  /// Who spoke last, so "waiting on you" and "already answered" are one glance
  /// apart. The patient carries no prefix (it is their thread); everyone else
  /// gets a short label.
  String _rolePrefix(String role) {
    switch (role) {
      case 'dietician':
        return 'Dietician: ';
      case 'clinician':
        return 'You: ';
      case 'assistant':
        return 'AI: ';
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final msg = session.lastMessage;
    final unread = session.unreadCount > 0;
    final name = session.patientName ?? 'Patient';
    final at = msg?.at ?? session.lastMessageAt;
    final emergency =
        session.highestUrgency == 'emergency' ||
        session.highestUrgency == 'urgent';

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
              name: name,
              avatarUrl: session.avatarUrl,
              accent: emergency ? AppColors.danger : AppColors.primary,
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
                          name,
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
                      if (at != null)
                        Text(
                          _stamp(at),
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
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              if (msg == null)
                                TextSpan(
                                  text:
                                      session.title.isEmpty
                                          ? 'No messages yet'
                                          : session.title,
                                )
                              else ...[
                                if (_rolePrefix(msg.role).isNotEmpty)
                                  TextSpan(text: _rolePrefix(msg.role)),
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
                            session.unreadCount > 99
                                ? '99+'
                                : '${session.unreadCount}',
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
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

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
