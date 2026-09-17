import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/tokens.dart';
import '../../features/appointments/data/clinic_repository.dart';
import '../../features/appointments/domain/clinic.dart';
import 'authed_image.dart' show AuthedImage, imageAuthHeaderProvider;
import 'user_avatar.dart' show initialsOf;

/// The ground a logo drawn for a dark letterhead sits on, named once.
const _darkLetterhead = Color(0xFF0E1526);

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
          color: _darkLetterhead,
          borderRadius: BorderRadius.circular(r),
        ),
        child: image,
      );
    }

    return ClipRRect(borderRadius: BorderRadius.circular(r), child: image);
  }
}

/// The practice's logo, or its initials, as a square mark.
///
/// For a header that names the practice rather than one of its locations —
/// the doctor's home, where the question is "which practice am I working in",
/// and one person can work in two.
class PracticeMark extends StatelessWidget {
  const PracticeMark({
    super.key,
    required this.name,
    this.logoUrl,
    this.size = T.s8 + T.s2,
  });

  final String name;
  final String? logoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = logoUrl;
    if (url != null && url.isNotEmpty) {
      return AuthedImage(
        path: url,
        width: size,
        height: size,
        radius: T.rCard,
        background: Colors.transparent,
        fit: BoxFit.contain,
      );
    }
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: T.primaryTint,
          borderRadius: BorderRadius.circular(T.rCard),
        ),
        child: Text(
          initialsOf(name),
          style: T.label.copyWith(color: T.primary, fontWeight: FontWeight.w700),
        ),
      ),
    );
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
    final async = ref.watch(brandClinicProvider);
    final clinic = async.valueOrNull;
    final logo = clinic?.logoLightUrl;
    final name = (clinic?.name ?? '').trim();
    final hasClinic = name.isNotEmpty || (logo != null && logo.isNotEmpty);

    /*
     * The product's name only when the answer is genuinely "no clinic".
     *
     * It used to stand in whenever the clinic's name was not on screen — while
     * the list was loading, and when it failed to load — so a practice whose
     * request had failed read "MedPin" across its own header, which is a claim
     * about whose app this is, made because a request did not come back.
     * Loading and failed now keep the space and say nothing; only an answer of
     * no clinic at all falls back to the product.
     */
    final answeredNone = async.hasValue && !hasClinic;
    final Widget mark;
    if (logo != null && logo.isNotEmpty) {
      mark = _Logo(
        url: logo,
        height: height,
        maxWidth: maxLogoWidth,
        needsDarkChip: clinic?.logoNeedsDarkChip ?? false,
      );
    } else if (answeredNone) {
      mark = Image.asset(
        'assets/brand/medpin_emblem.png',
        height: height * 0.86,
        errorBuilder: (_, _, _) => Icon(
          Icons.forum_rounded,
          size: height * 0.74,
          color: AppColors.accentOn(context),
        ),
      );
    } else {
      mark = SizedBox(width: height, height: height);
    }

    final String? title = hasClinic ? name : (answeredNone ? AppConfig.appName : null);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        mark,
        const SizedBox(width: T.s2),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (title != null && title.isNotEmpty)
                Text(
                  title,
                  // Two lines, because this clinic's name is nine words long and
                  // one line of it is "Dr. Dey's Diabetes Obesity & Metabolic…".
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: T.bodyStrong.copyWith(
                    height: 1.2,
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
                  style: T.label.copyWith(
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0,
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
        padding: const EdgeInsets.all(T.s1),
        decoration: BoxDecoration(
          color: _darkLetterhead,
          borderRadius: BorderRadius.circular(T.rCard),
        ),
        child: image,
      );
    }
    return image;
  }
}
