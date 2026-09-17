import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/chat_summary.dart';
import 'clinician_providers.dart';
import 'widgets/chat_summary_card.dart';

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
class ChatSummariesScreen extends ConsumerStatefulWidget {
  const ChatSummariesScreen({super.key});

  @override
  ConsumerState<ChatSummariesScreen> createState() =>
      _ChatSummariesScreenState();
}

class _ChatSummariesScreenState extends ConsumerState<ChatSummariesScreen> {
  String _scope = 'mine';
  bool _yesterday = false;

  /// The clinic's today, as the server named it in the last answer about today.
  String? _today;

  ChatSummaryQuery get _query => (
    day: _yesterday && _today != null ? previousClinicDay(_today!) : null,
    scope: _scope,
    kind: 'care',
  );

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
    final query = _query;
    final async = ref.watch(chatSummariesProvider(query));
    // A refresh that fails keeps what was on screen, and says so once rather
    // than letting stale summaries pass for current.
    ref.listen(chatSummariesProvider(query), (previous, next) {
      if (next.hasError && next.hasValue && !(previous?.hasError ?? false)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not refresh. Showing what was last loaded.')),
        );
      }
    });
    final data = async.valueOrNull;
    if (query.day == null && data != null) _today = data.day;
    final canGoBack = _today != null && previousClinicDay(_today!) != null;

    return Scaffold(
      appBar: AppBar(title: const Text('Patient conversations')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(chatSummariesProvider(query)),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s12),
          children: [
            // Bounded, known choices: wrapped, never scrolled out of sight.
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [
                _choice(
                  'My patients',
                  selected: _scope == 'mine',
                  onSelected: () => setState(() => _scope = 'mine'),
                ),
                _choice(
                  'Whole practice',
                  selected: _scope == 'practice',
                  onSelected: () => setState(() => _scope = 'practice'),
                ),
              ],
            ),
            const SizedBox(height: T.s2),
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [
                _choice(
                  'Today',
                  selected: !_yesterday,
                  onSelected: () => setState(() => _yesterday = false),
                ),
                _choice(
                  'Yesterday',
                  selected: _yesterday,
                  onSelected:
                      canGoBack ? () => setState(() => _yesterday = true) : null,
                ),
              ],
            ),
            const SizedBox(height: T.s4),
            if (data == null && async.hasError)
              LoadFailed(
                what: 'the conversations',
                onRetry: () => ref.invalidate(chatSummariesProvider(query)),
              )
            else if (data == null)
              const Padding(
                padding: EdgeInsets.all(T.s8),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              Text(_heading(data), style: T.bodyStrong.copyWith(color: T.ink)),
              for (final item in data.items) ...[
                const SizedBox(height: T.s3),
                _SummaryTile(
                  item: item,
                  onRead: () => _markRead(item, query),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _choice(
    String label, {
    required bool selected,
    required VoidCallback? onSelected,
  }) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: onSelected == null ? null : (_) => onSelected(),
    );
  }

  /// The day in one sentence. On "my patients" the count is of those still
  /// waiting on the reader; on the whole practice, of those needing anyone.
  String _heading(ChatSummaryDay d) {
    final when = _yesterday ? 'yesterday' : 'today';
    if (d.patients == 0) {
      return _scope == 'mine'
          ? 'None of your patients wrote $when.'
          : 'Nobody wrote to the practice $when.';
    }
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
  const _SummaryTile({required this.item, required this.onRead});

  final ChatSummary item;
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  item.patientName,
                  style: T.title.copyWith(fontSize: 16),
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
                const Icon(Icons.flag_outlined, size: 18, color: T.warning),
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
            style: T.small.copyWith(color: T.inkFaint),
          ),
          if (item.reviewed) ...[
            const SizedBox(height: T.s1),
            Text(
              'You marked this day read',
              style: T.small.copyWith(color: T.success),
            ),
          ],
          const SizedBox(height: T.s3),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              FilledButton.tonal(
                onPressed:
                    () => context.push(
                      '/clinician/patients/${item.patientId}/thread',
                    ),
                child: const Text('Open conversation'),
              ),
              if (!item.reviewed)
                TextButton(onPressed: onRead, child: const Text('Mark as read')),
            ],
          ),
        ],
      ),
    );
  }
}
