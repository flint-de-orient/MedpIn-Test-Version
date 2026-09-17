import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/home_panel.dart';

/// Clinical-alert triage: filter, acknowledge and resolve the alerts raised by
/// the assistant and the tracking rules.
///
/// ---- The bug this screen had ------------------------------------------------
///
/// Each card was handed `paged.items[i]` for its actions while it displayed
/// `shown[i]` — the list after the search and severity filters. With a filter
/// on, the two lists differ, so tapping Resolve on the second alert on screen
/// resolved the second alert in the unfiltered list: somebody else's, possibly
/// an emergency nobody had read. Every card now acts on the alert it shows.
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  String? _status = 'open';
  String? _severity;
  String _search = '';
  final _searchController = TextEditingController();

  static const _statuses = [
    ('open', 'Open'),
    ('acknowledged', 'Acknowledged'),
    ('resolved', 'Resolved'),
    (null, 'All'),
  ];

  /// Severity, worst first. `info` is folded into the unfiltered view — nobody
  /// comes to this screen looking for the least important thing on it.
  static const _severities = [
    (null, 'Any severity'),
    ('emergency', 'Emergency'),
    ('urgent', 'Urgent'),
    ('warning', 'Warning'),
  ];

  AlertsQuery get _query => (status: _status, severity: _severity);

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// Name or title match, in memory: the page is loaded and a practice's open
  /// alerts are few.
  List<ClinicalAlert> _filter(List<ClinicalAlert> items) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where(
          (a) =>
              (a.patientName ?? '').toLowerCase().contains(q) ||
              a.title.toLowerCase().contains(q),
        )
        .toList();
  }

  void _clearFilters() {
    _searchController.clear();
    setState(() {
      _search = '';
      _severity = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(alertsProvider(_query));

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Clinical alerts')),
      body: AutoRefresh(
        onTick: (r) => r.invalidate(alertsProvider(_query)),
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(alertsProvider(_query)),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s12),
            children: [
              _filters(),
              const SizedBox(height: T.s4),
              ..._content(async),
            ],
          ),
        ),
      ),
    );
  }

  Widget _filters() {
    // The chip theme's label style carries no typeface, so a bare label falls
    // back to the platform's font beside the app's own. Named explicitly.
    final label = T.small.copyWith(
      fontFamily: Theme.of(context).textTheme.bodyMedium?.fontFamily,
      fontWeight: FontWeight.w600,
    );

    // Wrapped, not scrolled: a bounded set of filters cut off at the screen's
    // edge is a filter nobody knows is there.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: T.s2,
          runSpacing: T.s2,
          children: [
            for (final (value, name) in _statuses)
              ChoiceChip(
                label: Text(name, style: label),
                // The fill says which is chosen; a tick as well made every
                // chip wider and pushed the set onto a third line.
                showCheckmark: false,
                selected: _status == value,
                onSelected: (_) => setState(() => _status = value),
              ),
          ],
        ),
        const SizedBox(height: T.s2),
        Wrap(
          spacing: T.s2,
          runSpacing: T.s2,
          children: [
            for (final (value, name) in _severities)
              ChoiceChip(
                label: Text(name, style: label),
                showCheckmark: false,
                selected: _severity == value,
                onSelected: (_) => setState(() => _severity = value),
              ),
          ],
        ),
        const SizedBox(height: T.s3),
        TextField(
          controller: _searchController,
          onChanged: (v) => setState(() => _search = v),
          style: T.body.copyWith(color: T.ink),
          decoration: InputDecoration(
            hintText: 'Search by patient or alert',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _search.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () {
                      _searchController.clear();
                      setState(() => _search = '');
                    },
                  ),
            filled: true,
            fillColor: T.surfaceRaised,
            constraints: const BoxConstraints(minHeight: T.tap),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(T.rControl),
              borderSide: const BorderSide(color: T.line),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(T.rControl),
              borderSide: const BorderSide(color: T.line),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _content(AsyncValue<Paged<ClinicalAlert>> async) {
    if (!async.hasValue) {
      if (async.hasError) {
        return [
          HomeCard(
            child: PanelProblem(
              problem: loadProblemOf(async.error),
              what: 'the alerts',
              serverMessage: readableServerMessage(async.error),
              onRetry: () => ref.invalidate(alertsProvider(_query)),
            ),
          ),
        ];
      }
      return const [HomeCard(child: PanelLoading(what: 'the alerts'))];
    }

    final shown = _filter(async.requireValue.items);
    return [
      if (async.hasError) ...[
        StaleNote(onRetry: () => ref.invalidate(alertsProvider(_query))),
        const SizedBox(height: T.s3),
      ],
      if (shown.isEmpty)
        _empty()
      else
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const SizedBox(height: T.s3),
          _AlertCard(
            // The alert on the card, not the one at the same index before the
            // filters ran.
            alert: shown[i],
            onAcknowledge: () => _acknowledge(shown[i]),
            onResolve: () => _resolve(shown[i]),
          ),
        ],
    ];
  }

  /// An empty list that says which empty it is, and what to do next.
  Widget _empty() {
    final filtered = _search.trim().isNotEmpty || _severity != null;
    final (String title, String body, String? action, VoidCallback? onAction) =
        switch (_status) {
          _ when filtered => (
            'No alerts match these filters',
            'Nothing with this severity or name is in the ${_status == null ? 'list' : '${_statusLabel(_status)} list'}.',
            'Clear filters',
            _clearFilters,
          ),
          'open' => (
            'No open alerts',
            'Nothing is waiting for a clinician. An alert opens here when a reading or a message crosses a clinical threshold — a very low or very high sugar, a crisis blood pressure, a red-flag symptom — and the doctor is told.',
            'Show resolved alerts',
            () => setState(() => _status = 'resolved'),
          ),
          'acknowledged' => (
            'No acknowledged alerts',
            'Alerts somebody has seen but not yet resolved appear here.',
            'Show open alerts',
            () => setState(() => _status = 'open'),
          ),
          'resolved' => (
            'No resolved alerts',
            'Alerts marked resolved, with their notes, appear here.',
            'Show open alerts',
            () => setState(() => _status = 'open'),
          ),
          _ => (
            'No alerts yet',
            'This practice has had no clinical alerts.',
            null,
            null,
          ),
        };

    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                filtered ? Icons.search_off_rounded : Icons.check_circle_outline_rounded,
                size: T.s6,
                color: filtered ? T.inkMuted : T.success,
              ),
              const SizedBox(width: T.s3),
              Expanded(child: Text(title, style: T.bodyStrong.copyWith(color: T.ink))),
            ],
          ),
          const SizedBox(height: T.s2),
          Text(body, style: T.body.copyWith(color: T.inkMuted)),
          if (action != null) ...[
            const SizedBox(height: T.s3),
            OutlinedButton(
              onPressed: onAction,
              style: OutlinedButton.styleFrom(
                foregroundColor: T.primary,
                minimumSize: const Size(T.tap, T.tap),
                side: const BorderSide(color: T.line),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(T.rControl)),
              ),
              child: Text(action, style: T.bodyStrong),
            ),
          ],
        ],
      ),
    );
  }

  static String _statusLabel(String? status) => switch (status) {
    'open' => 'open',
    'acknowledged' => 'acknowledged',
    'resolved' => 'resolved',
    _ => '',
  };

  Future<void> _acknowledge(ClinicalAlert a) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(clinicianRepositoryProvider).acknowledgeAlert(a.id);
      ref.invalidate(alertsProvider(_query));
      // The home's counts follow at once rather than on its next poll.
      ref.invalidate(overviewProvider);
      ref.invalidate(attentionPatientsProvider);
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update the alert. Please try again.')),
      );
    }
  }

  Future<void> _resolve(ClinicalAlert a) async {
    final controller = TextEditingController();
    final notes = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Resolve alert'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'What was done (optional)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Resolve'),
          ),
        ],
      ),
    );
    // Cancel and the back button both return null.
    if (notes == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .resolveAlert(a.id, notes: notes.isEmpty ? null : notes);
      ref.invalidate(alertsProvider(_query));
      ref.invalidate(overviewProvider);
      ref.invalidate(attentionPatientsProvider);
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update the alert. Please try again.')),
      );
    }
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({
    required this.alert,
    required this.onAcknowledge,
    required this.onResolve,
  });

  final ClinicalAlert alert;
  final VoidCallback onAcknowledge;
  final VoidCallback onResolve;

  /// Severity says how bad it was; status says whether it still needs anyone.
  /// A resolved emergency is not drawn in emergency red — a doctor who learns
  /// that red can mean "handled" stops reading red as urgent.
  static StatusWord severityWord(String severity, {required bool settled}) {
    final label = switch (severity) {
      'emergency' => 'Emergency',
      'urgent' => 'Urgent',
      'warning' => 'Warning',
      _ => 'Information',
    };
    if (settled) return StatusWord(label: label, tone: Tone.neutral);
    return StatusWord(
      label: label,
      tone: switch (severity) {
        'emergency' || 'urgent' => Tone.danger,
        'warning' => Tone.warning,
        _ => Tone.neutral,
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final a = alert;
    final settled = a.isResolved;
    final gender = switch (a.patientGender) {
      'male' => 'Male',
      'female' => 'Female',
      'other' => 'Other',
      _ => null,
    };
    final facts = [
      if (a.patientAge != null) '${a.patientAge} years',
      if (gender != null) gender,
      if (a.patientPhone != null) a.patientPhone!,
    ].join(' · ');

    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Wrap(
                  spacing: T.s2,
                  runSpacing: T.s1,
                  children: [
                    severityWord(a.severity, settled: settled),
                    if (a.status == 'acknowledged')
                      const StatusWord(label: 'Acknowledged', tone: Tone.neutral),
                    if (settled)
                      StatusWord(
                        label: a.status == 'dismissed' ? 'Dismissed' : 'Resolved',
                        tone: Tone.success,
                      ),
                  ],
                ),
              ),
              if (a.createdAt != null) ...[
                const SizedBox(width: T.s2),
                Text(
                  DateFormat('d MMM, h:mm a').format(a.createdAt!),
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ],
          ),
          const SizedBox(height: T.s2),
          Text(a.title, style: T.bodyStrong.copyWith(color: T.ink)),
          if (a.patientName != null) ...[
            const SizedBox(height: T.s2),
            // Who it is about, with a face, one tap from their record.
            Semantics(
              button: a.patientId != null,
              label: [a.patientName!, if (facts.isNotEmpty) facts].join('. '),
              excludeSemantics: true,
              child: InnerTile(
                onTap: a.patientId == null
                    ? null
                    : () => context.push('/clinician/patients/${a.patientId}', extra: a.patientName),
                padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
                child: Row(
                  children: [
                    UserAvatar(
                      name: a.patientName!,
                      avatarUrl: a.patientAvatarUrl,
                      accent: T.primary,
                      size: T.s8 + T.s2,
                    ),
                    const SizedBox(width: T.s3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(a.patientName!, style: T.bodyStrong.copyWith(color: T.ink)),
                          if (facts.isNotEmpty)
                            Text(facts, style: T.small.copyWith(color: T.inkMuted)),
                          if ((a.patientAddress ?? '').trim().isNotEmpty)
                            Text(a.patientAddress!.trim(), style: T.small.copyWith(color: T.inkMuted)),
                          if (a.patientRiskBand == 'critical' || a.patientRiskBand == 'high')
                            Padding(
                              padding: const EdgeInsets.only(top: T.s1),
                              child: StatusWord(
                                label: a.patientRiskBand == 'critical' ? 'Critical risk' : 'High risk',
                                tone: a.patientRiskBand == 'critical' ? Tone.danger : Tone.warning,
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (a.patientId != null)
                      const Icon(Icons.chevron_right_rounded, size: T.s6, color: T.inkMuted),
                  ],
                ),
              ),
            ),
          ],
          if (a.detail != null && a.detail!.trim().isNotEmpty) ...[
            const SizedBox(height: T.s2),
            Text(
              a.detail!.trim(),
              style: T.body.copyWith(color: T.inkMuted),
              maxLines: 6,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (!settled) ...[
            const SizedBox(height: T.s3),
            // Quiet actions on every card — a list of filled buttons is a list
            // of primaries — and they move to their own line rather than
            // breaking "Acknowledge" in half.
            Wrap(
              alignment: WrapAlignment.end,
              spacing: T.s2,
              runSpacing: T.s2,
              children: [
                if (a.status == 'open')
                  TextButton(
                    onPressed: onAcknowledge,
                    style: TextButton.styleFrom(
                      foregroundColor: T.primary,
                      minimumSize: const Size(T.tap, T.tap),
                    ),
                    child: const Text('Acknowledge', style: T.bodyStrong),
                  ),
                OutlinedButton.icon(
                  onPressed: onResolve,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: T.primary,
                    minimumSize: const Size(T.tap, T.tap),
                    side: const BorderSide(color: T.primary),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(T.rControl)),
                  ),
                  icon: const Icon(Icons.check_rounded, size: T.s5),
                  label: const Text('Resolve', style: T.bodyStrong),
                ),
              ],
            ),
          ],
          if (settled && (a.resolutionNotes ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: T.s2),
            Text(
              'What was done: ${a.resolutionNotes!.trim()}',
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ],
        ],
      ),
    );
  }
}
