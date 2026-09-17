import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/submission_keys.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/error_view.dart';
import '../../feedback/data/feedback_repository.dart';

/// Lets a patient tell a clinic, or MedPin, what is working and what is not.
///
/// Two subjects, chosen deliberately: a complaint about the app is a product
/// problem and a complaint about care is the clinic's to answer, and merging
/// them means one of the two never reaches the person who can act on it.
///
/// ---- Saying where it goes, before and after ------------------------------
///
/// This screen said "Tell Dr. Dey…" to every patient of every practice, and
/// "the clinic has received this" after feedback about the app — which no
/// clinic receives — and after feedback from somebody no clinic has taken on.
/// It now names the practice it is writing to, asks which one when there are
/// several, says plainly when it goes to the MedPin team instead, and repeats
/// where the server actually sent it.
///
/// The rating is optional. Someone with a specific thing to say should not have
/// to reduce it to a number first.
class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _message = TextEditingController();
  final _keys = SubmissionKeys();
  String _about = 'clinic';
  FeedbackPractice? _practice;
  int? _rating;
  bool _sending = false;
  FeedbackReceipt? _sent;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _send(List<FeedbackPractice> practices) async {
    final text = _message.text.trim();
    if (_rating == null && text.isEmpty) return;

    // One practice needs no choosing; several do, and none means MedPin.
    final practice = _about != 'clinic'
        ? null
        : (practices.length == 1 ? practices.first : _practice);
    final body = feedbackBody(
      about: _about,
      practiceId: practice?.practiceId,
      patientId: practice == null || practice.isSelf ? null : practice.patientId,
      rating: _rating,
      message: text,
    );

    setState(() => _sending = true);
    try {
      final receipt = await ref.read(feedbackRepositoryProvider).send(
        about: _about,
        practiceId: practice?.practiceId,
        patientId: practice == null || practice.isSelf ? null : practice.patientId,
        rating: _rating,
        message: text,
        headers: {'Idempotency-Key': _keys.keyFor('feedback', body)},
      );
      if (!mounted) return;
      ref.invalidate(myFeedbackProvider);
      setState(() {
        _sent = receipt;
        _sending = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_sent != null) return _ThankYou(receipt: _sent!);

    final scheme = Theme.of(context).colorScheme;
    final practicesAsync = ref.watch(feedbackPracticesProvider);
    final practices = practicesAsync.valueOrNull ?? const <FeedbackPractice>[];
    final loadingPractices = _about == 'clinic' && practicesAsync.isLoading;

    final needsChoice = _about == 'clinic' && practices.length > 1 && _practice == null;
    final canSend = (_rating != null || _message.text.trim().isNotEmpty) && !needsChoice && !loadingPractices;

    final destination = _about == 'app'
        ? 'This goes to the MedPin team, who make the app. No clinic sees it.'
        : practices.isEmpty
            ? 'You are not registered with a clinic on MedPin yet, so this goes to the MedPin team. No clinic sees it.'
            : practices.length == 1
                ? 'This goes to ${practices.first.practiceName ?? 'your clinic'}.'
                : 'Choose which clinic this is about.';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Send feedback'),
        actions: [
          TextButton(
            onPressed: () => context.push('/profile/feedback/mine'),
            child: const Text('Your feedback'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
        children: [
          Text('What is this about?', style: T.label.copyWith(color: scheme.onSurfaceVariant)),
          const SizedBox(height: T.s2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _SubjectCard(
                  icon: Icons.local_hospital_rounded,
                  label: 'A clinic',
                  detail: 'Your care, appointments, staff',
                  selected: _about == 'clinic',
                  onTap: () => setState(() => _about = 'clinic'),
                ),
              ),
              const SizedBox(width: T.s2),
              Expanded(
                child: _SubjectCard(
                  icon: Icons.phone_android_rounded,
                  label: 'This app',
                  detail: 'Bugs, speed, anything confusing',
                  selected: _about == 'app',
                  onTap: () => setState(() => _about = 'app'),
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          if (loadingPractices)
            const LinearProgressIndicator()
          else
            Text(destination, style: T.body.copyWith(color: scheme.onSurface)),
          if (_about == 'clinic' && practices.length > 1) ...[
            const SizedBox(height: T.s2),
            RadioGroup<FeedbackPractice>(
              groupValue: _practice,
              onChanged: (v) => setState(() => _practice = v),
              child: Column(
                children: [
                  for (final p in practices)
                    RadioListTile<FeedbackPractice>(
                      value: p,
                      contentPadding: EdgeInsets.zero,
                      title: Text(p.practiceName ?? 'A clinic', style: T.body),
                      subtitle:
                          p.isSelf || p.patientName == null ? null : Text('About ${p.patientName}', style: T.small),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s6),
          Text('How would you rate it? (optional)', style: T.label.copyWith(color: scheme.onSurfaceVariant)),
          const SizedBox(height: T.s2),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  tooltip: '$i out of 5',
                  onPressed: () => setState(() => _rating = _rating == i ? null : i),
                  iconSize: T.s8,
                  icon: Icon(
                    (_rating ?? 0) >= i ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: (_rating ?? 0) >= i ? T.warning : scheme.outline,
                  ),
                ),
            ],
          ),
          if (_rating != null)
            Center(child: Text('$_rating out of 5', style: T.small.copyWith(color: scheme.onSurfaceVariant))),
          const SizedBox(height: T.s4),
          TextField(
            controller: _message,
            minLines: 4,
            maxLines: 8,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: _about == 'clinic' ? 'What went well, or what did not…' : 'What is broken or confusing…',
              // Darker than the theme's default hint, which falls under the AA
              // contrast floor on white — and this clinic's patients are
              // largely elderly.
              hintStyle: T.body.copyWith(color: scheme.onSurfaceVariant),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: T.s2),
          // Said plainly rather than implying anonymity.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline_rounded, size: T.s5, color: scheme.onSurfaceVariant),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  _about == 'clinic' && practices.isNotEmpty
                      ? 'Your name is sent with this so the clinic can reply. It is not part of your medical record.'
                      : 'The MedPin team sees what you write, not your name or number. Any reply appears under Your feedback.',
                  style: T.small.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s6),
          FilledButton(
            onPressed: (!canSend || _sending) ? null : () => _send(practices),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
            child: Text(_sending ? 'Sending…' : 'Send feedback'),
          ),
        ],
      ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({
    required this.icon,
    required this.label,
    required this.detail,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String detail;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(T.rControl),
        child: Container(
          constraints: const BoxConstraints(minHeight: T.tap),
          padding: const EdgeInsets.all(T.s4),
          decoration: BoxDecoration(
            color: selected ? scheme.primaryContainer : scheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(T.rControl),
            border: Border.all(color: selected ? scheme.primary : scheme.outlineVariant, width: selected ? 2 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: selected ? scheme.primary : scheme.onSurfaceVariant),
              const SizedBox(height: T.s2),
              Text(label, style: T.bodyStrong.copyWith(color: selected ? scheme.primary : scheme.onSurface)),
              Text(detail, style: T.label.copyWith(color: scheme.onSurfaceVariant)),
            ],
          ),
        ),
      ),
    );
  }
}

/// After sending: where it went, in the server's words, and where to find it.
class _ThankYou extends StatelessWidget {
  const _ThankYou({required this.receipt});

  final FeedbackReceipt receipt;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final to = receipt.toPractice ? (receipt.practiceName ?? 'your clinic') : 'the MedPin team';
    return Scaffold(
      appBar: AppBar(title: const Text('Send feedback')),
      body: ListView(
        padding: const EdgeInsets.all(T.s6),
        children: [
          const SizedBox(height: T.s8),
          const Icon(Icons.check_circle_rounded, size: T.s12, color: T.success),
          const SizedBox(height: T.s4),
          Text('Sent to $to', textAlign: TextAlign.center, style: T.title.copyWith(color: scheme.onSurface)),
          const SizedBox(height: T.s2),
          Text(
            'If they reply, you will see it under Your feedback, and your phone will tell you.',
            textAlign: TextAlign.center,
            style: T.body.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: T.s8),
          FilledButton(
            onPressed: () => context.pushReplacement('/profile/feedback/mine'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
            child: const Text('See your feedback'),
          ),
          const SizedBox(height: T.s2),
          SizedBox(
            height: T.tap,
            child: TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
          ),
        ],
      ),
    );
  }
}
