import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/error_view.dart';
import '../../../../shared/widgets/otp_field.dart';
import '../../../sharing/data/sharing_repository.dart';
import '../../data/clinician_repository.dart';
import '../../domain/patient_registration.dart';

/// The code the patient was texted, taken at the counter — and the patient's
/// answers about what this clinic may see, taken in the same step.
///
/// A dialog rather than another screen: the receptionist has the patient in
/// front of them and the whole interaction is six digits read aloud. Pushing a
/// route would lose the form behind it and make "not now" a navigation problem
/// rather than a button.
///
/// ---- The two questions, and why they may go unasked --------------------
///
/// What the patient writes themselves and what other clinics recorded before
/// are private until the patient shares them. The desk may put both questions
/// to the patient standing there; the answers travel with the code, so they
/// are recorded with the proof the patient was present. A busy counter may
/// leave them for the patient's own app instead — and then nothing is recorded
/// on their behalf, which is why "the patient answered now" is its own switch
/// rather than two boxes that would read an unasked question as a no.
///
/// Returns the confirmation when the enrolment is active, or null for "not
/// now".
Future<EnrolmentConfirmation?> showConsentCodeDialog(
  BuildContext context, {
  required String enrollmentId,
  required String title,
  required String message,
}) {
  return showDialog<EnrolmentConfirmation>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _ConsentCodeDialog(enrollmentId: enrollmentId, title: title, message: message),
  );
}

class _ConsentCodeDialog extends ConsumerStatefulWidget {
  const _ConsentCodeDialog({required this.enrollmentId, required this.title, required this.message});

  final String enrollmentId;
  final String title;
  final String message;

  @override
  ConsumerState<_ConsentCodeDialog> createState() => _ConsentCodeDialogState();
}

class _ConsentCodeDialogState extends ConsumerState<_ConsentCodeDialog> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _asked = false;
  bool _ownLogs = false;
  bool _history = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_code.text.trim().length < 4) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final confirmation = await ref.read(clinicianRepositoryProvider).confirmEnrolment(
        enrollmentId: widget.enrollmentId,
        code: _code.text.trim(),
        share: ConsentShareAnswers(asked: _asked, ownLogs: _ownLogs, history: _history),
      );
      if (mounted) Navigator.of(context).pop(confirmation);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = ErrorView.messageFor(context, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The server's own sentence, not a reworded one, so the counter and
            // the log say the same thing.
            Text(widget.message, style: T.body.copyWith(color: scheme.onSurface)),
            const SizedBox(height: T.s4),
            OtpCodeField(
              controller: _code,
              enabled: !_busy,
              hasError: _error != null,
              onCompleted: (_) {
                // With the questions open the desk is still asking; wait for
                // the button rather than confirming half an answer.
                if (!_asked) _submit();
              },
            ),
            if (_error != null) ...[
              const SizedBox(height: T.s2),
              Text(_error!, style: T.small.copyWith(color: scheme.error)),
            ],
            const SizedBox(height: T.s4),
            Text('What may this clinic see?', style: T.bodyStrong.copyWith(color: scheme.onSurface)),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _asked,
              onChanged: _busy ? null : (v) => setState(() => _asked = v),
              title: Text('The patient answered now', style: T.body),
              subtitle: Text(
                _asked
                    ? 'Tick only what they agreed to. Unticked is not shared.'
                    : 'Leave off and they will be asked in their own app. Nothing is shared meanwhile.',
                style: T.small,
              ),
            ),
            if (_asked) ...[
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _ownLogs,
                onChanged: _busy ? null : (v) => setState(() => _ownLogs = v ?? false),
                title: Text('Their own health logs', style: T.body),
                subtitle: Text(ShareCategory.sentence(ShareCategory.ownLogs), style: T.small),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _history,
                onChanged: _busy ? null : (v) => setState(() => _history = v ?? false),
                title: Text('Their earlier history', style: T.body),
                subtitle: Text(
                  '${ShareCategory.sentence(ShareCategory.history)}, including other clinics’',
                  style: T.small,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        // Not "Cancel". The registration has already happened; what this
        // declines is finishing it, and the caller says what that leaves.
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: const Text('Not now')),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Checking…' : 'Confirm')),
      ],
    );
  }
}
