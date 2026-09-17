import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/network/submission_keys.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../feedback/data/feedback_repository.dart';

/// What patients have written to this practice.
///
/// Kept out of the clinical-alert queue on purpose: a five-star note and a
/// hypo report must never share a list, or the list that matters gets skimmed.
///
/// ---- What changed, and why each part is here ------------------------------
///
///  * Only this practice's. Feedback names the practice it was written to, and
///    feedback about the app — or from somebody no practice has taken on — goes
///    to the MedPin team and never here.
///  * Read is per person. It was one mark for the whole practice, so the first
///    person to glance at a complaint cleared it from everybody's list, the
///    doctor it was about included. Each reader's own mark is theirs, and the
///    card says which colleagues have read it.
///  * Answerable. The patient's app promised a reply and nothing could send
///    one. A reply is stored on the feedback and the patient reads it there;
///    only people who may answer patients see the button.
class FeedbackInboxScreen extends ConsumerStatefulWidget {
  const FeedbackInboxScreen({super.key});

  @override
  ConsumerState<FeedbackInboxScreen> createState() => _FeedbackInboxScreenState();
}

class _FeedbackInboxScreenState extends ConsumerState<FeedbackInboxScreen> {
  String? _about;

  static const _filters = [(null, 'All'), ('clinic', 'Care'), ('app', 'The app')];

  Future<void> _markRead(InboxFeedback entry) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(feedbackRepositoryProvider).markRead(entry.id);
      ref.invalidate(feedbackInboxProvider);
      ref.invalidate(feedbackUnreadProvider);
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
    }
  }

  Future<void> _reply(InboxFeedback entry) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ReplySheet(entry: entry),
    );
    if (sent == true) {
      ref.invalidate(feedbackInboxProvider);
      ref.invalidate(feedbackUnreadProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(feedbackInboxProvider);
    final mayReply = ref.watch(capabilitySetProvider).can(Perm.chatReply);

    return Scaffold(
      appBar: AppBar(title: const Text('Patient feedback')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(feedbackInboxProvider);
          ref.invalidate(feedbackUnreadProvider);
        },
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ListView(
            padding: const EdgeInsets.all(T.s4),
            children: [LoadFailed(what: 'patient feedback', onRetry: () => ref.invalidate(feedbackInboxProvider))],
          ),
          data: (inbox) {
            final items = _about == null ? inbox.items : inbox.items.where((e) => e.about == _about).toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
              children: [
                Text(
                  inbox.unread == 0
                      ? 'You have read everything patients have sent this practice.'
                      : inbox.unread == 1
                          ? '1 you have not read yet.'
                          : '${inbox.unread} you have not read yet.',
                  style: T.body.copyWith(color: scheme.onSurface),
                ),
                const SizedBox(height: T.s3),
                Wrap(
                  spacing: T.s2,
                  runSpacing: T.s2,
                  children: [
                    for (final (value, label) in _filters)
                      ChoiceChip(
                        label: Text(label),
                        selected: _about == value,
                        onSelected: (_) => setState(() => _about = value),
                      ),
                  ],
                ),
                const SizedBox(height: T.s4),
                if (items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: T.s8),
                    child: Text(
                      _about == null
                          ? 'Nothing here yet. What patients registered here send about their care appears here.'
                          : 'Nothing under this filter.',
                      textAlign: TextAlign.center,
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  )
                else
                  for (final entry in items) ...[
                    _FeedbackCard(
                      entry: entry,
                      mayReply: mayReply,
                      onRead: () => _markRead(entry),
                      onReply: () => _reply(entry),
                    ),
                    const SizedBox(height: T.s3),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FeedbackCard extends StatelessWidget {
  const _FeedbackCard({
    required this.entry,
    required this.mayReply,
    required this.onRead,
    required this.onReply,
  });

  final InboxFeedback entry;
  final bool mayReply;
  final VoidCallback onRead;
  final VoidCallback onReply;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final unread = !entry.reviewedByMe;
    final readers = entry.reviewedBy.map((r) => r.name).whereType<String>().toList();

    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UserAvatar(
                name: entry.patientName ?? '',
                avatarUrl: entry.patientAvatarUrl,
                accent: scheme.primary,
                size: T.hCircle,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(entry.patientName ?? 'Patient', style: T.bodyStrong.copyWith(color: scheme.onSurface)),
                    Text(
                      [
                        entry.about == 'app' ? 'About the app' : 'About their care',
                        if (entry.createdAt != null) DateFormat('d MMM yyyy, h:mm a').format(entry.createdAt!),
                      ].join(' · '),
                      style: T.label.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              // A word, not only a colour: whether *you* have read it.
              StatusPill(label: unread ? 'New to you' : 'Read', status: unread ? Status.watch : Status.neutral),
            ],
          ),
          const SizedBox(height: T.s3),
          if (entry.rating != null)
            Text('Rated ${entry.rating} out of 5', style: T.small.copyWith(color: scheme.onSurface)),
          if (entry.message.isNotEmpty) Text(entry.message, style: T.body.copyWith(color: scheme.onSurface)),
          if (readers.isNotEmpty) ...[
            const SizedBox(height: T.s2),
            Text('Read by ${readers.join(', ')}', style: T.label.copyWith(color: scheme.onSurfaceVariant)),
          ],
          for (final r in entry.replies) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Reply from ${r.byName ?? 'the practice'}', style: T.label.copyWith(color: scheme.primary)),
                  Text(r.body, style: T.body.copyWith(color: scheme.onSurface)),
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s3),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            alignment: WrapAlignment.end,
            children: [
              if (unread)
                OutlinedButton.icon(
                  onPressed: onRead,
                  icon: const Icon(Icons.done_rounded),
                  label: const Text('Mark read'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, T.tap)),
                ),
              if (mayReply)
                FilledButton.icon(
                  onPressed: onReply,
                  icon: const Icon(Icons.reply_rounded),
                  label: const Text('Reply'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, T.tap)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReplySheet extends ConsumerStatefulWidget {
  const _ReplySheet({required this.entry});

  final InboxFeedback entry;

  @override
  ConsumerState<_ReplySheet> createState() => _ReplySheetState();
}

class _ReplySheetState extends ConsumerState<_ReplySheet> {
  final _text = TextEditingController();
  final _keys = SubmissionKeys();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final message = _text.text.trim();
    if (message.isEmpty) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(feedbackRepositoryProvider).reply(
        widget.entry.id,
        message,
        headers: {'Idempotency-Key': _keys.keyFor('feedback-reply', {'id': widget.entry.id, 'message': message})},
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = ErrorView.messageFor(context, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(T.s4, 0, T.s4, MediaQuery.of(context).viewInsets.bottom + T.s4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Reply to ${widget.entry.patientName ?? 'the patient'}', style: T.title.copyWith(color: scheme.onSurface)),
            const SizedBox(height: T.s1),
            Text(
              'They read it under Your feedback, with the practice’s name and yours, and their phone tells them.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: T.s3),
            TextField(
              controller: _text,
              minLines: 3,
              maxLines: 6,
              maxLength: 2000,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(hintText: 'Write your reply'),
            ),
            if (_error != null) Text(_error!, style: T.small.copyWith(color: scheme.error)),
            const SizedBox(height: T.s2),
            FilledButton(
              onPressed: _sending || _text.text.trim().isEmpty ? null : _send,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              child: Text(_sending ? 'Sending…' : 'Send reply'),
            ),
          ],
        ),
      ),
    );
  }
}
