import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../features/appointments/data/clinic_repository.dart';
import '../../features/appointments/domain/clinic.dart';
import 'authed_image.dart' show AuthedImage, imageAuthHeaderProvider;

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

/// The clinic's mark and its name, across the top of a panel.
///
/// Both, always — which is a correction. This first drew the logo *instead* of
/// the name, on the reasoning that clinic artwork is usually a wordmark and
/// printing the name beside one prints it twice. That reasoning is sound and
/// the premise was wrong: the mark this clinic actually uploaded is the
/// symbol alone, no words in it at all. So the header showed a small abstract
/// shape and nothing that said whose clinic this was.
///
/// A logo that happens to contain its own name is not worth detecting. It
/// costs a repeated word; guessing wrong costs the clinic its name on every
/// screen.
///
/// The logo is sized by height only. Giving it a fixed width and asking
/// [BoxFit.contain] to fill it centres a square mark inside a wide box, which
/// is where the gap down the left of the header came from — the image was
/// doing exactly what it was told, in a box that was the wrong shape. Height
/// alone lets a square mark be square and a wordmark be wide.
class ClinicWordmark extends ConsumerWidget {
  const ClinicWordmark({
    super.key,
    this.subtitle,
    this.subtitleWidget,
    this.height = 34,
    this.maxLogoWidth = 92,
  });

  /// A line under the name: "Doctor Panel", "Front desk".
  final String? subtitle;

  /// The same line, when it is more than text.
  ///
  /// The front desk puts a live open/closed chip beside "Front Desk", which is
  /// the one thing on that header a receptionist reads before answering the
  /// phone. Overrides [subtitle] when both are given. Optional so that every
  /// other panel keeps passing a plain string and keeps behaving identically.
  final Widget? subtitleWidget;

  /// How tall the logo is drawn.
  final double height;

  /// How wide a very wide wordmark may get before the name is squeezed.
  final double maxLogoWidth;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final clinic = ref.watch(brandClinicProvider).valueOrNull;
    final logo = clinic?.logoLightUrl;
    final name = (clinic?.name ?? '').trim();

    // No clinic yet — a fresh install, or the list still loading. The product's
    // own mark stands in, because a header with an empty corner reads as
    // something that failed rather than something not yet configured.
    final hasClinic = name.isNotEmpty || (logo != null && logo.isNotEmpty);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (logo != null && logo.isNotEmpty)
          _Logo(
            url: logo,
            height: height,
            maxWidth: maxLogoWidth,
            needsDarkChip: clinic?.logoNeedsDarkChip ?? false,
          )
        else
          Image.asset(
            'assets/brand/medpin_emblem.png',
            height: height * 0.86,
            errorBuilder:
                (_, _, _) => Icon(
                  Icons.forum_rounded,
                  size: height * 0.74,
                  color: AppColors.accentOn(context),
                ),
          ),
        const SizedBox(width: 8),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                hasClinic ? name : AppConfig.appName,
                // Two lines, because this clinic's name is nine words long and
                // one line of it is "Dr. Dey's Diabetes Obesity & Metabolic…".
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 15,
                  height: 1.15,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                  color: AppColors.accentOn(context),
                ),
              ),
              if (subtitleWidget != null)
                subtitleWidget!
              else if (subtitle != null)
                Text(
                  subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.25,
                    fontWeight: FontWeight.w500,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The logo bitmap, sized by height and left-aligned.
///
/// Drawn with [Image.network] rather than [AuthedImage] because that widget
/// fixes both dimensions of its box, which is exactly what cannot be done
/// here: the aspect ratio belongs to whatever the clinic uploaded, and only it
/// knows whether that is a square symbol or a long wordmark.
class _Logo extends ConsumerWidget {
  const _Logo({
    required this.url,
    required this.height,
    required this.maxWidth,
    required this.needsDarkChip,
  });

  final String url;
  final double height;
  final double maxWidth;
  final bool needsDarkChip;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final headers = ref.watch(imageAuthHeaderProvider).valueOrNull;

    // A fixed box only while the bytes are on their way, so the row does not
    // jump when they land.
    if (headers == null) return SizedBox(width: height, height: height);

    Widget image = ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: height),
      child: Image.network(
        '${AppConfig.apiOrigin}$url',
        headers: headers,
        height: height,
        fit: BoxFit.contain,
        alignment: Alignment.centerLeft,
        errorBuilder:
            (_, _, _) => SizedBox(
              width: height,
              height: height,
              child: Icon(
                Icons.local_hospital_rounded,
                size: height * 0.7,
                color: AppColors.accentOn(context),
              ),
            ),
      ),
    );

    // Artwork drawn for a dark letterhead gets a dark ground rather than being
    // inverted: inversion is a per-channel complement, so this clinic's teal
    // would come back orange, and the colour is what a logo carries.
    if (needsDarkChip) {
      image = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFF0E1526),
          borderRadius: BorderRadius.circular(8),
        ),
        child: image,
      );
    }
    return image;
  }
}
