import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/providers/preferences_provider.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../glucose/domain/glucose_trends.dart';
import '../../../glucose/presentation/glucose_providers.dart';
import '../../../glucose/presentation/log_glucose_sheet.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
import '../../domain/care_summary.dart';
import '../../domain/today_plan.dart';
import 'home_glucose_chart.dart';

/// What a server flag means, as a status and a word.
///
/// Derived from the reading's own `flag`, never re-thresholded here. The
/// clinic sets the bands; a second copy in the client is a second thing to get
/// wrong, and the one that would be wrong silently.
({Status status, String label, IconData icon})? readingVerdict(
  AppLocalizations l10n,
  String? flag,
) => switch (flag) {
  'critical_high' || 'severe_high' || 'severe_low' => (
    status: Status.alert,
    label: l10n.ptReadingNeedsAttention,
    icon: Icons.error_outline_rounded,
  ),
  'very_high' => (
    status: Status.alert,
    label: l10n.ptReadingWellAbove,
    icon: Icons.arrow_upward_rounded,
  ),
  'high' => (
    status: Status.watch,
    label: l10n.ptReadingAbove,
    icon: Icons.arrow_upward_rounded,
  ),
  'low' => (
    status: Status.watch,
    label: l10n.ptReadingBelow,
    icon: Icons.arrow_downward_rounded,
  ),
  'in_range' => (
    status: Status.ok,
    label: l10n.ptReadingInRange,
    icon: Icons.check_circle_outline_rounded,
  ),
  _ => null,
};

/// The patient's blood sugar: the latest reading and what it means, the trend,
/// and the few figures worth carrying.
///
/// Before this, the card opened on a sideways-scrolling rail of stat tiles that
/// never showed the latest reading at all — the one number a patient opens the
/// app to see — and whose tiles were too short for their own contents, so a
/// yellow-and-black overflow stripe ran along the bottom of every phone.
class HomeGlucoseSection extends ConsumerStatefulWidget {
  const HomeGlucoseSection({super.key, required this.labHba1c});

  /// The lab result, shown beside the estimate rather than instead of it.
  final Hba1cResult? labHba1c;

  @override
  ConsumerState<HomeGlucoseSection> createState() => _HomeGlucoseSectionState();
}

class _HomeGlucoseSectionState extends ConsumerState<HomeGlucoseSection> {
  GlucoseRange _range = GlucoseRange.d30;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final unit = ref.watch(appPreferencesProvider).glucoseUnit;
    final async = ref.watch(glucoseTrendsRangeProvider(_range));

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.water_drop_outlined,
            title: l10n.ptSugarTitle,
          ),
          const SizedBox(height: T.s4),
          // 7 days · 30 days · 3 months · 6 months, in words. "7D 30D 3M 6M"
          // read as codes rather than periods, and none of them translated.
          SegmentedChoice<GlucoseRange>(
            values: GlucoseRange.values,
            selected: _range,
            labelOf: (r) => switch (r) {
              GlucoseRange.d7 => l10n.ptRange7Days,
              GlucoseRange.d30 => l10n.ptRange30Days,
              GlucoseRange.m3 => l10n.ptRange3Months,
              GlucoseRange.m6 => l10n.ptRange6Months,
            },
            onChanged: (r) => setState(() => _range = r),
          ),
          const SizedBox(height: T.s4),
          async.when(
            skipLoadingOnReload: true,
            loading:
                () => Semantics(
                  label: l10n.commonLoading,
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonLine(width: 160, height: T.s8),
                      SizedBox(height: T.s4),
                      SkeletonLine(height: 160),
                    ],
                  ),
                ),
            error:
                (_, _) => SectionLoadFailed(
                  message: l10n.ptCouldNotLoadReadings,
                  onRetry: () => ref.invalidate(glucoseTrendsRangeProvider(_range)),
                ),
            data: (t) {
              final latest = latestReading(t);
              if (latest == null) {
                // Informative, not hidden: "nothing in 30 days" is a fact the
                // patient and the clinic both need to see, and hiding it made
                // it look like a screen still loading. Short of six months it
                // also says where older readings would be.
                return Text(
                  _range == GlucoseRange.m6
                      ? l10n.ptNoReadingsInDays(t.days)
                      : l10n.ptNoReadingsTryLonger(t.days),
                  style: T.body.copyWith(color: T.inkMuted),
                );
              }
              final dated = t.series.where((p) => p.at != null).length;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LatestReading(point: latest, unit: unit),
                  const SizedBox(height: T.s5),
                  if (dated >= 2)
                    HomeGlucoseChart(points: t.series, unit: unit)
                  else
                    Text(
                      l10n.ptOneReadingSoFar,
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                  const SizedBox(height: T.s5),
                  _Figures(
                    trends: t,
                    unit: unit,
                    labHba1c: widget.labHba1c,
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: T.s2),
          ActionLink(
            label: l10n.ptAddAReading,
            leadingIcon: Icons.add_rounded,
            onTap: () => showLogGlucoseSheet(context),
          ),
        ],
      ),
    );
  }
}

/// The most recent reading: the number, what it means, and when it was taken.
class _LatestReading extends StatelessWidget {
  const _LatestReading({required this.point, required this.unit});

  final GlucoseTrendPoint point;
  final GlucoseUnit unit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final verdict = readingVerdict(l10n, point.flag);
    final at = point.at!.toLocal();
    final when = [
      dayAndClock(context, at),
      if (_contextLabel(l10n, point.context) case final String c) c,
    ].join(' · ');

    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.ptLatestReading,
            style: T.label.copyWith(letterSpacing: 0, color: T.inkMuted),
          ),
          const SizedBox(height: T.s1),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: unit.format(point.value, withUnit: false),
                  style: T.metric.copyWith(
                    color: verdict?.status == Status.alert ? T.danger : T.ink,
                  ),
                ),
                TextSpan(
                  text: ' ${unit.label}',
                  style: T.body.copyWith(
                    color: T.inkMuted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: T.s2),
          if (verdict != null)
            StatusWord(
              label: verdict.label,
              status: verdict.status,
              icon: verdict.icon,
            ),
          Text(when, style: T.small.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }

  static String? _contextLabel(AppLocalizations l10n, String? context) =>
      switch (context) {
        'fasting' => l10n.glucoseContextFasting,
        'pre_meal' => l10n.glucoseContextPreMeal,
        'post_meal' => l10n.glucoseContextPostMeal,
        'bedtime' => l10n.glucoseContextBedtime,
        'random' => l10n.glucoseContextRandom,
        _ => null,
      };
}

/// Average, estimated HbA1c and the lab HbA1c, two to a row.
///
/// A known, short set, so it wraps rather than scrolls: a figure behind the
/// edge of a rail is a figure nobody reads.
class _Figures extends StatelessWidget {
  const _Figures({required this.trends, required this.unit, this.labHba1c});

  final GlucoseTrends trends;
  final GlucoseUnit unit;
  final Hba1cResult? labHba1c;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final s = trends.stats;
    final avg = s.average;
    final lab = labHba1c;

    final tiles = <Widget>[
      if (avg != null)
        _Figure(
          label: l10n.ptAverageOverDays(trends.days),
          value: unit.format(avg, withUnit: false),
          unit: unit.label,
          // The average is not a reading and carries no server flag. It is
          // judged against the same general band the chart shades, and worded
          // with that in mind.
          status:
              avg > kTargetHighMgdl
                  ? (Status.watch, l10n.ptReadingAbove)
                  : avg < kTargetLowMgdl
                  ? (Status.watch, l10n.ptReadingBelow)
                  : (Status.ok, l10n.ptReadingInRange),
        ),
      if (s.estimatedHba1c != null)
        _Figure(
          label: l10n.ptEstimatedHba1c,
          value: '~${s.estimatedHba1c!.toStringAsFixed(1)}',
          unit: '%',
          footnote: l10n.ptEstimatedHba1cNote,
        ),
      // Two numbers both called HbA1c, points apart, with neither saying where
      // it came from, would be the most alarming thing this card could do. So
      // each names its source.
      if (lab != null)
        _Figure(
          label: l10n.ptLabHba1c,
          value: lab.percentage.toStringAsFixed(1),
          unit: '%',
          footnote:
              lab.testedOn == null
                  ? l10n.ptFromABloodTest
                  : l10n.ptTestedOn(
                    DateFormat(
                      'd MMM',
                      Localizations.localeOf(context).toString(),
                    ).format(lab.testedOn!),
                  ),
          status: lab.isHigh ? (Status.alert, l10n.ptAboveYourTarget) : null,
          onTap: () => context.push('/profile/tests'),
        ),
    ];
    if (tiles.isEmpty) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, box) {
        final half = (box.maxWidth - T.s3) / 2;
        return Wrap(
          spacing: T.s3,
          runSpacing: T.s3,
          children: [
            for (final (i, t) in tiles.indexed)
              SizedBox(
                // An odd one out takes the row rather than sitting beside a
                // hole.
                width:
                    tiles.length.isOdd && i == tiles.length - 1
                        ? box.maxWidth
                        : half,
                child: t,
              ),
          ],
        );
      },
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.value,
    required this.unit,
    this.status,
    this.footnote,
    this.onTap,
  });

  final String label;
  final String value;
  final String unit;
  final (Status, String)? status;
  final String? footnote;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  label,
                  style: T.label.copyWith(letterSpacing: 0, color: T.inkMuted),
                ),
              ),
              if (onTap != null)
                const Icon(Icons.chevron_right_rounded, size: 20, color: T.primary),
            ],
          ),
          const SizedBox(height: T.s1),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: value, style: T.title.copyWith(color: T.ink)),
                TextSpan(
                  text: ' $unit',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          if (status != null)
            StatusWord(label: status!.$2, status: status!.$1),
          if (footnote != null)
            Text(
              footnote!,
              style: T.label.copyWith(
                letterSpacing: 0,
                fontWeight: FontWeight.w500,
                color: T.inkMuted,
              ),
            ),
        ],
      ),
    );
  }
}
