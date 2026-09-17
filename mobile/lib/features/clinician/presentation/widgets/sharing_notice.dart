import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/capabilities/capabilities.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/error_view.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../sharing/data/sharing_repository.dart';

/// On a patient's record: what the patient has not shared with this practice.
///
/// ---- Why a clinician has to be told ---------------------------------------
///
/// A record with nothing hidden and a record with half of it hidden look the
/// same on screen. A doctor who does not know the earlier prescriptions are
/// withheld reads "no previous medication" as a fact about the patient rather
/// than about the sharing, and prescribes on it.
///
/// So the gaps are named, in words, from the server's own answer for this
/// person — a grant narrowed to a colleague does not count for anybody else —
/// and hidden only when nothing is withheld.
///
/// A member holding SHARE_RECORDS may ask the patient for more. Asking grants
/// nothing; the patient decides in their own app.
class SharingNotice extends ConsumerWidget {
  const SharingNotice({super.key, required this.patientId});

  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sharing = ref.watch(practiceSharingProvider(patientId)).valueOrNull;
    if (sharing == null || sharing.notShared.isEmpty) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final mayAsk = ref.watch(capabilitySetProvider).can(Perm.shareRecords);
    final hidden = ShareCategory.all.where(sharing.notShared.contains).toList();

    return Padding(
      padding: const EdgeInsets.only(bottom: T.s6),
      child: InnerTile(
        padding: const EdgeInsets.all(T.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.visibility_off_outlined, color: scheme.onSurfaceVariant),
                const SizedBox(width: T.s2),
                Expanded(
                  child: Text(
                    'Some of this record may be hidden from you',
                    style: T.bodyStrong.copyWith(color: scheme.onSurface),
                  ),
                ),
              ],
            ),
            const SizedBox(height: T.s1),
            Text(
              'The patient has not shared ${ShareCategory.sentence(hidden)} with this practice. '
              'What another clinic recorded, or what they logged themselves, may not appear below.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (sharing.request != null) ...[
              const SizedBox(height: T.s2),
              Text(
                'Your practice has asked for ${ShareCategory.sentence(sharing.request!.categories)}. '
                'Waiting for the patient to decide.',
                style: T.small.copyWith(color: scheme.onSurface),
              ),
            ] else if (mayAsk) ...[
              const SizedBox(height: T.s2),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _ask(context, ref, hidden),
                  icon: const Icon(Icons.forward_to_inbox_outlined),
                  label: const Text('Ask the patient to share'),
                  style: TextButton.styleFrom(minimumSize: const Size(0, T.tap)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _ask(BuildContext context, WidgetRef ref, List<String> hidden) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _AskSheet(patientId: patientId, options: hidden),
    );
    if (sent == true) ref.invalidate(practiceSharingProvider(patientId));
  }
}

class _AskSheet extends ConsumerStatefulWidget {
  const _AskSheet({required this.patientId, required this.options});

  final String patientId;
  final List<String> options;

  @override
  ConsumerState<_AskSheet> createState() => _AskSheetState();
}

class _AskSheetState extends ConsumerState<_AskSheet> {
  final Set<String> _chosen = {};
  final _note = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(sharingRepositoryProvider).ask(
        patientId: widget.patientId,
        categories: widget.options.where(_chosen.contains).toList(),
        note: _note.text.trim(),
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
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
          children: [
            Text('Ask the patient to share', style: T.title.copyWith(color: scheme.onSurface)),
            const SizedBox(height: T.s1),
            Text(
              'The patient is told in their app and decides. Nothing is shared unless they agree, '
              'and they can share less than you ask for.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: T.s2),
            for (final c in widget.options)
              CheckboxListTile(
                value: _chosen.contains(c),
                onChanged: _sending ? null : (v) => setState(() => v == true ? _chosen.add(c) : _chosen.remove(c)),
                title: Text(ShareCategory.label(c), style: T.body),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
              ),
            TextField(
              controller: _note,
              maxLength: 300,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Why (shown to the patient)'),
            ),
            if (_error != null) Text(_error!, style: T.small.copyWith(color: scheme.error)),
            const SizedBox(height: T.s2),
            FilledButton(
              onPressed: _sending || _chosen.isEmpty ? null : _send,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              child: Text(_sending ? 'Sending…' : 'Send request'),
            ),
          ],
        ),
      ),
    );
  }
}
