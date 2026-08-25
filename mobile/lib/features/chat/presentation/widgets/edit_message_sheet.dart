import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../data/chat_repository.dart';
import '../../domain/chat_message.dart';

/// Rewrite a message you have just sent.
///
/// One sheet for every thread in the app — the patient's care and nutrition
/// conversations, the doctor's and the dietician's. Four copies of a control
/// that edits a clinical record is four places for the rules to drift apart.
///
/// The sheet says the two things the author needs to know before they commit:
/// that the other side will see it was edited, and that they have a quarter of
/// an hour. Neither is a surprise worth springing after the fact on a thread a
/// clinician may already have acted on.
Future<bool> showEditMessageSheet(
  BuildContext context,
  WidgetRef ref,
  ChatMessage message,
) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _EditSheet(message: message, ref: ref),
  );
  return saved ?? false;
}

class _EditSheet extends StatefulWidget {
  const _EditSheet({required this.message, required this.ref});

  final ChatMessage message;
  final WidgetRef ref;

  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late final TextEditingController _text = TextEditingController(
    text: widget.message.content,
  );
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final next = _text.text.trim();
    if (_busy || next.isEmpty || next == widget.message.content) {
      Navigator.of(context).pop(false);
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    try {
      await widget.ref
          .read(chatRepositoryProvider)
          .editMessage(widget.message.id, next);
      navigator.pop(true);
    } on ApiException catch (e) {
      // The server owns the rules — the window, the emergency freeze, the
      // voice-note refusal — so its wording is what the author sees rather
      // than a guess made here.
      if (mounted) setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Edit message',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'The other side will see that it was edited.',
            style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _text,
            autofocus: true,
            minLines: 2,
            maxLines: 6,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed:
                      _busy ? null : () => Navigator.of(context).pop(false),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: FilledButton(
                  onPressed: _busy ? null : _save,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child:
                      _busy
                          ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: Colors.white,
                            ),
                          )
                          : const Text('Save'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
