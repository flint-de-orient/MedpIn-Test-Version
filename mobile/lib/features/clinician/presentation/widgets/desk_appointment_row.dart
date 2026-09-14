import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../staff/presentation/widgets/desk_geometry.dart';
import '../../../../shared/utils/phone_format.dart';

/// One booked appointment, as the desk reads it.
///
/// The patient's name is the strongest thing on the row, not the time. The desk
/// is nearly always answering "when is Mrs Rahman coming?" rather than "who is
/// at 10:30" — the time block earns its place by making the column scannable,
/// but it should not outweigh the person.
class DeskAppointmentRow extends ConsumerWidget {
  const DeskAppointmentRow({
    super.key,
    required this.appointment,
    required this.onManage,
  });

  final Appointment appointment;
  final VoidCallback onManage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();
    final dimmed = a.isCancelled;

    final (statusLabel, statusTone) = _status(context, a.status);

    return Opacity(
      opacity: dimmed ? 0.55 : 1,
      child: Material(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(kInnerRadius + 2),
        child: InkWell(
          onTap: onManage,
          borderRadius: BorderRadius.circular(kInnerRadius + 2),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(kInnerRadius + 2),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.6),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _TimeBlock(at: a.scheduledFor?.toLocal(), locale: locale),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    a.patientName ?? 'Patient',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 16.5,
                                      height: 1.2,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                _StatusPill(
                                  label: statusLabel,
                                  tone: statusTone,
                                ),
                              ],
                            ),
                            if ((a.patientPhone ?? '').isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      formatPhone(a.patientPhone),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 13.5,
                                        color: scheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  InkWell(
                                    onTap:
                                        () => launchUrl(
                                          Uri(
                                            scheme: 'tel',
                                            path: a.patientPhone,
                                          ),
                                        ),
                                    borderRadius: BorderRadius.circular(20),
                                    child: Padding(
                                      padding: const EdgeInsets.all(3),
                                      child: Icon(
                                        Icons.call_rounded,
                                        size: 16,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            const SizedBox(height: 3),
                            Row(
                              children: [
                                Icon(
                                  _modeIcon(a.mode),
                                  size: 14,
                                  color: scheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 4),
                                Flexible(
                                  child: Text(
                                    _modeLabel(a.mode),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        icon: Icon(
                          Icons.more_vert_rounded,
                          size: 19,
                          color: scheme.onSurfaceVariant,
                        ),
                        onPressed: onManage,
                      ),
                    ],
                  ),

                  // What the patient originally asked for, when it is not what
                  // they got. A badge rather than a plain line, because it is
                  // the reason this row may need a phone call — the desk gave
                  // them one o'clock and they wanted four.
                  if (a.preferredTime != null || (a.reason ?? '').isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8, left: 2),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.warningBgOn(context),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.schedule_rounded,
                              size: 13,
                              color: AppColors.warningOn(context),
                            ),
                            const SizedBox(width: 5),
                            Flexible(
                              child: Text(
                                a.preferredTime != null
                                    ? 'Requested around ${a.preferredTime}'
                                    : a.reason!,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  height: 1.25,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.warningOn(context),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

IconData _modeIcon(String mode) =>
    mode == 'teleconsult' ? Icons.videocam_outlined : Icons.place_outlined;

String _modeLabel(String mode) =>
    mode == 'teleconsult' ? 'Video consult' : 'In clinic';

/// Colour carries the meaning, and the word carries it too.
///
/// Never colour alone: a status a colourblind receptionist cannot read is a
/// status the app has not communicated.
(String, Color) _status(BuildContext context, String status) => switch (status) {
  'requested' => ('Requested', AppColors.warningOn(context)),
  'confirmed' => ('Confirmed', AppColors.primary),
  'completed' => ('Completed', AppColors.successOn(context)),
  'cancelled' => ('Cancelled', AppColors.dangerOn(context)),
  'no_show' => ('No show', AppColors.dangerOn(context)),
  _ => (status, Theme.of(context).colorScheme.onSurfaceVariant),
};

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.tone});

  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          color: tone,
        ),
      ),
    );
  }
}

class _TimeBlock extends StatelessWidget {
  const _TimeBlock({required this.at, required this.locale});

  final DateTime? at;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: 62,
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            // A request has no hour yet. Printing one would tell the desk a
            // time the patient was never given.
            at == null ? '--' : DateFormat('h:mm', locale).format(at!),
            style: TextStyle(
              fontSize: 15.5,
              height: 1.1,
              fontWeight: FontWeight.w800,
              color: at == null ? scheme.onSurfaceVariant : AppColors.primary,
            ),
          ),
          if (at != null)
            Text(
              DateFormat('a', locale).format(at!),
              style: TextStyle(
                fontSize: 11,
                height: 1.2,
                fontWeight: FontWeight.w700,
                color: AppColors.primary.withValues(alpha: 0.8),
              ),
            ),
        ],
      ),
    );
  }
}
