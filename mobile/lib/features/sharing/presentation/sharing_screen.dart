import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/submission_keys.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/providers/active_patient.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/sharing_repository.dart';
import 'widgets/sharing_question_card.dart';

String _day(DateTime? d) => d == null ? '' : DateFormat('d MMM yyyy').format(d);

/// "Who can see my records?"
///
/// ---- What this screen has to be able to say, truthfully -------------------
///
/// Every practice that can read anything, and why: registered there, from a
/// date. On top of that, whatever the patient chose to share, with whom, until
/// when — each with a way to stop it. What a practice has asked for and not
/// been given. Practices still waiting on a code, and ones whose access ended.
///
/// Nothing on it is inferred. A practice is listed because the server says it
/// is connected, and a grant because the server holds one; the history of who
/// looked under a grant is its own screen, read from the audit log.
class SharingScreen extends ConsumerWidget {
  const SharingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(sharingOverviewProvider);
    final questions = ref.watch(sharingQuestionsProvider).valueOrNull ?? const [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Who can see my records?'),
        actions: [
          IconButton(
            tooltip: 'Sharing history',
            icon: const Icon(Icons.history_rounded),
            onPressed: () => context.push('/profile/sharing/history'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(sharingOverviewProvider);
          ref.invalidate(sharingQuestionsProvider);
        },
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ListView(
            padding: const EdgeInsets.all(T.s4),
            children: [
              LoadFailed(
                what: 'who can see your records',
                onRetry: () => ref.invalidate(sharingOverviewProvider),
              ),
            ],
          ),
          data: (overview) => ListView(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
            children: [
              for (final q in questions) ...[
                SharingQuestionCard(question: q),
                const SizedBox(height: T.s4),
              ],
              if (overview.connected.isEmpty)
                const _Explainer(
                  'No clinic is connected to this record. A clinic is connected when its desk '
                  'registers you and you read back the code sent to your phone.',
                ),
              for (final p in overview.connected) ...[
                _PracticeCard(practice: p),
                const SizedBox(height: T.s4),
              ],
              if (overview.waiting.isNotEmpty) ...[
                const _Heading('Waiting for your code'),
                for (final w in overview.waiting)
                  _Line(
                    title: w.practiceName ?? 'A clinic',
                    detail: 'Asked on ${_day(w.askedOn)}. It sees nothing until you read back the code.',
                  ),
                const SizedBox(height: T.s4),
              ],
              if (overview.ended.isNotEmpty) ...[
                const _Heading('Access ended'),
                for (final e in overview.ended)
                  _Line(
                    title: e.practiceName ?? 'A clinic',
                    detail: 'Since ${_day(e.endedOn)}. It keeps what it recorded, and sees nothing new.',
                  ),
                const SizedBox(height: T.s4),
              ],
              if (overview.past.isNotEmpty) ...[
                const _Heading('Sharing that has ended'),
                for (final g in overview.past)
                  _Line(
                    title: '${ShareCategory.sentence(g.categories)} — ${g.practiceName ?? 'a clinic'}',
                    detail: switch (g.status) {
                      'expired' => 'Reached its end date, ${_day(g.expiresAt)}',
                      'declined' => 'Request declined, ${_day(g.endedAt)}',
                      _ when g.endedWithRegistration => 'Ended with the clinic’s access, ${_day(g.endedAt)}',
                      _ => 'Stopped, ${_day(g.endedAt)}',
                    },
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PracticeCard extends ConsumerWidget {
  const _PracticeCard({required this.practice});

  final ConnectedPractice practice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final name = practice.practiceName ?? 'Your clinic';

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            icon: Icons.local_hospital_outlined,
            title: name,
            subtitle: 'Registered with you',
          ),
          const SizedBox(height: T.s3),
          Text(
            practice.since == null
                ? 'Sees what is recorded while you are registered with it.'
                : 'Sees what is recorded from ${_day(practice.since)}.',
            style: T.body.copyWith(color: scheme.onSurface),
          ),
          if (practice.reconsented && practice.consentedOn != null)
            Text(
              'You agreed again on ${_day(practice.consentedOn)}.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
          const SizedBox(height: T.s3),
          if (practice.shared.isEmpty)
            Text(
              'Nothing else is shared with it.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            )
          else ...[
            Text('Also shared', style: T.label.copyWith(color: scheme.onSurfaceVariant)),
            const SizedBox(height: T.s2),
            for (final g in practice.shared) ...[
              _GrantTile(grant: g),
              const SizedBox(height: T.s2),
            ],
          ],
          for (final r in practice.requests) ...[
            const SizedBox(height: T.s2),
            _RequestTile(request: r, practiceName: name),
          ],
          const SizedBox(height: T.s3),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              OutlinedButton.icon(
                onPressed: () => _shareMore(context, ref),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Share more'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, T.tap)),
              ),
              TextButton(
                onPressed: () => _endAccess(context, ref, name),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.error,
                  minimumSize: const Size(0, T.tap),
                ),
                child: const Text('End this clinic’s access'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _shareMore(BuildContext context, WidgetRef ref) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ShareSheet(practice: practice),
    );
    if (done == true) ref.invalidate(sharingOverviewProvider);
  }

  Future<void> _endAccess(BuildContext context, WidgetRef ref, String name) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('End $name’s access?'),
        content: Text(
          '$name will not see anything recorded from now on, and everything you shared with it '
          'stops. It keeps what it has already recorded. You will not be able to message it or '
          'book with it until its desk registers you again with your code.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep access')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('End access'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(sharingRepositoryProvider).endAccess(practice.enrollmentId);
      ref.invalidate(sharingOverviewProvider);
      messenger.showSnackBar(SnackBar(content: Text('$name’s access has ended.')));
    } catch (e) {
      if (!context.mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
    }
  }
}

class _GrantTile extends ConsumerWidget {
  const _GrantTile({required this.grant});

  final ShareGrantView grant;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(ShareCategory.sentence(grant.categories), style: T.bodyStrong.copyWith(color: scheme.onSurface)),
                Text(
                  [
                    grant.doctorName == null ? 'Anyone there who looks after you' : 'Only ${grant.doctorName}',
                    grant.expiresAt == null ? 'until you stop it' : 'until ${_day(grant.expiresAt)}',
                  ].join(', '),
                  style: T.small.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => _stop(context, ref),
            style: TextButton.styleFrom(minimumSize: const Size(0, T.tap)),
            child: const Text('Stop sharing'),
          ),
        ],
      ),
    );
  }

  Future<void> _stop(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(sharingRepositoryProvider).stopSharing(grant.id);
      ref.invalidate(sharingOverviewProvider);
      messenger.showSnackBar(const SnackBar(content: Text('Stopped. It no longer sees what you shared.')));
    } catch (e) {
      if (!context.mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
    }
  }
}

class _RequestTile extends ConsumerWidget {
  const _RequestTile({required this.request, required this.practiceName});

  final ShareGrantView request;
  final String practiceName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return InnerTile(
      tone: Theme.of(context).brightness == Brightness.dark ? null : T.warningTint,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$practiceName asks to see more', style: T.bodyStrong.copyWith(color: scheme.onSurface)),
          Text(ShareCategory.sentence(request.categories), style: T.body.copyWith(color: scheme.onSurface)),
          if (request.requestNote != null)
            Text(
              '“${request.requestNote}”${request.requestedBy == null ? '' : ' — ${request.requestedBy}'}',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
          Text(
            'Nothing is shared unless you agree.',
            style: T.small.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: T.s2),
          Wrap(
            spacing: T.s2,
            children: [
              FilledButton(
                onPressed: () => _answer(context, ref, approve: true),
                style: FilledButton.styleFrom(minimumSize: const Size(0, T.tap)),
                child: const Text('Share'),
              ),
              OutlinedButton(
                onPressed: () => _answer(context, ref, approve: false),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, T.tap)),
                child: const Text('Decline'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _answer(BuildContext context, WidgetRef ref, {required bool approve}) async {
    final messenger = ScaffoldMessenger.of(context);
    final repo = ref.read(sharingRepositoryProvider);
    try {
      if (approve) {
        await repo.approve(request.id);
      } else {
        await repo.decline(request.id);
      }
      ref.invalidate(sharingOverviewProvider);
      messenger.showSnackBar(SnackBar(content: Text(approve ? 'Shared.' : 'Declined. Nothing was shared.')));
    } catch (e) {
      if (!context.mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
    }
  }
}

/// Choosing what else to share with one practice.
class _ShareSheet extends ConsumerStatefulWidget {
  const _ShareSheet({required this.practice});

  final ConnectedPractice practice;

  @override
  ConsumerState<_ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends ConsumerState<_ShareSheet> {
  final _keys = SubmissionKeys();
  final Set<String> _chosen = {};
  String? _doctorId;
  DateTime? _until;
  bool _saving = false;
  String? _error;
  List<({String id, String name})> _doctors = const [];

  @override
  void initState() {
    super.initState();
    _loadDoctors();
  }

  Future<void> _loadDoctors() async {
    try {
      final doctors = await ref
          .read(sharingRepositoryProvider)
          .doctorsAt(widget.practice.practiceId, patientId: ref.read(activePatientProvider));
      if (mounted) setState(() => _doctors = doctors);
    } catch (_) {
      // Without the list the grant simply goes to the practice as a whole,
      // which is the default anyway.
    }
  }

  Future<void> _pickEnd() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _until ?? now.add(const Duration(days: 30)),
      firstDate: now.add(const Duration(days: 1)),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _until = DateTime(picked.year, picked.month, picked.day, 23, 59));
  }

  Future<void> _save() async {
    if (_chosen.isEmpty) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final categories = ShareCategory.all.where(_chosen.contains).toList();
    final body = {
      'practiceId': widget.practice.practiceId,
      'categories': categories,
      'doctorId': _doctorId,
      'expiresAt': _until?.toIso8601String(),
    };
    try {
      await ref.read(sharingRepositoryProvider).share(
        practiceId: widget.practice.practiceId,
        categories: categories,
        doctorId: _doctorId,
        expiresAt: _until,
        patientId: ref.read(activePatientProvider),
        headers: {'Idempotency-Key': _keys.keyFor('share', body)},
      );
      if (mounted) Navigator.of(context).pop(true);
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
    final name = widget.practice.practiceName ?? 'this clinic';

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
          children: [
            Text('Share more with $name', style: T.title.copyWith(color: scheme.onSurface)),
            const SizedBox(height: T.s1),
            Text(
              'It will be able to see all of what you choose, including records from before it '
              'registered you and records other clinics made. Each time it looks, it shows in '
              'your sharing history.',
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: T.s3),
            for (final c in ShareCategory.all)
              CheckboxListTile(
                value: _chosen.contains(c),
                onChanged: _saving
                    ? null
                    : (v) => setState(() => v == true ? _chosen.add(c) : _chosen.remove(c)),
                title: Text(ShareCategory.label(c), style: T.body),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
              ),
            const SizedBox(height: T.s2),
            DropdownButtonFormField<String?>(
              initialValue: _doctorId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Who there may see it'),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Anyone there who looks after me')),
                for (final d in _doctors) DropdownMenuItem<String?>(value: d.id, child: Text('Only ${d.name}')),
              ],
              onChanged: _saving ? null : (v) => setState(() => _doctorId = v),
            ),
            const SizedBox(height: T.s2),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_outlined),
              title: Text(_until == null ? 'Until I stop it' : 'Until ${_day(_until)}', style: T.body),
              trailing: _until == null
                  ? TextButton(onPressed: _saving ? null : _pickEnd, child: const Text('Set an end date'))
                  : TextButton(
                      onPressed: _saving ? null : () => setState(() => _until = null),
                      child: const Text('No end date'),
                    ),
            ),
            if (_error != null) Text(_error!, style: T.small.copyWith(color: scheme.error)),
            const SizedBox(height: T.s3),
            FilledButton(
              onPressed: _saving || _chosen.isEmpty ? null : _save,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              child: Text(_saving ? 'Sharing…' : 'Share'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: T.s2),
    child: Text(text, style: T.label.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
  );
}

class _Line extends StatelessWidget {
  const _Line({required this.title, required this.detail});

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: T.s2),
      child: InnerTile(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: T.bodyStrong.copyWith(color: scheme.onSurface)),
            Text(detail, style: T.small.copyWith(color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}

class _Explainer extends StatelessWidget {
  const _Explainer(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: T.s4),
    child: Text(text, style: T.body.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
  );
}
