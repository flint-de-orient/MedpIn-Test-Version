import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../data/clinician_repository.dart';
import 'package:go_router/go_router.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_visuals.dart';

/// Clinical-alert triage: filter, acknowledge and resolve the alerts raised by
/// the assistant and the tracking rules.
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  String? _status = 'open';
  String? _severity;
  String _search = '';

  static const _statuses = [
    ('open', 'Open'),
    ('acknowledged', 'Acknowledged'),
    ('resolved', 'Resolved'),
    (null, 'All'),
  ];

  /// Severity, worst first. `info` is folded into the unfiltered view rather
  /// than given a chip of its own — nobody comes to this screen looking for
  /// the least important thing on it.
  static const _severities = [
    (null, 'Any severity'),
    ('emergency', 'Emergency'),
    ('urgent', 'Urgent'),
    ('warning', 'Warning'),
  ];

  AlertsQuery get _query => (status: _status, severity: _severity);

  /// Name match, in memory. The page is already loaded and a clinic's open
  /// alerts are few; a round trip per keystroke would be slower than the
  /// scroll it saves.
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

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(alertsProvider(_query));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Clinical alerts'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(150),
          child: Column(
            children: [
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                  ),
                  itemCount: _statuses.length,
                  separatorBuilder:
                      (_, _) => const SizedBox(width: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final (value, label) = _statuses[i];
                    return ChoiceChip(
                      label: Text(label),
                      selected: _status == value,
                      onSelected: (_) => setState(() => _status = value),
                    );
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              // Severity, alongside status. "Open" is a queue; "open and an
              // emergency" is the thing the doctor actually opened this screen
              // for, and until now the only way to it was reading the rails.
              SizedBox(
                height: 36,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                  ),
                  itemCount: _severities.length,
                  separatorBuilder:
                      (_, _) => const SizedBox(width: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final (value, label) = _severities[i];
                    final on = _severity == value;
                    return ChoiceChip(
                      label: Text(label),
                      selected: on,
                      visualDensity: VisualDensity.compact,
                      avatar:
                          value == null || on
                              ? null
                              : Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: alertSeverityColor(value),
                                  shape: BoxShape.circle,
                                ),
                              ),
                      onSelected: (_) => setState(() => _severity = value),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.sm,
                  AppSpacing.md,
                  AppSpacing.sm,
                ),
                child: TextField(
                  onChanged: (v) => setState(() => _search = v),
                  style: const TextStyle(fontSize: 15.5),
                  decoration: InputDecoration(
                    hintText: 'Search patient or alert…',
                    prefixIcon: Icon(
                      Icons.search_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                    suffixIcon:
                        _search.isEmpty
                            ? null
                            : IconButton(
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () => setState(() => _search = ''),
                            ),
                    filled: true,
                    fillColor: scheme.surfaceContainerHigh.withValues(
                      alpha: 0.55,
                    ),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(28),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      body: AutoRefresh(
        onTick: (r) => r.invalidate(alertsProvider(_query)),
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(alertsProvider(_query)),
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load alerts'),
                      const SizedBox(height: AppSpacing.sm),
                      OutlinedButton(
                        onPressed: () => ref.invalidate(alertsProvider(_query)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
            data: (paged) {
              final shown = _filter(paged.items);
              if (shown.isEmpty) {
                final filtered = _search.isNotEmpty || _severity != null;
                return ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.2),
                    Icon(
                      filtered
                          ? Icons.search_off_rounded
                          : Icons.verified_outlined,
                      size: 56,
                      color: scheme.outlineVariant,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Center(
                      child: Text(
                        filtered ? 'No alerts match' : 'Nothing here',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (filtered) ...[
                      const SizedBox(height: AppSpacing.md),
                      Center(
                        child: OutlinedButton(
                          onPressed:
                              () => setState(() {
                                _search = '';
                                _severity = null;
                              }),
                          child: const Text('Clear filters'),
                        ),
                      ),
                    ],
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: shown.length,
                separatorBuilder:
                    (_, _) => const SizedBox(height: AppSpacing.sm),
                itemBuilder:
                    (context, i) => _AlertCard(
                      alert: shown[i],
                      onAcknowledge: () => _acknowledge(paged.items[i]),
                      onResolve: () => _resolve(paged.items[i]),
                    ),
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _acknowledge(ClinicalAlert a) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(clinicianRepositoryProvider).acknowledgeAlert(a.id);
      ref.invalidate(alertsProvider(_query));
      // Push the change to the dashboard now instead of waiting for its 20s
      // poll — the open-alert counts and worklist update in real time.
      ref.invalidate(overviewProvider);
      ref.invalidate(attentionPatientsProvider);
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update. Please try again.')),
      );
    }
  }

  Future<void> _resolve(ClinicalAlert a) async {
    final controller = TextEditingController();
    final notes = await showDialog<String?>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Resolve alert'),
            content: TextField(
              controller: controller,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Resolution notes (optional)',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                child: const Text('Resolve'),
              ),
            ],
          ),
    );
    if (notes == null || !mounted)
      return; // Cancel returns null (back button too).
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .resolveAlert(a.id, notes: notes.isEmpty ? null : notes);
      ref.invalidate(alertsProvider(_query));
      // Reflect the resolve on the dashboard immediately (open alerts, worklist).
      ref.invalidate(overviewProvider);
      ref.invalidate(attentionPatientsProvider);
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update. Please try again.')),
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

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final a = alert;
    // Severity says how bad it was; status says whether it still needs anyone.
    // Painting a resolved emergency in emergency red spends the loudest colour
    // in the app on something already dealt with — and a doctor who learns that
    // red can mean "handled" stops reading red as urgent.
    final settled = a.status == 'resolved' || a.status == 'dismissed';
    final color = settled ? scheme.outline : alertSeverityColor(a.severity);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border(left: BorderSide(color: color, width: 4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                MiniPill(label: a.severity.toUpperCase(), color: color),
                const SizedBox(width: AppSpacing.sm),
                if (a.status != 'open')
                  MiniPill(
                    label: a.status.toUpperCase(),
                    color: const Color(0xFF6B7280),
                  ),
                const Spacer(),
                if (a.createdAt != null)
                  Text(
                    DateFormat('d MMM, h:mm a').format(a.createdAt!),
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              a.title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            // Who this is about, with a face. An alert is read in a hurry and
            // acted on immediately; a name in grey text is slower to place than
            // a photo, and tapping through to the record should not require
            // first working out whose record it is.
            if (a.patientName != null) ...[
              const SizedBox(height: AppSpacing.sm),
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap:
                    a.patientId == null
                        ? null
                        : () =>
                            context.push('/clinician/patients/${a.patientId}'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      UserAvatar(
                        name: a.patientName!,
                        avatarUrl: a.patientAvatarUrl,
                        accent: AppColors.accentOn(context),
                        size: 38,
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    a.patientName!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                                if (a.patientRiskBand != null &&
                                    a.patientRiskBand != 'low') ...[
                                  const SizedBox(width: 4),
                                  MiniPill(
                                    label: a.patientRiskBand!.toUpperCase(),
                                    color: riskBandColor(a.patientRiskBand!),
                                  ),
                                ],
                              ],
                            ),
                            Text(
                              [
                                if (a.patientAge != null) '${a.patientAge} yrs',
                                if (a.patientGender != null) a.patientGender!,
                                if (a.patientPhone != null) a.patientPhone!,
                              ].join('  •  '),
                              style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                            if ((a.patientAddress ?? '').trim().isNotEmpty)
                              Text(
                                a.patientAddress!.trim(),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  height: 1.3,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                          ],
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 20,
                        color: scheme.outline,
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (a.detail != null && a.detail!.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                a.detail!,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.4,
                  color: scheme.onSurface,
                ),
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (!a.isResolved) ...[
              const SizedBox(height: AppSpacing.md),
              Row(
                children: [
                  if (a.status == 'open') ...[
                    Expanded(
                      child: OutlinedButton(
                        onPressed: onAcknowledge,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(44),
                          foregroundColor: AppColors.primary,
                          side: BorderSide(color: AppColors.accentOn(context)),
                        ),
                        child: const Text('Acknowledge'),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                  ],
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: onResolve,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(44),
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                      ),
                      icon: const Icon(
                        Icons.check_circle_outline_rounded,
                        size: 18,
                      ),
                      label: const Text('Resolve'),
                    ),
                  ),
                ],
              ),
            ],
            if (a.isResolved &&
                a.resolutionNotes != null &&
                a.resolutionNotes!.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Resolution: ${a.resolutionNotes}',
                style: TextStyle(
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
