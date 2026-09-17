import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/core_providers.dart';

/// Lets a patient tell the clinic what is working and what is not.
///
/// Two subjects, chosen deliberately: a complaint about the app is a product
/// problem and a complaint about care is the doctor's to answer, and merging
/// them means one of the two never reaches the person who can act on it.
///
/// The rating is optional. Someone with a specific thing to say should not have
/// to reduce it to a number first — and "three stars" on its own says far less
/// than one sentence about what happened.
class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _message = TextEditingController();
  String _about = 'clinic';
  int? _rating;
  bool _sending = false;
  bool _sent = false;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _message.text.trim();
    if (_rating == null && text.isEmpty) return;

    setState(() => _sending = true);
    try {
      await ref
          .read(apiClientProvider)
          .postJson(
            '/feedback',
            body: {
              'about': _about,
              if (_rating != null) 'rating': _rating,
              if (text.isNotEmpty) 'message': text,
            },
          );
      if (!mounted) return;
      setState(() {
        _sent = true;
        _sending = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (_sent) return _ThankYou(onDone: () => Navigator.of(context).pop());

    final canSend = _rating != null || _message.text.trim().isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Send feedback')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          Text(
            'What is this about?',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: _SubjectCard(
                  icon: Icons.local_hospital_rounded,
                  label: 'The clinic',
                  detail: 'Your care, appointments, staff',
                  selected: _about == 'clinic',
                  onTap: () => setState(() => _about = 'clinic'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
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
          const SizedBox(height: AppSpacing.lg),
          Text(
            'How would you rate it? (optional)',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  onPressed:
                      () => setState(() => _rating = _rating == i ? null : i),
                  iconSize: 38,
                  icon: Icon(
                    (_rating ?? 0) >= i
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    color:
                        (_rating ?? 0) >= i
                            ? AppColors.warning
                            : scheme.outline,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _message,
            minLines: 4,
            maxLines: 8,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText:
                  _about == 'clinic'
                      ? 'Tell your doctor what went well, or what did not…'
                      : 'Tell us what is broken or confusing…',
              // Darker than the theme's default hint, which sits at 38% opacity
              // and falls under the AA contrast floor on white. A placeholder
              // nobody can read is a field with no guidance at all, and this
              // clinic's patients are largely elderly.
              hintStyle: TextStyle(
                color: scheme.onSurfaceVariant,
                fontSize: 15,
                height: 1.4,
              ),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          // Said plainly rather than implying anonymity. A patient should know
          // the clinic can see who wrote this before they write it — and for a
          // complaint about care, being able to follow up is the point.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.info_outline_rounded,
                size: 18,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Your name is sent with this so the clinic can follow up. '
                  'It is not part of your medical record.',
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.45,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: (!canSend || _sending) ? null : _send,
            style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
            child:
                _sending
                    ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: Colors.white,
                      ),
                    )
                    : const Text('Send feedback'),
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color:
              selected
                  ? AppColors.accentSoftOn(context)
                  : scheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? AppColors.primary : scheme.outlineVariant,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icon,
              size: 22,
              color: selected ? AppColors.primary : scheme.onSurfaceVariant,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: selected ? AppColors.primary : scheme.onSurface,
              ),
            ),
            const SizedBox(height: 0),
            Text(
              detail,
              style: TextStyle(
                fontSize: 12,
                height: 1.35,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThankYou extends StatelessWidget {
  const _ThankYou({required this.onDone});

  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Send feedback')),
      body: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                color: AppColors.accentSoftOn(context),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.check_rounded,
                size: 42,
                color: AppColors.accentOn(context),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            const Text(
              'Thank you',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'The clinic has received this. If it needs a reply, someone will '
              'message you in your care thread.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                height: 1.45,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: onDone,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                ),
                child: const Text('Done'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
