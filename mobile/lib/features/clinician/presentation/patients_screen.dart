import 'dart:async';

import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/panel_ui.dart';
import 'widgets/clinician_notification_sheet.dart';

/// The clinician's inbox.
///
/// Deliberately a conversation list rather than a clinical directory: reaching a
/// waiting patient is the daily job, and the question the doctor opens the app
/// to answer is "who is waiting on me", not "who has the worst HbA1c". Risk and
/// alerts still appear, but as marks on a row, not as the organising principle.
///
/// Rows sort unread-first, then by most recent message, so the list orders
/// itself around that question without the doctor having to filter.
class PatientsScreen extends ConsumerStatefulWidget {
  const PatientsScreen({super.key});

  @override
  ConsumerState<PatientsScreen> createState() => _PatientsScreenState();
}

class _PatientsScreenState extends ConsumerState<PatientsScreen>
    with WidgetsBindingObserver {
  final _searchController = TextEditingController();
  String _search = '';
  Timer? _debounce;
  Timer? _poll;

  /// Only unread conversations, when the doctor wants the queue and nothing else.
  bool _unreadOnly = false;

  /// The inbox is only useful if it is current. There is no socket, so it
  /// re-reads on a timer while on screen and immediately on resume.
  ///
  /// Matched to the conversation screens rather than the twenty seconds a list
  /// view would normally justify: this is the screen a doctor sits on while
  /// waiting for a patient to reply, and a message that takes twenty seconds to
  /// appear reads as the app being broken.
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
    // Returning from the background is the likeliest moment for a new message
    // to have arrived, so check at once rather than waiting out the timer.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (!mounted) return;
    ref.invalidate(patientsProvider(_query));
  }

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _search = v.trim());
    });
  }

  PatientsQuery get _query => (
    riskBand: null,
    search: _search.isEmpty ? null : _search,
    sort: 'name',
  );

  /// Unread first, then newest message. A patient who has never written sinks
  /// to the bottom — there is nothing waiting there.
  List<PatientListItem> _ordered(List<PatientListItem> items) {
    final list = [...items];
    list.sort((a, b) {
      if ((a.unreadCount > 0) != (b.unreadCount > 0))
        return a.unreadCount > 0 ? -1 : 1;
      final at = a.lastMessage?.at;
      final bt = b.lastMessage?.at;
      if (at == null && bt == null) return a.name.compareTo(b.name);
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final asyncRaw = ref.watch(patientsProvider(_query));
    // Hold the last list while a refresh is in flight. The screen polls, and
    // every tick dropped the whole list to a spinner and back — which is the
    // flicker you see, most obviously at the moment you tap the toggle and are
    // actually looking at it.
    final loaded = asyncRaw.valueOrNull;
    final async = loaded != null ? AsyncData(loaded) : asyncRaw;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      // Desk intake: register a walk-in patient without leaving the directory.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/clinician/patients/new'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: const Text('Add patient'),
      ),
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
                    // Clear of the "Add patient" button. AppSpacing.xl is 32,
                    // and an extended FAB plus its margin is nearer 90 — so the
                    // last patient in the list sat underneath it, which is the
                    // one place a list must stay readable to the end.
                    96,
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
                                const Text('Could not load messages'),
                                const SizedBox(height: AppSpacing.sm),
                                OutlinedButton(
                                  onPressed: _refresh,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                      data: (paged) {
                        var items = _ordered(paged.items);
                        if (_unreadOnly)
                          items =
                              items.where((p) => p.unreadCount > 0).toList();

                        if (items.isEmpty) {
                          // Three different nothings, and they mean opposite
                          // things. A search with no match is a typo; nothing
                          // unread is the clinic being on top of its messages;
                          // an empty roll is a clinic with no patients yet.
                          // One shrug for all three left the doctor unable to
                          // tell "you are done" from "this is broken".
                          final searching = _search.isNotEmpty;
                          final (icon, title, body, action) = switch ((
                            searching,
                            _unreadOnly,
                          )) {
                            (true, _) => (
                              Icons.search_off_rounded,
                              'No patient matches “$_search”',
                              'Check the spelling, or clear the search to see '
                                  'everyone.',
                              'Clear search',
                            ),
                            (false, true) => (
                              Icons.mark_email_read_outlined,
                              'Nothing unread',
                              'Every patient message has been read. New ones '
                                  'appear here as they arrive.',
                              'Show all conversations',
                            ),
                            (false, false) => (
                              Icons.forum_outlined,
                              'No conversations yet',
                              'When a patient writes in, their message opens a '
                                  'thread here.',
                              null,
                            ),
                          };

                          return Padding(
                            padding: const EdgeInsets.fromLTRB(
                              AppSpacing.lg,
                              40,
                              AppSpacing.lg,
                              40,
                            ),
                            child: Column(
                              children: [
                                Icon(
                                  icon,
                                  size: 52,
                                  color: scheme.outlineVariant,
                                ),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  title,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.xs),
                                Text(
                                  body,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    height: 1.4,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                                if (action != null) ...[
                                  const SizedBox(height: AppSpacing.md),
                                  OutlinedButton(
                                    onPressed: () {
                                      setState(() {
                                        if (searching) {
                                          _searchController.clear();
                                          _search = '';
                                        } else {
                                          _unreadOnly = false;
                                        }
                                      });
                                    },
                                    child: Text(action),
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
                                      // No severity rail. The row already
                                      // carries a NEEDS ATTENTION tag and a red
                                      // timestamp; a third marker for the same
                                      // fact just made the card look striped.
                                      Expanded(
                                        child: Material(
                                          color: Colors.transparent,
                                          child: _ConversationRow(
                                            patient: it,
                                            onTap:
                                                () => context.push(
                                                  '/clinician/patients/${it.id}/thread',
                                                  extra: it.name,
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

/// Brand row. Uses the app's own mark, not a generic medical cross.
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
          // The app's own emblem, not a generic medical cross.
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
    return Padding(
      padding: EdgeInsets.zero,
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        style: const TextStyle(fontSize: 16),
        decoration: InputDecoration(
          hintText: 'Search by name or number…',
          prefixIcon: Icon(
            Icons.search_rounded,
            color: scheme.onSurfaceVariant,
          ),
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
        // Title and filter share a line: the heading names the screen, the
        // control sits at the far edge where a control belongs, and the pair
        // reads as one bar instead of two stacked blocks.
        Row(
          children: [
            const Expanded(
              child: Text(
                'Care Inbox',
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

/// One segment of the pill toggle — the selected one lifts onto a white pill.
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
          color: selected ? scheme.surfaceContainerLowest : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          boxShadow:
              selected
                  ? [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.06),
                      blurRadius: 6,
                      offset: const Offset(0, 1),
                    ),
                  ]
                  : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

/// One conversation. Reads top-to-bottom as: who, when, what was last said,
/// and whether it needs the doctor.
class _ConversationRow extends StatelessWidget {
  const _ConversationRow({required this.patient, required this.onTap});

  final PatientListItem patient;
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

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final msg = patient.lastMessage;
    final unread = patient.unreadCount > 0;
    final emergency = msg?.urgency == 'emergency' || msg?.urgency == 'urgent';

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
              name: patient.name,
              avatarUrl: patient.avatarUrl,
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
                          patient.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 16,
                            // Unread rows carry the weight, so the queue is
                            // visible without reading a single word.
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
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              if (msg == null)
                                const TextSpan(text: 'No messages yet')
                              else ...[
                                // Say who spoke, so "answered" and "waiting" are
                                // distinguishable at a glance.
                                if (!msg.fromPatient)
                                  const TextSpan(text: 'You: '),
                                // A subtle monochrome icon for a media turn —
                                // premium, not a cheap emoji.
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
                      // WhatsApp-style unread count: a green disc with just the
                      // number, on the right of the preview line. Expands to a
                      // pill for two digits, "99+" beyond.
                      if (unread) ...[
                        const SizedBox(width: 8),
                        Container(
                          constraints: const BoxConstraints(minWidth: 22),
                          height: 22,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.accentOn(context),
                            borderRadius: BorderRadius.all(Radius.circular(12)),
                          ),
                          child: Text(
                            patient.unreadCount > 99
                                ? '99+'
                                : '${patient.unreadCount}',
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
                  // Status tags only — "Needs attention" and "Check-in due" flow
                  // onto one line (wrapping if a narrow phone needs it), and only
                  // the ones that apply are shown.
                  if (emergency || patient.checkInOverdue) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (emergency)
                          _Chip(
                            label: 'Needs attention',
                            fg: AppColors.dangerOn(context),
                            bg: AppColors.dangerBgOn(context),
                            icon: Icons.priority_high_rounded,
                          ),
                        if (patient.checkInOverdue)
                          _Chip(
                            label: 'Check-in due',
                            fg: AppColors.warningOn(context),
                            bg: AppColors.warningBgOn(context),
                            icon: Icons.schedule_rounded,
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
    );
  }
}

/// Subtle inbox-preview icon for a media turn — a monochrome Material glyph, not
/// an emoji, so the row reads as premium.
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

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.fg,
    required this.bg,
    required this.icon,
  });

  final String label;
  final Color fg;
  final Color bg;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: fg),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }
}
