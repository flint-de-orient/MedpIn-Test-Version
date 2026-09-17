import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/chat_review.dart';
import 'clinician_providers.dart';
import 'widgets/clinic_title.dart';
import 'widgets/clinician_notification_sheet.dart';
import 'widgets/conversation_row.dart';
import 'widgets/inbox_states.dart';
import 'widgets/panel_ui.dart';

/// The doctor's Nutrition tab: every dietician↔patient conversation, so the
/// doctor can follow them and step in when something needs correcting.
///
/// ---- What changed, and why -------------------------------------------------
///
/// The header said MedPin — the product's emblem stood in for a clinic without
/// a logo — and the doctor's own avatar read "D", the initial of "Dr.". It is
/// the clinic's name now, and the doctor's own initial.
///
/// "Nutrition Inbox", in title case, shared a line with the Unread/All switch
/// and wrapped onto two lines to make room for it. The title has its own line.
///
/// An urgent thread was marked by a red rail down its card and nothing else.
/// It says "Urgent" now, in words, on the row.
///
/// A poll that failed after a good load was hidden altogether — the list sat
/// there unmarked while the connection was down. It stays, and says since when.
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
  final _loadedAt = LoadedAt();
  String _search = '';
  Timer? _debounce;
  Timer? _poll;

  /// Only unread conversations, when the doctor wants the queue and nothing
  /// else.
  bool _unreadOnly = false;

  /// No socket, so the list re-reads on a short timer while on screen and
  /// immediately on resume.
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
    if (!mounted) return;
    // Nothing to fetch for a role that may not read conversations; asking
    // every three seconds would be three refusals a second's worth of noise.
    if (!mayReadConversations(ref.read(capabilitySetProvider))) return;
    ref.invalidate(chatReviewProvider(_query));
  }

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _search = v.trim().toLowerCase());
    });
  }

  void _clearSearch() {
    _debounce?.cancel();
    _searchController.clear();
    setState(() => _search = '');
  }

  /// Unread first, then newest message, then name — so a waiting thread is
  /// always at the top.
  List<ChatReviewSession> _ordered(List<ChatReviewSession> items) {
    final list = [...items];
    list.sort((a, b) {
      if ((a.unreadCount > 0) != (b.unreadCount > 0)) {
        return a.unreadCount > 0 ? -1 : 1;
      }
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

  /// Name and last message — the nutrition list is small enough that a round
  /// trip per keystroke would be wasted.
  bool _matches(ChatReviewSession s) {
    if (_search.isEmpty) return true;
    final name = (s.patientName ?? '').toLowerCase();
    final preview = (s.lastMessage?.preview ?? s.title).toLowerCase();
    return name.contains(_search) || preview.contains(_search);
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(capabilitySetProvider);
    final mayRead = mayReadConversations(caps);

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this screen and
      // the navigation bar alike.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async => _refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s8),
            children: [
              const _InboxHeader(),
              const SizedBox(height: T.s5),
              Text('Nutrition inbox', style: T.display.copyWith(color: T.ink)),
              const SizedBox(height: T.s1),
              Text(
                'Conversations between patients and their dietician.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: T.s4),
              if (!mayRead)
                const NotYourRole(what: 'patients’ conversations')
              else ...[
                ChoicePills<bool>(
                  options: const [(false, 'All'), (true, 'Unread')],
                  selected: _unreadOnly,
                  onSelected: (v) => setState(() => _unreadOnly = v),
                ),
                const SizedBox(height: T.s3),
                TextField(
                  controller: _searchController,
                  onChanged: _onSearchChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search patients or messages',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon:
                        _searchController.text.isEmpty
                            ? null
                            : IconButton(
                              tooltip: 'Clear search',
                              icon: const Icon(Icons.close_rounded),
                              onPressed: _clearSearch,
                            ),
                  ),
                ),
                const SizedBox(height: T.s4),
                ..._results(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _results() {
    final async = ref.watch(chatReviewProvider(_query));
    _loadedAt.note(_query, async);

    if (!async.hasValue) {
      if (async.hasError) {
        return [
          if (refusedForRole(async.error))
            const NotYourRole(what: 'patients’ conversations')
          else
            LoadFailed(what: 'the conversations', onRetry: _refresh),
        ];
      }
      return const [ListSkeleton()];
    }

    var items = _ordered(async.value!.items).where(_matches).toList();
    if (_unreadOnly) items = items.where((s) => s.unreadCount > 0).toList();

    return [
      if (async.hasError) ...[
        StaleNotice.english(
          context: context,
          what: 'the conversations',
          loadedAt: _loadedAt[_query],
          onRetry: _refresh,
        ),
        const SizedBox(height: T.s4),
      ],
      if (items.isEmpty)
        _empty()
      else
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0)
                  const Divider(height: 1, indent: T.s12 + T.s4, color: T.line),
                ConversationRow(
                  session: items[i],
                  onTap:
                      () =>
                          context.push('/clinician/chat-review/${items[i].id}'),
                ),
              ],
            ],
          ),
        ),
    ];
  }

  Widget _empty() {
    if (_search.isNotEmpty) {
      return InboxEmpty(
        icon: Icons.search_off_rounded,
        title: 'No conversation matches “${_searchController.text.trim()}”',
        body: 'Names and the last message in each conversation are searched.',
        action: TextButton(
          onPressed: _clearSearch,
          child: const Text('Clear the search'),
        ),
      );
    }
    if (_unreadOnly) {
      return InboxEmpty(
        icon: Icons.mark_email_read_outlined,
        title: 'Nothing unread',
        body: 'Every nutrition conversation has been read.',
        action: OutlinedButton(
          onPressed: () => setState(() => _unreadOnly = false),
          child: const Text('Show all conversations'),
        ),
      );
    }
    return const InboxEmpty(
      icon: Icons.restaurant_menu_rounded,
      title: 'No nutrition conversations yet',
      body:
          'When a patient writes to their dietician, the conversation appears '
          'here, so you can follow it and step in.',
    );
  }
}

/// The clinic's name, the bell, and the doctor's own face leading to Profile.
class _InboxHeader extends ConsumerWidget {
  const _InboxHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final name = user?.name ?? '';

    return Row(
      children: [
        const Expanded(child: ClinicTitle(fallback: 'Nutrition')),
        const SizedBox(width: T.s1),
        PanelNotificationBell(onTap: () => showClinicianNotifications(context)),
        Semantics(
          button: true,
          label: 'Your profile',
          excludeSemantics: true,
          child: InkResponse(
            // `go`, not `push`: Profile is one of this shell's own tabs, so
            // pushing it stacked a copy while the bar kept the old tab lit.
            onTap: () => context.go('/clinician/more'),
            radius: T.tap / 2,
            child: SizedBox.square(
              dimension: T.tap,
              child: Center(
                child: UserAvatar(
                  name: nameForInitial(name),
                  avatarUrl: user?.avatarUrl,
                  accent: T.primary,
                  size: T.s8 + T.s1,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
