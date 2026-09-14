import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/data/care_contact.dart';

/// Rendered whenever `triage.urgency == "emergency"`. This is a
/// patient-safety requirement, not decoration — keep it loud, and never
/// collapse it behind a tap.
///
/// "Call clinic" dials the patient's own practice, as the server resolves it,
/// and is drawn only when there is a number to dial. It used to fall back to a
/// placeholder compiled into the app, so a patient with chest pain could be
/// connected to a number that rang nowhere — or to another practice. With no
/// number the card still says the one thing that is always right: go to the
/// nearest hospital.
class EmergencyCard extends ConsumerWidget {
  const EmergencyCard({super.key, required this.content});

  final String content;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final phone = ref.watch(careContactProvider).valueOrNull?.phone;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.dangerBgOn(context),
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: AppColors.dangerOn(context), width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Solid red disc — carries the warning independently of colour,
              // which matters for the ~8% of men with colour blindness in a
              // cohort that is mostly men over 45.
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.dangerOn(context),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.warning_amber_rounded,
                  color: Colors.white,
                  size: 26,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.chatEmergencyBody,
                      style: TextStyle(
                        color: AppColors.dangerOn(context),
                        fontWeight: FontWeight.w800,
                        fontSize: 20,
                        height: 1.3,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      content,
                      style: const TextStyle(
                        fontSize: 16,
                        height: 1.45,
                        color: Color(0xFF1F2937),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (phone != null) ...[
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              height: AppSpacing.minTapTarget + 8,
              child: ElevatedButton.icon(
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: AppColors.danger,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(
                      AppSpacing.buttonRadius,
                    ),
                    side: BorderSide(
                      color: AppColors.dangerOn(context),
                      width: 1.5,
                    ),
                  ),
                ),
                icon: const Icon(Icons.call_rounded, size: 22),
                label: Text(
                  l10n.chatCallClinic,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
