import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/clinic_brand.dart';

/// The clinic's name at the top of a panel screen — the clinic's, never the
/// product's.
///
/// The shared wordmark stands the product's emblem in for a clinic with no
/// logo, and the product's name in for a clinic that has not loaded yet, so for
/// the first moments of every morning a clinic's own screens said MedPin. The
/// people using them work for the clinic. With no logo there is no mark at all;
/// with no name yet there is [fallback], which names the screen rather than
/// guessing whose it is.
///
/// Candidate for lib/shared/widgets beside [ClinicWordmark].
class ClinicTitle extends ConsumerWidget {
  const ClinicTitle({super.key, required this.fallback, this.subtitle});

  /// What the title says before the clinic's name is known: "Front desk".
  final String fallback;

  /// A line under the name, drawn only once the clinic is known.
  final Widget? subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clinic = ref.watch(brandClinicProvider).valueOrNull;
    final name = (clinic?.name ?? '').trim();
    final logo = clinic?.logoLightUrl;

    return Row(
      children: [
        if (logo != null && logo.isNotEmpty) ...[
          ClinicMark(clinic: clinic, size: T.s8 + T.s2),
          const SizedBox(width: T.s3),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name.isEmpty ? fallback : name,
                // Room to wrap: this clinic's name is nine words long, and one
                // line of it is "Dr. Dey's Diabetes Obesity & Metabolic…".
                // Three lines, because at a large text size two cut it.
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: T.bodyStrong.copyWith(color: T.ink, height: 1.3),
              ),
              if (clinic != null && subtitle != null) subtitle!,
            ],
          ),
        ),
      ],
    );
  }
}
