import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/chat_review.dart';
import 'clinician_providers.dart';
import 'widgets/conversation_row.dart';
import 'widgets/inbox_states.dart';

/// Assistant-conversation review: the threads the assistant or a patient
/// flagged for a clinician to check, and every other care conversation.
///
/// ---- What changed, and why -------------------------------------------------
///
/// The filters and the search field sat in a fixed 108-point strip under the
/// app bar. At a larger text size they no longer fitted it, and the strip
/// overflowed over the list. They are part of the scrolling page now.
///
/// A failed refresh used to replace the whole list with "Could not load
/// conversations" every fifteen seconds that the connection was down. The list
/// that loaded stays, with a line saying when it loaded.
///
/// A role without access to patients' conversations — the laboratory, a
/// practice manager — was told the load had failed. It is told what is true:
/// this is not part of their role.
class ChatReviewScreen extends ConsumerStatefulWidget {
  const ChatReviewScreen({super.key, this.initialTab});

  /// `all` | `flagged`. Null opens on the flagged queue.
  final String? initialTab;

  @override
  ConsumerState<ChatReviewScreen> createState() => _ChatReviewScreenState();
}

/// The two views of the review queue. Nutrition conversations have their own
/// tab, so review is purely the clinical care threads.
enum _ReviewTab { flagged, all }

class _ChatReviewScreenState extends ConsumerState<ChatReviewScreen> {
  late _ReviewTab _tab =
      widget.initialTab == 'all' ? _ReviewTab.all : _ReviewTab.flagged;

  final _searchController = TextEditingController();
  final _loadedAt = LoadedAt();

  /// What has been typed into the search box.
  String _search = '';

  ChatReviewQuery get _query => (
    flagged: _tab == _ReviewTab.flagged,
    urgency: null,
    kind: 'care',
  );

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _reload() => ref.invalidate(chatReviewProvider(_query));

  void _clearSearch() {
    _searchController.clear();
    setState(() => _search = '');
  }

  /// Name match, case-insensitive. "All conversations" is every patient who
  /// has ever written, and a doctor looking for one was scrolling for it.
  List<ChatReviewSession> _filter(List<ChatReviewSession> items) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where((s) => (s.patientName ?? '').toLowerCase().contains(q))
        .toList();
  }

  /// Clears the review flag without opening the conversation.
  ///
  /// A queue of old flags that can only be cleared by opening every one of
  /// them stops being read at all — which matters when the next flag is a
  /// real emergency.
  Future<void> _clearFlag(ChatReviewSession session) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(clinicianRepositoryProvider).markReviewed(session.id);
      _reload();
      messenger.showSnackBar(const SnackBar(content: Text('Flag cleared')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(capabilitySetProvider);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Chat review')),
      body:
          !mayReadConversations(caps)
              ? ListView(
                padding: const EdgeInsets.all(T.s4),
                children: const [NotYourRole(what: 'patients’ conversations')],
              )
              : AutoRefresh(
                // Flagged conversations arrive while the doctor is looking.
                onTick: (ref) => ref.invalidate(chatReviewProvider(_query)),
                child: RefreshIndicator(
                  onRefresh: () async => _reload(),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s12),
                    children: [
                      ChoicePills<_ReviewTab>(
                        options: const [
                          (_ReviewTab.flagged, 'Flagged'),
                          (_ReviewTab.all, 'All conversations'),
                        ],
                        selected: _tab,
                        onSelected: (tab) => setState(() => _tab = tab),
                      ),
                      const SizedBox(height: T.s3),
                      TextField(
                        controller: _searchController,
                        onChanged: (v) => setState(() => _search = v),
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          hintText: 'Search by patient name',
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon:
                              _search.isEmpty
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
            LoadFailed(what: 'the conversations', onRetry: _reload),
        ];
      }
      return const [ListSkeleton()];
    }

    final paged = async.value!;
    final shown = _filter(paged.items);
    final searching = _search.trim().isNotEmpty;

    return [
      // Kept, not replaced: the list below is the last one that loaded.
      if (async.hasError) ...[
        StaleNotice.english(
          context: context,
          what: 'the conversations',
          loadedAt: _loadedAt[_query],
          onRetry: _reload,
        ),
        const SizedBox(height: T.s4),
      ],
      if (shown.isEmpty)
        _empty(searching)
      else
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          child: Column(
            children: [
              for (var i = 0; i < shown.length; i++) ...[
                if (i > 0)
                  const Divider(height: 1, indent: T.s12 + T.s4, color: T.line),
                ConversationRow(
                  session: shown[i],
                  // Every row on the flagged list is flagged; saying so on
                  // each is noise.
                  showFlag: _tab == _ReviewTab.all,
                  onTap:
                      () =>
                          context.push('/clinician/chat-review/${shown[i].id}'),
                  trailing:
                      shown[i].flaggedForReview
                          ? Semantics(
                            label:
                                'Clear flag for ${shown[i].patientName ?? 'this patient'}',
                            excludeSemantics: true,
                            child: TextButton(
                              onPressed: () => _clearFlag(shown[i]),
                              style: TextButton.styleFrom(
                                foregroundColor: T.inkMuted,
                              ),
                              child: const Text('Clear flag'),
                            ),
                          )
                          : null,
                ),
              ],
            ],
          ),
        ),
      // Honest about a cut-off list rather than letting the hundredth row look
      // like the last conversation the practice has.
      if (shown.isNotEmpty && paged.hasMore && !searching) ...[
        const SizedBox(height: T.s3),
        Text(
          'Showing the ${paged.items.length} most recent. Search by name to '
          'find an older conversation.',
          style: T.small.copyWith(color: T.inkMuted),
        ),
      ],
    ];
  }

  Widget _empty(bool searching) {
    if (searching) {
      return InboxEmpty(
        icon: Icons.search_off_rounded,
        title: 'No patient matches “${_search.trim()}”',
        body:
            _tab == _ReviewTab.flagged
                ? 'Only flagged conversations are searched here. The patient '
                    'may have a conversation under All conversations.'
                : 'Check the spelling, or search by another part of the name.',
        action: TextButton(
          onPressed: _clearSearch,
          child: const Text('Clear the search'),
        ),
      );
    }
    return switch (_tab) {
      _ReviewTab.flagged => InboxEmpty(
        icon: Icons.flag_outlined,
        title: 'Nothing flagged',
        body:
            'A conversation appears here when a patient reports one of the '
            'assistant’s answers, or the assistant marks a reply for a '
            'clinician to check.',
        action: OutlinedButton(
          onPressed: () => setState(() => _tab = _ReviewTab.all),
          child: const Text('Show all conversations'),
        ),
      ),
      _ReviewTab.all => const InboxEmpty(
        icon: Icons.forum_outlined,
        title: 'No conversations yet',
        body:
            'A patient’s conversation appears here once they write to the '
            'clinic from the app.',
      ),
    };
  }
}
