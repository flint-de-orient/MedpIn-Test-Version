import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/router/area.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/chat_summary.dart';
import 'clinician_providers.dart';
import 'widgets/chat_summary_card.dart';
import 'widgets/inbox_states.dart';

/// The day before [day], both `YYYY-MM-DD`: calendar arithmetic, never a clock.
///
/// Worked from the date the server named as today, so a phone set to another
/// timezone still reads the clinic's yesterday. Null for anything that is not a
/// date, which leaves "Yesterday" unavailable rather than guessed.
String? previousClinicDay(String day) {
  final parsed = day.length == 10 ? DateTime.tryParse(day) : null;
  if (parsed == null) return null;
  // Day 0 of a month is the last day of the one before; DateTime normalises it.
  final before = DateTime.utc(parsed.year, parsed.month, parsed.day - 1);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${before.year}-${two(before.month)}-${two(before.day)}';
}

/// A day of patients' conversations, summarised for the clinicians they did not
/// interrupt.
///
/// Worst first, as the server orders them: what triage flagged, then what needs
/// a clinician, then the rest by who wrote last. Every point on a summary came
/// from a message in that patient's conversation with this practice, and "Open
/// conversation" is where the doctor reads it and answers.
///
/// ---- What changed, and why -------------------------------------------------
///
/// A day nobody wrote was a sentence under two rows of filter chips and then a
/// blank screen, which is how a screen still loading looks too. It now says
/// what the emptiness means and offers the obvious next look — the whole
/// practice, or yesterday.
///
/// Every summary carried a large tinted button, so a busy day was a column of
/// identical lavender slabs. The actions are quiet text buttons now; the
/// patient's name and why they need a clinician are what the eye finds first.
class ChatSummariesScreen extends ConsumerStatefulWidget {
  const ChatSummariesScreen({super.key});

  @override
  ConsumerState<ChatSummariesScreen> createState() =>
      _ChatSummariesScreenState();
}

class _ChatSummariesScreenState extends ConsumerState<ChatSummariesScreen> {
  String _scope = 'mine';
  bool _yesterday = false;
  final _loadedAt = LoadedAt();

  /// The clinic's today, as the server named it in the last answer about today.
  String? _today;

  ChatSummaryQuery get _query => (
    day: _yesterday && _today != null ? previousClinicDay(_today!) : null,
    scope: _scope,
    kind: 'care',
  );

  void _reload() => ref.invalidate(chatSummariesProvider(_query));

  Future<void> _markRead(ChatSummary item, ChatSummaryQuery query) async {
    try {
      await ref.read(clinicianRepositoryProvider).markSummaryReviewed(item.id);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
      return;
    }
    if (!mounted) return;
    ref.invalidate(chatSummariesProvider(query));
    // The home screen's card counts the same day.
    ref.invalidate(chatSummariesProvider(ChatSummaryCard.query));
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(capabilitySetProvider);
    final mayRead = mayReadConversations(caps);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Patient conversations')),
      body:
          !mayRead
              ? ListView(
                padding: const EdgeInsets.all(T.s4),
                children: const [NotYourRole(what: 'patients’ conversations')],
              )
              : RefreshIndicator(
                onRefresh: () async => _reload(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s12),
                  children: _body(),
                ),
              ),
    );
  }

  List<Widget> _body() {
    final query = _query;
    final async = ref.watch(chatSummariesProvider(query));
    _loadedAt.note(query, async);
    final data = async.valueOrNull;
    if (query.day == null && data != null) _today = data.day;
    final canGoBack = _today != null && previousClinicDay(_today!) != null;

    final filters = <Widget>[
      // Bounded, known choices: wrapped, never scrolled out of sight.
      ChoicePills<String>(
        options: const [
          ('mine', 'My patients'),
          ('practice', 'Whole practice'),
        ],
        selected: _scope,
        onSelected: (v) => setState(() => _scope = v),
      ),
      const SizedBox(height: T.s2),
      ChoicePills<bool>(
        options: const [(false, 'Today'), (true, 'Yesterday')],
        selected: _yesterday,
        // Yesterday is worked out from the server's today, so it waits for one.
        onSelected:
            canGoBack || _yesterday
                ? (v) => setState(() => _yesterday = v)
                : null,
      ),
      const SizedBox(height: T.s4),
    ];

    if (data == null) {
      return [
        ...filters,
        if (async.hasError)
          refusedForRole(async.error)
              ? const NotYourRole(what: 'patients’ conversations')
              : LoadFailed(what: 'the conversations', onRetry: _reload)
        else
          const ListSkeleton(rows: 3, avatar: false),
      ];
    }

    return [
      ...filters,
      if (async.hasError) ...[
        StaleNotice.english(
          context: context,
          what: 'the conversations',
          loadedAt: _loadedAt[query],
          onRetry: _reload,
        ),
        const SizedBox(height: T.s4),
      ],
      if (data.items.isEmpty)
        _empty(canGoBack)
      else ...[
        Text(_heading(data), style: T.bodyStrong.copyWith(color: T.ink)),
        for (final item in data.items) ...[
          const SizedBox(height: T.s3),
          _SummaryTile(
            item: item,
            onOpen:
                () => context.push(
                  '${areaPrefix(ref)}/patients/${item.patientId}/thread',
                  extra: item.patientName,
                ),
            onRead: () => _markRead(item, query),
          ),
        ],
      ],
    ];
  }

  Widget _empty(bool canGoBack) {
    final when = _yesterday ? 'yesterday' : 'today';
    if (_scope == 'mine') {
      return InboxEmpty(
        icon: Icons.forum_outlined,
        title: 'None of your patients wrote $when.',
        body:
            'When one of your patients writes to the clinic, the day’s messages '
            'are summarised here. Patients seen by colleagues are under Whole '
            'practice.',
        action: OutlinedButton(
          onPressed: () => setState(() => _scope = 'practice'),
          child: const Text('Show the whole practice'),
        ),
      );
    }
    return InboxEmpty(
      icon: Icons.forum_outlined,
      title: 'Nobody wrote to the practice $when.',
      body:
          'A summary appears here for every patient who writes to the clinic, '
          'worst first.',
      action:
          _yesterday
              ? OutlinedButton(
                onPressed: () => setState(() => _yesterday = false),
                child: const Text('Back to today'),
              )
              : canGoBack
              ? OutlinedButton(
                onPressed: () => setState(() => _yesterday = true),
                child: const Text('Show yesterday'),
              )
              : null,
    );
  }

  /// The day in one sentence. On "my patients" the count is of those still
  /// waiting on the reader; on the whole practice, of those needing anyone.
  String _heading(ChatSummaryDay d) {
    final when = _yesterday ? 'yesterday' : 'today';
    final wrote =
        '${d.patients} ${d.patients == 1 ? 'patient' : 'patients'} wrote $when.';
    if (_scope == 'mine') {
      final n = d.waiting.length;
      return n == 0
          ? '$wrote None needs you.'
          : '$wrote $n ${n == 1 ? 'needs' : 'need'} you.';
    }
    final n = d.needsDoctor;
    return n == 0
        ? '$wrote None needs a clinician.'
        : '$wrote $n ${n == 1 ? 'needs' : 'need'} a clinician.';
  }
}

class _SummaryTile extends StatelessWidget {
  const _SummaryTile({
    required this.item,
    required this.onOpen,
    required this.onRead,
  });

  final ChatSummary item;
  final VoidCallback onOpen;
  final VoidCallback onRead;

  /// What each point is, in the reader's words.
  static const _kinds = {
    'symptom': 'Symptom',
    'concern': 'Concern',
    'question': 'Question',
    'medication': 'Medicine',
    'diet': 'Food',
    'reading': 'Reading',
    'appointment': 'Appointment',
    'assistant_answer': 'The assistant said',
    'follow_up': 'To follow up',
  };

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  item.patientName,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
              ),
              const SizedBox(width: T.s2),
              SummaryStatusPill(summary: item),
            ],
          ),
          for (final reason in item.reasons) ...[
            const SizedBox(height: T.s2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.flag_outlined, size: T.s5, color: T.warning),
                const SizedBox(width: T.s2),
                Expanded(
                  child: Text(
                    reason,
                    style: T.small.copyWith(
                      color: T.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (item.overview.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            Text(item.overview, style: T.body.copyWith(color: T.ink)),
          ],
          if (item.points.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var i = 0; i < item.points.length; i++) ...[
                    if (i > 0) const SizedBox(height: T.s3),
                    Text(
                      _kinds[item.points[i].kind] ?? 'Note',
                      style: T.label.copyWith(color: T.inkMuted),
                    ),
                    const SizedBox(height: T.s1),
                    Text(
                      item.points[i].text,
                      style: T.body.copyWith(color: T.ink),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s3),
          Text(
            // Which kind of text this is, said rather than left to be assumed.
            item.writtenByAssistant
                ? 'Summarised by the assistant from the day’s messages'
                : 'Put together from the day’s messages',
            style: T.small.copyWith(color: T.inkMuted),
          ),
          if (item.reviewed) ...[
            const SizedBox(height: T.s1),
            Text(
              'You marked this day read',
              style: T.small.copyWith(color: T.success),
            ),
          ],
          const SizedBox(height: T.s1),
          Wrap(
            spacing: T.s2,
            children: [
              TextButton(
                onPressed: onOpen,
                child: const Text('Open conversation'),
              ),
              if (!item.reviewed)
                TextButton(
                  onPressed: onRead,
                  style: TextButton.styleFrom(foregroundColor: T.inkMuted),
                  child: const Text('Mark as read'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
