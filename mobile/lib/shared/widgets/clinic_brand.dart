import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../features/appointments/data/clinic_repository.dart';
import '../../features/appointments/domain/clinic.dart';
import 'authed_image.dart';

/// The clinic's identity, wherever a panel says who it belongs to.
///
/// MedPin is the product. The clinic is the tenant, and the tenant is what the
/// people using these screens work for — a receptionist at Dr. Dey's does not
/// think of themselves as opening MedPin any more than a bank teller thinks of
/// opening a browser. Every panel header said MedPin because the brand was a
/// string in the source; the clinic's own name and mark were sitting in the
/// database the whole time, editable from Profile, and drawn nowhere.
///
/// The app's own name has not gone anywhere: it is on the icon, the splash and
/// the About screen. Those are the places where "what is this software" is the
/// question being asked. A panel header is answering a different one.

/// The clinic to brand the app with.
///
/// A single-clinic install is the common case, so the first active one is the
/// one. Read rather than assumed: putting a guessed name on a header is putting
/// someone else's clinic on the screen.
final FutureProvider<Clinic?> brandClinicProvider = FutureProvider<Clinic?>((
  ref,
) async {
  final clinics = await ref.watch(clinicRepositoryProvider).list();
  if (clinics.isEmpty) return null;
  return clinics.firstWhere((c) => c.isActive, orElse: () => clinics.first);
});

/// The clinic's logo, or its initial when it has none.
///
/// A square mark for a corner: an avatar slot, a list row, the desk header.
/// Falls back rather than showing an empty box — a clinic that has not uploaded
/// artwork still has a name, and a blank square reads as something that failed
/// to load.
class ClinicMark extends StatelessWidget {
  const ClinicMark({
    super.key,
    required this.clinic,
    this.size = 44,
    this.radius,
  });

  final Clinic? clinic;
  final double size;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    final r = radius ?? AppSpacing.cardRadius;
    final url = clinic?.logoLightUrl;
    final name = (clinic?.name ?? '').trim();

    if (url == null || url.isEmpty) {
      return Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(r),
        ),
        child: Text(
          name.isEmpty ? 'C' : name[0].toUpperCase(),
          style: TextStyle(
            fontSize: size * 0.42,
            fontWeight: FontWeight.w800,
            color: AppColors.primary,
          ),
        ),
      );
    }

    final image = AuthedImage(
      path: url,
      width: size,
      height: size,
      radius: r,
      // A logo is cut out, so it sits on the page rather than on a plate.
      background: Colors.transparent,
      fit: BoxFit.contain,
    );

    // Artwork drawn for a dark letterhead is given a dark ground rather than
    // being inverted: inversion is a per-channel complement, so this clinic's
    // teal would come back orange, and the colour is what a logo carries.
    if (clinic?.logoNeedsDarkChip ?? false) {
      return Container(
        width: size,
        height: size,
        padding: EdgeInsets.all(size * 0.12),
        decoration: BoxDecoration(
          color: const Color(0xFF0E1526),
          borderRadius: BorderRadius.circular(r),
        ),
        child: image,
      );
    }

    return ClipRRect(borderRadius: BorderRadius.circular(r), child: image);
  }
}

/// The clinic's name across the top of a panel.
///
/// When the clinic has a logo, the logo is all that is drawn — and that is the
/// point rather than an omission. Clinic artwork is nearly always a wordmark:
/// this one literally reads "Dr. Dey's · Diabetes Obesity & Metabolic Clinic".
/// Setting the name beside it prints the name twice, and in a row that also
/// holds a bell and a face there is not width for one copy, let alone two.
///
/// With no logo the name is the wordmark, wrapped to two lines. With no clinic
/// at all — a fresh install, an offline first run — the app's own emblem stands
/// in, because a header with nothing in the corner looks broken.
class ClinicWordmark extends ConsumerWidget {
  const ClinicWordmark({
    super.key,
    this.subtitle,
    this.height = 34,
    this.maxWidth = 200,
  });

  /// A line under the mark: "Doctor Panel", "Front desk".
  final String? subtitle;

  /// How tall the logo may be drawn.
  final double height;

  /// How much of the row the mark may claim before the bell and the face.
  final double maxWidth;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final clinic = ref.watch(brandClinicProvider).valueOrNull;
    final logo = clinic?.logoLightUrl;
    final sub =
        subtitle == null
            ? null
            : Text(
              subtitle!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                height: 1.2,
                fontWeight: FontWeight.w500,
                color: scheme.onSurfaceVariant,
              ),
            );

    Widget wrap(Widget mark) {
      if (sub == null) return mark;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [mark, const SizedBox(height: 2), sub],
      );
    }

    if (logo != null && logo.isNotEmpty) {
      final dark = clinic?.logoNeedsDarkChip ?? false;
      Widget image = AuthedImage(
        path: logo,
        // Wide rather than square: a wordmark is a long thin thing, and a
        // square box either shrinks it to nothing or crops the words off it.
        width: maxWidth,
        height: height,
        radius: 0,
        background: Colors.transparent,
        fit: BoxFit.contain,
      );
      if (dark) {
        image = Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFF0E1526),
            borderRadius: BorderRadius.circular(8),
          ),
          child: image,
        );
      }
      return ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: wrap(
          Align(alignment: Alignment.centerLeft, child: image),
        ),
      );
    }

    final name = (clinic?.name ?? '').trim();
    if (name.isEmpty) {
      // No clinic yet. The product's own mark, which is the honest answer to
      // "whose app is this" when nobody has told it about a clinic.
      return wrap(
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/brand/medpin_emblem.png',
              height: height * 0.88,
              errorBuilder:
                  (_, _, _) => Icon(
                    Icons.forum_rounded,
                    size: height * 0.76,
                    color: AppColors.accentOn(context),
                  ),
            ),
            const SizedBox(width: 8),
            Text(
              AppConfig.appName,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.accentOn(context),
              ),
            ),
          ],
        ),
      );
    }

    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: wrap(
        Text(
          name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 17,
            height: 1.15,
            fontWeight: FontWeight.w800,
            color: AppColors.accentOn(context),
          ),
        ),
      ),
    );
  }
}
