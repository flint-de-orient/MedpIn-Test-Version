import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../appointments/domain/clinic.dart';
import '../../appointments/presentation/appointment_providers.dart';
import 'widgets/clinician_visuals.dart';

const _dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Clinic + availability management for doctor and staff. The list; editing is
/// [ClinicEditScreen].
class ClinicsScreen extends ConsumerWidget {
  const ClinicsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(clinicsProvider);

    // Somebody narrowed to particular locations runs those and reads the rest,
    // and opening a new one is for somebody who runs them all — the server
    // refuses it, so it is not offered. Before the list loads nothing is known,
    // and the button waits rather than appearing and vanishing.
    final narrowed =
        async.valueOrNull?.any((c) => c.managedByYou == false) ?? true;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Clinics'),
      ),
      floatingActionButton:
          narrowed
              ? null
              : FloatingActionButton.extended(
                onPressed: () => context.push('/clinician/clinics/new'),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add clinic'),
              ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(clinicsProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load clinics'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      onPressed: () => ref.invalidate(clinicsProvider),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          data: (clinics) {
            if (clinics.isEmpty) {
              return ListView(
                children: [
                  SizedBox(height: MediaQuery.of(context).size.height * 0.16),
                  Icon(
                    Icons.local_hospital_outlined,
                    size: 56,
                    color: scheme.outlineVariant,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Center(
                    child: Text(
                      'No clinics yet',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  // Optional, and said so. "Add a clinic to start taking
                  // bookings" read as a step the practice had to complete, when
                  // requests, visits and the whole record work without one; a
                  // location adds published hours patients book from.
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: T.s6),
                    child: Text(
                      'Appointments work without one. Add a clinic to publish '
                      'opening hours patients can book from.',
                      textAlign: TextAlign.center,
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.md,
                AppSpacing.md,
                96,
              ),
              itemCount: clinics.length,
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
              itemBuilder:
                  (context, i) => _ClinicRow(
                    clinic: clinics[i],
                    // Only a location the reader runs opens for editing; the
                    // server refuses the rest.
                    onTap:
                        clinics[i].managedByYou == false
                            ? null
                            : () => context.push(
                              '/clinician/clinics/edit',
                              extra: clinics[i],
                            ),
                  ),
            );
          },
        ),
      ),
    );
  }
}

class _ClinicRow extends StatelessWidget {
  const _ClinicRow({required this.clinic, required this.onTap});

  final Clinic clinic;

  /// Null for a location the reader does not run: shown, not editable.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final c = clinic;
    final days = c.weeklyHours.map((w) => w.dayOfWeek).toSet().toList()..sort();
    final daysLabel =
        days.isEmpty
            ? 'No hours set'
            : days.map((d) => _dayLabels[d]).join(', ');

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: Opacity(
        opacity: c.isActive ? 1 : 0.6,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.6),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: AppColors.accentOn(context).withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.local_hospital_rounded,
                  color: AppColors.accentOn(context),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            c.name,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (!c.isActive) ...[
                          const SizedBox(width: T.s1),
                          const MiniPill(label: 'Inactive', color: T.inkMuted),
                        ],
                        // In words, so a row that does not open is not taken
                        // for a broken one.
                        if (onTap == null) ...[
                          const SizedBox(width: T.s1),
                          const MiniPill(label: 'View only', color: T.inkMuted),
                        ],
                      ],
                    ),
                    if (c.locationLine.isNotEmpty) ...[
                      const SizedBox(height: 0),
                      Text(
                        c.locationLine,
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          Icons.schedule_rounded,
                          size: 13,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            '$daysLabel · ${c.slotMinutes} min slots',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (onTap != null)
                Icon(Icons.chevron_right_rounded, color: scheme.outline),
            ],
          ),
        ),
      ),
    );
  }
}
