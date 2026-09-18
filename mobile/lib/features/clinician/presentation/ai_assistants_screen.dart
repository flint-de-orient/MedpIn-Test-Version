import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/disclosure_tile.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/ai_assistant.dart';
import 'clinician_providers.dart';

/// The AI assistants for this doctor's specialty, and the switch that turns one
/// on for their practice.
///
/// ---- Simple for the doctor, strict underneath ------------------------------
///
/// The doctor reads what the assistant covers, what it refuses and what it
/// treats as an emergency, then approves once. Nothing here decides whether an
/// assistant is on: after every action the list is read again from the server,
/// which answers from the same function the assistant asks before replying to a
/// patient. So this screen cannot say ON while patients are told it is
/// unavailable — if the two ever disagreed, the server would win on the next
/// read, and the screen reads again after everything it does.
class AiAssistantsScreen extends ConsumerWidget {
  const AiAssistantsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(aiAssistantsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('AI assistants')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(aiAssistantsProvider),
        child: async.when(
          loading: () => Center(
            child: Semantics(label: 'Loading AI assistants', child: const CircularProgressIndicator()),
          ),
          error: (error, _) => _Failed(error: error, onRetry: () => ref.invalidate(aiAssistantsProvider)),
          data: (items) => items.isEmpty
              ? const _NoneForYou()
              : ListView(
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
                  children: [
                    for (final a in items) ...[
                      _AssistantCard(assistant: a),
                      const SizedBox(height: T.s4),
                    ],
                    const _Limits(),
                  ],
                ),
        ),
      ),
    );
  }
}

/// A failure that says what it was: a refusal is not a dropped connection.
class _Failed extends StatelessWidget {
  const _Failed({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final e = error;
    final refused = e is ApiException && (e.statusCode == 403 || e.code == 'FORBIDDEN');
    return ListView(
      padding: const EdgeInsets.all(T.s4),
      children: [
        if (refused)
          const _Message(
            icon: Icons.lock_outline_rounded,
            title: 'Only doctors can manage AI assistants',
            body: 'Ask a doctor at your practice to review and switch on the assistant for their specialty.',
          )
        else
          LoadFailed(what: 'your AI assistants', onRetry: onRetry),
      ],
    );
  }
}

class _NoneForYou extends StatelessWidget {
  const _NoneForYou();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(T.s4),
      children: const [
        _Message(
          icon: Icons.smart_toy_outlined,
          title: 'No assistant for your specialty here yet',
          body:
              'Assistants are listed for the specialties you practise at this practice. If you are missing '
              'from a specialty, ask whoever manages your practice’s departments to add you to it.',
        ),
      ],
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: T.inkMuted),
          const SizedBox(height: T.s2),
          Text(title, style: T.bodyStrong.copyWith(color: T.ink)),
          const SizedBox(height: T.s1),
          Text(body, style: T.body.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }
}

class _AssistantCard extends ConsumerStatefulWidget {
  const _AssistantCard({required this.assistant});

  final AiAssistant assistant;

  @override
  ConsumerState<_AssistantCard> createState() => _AssistantCardState();
}

class _AssistantCardState extends ConsumerState<_AssistantCard> {
  bool _busy = false;

  AiAssistant get a => widget.assistant;

  Future<void> _approve() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _ApproveDialog(assistant: a),
    );
    if (confirmed != true || !mounted) return;
    await _run(
      (repo) => repo.approveAiAssistant(a),
      done: (item) => item.isOn
          ? '${a.specialty} AI is now ON for your practice.'
          : 'Approved. ${a.specialty} AI is not on yet: ${offReason(item)}',
    );
  }

  Future<void> _withdraw() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Withdraw approval for ${a.specialty} AI?'),
        content: const Text(
          'It stops answering your practice’s patients straight away. Their messages still reach your '
          'clinic, and you can approve it again later.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _run((repo) => repo.withdrawAiAssistant(a), done: (_) => '${a.specialty} AI is now OFF.');
  }

  /// Runs an action, then reads the list again from the server — whatever the
  /// action returned, what the screen shows next is the server's answer.
  Future<void> _run(
    Future<AiAssistant> Function(ClinicianRepository repo) action, {
    required String Function(AiAssistant item) done,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    // Held before the await: the list is re-read even if this card has been
    // rebuilt in the meantime, and a disposed card's `ref` cannot be used.
    final container = ProviderScope.containerOf(context, listen: false);
    setState(() => _busy = true);
    try {
      final item = await action(container.read(clinicianRepositoryProvider));
      messenger.showSnackBar(SnackBar(content: Text(done(item))));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(_refusal(e))));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Something went wrong. Nothing was changed.')));
    } finally {
      if (mounted) setState(() => _busy = false);
      container.invalidate(aiAssistantsProvider);
    }
  }

  String _refusal(ApiException e) {
    if (e.statusCode == 409) {
      return 'This assistant has changed since you opened it. Review the latest version before approving.';
    }
    if (e.statusCode == 403) return 'Only a doctor of this specialty at your practice can do this.';
    if (e.code == 'NETWORK_ERROR' || e.code == 'TIMEOUT') {
      return 'Could not reach the server. Nothing was changed — try again.';
    }
    return 'That did not go through. Nothing was changed.';
  }

  @override
  Widget build(BuildContext context) {
    final approval = a.approval;
    final date = DateFormat('d MMM y');

    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(Icons.smart_toy_outlined, color: T.primary),
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${a.specialty} AI', style: T.title.copyWith(color: T.ink)),
                    Text('Specialty: ${a.specialty}', style: T.label.copyWith(color: T.inkMuted)),
                  ],
                ),
              ),
              const SizedBox(width: T.s2),
              _StateChip(state: a.state),
            ],
          ),
          const SizedBox(height: T.s3),
          Text(_statusLine(date), style: T.body.copyWith(color: T.ink)),
          if (a.updatesAvailable) ...[
            const SizedBox(height: T.s2),
            Text(
              'Its guidance has been updated since it was approved. Patients are answered from what you '
              'approved until you review the update.',
              style: T.label.copyWith(color: T.warning),
            ),
          ],
          const SizedBox(height: T.s3),
          _Section(
            title: 'Knowledge',
            child: Text(
              '${a.specialty}-specific medical guidance: ${a.knowledge.total} passages '
              '(English ${a.knowledge.byLanguage['en'] ?? 0}, Bengali ${a.knowledge.byLanguage['bn'] ?? 0}, '
              'Hindi ${a.knowledge.byLanguage['hi'] ?? 0})'
              '${a.sourceCount > 0 ? ', checked against ${a.sourceCount} published sources' : ''}.'
              '${a.isAiDrafted ? ' Drafted by AI from published guidance.' : ''}',
              style: T.body.copyWith(color: T.inkMuted),
            ),
          ),
          if (a.reviewNotes.isNotEmpty && a.canApprove) ...[
            const SizedBox(height: T.s3),
            _Notes(notes: a.reviewNotes),
          ],
          _Disclosure(title: 'What it covers', items: a.covers),
          _Disclosure(title: 'What it refuses', items: a.refuses),
          _Disclosure(
            title: 'Warning signs it treats as urgent',
            items: a.warningSigns.isEmpty
                ? const ['Emergencies are escalated by the app’s own checks for every specialty.']
                : a.warningSigns,
          ),
          const SizedBox(height: T.s1),
          Text(
            'Version ${a.version} · knowledge ${a.knowledgeVersion}',
            style: T.label.copyWith(color: T.inkFaint),
          ),
          if (approval?.approvedAt != null && !a.isWithdrawn && !a.isOn) ...[
            const SizedBox(height: T.s1),
            Text(
              'Last approved by ${approval!.approvedByName ?? 'a colleague'} on ${date.format(approval.approvedAt!)}.',
              style: T.label.copyWith(color: T.inkFaint),
            ),
          ],
          const SizedBox(height: T.s4),
          if (_busy)
            const Center(child: Padding(padding: EdgeInsets.all(T.s2), child: CircularProgressIndicator()))
          else
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [
                if (a.canApprove)
                  FilledButton.icon(
                    onPressed: _approve,
                    icon: const Icon(Icons.check_circle_outline_rounded),
                    label: Text(a.updatesAvailable ? 'Review update & approve' : 'Approve & turn on'),
                  ),
                if (a.canWithdraw)
                  OutlinedButton.icon(
                    onPressed: _withdraw,
                    style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                    icon: const Icon(Icons.block_rounded),
                    label: const Text('Withdraw approval'),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  String _statusLine(DateFormat date) {
    final approval = a.approval;
    if (a.isOn) {
      final by = approval?.approvedByName;
      final at = approval?.approvedAt;
      return 'ON — answering your practice’s patients'
          '${by != null ? '. Approved by $by' : ''}${at != null ? ' on ${date.format(at)}' : ''}.';
    }
    if (a.isWithdrawn) {
      final by = approval?.withdrawnByName;
      final at = approval?.withdrawnAt;
      return 'WITHDRAWN — not answering patients'
          '${by != null ? '. Withdrawn by $by' : ''}${at != null ? ' on ${date.format(at)}' : ''}.';
    }
    return 'OFF — ${offReason(a)}';
  }
}

/// Why an assistant is off, in words a doctor can act on.
String offReason(AiAssistant a) => switch (a.reason) {
  'scope_not_approved' => 'awaiting approval by a doctor of this specialty.',
  'scope_approval_outdated' => 'its wording changed after it was approved. Review it and approve again.',
  'scope_retired' => 'this assistant has been retired.',
  'too_little_approved_knowledge' => 'not enough approved guidance yet.',
  'no_approved_red_flag_guidance' => 'its emergency guidance has not been approved yet.',
  'department_inactive' => 'this specialty is switched off at your practice.',
  _ => 'not available.',
};

class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final String state;

  @override
  Widget build(BuildContext context) {
    final (label, fg, bg) = switch (state) {
      'on' => ('ON', T.success, T.successTint),
      'withdrawn' => ('WITHDRAWN', T.warning, T.warningTint),
      _ => ('OFF', T.inkMuted, T.surface),
    };
    return Semantics(
      label: 'Status: $label',
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(color: bg, borderRadius: T.rFull, border: Border.all(color: fg)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s1),
            child: Text(label, style: T.label.copyWith(color: fg, fontWeight: FontWeight.w700)),
          ),
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: T.bodyStrong.copyWith(color: T.ink)),
        const SizedBox(height: T.s1),
        child,
      ],
    );
  }
}

class _Disclosure extends StatelessWidget {
  const _Disclosure({required this.title, required this.items});

  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return DisclosureTile(
      tilePadding: EdgeInsets.zero,
      title: Text('$title (${items.length})', style: T.bodyStrong.copyWith(color: T.ink)),
      children: [for (final item in items) _Bullet(text: item)],
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: T.s1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('•  ', style: T.body.copyWith(color: T.inkMuted)),
          Expanded(child: Text(text, style: T.body.copyWith(color: T.inkMuted))),
        ],
      ),
    );
  }
}

class _Notes extends StatelessWidget {
  const _Notes({required this.notes});

  final List<ReviewNote> notes;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: T.warningTint, borderRadius: BorderRadius.circular(T.rControl)),
      child: Padding(
        padding: const EdgeInsets.all(T.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Before you approve', style: T.bodyStrong.copyWith(color: T.ink)),
            const SizedBox(height: T.s2),
            for (final n in notes) ...[
              Text(n.title, style: T.body.copyWith(color: T.ink, fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text(n.detail, style: T.label.copyWith(color: T.inkMuted)),
              const SizedBox(height: T.s2),
            ],
          ],
        ),
      ),
    );
  }
}

class _Limits extends StatelessWidget {
  const _Limits();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: T.s2),
      child: Text(
        'An assistant answers patients only while it is ON, and only from the guidance approved for your '
        'practice. It is assistive information, not a replacement for clinical judgement: it never changes a '
        'dose or a prescription, and emergencies are escalated by the app’s own checks whether or not it is on.',
        style: T.label.copyWith(color: T.inkMuted),
      ),
    );
  }
}

/// The confirmation a doctor reads before an assistant goes live: what it is,
/// what it answers from, what it will and will not do, the versions being
/// approved — and a tick to say they have read it.
class _ApproveDialog extends StatefulWidget {
  const _ApproveDialog({required this.assistant});

  final AiAssistant assistant;

  @override
  State<_ApproveDialog> createState() => _ApproveDialogState();
}

class _ApproveDialogState extends State<_ApproveDialog> {
  bool _confirmed = false;

  @override
  Widget build(BuildContext context) {
    final a = widget.assistant;
    return AlertDialog(
      title: Text('Turn on ${a.specialty} AI?'),
      scrollable: true,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Your practice’s ${a.specialty.toLowerCase()} patients will be answered by this assistant, from the '
            '${a.specialty} knowledge base: ${a.knowledge.total} passages in English, Bengali and Hindi.',
            style: T.body.copyWith(color: T.ink),
          ),
          const SizedBox(height: T.s3),
          _Section(title: 'It covers', child: Column(children: [for (final c in a.covers) _Bullet(text: c)])),
          const SizedBox(height: T.s2),
          _Section(title: 'It refuses', child: Column(children: [for (final r in a.refuses) _Bullet(text: r)])),
          if (a.warningSigns.isNotEmpty) ...[
            const SizedBox(height: T.s2),
            _Section(
              title: 'Treated as warning signs',
              child: Column(children: [for (final w in a.warningSigns) _Bullet(text: w)]),
            ),
          ],
          if (a.reviewNotes.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            _Notes(notes: a.reviewNotes),
          ],
          const SizedBox(height: T.s3),
          Text(
            'AI output is assistive content and is not a replacement for clinical judgement. You can withdraw '
            'your approval at any time.',
            style: T.label.copyWith(color: T.inkMuted),
          ),
          const SizedBox(height: T.s2),
          Text(
            'Approving configuration version ${a.version} and knowledge version ${a.knowledgeVersion}.',
            style: T.label.copyWith(color: T.inkFaint),
          ),
          const SizedBox(height: T.s2),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _confirmed,
            onChanged: (v) => setState(() => _confirmed = v ?? false),
            title: Text(
              'I have reviewed this assistant and approve it for my practice’s patients.',
              style: T.body.copyWith(color: T.ink),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          onPressed: _confirmed ? () => Navigator.pop(context, true) : null,
          child: const Text('Approve & turn on'),
        ),
      ],
    );
  }
}
