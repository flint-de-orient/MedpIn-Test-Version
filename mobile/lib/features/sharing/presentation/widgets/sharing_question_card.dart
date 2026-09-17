import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/error_view.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../data/sharing_repository.dart';

/// The questions asked once when a practice is connected, answered in the app.
///
/// ---- Why both answers start as no -----------------------------------------
///
/// What the patient writes themselves, and what other clinics recorded before,
/// are private until the patient says otherwise. A switch that starts on is a
/// decision the app made and the patient failed to notice; one that starts off
/// is a decision nobody has made yet, which is the truth.
///
/// Saving "no" to both is still an answer — the question is not asked again —
/// and either can be shared later from "Who can see my records?".
class SharingQuestionCard extends ConsumerStatefulWidget {
  const SharingQuestionCard({super.key, required this.question});

  final SharingQuestion question;

  @override
  ConsumerState<SharingQuestionCard> createState() => _SharingQuestionCardState();
}

class _SharingQuestionCardState extends ConsumerState<SharingQuestionCard> {
  bool _ownLogs = false;
  bool _history = false;
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(sharingRepositoryProvider).answer(
        enrollmentId: widget.question.enrollmentId,
        ownLogs: _ownLogs,
        history: widget.question.asksHistory && _history,
      );
      if (!mounted) return;
      ref.invalidate(sharingQuestionsProvider);
      ref.invalidate(sharingOverviewProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Saved. You can change this any time under Who can see my records.'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = ErrorView.messageFor(context, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final q = widget.question;
    final practice = q.practiceName ?? 'Your clinic';
    final since = q.since == null ? null : DateFormat('d MMM yyyy').format(q.since!);

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            icon: Icons.lock_person_outlined,
            title: 'Choose what $practice can see',
            subtitle: q.patientName == null ? null : 'About ${q.patientName}',
          ),
          const SizedBox(height: T.s3),
          Text(
            since == null
                ? '$practice is now connected to this record. Nothing more is shared unless you choose it here.'
                : '$practice is now connected and sees what is recorded from $since. Nothing more is shared unless you choose it here.',
            style: T.body.copyWith(color: scheme.onSurface),
          ),
          const SizedBox(height: T.s3),
          if (q.asksOwnLogs)
            _Choice(
              title: 'Your own health logs',
              detail: ShareCategory.sentence(ShareCategory.ownLogs),
              value: _ownLogs,
              onChanged: _saving ? null : (v) => setState(() => _ownLogs = v),
            ),
          if (q.asksHistory) ...[
            const SizedBox(height: T.s2),
            _Choice(
              title: 'Your earlier history',
              detail:
                  '${ShareCategory.sentence(ShareCategory.history)}, including what other clinics recorded',
              value: _history,
              onChanged: _saving ? null : (v) => setState(() => _history = v),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: T.s2),
            Text(_error!, style: T.small.copyWith(color: scheme.error)),
          ],
          const SizedBox(height: T.s4),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              child: Text(_saving ? 'Saving…' : 'Save my choice'),
            ),
          ),
        ],
      ),
    );
  }
}

/// A switch with its words beside it, the whole row tappable.
class _Choice extends StatelessWidget {
  const _Choice({
    required this.title,
    required this.detail,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String detail;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InnerTile(
      onTap: onChanged == null ? null : () => onChanged!(!value),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: T.bodyStrong.copyWith(color: scheme.onSurface)),
                Text(detail, style: T.small.copyWith(color: scheme.onSurfaceVariant)),
                // The state in words as well as in the switch's colour.
                Text(
                  value ? 'Will be shared' : 'Not shared',
                  style: T.label.copyWith(color: value ? scheme.primary : scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: T.s2),
          Semantics(
            label: title,
            toggled: value,
            child: Switch(value: value, onChanged: onChanged),
          ),
        ],
      ),
    );
  }
}

/// On Home: a short line that a question is waiting, and where to answer it.
///
/// Hidden when nothing is waiting, and hidden while it is unknown — a card that
/// flickers in on every refresh is a card the patient learns to ignore.
class SharingQuestionsBanner extends ConsumerWidget {
  const SharingQuestionsBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final waiting = ref.watch(sharingQuestionsProvider).valueOrNull ?? const [];
    if (waiting.isEmpty) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final names = waiting.map((q) => q.practiceName).whereType<String>().toSet();
    final who = names.length == 1 ? names.first : 'Your clinics';

    return Padding(
      padding: const EdgeInsets.only(top: T.s8),
      child: Semantics(
        button: true,
        label: 'Choose what $who can see',
        child: InnerTile(
          tone: T.primaryTint,
          onTap: () => context.push('/profile/sharing'),
          padding: const EdgeInsets.all(T.s4),
          child: Row(
            children: [
              const Icon(Icons.lock_person_outlined, color: T.primary),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Choose what $who can see', style: T.bodyStrong.copyWith(color: T.ink)),
                    Text(
                      'Your own logs and your earlier records stay private until you decide.',
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
