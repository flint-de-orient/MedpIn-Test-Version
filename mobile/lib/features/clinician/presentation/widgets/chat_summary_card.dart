import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/chat_summary.dart';
import '../clinician_providers.dart';

/// Today's patient conversations, on the clinician's home screen.
///
/// A doctor is pushed emergencies and high-risk alerts and nothing else. The
/// rest of a patient's day — the request to be seen, the question the assistant
/// could not answer, the message nobody replied to — reaches them here: how many
/// of their patients wrote, how many are still waiting on them, and the first
/// few of those by name.
///
/// ---- Its own request, and not on the poll -----------------------------------
///
/// Everything else on the dashboard is re-pulled every twenty seconds. This list
/// reads every conversation of the day and may have the assistant summarise each
/// patient whose day has moved on, so it is fetched when the screen opens, when
/// the app comes back to the foreground, and on pull to refresh — see
/// `_refreshConversations` in `clinician_dashboard_screen.dart`.
class ChatSummaryCard extends ConsumerWidget {
  const ChatSummaryCard({super.key});

  /// The card's question: today, and the patients this person answers for.
  static const ChatSummaryQuery query = (day: null, scope: 'mine', kind: 'care');

  /// Patients named under the heading. The rest are counted, one tap away.
  static const int shown = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(chatSummariesProvider(query));
    final data = async.valueOrNull;
    final waiting = data?.waiting ?? const <ChatSummary>[];

    void open() => context.push('/clinician/chat-summaries');

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.forum_outlined, size: 18, color: T.primary),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  'Today’s conversations',
                  style: T.title.copyWith(fontSize: 16),
                ),
              ),
              TextButton(
                onPressed: open,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: T.s2),
                ),
                child: const Text('View all'),
              ),
            ],
          ),

          if (data == null && async.hasError)
            Padding(
              padding: const EdgeInsets.only(top: T.s2),
              child: Text(
                // Never "nobody wrote": a list that did not load has said
                // nothing about the day.
                'Could not load today’s conversations. Pull down to try again.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            )
          else if (data == null)
            // A spinner rather than an empty card. "None of your patients
            // wrote" before the answer arrives is said without knowing.
            const Padding(
              padding: EdgeInsets.symmetric(vertical: T.s5),
              child: Center(
                child: SizedBox(
                  width: T.s5,
                  height: T.s5,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else ...[
            Padding(
              padding: const EdgeInsets.only(top: T.s2),
              child: Text(
                headline(data),
                style:
                    waiting.isEmpty
                        ? T.small.copyWith(color: T.inkMuted)
                        : T.small.copyWith(
                          color: T.warning,
                          fontWeight: FontWeight.w600,
                        ),
              ),
            ),
            for (final item in waiting.take(shown)) ...[
              const SizedBox(height: T.s2),
              _WaitingRow(item: item, onTap: open),
            ],
            if (waiting.length > shown)
              Padding(
                padding: const EdgeInsets.only(top: T.s1),
                child: TextButton(
                  onPressed: open,
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                  ),
                  child: Text('+${waiting.length - shown} more waiting'),
                ),
              ),
          ],
        ],
      ),
    );
  }

  /// Said once, in the words the evening push uses: who wrote, and how many are
  /// still waiting on this person.
  static String headline(ChatSummaryDay d) {
    if (d.patients == 0) return 'None of your patients wrote today.';
    final wrote =
        '${d.patients} ${d.patients == 1 ? 'patient' : 'patients'} wrote today.';
    final n = d.waiting.length;
    if (n == 0) return '$wrote None needs you.';
    return '$wrote $n ${n == 1 ? 'needs' : 'need'} you.';
  }
}

class _WaitingRow extends StatelessWidget {
  const _WaitingRow({required this.item, required this.onTap});

  final ChatSummary item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final reason = item.reasons.isNotEmpty ? item.reasons.first : item.overview;
    final scale = MediaQuery.textScalerOf(context);

    return Semantics(
      button: true,
      label: '${item.patientName}. ${summaryStatusLabel(item)}. $reason',
      onTap: onTap,
      excludeSemantics: true,
      child: InnerTile(
        onTap: onTap,
        child: ConstrainedBox(
          // The tap floor, less the tile's own padding, grown with the text.
          constraints: BoxConstraints(
            minHeight: scale.scale(T.tap - 2 * T.s3),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.patientName,
                      style: T.bodyStrong.copyWith(color: T.ink),
                    ),
                    if (reason.isNotEmpty) ...[
                      const SizedBox(height: T.s1),
                      Text(
                        reason,
                        style: T.small.copyWith(color: T.inkMuted),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: T.s2),
              SummaryStatusPill(summary: item),
            ],
          ),
        ),
      ),
    );
  }
}

/// A summary's status as a word, never a colour alone.
///
/// "Waiting" rather than "needs you": the same pill sits on the whole-practice
/// list, where the patient may be a colleague's.
String summaryStatusLabel(ChatSummary s) {
  if (s.highestUrgency == 'emergency') return 'Emergency';
  if (s.highestUrgency == 'urgent') return 'Urgent';
  if (s.needsDoctor && !s.reviewed) return 'Waiting';
  if (s.reviewed) return 'Read';
  return 'Routine';
}

/// A small pill carrying [summaryStatusLabel], tinted to match it.
class SummaryStatusPill extends StatelessWidget {
  const SummaryStatusPill({super.key, required this.summary});

  final ChatSummary summary;

  @override
  Widget build(BuildContext context) {
    final label = summaryStatusLabel(summary);
    final (Color background, Color foreground) = switch (label) {
      'Emergency' || 'Urgent' => (T.dangerTint, T.danger),
      'Waiting' => (T.warningTint, T.warning),
      'Read' => (T.successTint, T.success),
      _ => (T.primaryTint, T.primary),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s1),
      decoration: BoxDecoration(color: background, borderRadius: T.rFull),
      child: Text(
        label,
        style: T.label.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
    );
  }
}
