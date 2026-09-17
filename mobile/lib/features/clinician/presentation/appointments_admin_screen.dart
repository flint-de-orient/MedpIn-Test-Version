import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../appointments/data/appointment_repository.dart';
import '../../appointments/domain/appointment.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../staff/presentation/widgets/desk_geometry.dart';
import 'widgets/desk_appointment_row.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../staff/presentation/widgets/request_card.dart';
import 'widgets/appointment_manage_sheet.dart';
import 'package:url_launcher/url_launcher.dart';

/// The clinic diary, led by the one thing this app is for.
///
/// The doctor already runs practice software that owns the appointment book —
/// booking, rescheduling, billing, the lot. What that software cannot do is
/// hear from a patient, so what this screen exists to handle is *requests*: a
/// patient asked for a time, and until somebody answers, they are waiting.
///
/// So requests come first and carry their actions inline, rather than being one
/// value of a status filter three taps into a general-purpose diary. The booked
/// list below them is reference — who is coming, so the desk can answer the
/// phone and avoid double-booking — not a second place to run the practice.
///
/// The five-way status filter that used to sit under the title is gone with it.
/// It offered Requested / Confirmed / Completed / Cancelled as equals, which is
/// only the right shape if all four are things the desk works on. Three of them
/// are things the desk looks up.
class AppointmentsAdminScreen extends ConsumerStatefulWidget {
  const AppointmentsAdminScreen({super.key});

  @override
  ConsumerState<AppointmentsAdminScreen> createState() =>
      _AppointmentsAdminScreenState();
}

class _AppointmentsAdminScreenState
    extends ConsumerState<AppointmentsAdminScreen> {
  /// Which slice of the *booked* list is shown. Requests are never scoped by
  /// day — see below.
  String _scope = 'today'; // today | upcoming | past

  /// Everything asked for and not yet given a time, whatever day it is for.
  ///
  /// Deliberately undated, exactly as on the desk's Today screen. A request
  /// from last Tuesday that nobody answered is more urgent than one from this
  /// morning, not less, and a date filter is how it would stop being visible.
  AppointmentQuery get _requestQuery =>
      (from: null, to: null, status: 'requested', clinicId: null);

  /// Requests the desk turned down.
  ///
  /// There is no `rejected` status, and there does not need to be one: a
  /// declined request is cancelled *before* it was ever given a time, so it is
  /// the one cancellation in the system with no `scheduledFor`. A cancelled
  /// booking always has one, because it had an hour before somebody called it
  /// off. That distinction is what separates "we said no" from "it was called
  /// off", and the desk needs to see the first list without wading through the
  /// second.
  AppointmentQuery get _declinedQuery =>
      (from: null, to: null, status: 'cancelled', clinicId: null);

  AppointmentQuery get _bookedQuery {
    switch (_scope) {
      case 'today':
        final b = todayBounds();
        return (from: b.from, to: b.to, status: null, clinicId: null);
      case 'upcoming':
        // From tomorrow, not from today. Upcoming beside a Today tab that
        // already holds the day means *after* today; overlapping them listed
        // this morning twice and made the two tabs disagree about how many
        // appointments the clinic has.
        return (
          from: todayBounds().to,
          to: null,
          status: null,
          clinicId: null,
        );
      default:
        // Past: everything up to the start of today.
        return (from: null, to: todayBounds().from, status: null, clinicId: null);
    }
  }

  void _reload(WidgetRef ref) => ref.invalidate(appointmentDiaryProvider);

  @override
  Widget build(BuildContext context) {
    final requests =
        ref.watch(appointmentDiaryProvider(_requestQuery)).valueOrNull?.items ??
        const <Appointment>[];

    final bookedAsync = ref.watch(appointmentDiaryProvider(_bookedQuery));

    // Cancelled with no time on it: turned down while still a request. A
    // cancelled *booking* always carries the hour it was called off from.
    final declined =
        (ref
                    .watch(appointmentDiaryProvider(_declinedQuery))
                    .valueOrNull
                    ?.items ??
                const <Appointment>[])
            .where((a) => a.scheduledFor == null)
            .toList()
          ..sort((a, b) => b.sortKey.compareTo(a.sortKey));

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: true,
        title: const Text('Appointments'),
      ),
      body: AutoRefresh(
        onTick: _reload,
        child: RefreshIndicator(
          onRefresh: () async => _reload(ref),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              AppSpacing.xxl,
            ),
            children: [
              if (requests.isNotEmpty) ...[
                _SectionHeader(
                  title: 'Waiting for a time',
                  count: requests.length,
                  tone: AppColors.warningOn(context),
                  icon: Icons.hourglass_top_rounded,
                ),
                const SizedBox(height: AppSpacing.sm),
                for (final a in requests)
                  RequestCard(
                    appointment: a,
                    onConfirmed: () async => _reload(ref),
                  ),
                const SizedBox(height: AppSpacing.lg),
              ],

              // No "Booked" heading above this. The screen is called
              // Appointments and the tabs immediately under it say which ones
              // — a third label between the two said nothing either did not.
              _ScopeToggle(
                scope: _scope,
                onChanged: (s) => setState(() => _scope = s),
              ),
              const SizedBox(height: AppSpacing.md),

              // Three numbers, and every one of them can move.
              //
              // The design had four, two of which read Checked in and
              // Completed. Nothing sets those statuses any more — walking a
              // patient through arrived → with the doctor → done belongs to the
              // practice software the clinic already runs — so both would have
              // shown 0 for ever, and a front desk reading "0 checked in" on a
              // full morning would believe it.
              _StatsStrip(
                booked: bookedAsync.valueOrNull?.items ?? const [],
                waiting: requests.length,
                loading: bookedAsync.isLoading,
              ),
              const SizedBox(height: AppSpacing.md),

              bookedAsync.when(
                skipLoadingOnReload: true,
                skipLoadingOnRefresh: true,
                loading:
                    () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error: (_, _) => _LoadFailed(onRetry: () => _reload(ref)),
                data: (paged) {
                  // Requests are excluded here even under "All", where the
                  // query has no date bounds to exclude them for us. They are
                  // already the section above, and a patient appearing twice on
                  // one screen — once as waiting, once as a row with no time —
                  // reads as a duplicate booking, which is the single most
                  // alarming thing a front desk can be shown by mistake.
                  final items =
                      paged.items
                          .where((a) => a.status != 'requested')
                          .toList()
                        ..sort(
                          (a, b) =>
                              _scope == 'past'
                                  ? b.sortKey.compareTo(a.sortKey)
                                  : a.sortKey.compareTo(b.sortKey),
                        );

                  if (items.isEmpty) return _NothingBooked(scope: _scope);

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final group in _groupByDay(items)) ...[
                        _DayHeading(day: group.day, count: group.items.length),
                        const SizedBox(height: AppSpacing.sm),
                        for (final a in group.items)
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppSpacing.sm,
                            ),
                            child: DeskAppointmentRow(
                              appointment: a,
                              onManage: () => _manage(a),
                            ),
                          ),
                        const SizedBox(height: AppSpacing.sm),
                      ],
                    ],
                  );
                },
              ),

              // Turned down, and kept out of the way.
              //
              // A collapsed section, because this is a thing the desk looks up
              // ("did we ever answer her?") rather than works through, and an
              // open list of refusals under the day's schedule would be the
              // loudest thing on a screen about who is coming in.
              if (declined.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                _DeclinedSection(items: declined),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _manage(Appointment a) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder:
          (_) => AppointmentManageSheet(
            appointment: a,
            // This screen's context, not the sheet's: the sheet is gone by the
            // time the locations have loaded, and this screen is not.
            onReschedule:
                () => rescheduleAppointment(
                  context,
                  ref,
                  a,
                  () async => _reload(ref),
                ),
            onCancel: () async {
              final messenger = ScaffoldMessenger.of(context);
              final locale = Localizations.localeOf(context).toString();

              // Asked first, and told what it does.
              //
              // Cancelling sends a push to the patient. It is not undoable from
              // this screen, it frees a slot somebody else may take within the
              // minute, and it sat one tap from "Move to another time" in a
              // menu a receptionist opens all day. Naming the patient and the
              // hour is what makes a mis-tap visible before it is sent rather
              // than after.
              final sure = await showDialog<bool>(
                context: context,
                builder:
                    (ctx) => AlertDialog(
                      title: const Text('Cancel this appointment?'),
                      content: Text(
                        [
                          a.patientName ?? 'This patient',
                          if (a.scheduledFor != null)
                            DateFormat(
                              'EEE, d MMM · h:mm a',
                              locale,
                            ).format(a.scheduledFor!.toLocal()),
                          'The patient will be told.',
                        ].join('\n'),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: const Text('Keep it'),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.danger,
                          ),
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('Cancel appointment'),
                        ),
                      ],
                    ),
              );
              if (sure != true) return;

              try {
                await ref.read(appointmentRepositoryProvider).cancel(a.id);
                _reload(ref);
              } on ApiException catch (e) {
                messenger.showSnackBar(SnackBar(content: Text(e.message)));
              }
            },
          ),
    );
  }
}

/// One day's appointments, in the order they happen.
typedef _DayGroup = ({DateTime day, List<Appointment> items});

/// Grouped by the day they fall on, preserving the order they arrive in.
///
/// A flat list of times with the date repeated on every row makes the reader do
/// the grouping in their head, and the question the desk is actually asking —
/// "how busy is Monday" — is answered by a heading, not by counting rows that
/// happen to share a date.
List<_DayGroup> _groupByDay(List<Appointment> items) {
  final out = <_DayGroup>[];
  for (final a in items) {
    final at = a.scheduledFor?.toLocal();
    if (at == null) continue;
    final day = DateTime(at.year, at.month, at.day);
    if (out.isNotEmpty && out.last.day == day) {
      out.last.items.add(a);
    } else {
      out.add((day: day, items: [a]));
    }
  }
  return out;
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.icon,
    required this.tone,
    this.count,
  });

  final String title;
  final IconData icon;
  final Color tone;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: tone),
        const SizedBox(width: 7),
        Text(
          title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        if (count != null && count! > 0) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: tone,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Today / Tomorrow / a date — whichever the reader would say out loud.
class _DayHeading extends StatelessWidget {
  const _DayHeading({required this.day, required this.count});

  final DateTime day;
  final int count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final delta = day.difference(today).inDays;

    // One shape for every row: a relative word where there is one, then the
    // date itself, always.
    //
    // It printed "Tomorrow" for one group and "Wednesday, 2 September" for the
    // next — two different kinds of label in a single list, so the eye could
    // not compare them, and "Tomorrow" gave no date at all to a receptionist
    // writing one down for a patient on the phone.
    //
    // Computed every build, never stored: at one minute past midnight tomorrow
    // becomes today, and a cached string would stay wrong until somebody
    // happened to reopen the app.
    final relative = switch (delta) {
      0 => 'TODAY',
      1 => 'TOMORROW',
      -1 => 'YESTERDAY',
      _ => DateFormat('EEEE', locale).format(day).toUpperCase(),
    };
    // The year appears only when it is not this one, so an ordinary week is not
    // cluttered by a number that never changes.
    final date =
        DateFormat(
          day.year == now.year ? 'd MMM' : 'd MMM yyyy',
          locale,
        ).format(day).toUpperCase();

    final tone = delta == 0 ? AppColors.primary : scheme.onSurfaceVariant;

    return Row(
      children: [
        Expanded(
          child: Text(
            '$relative · $date',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
              color: tone,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: tone.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: tone,
            ),
          ),
        ),
      ],
    );
  }
}

class _ScopeToggle extends StatelessWidget {
  const _ScopeToggle({required this.scope, required this.onChanged});

  final String scope;
  final ValueChanged<String> onChanged;

  static const _options = [
    ('today', 'Today'),
    ('upcoming', 'Upcoming'),
    ('past', 'Past'),
  ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        children: [
          for (final (value, label) in _options)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(value),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  curve: Curves.easeOut,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: scope == value ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(999),
                    boxShadow:
                        scope == value
                            ? const [
                              BoxShadow(
                                color: Color(0x140B1B3A),
                                blurRadius: 6,
                                offset: Offset(0, 2),
                              ),
                            ]
                            : null,
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight:
                          scope == value ? FontWeight.w700 : FontWeight.w600,
                      color:
                          scope == value
                              ? AppColors.primary
                              : scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Compact, not a page of empty canvas.
///
/// The old one pushed an icon down by a fifth of the screen height and left the
/// rest blank, which on a quiet day made the whole screen look like it had
/// failed to load rather than like a clinic with nothing booked yet.
class _NothingBooked extends StatelessWidget {
  const _NothingBooked({required this.scope});

  final String scope;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final what = switch (scope) {
      'today' => 'Nothing booked today',
      'upcoming' => 'Nothing booked yet',
      _ => 'No appointments',
    };

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          Icon(
            Icons.event_busy_outlined,
            size: 28,
            color: scheme.outlineVariant,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  what,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Confirmed appointments appear here.',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.3,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(
        children: [
          const Text('Could not load appointments'),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}


/// Requests the clinic turned down, folded away.
///
/// Collapsed by default and counted in the heading, so the desk can see at a
/// glance that there are three and open them only when somebody asks. Kept at
/// all because "did anyone get back to Mrs Rahman?" is a question a front desk
/// is asked, and a refusal that leaves no trace is indistinguishable from a
/// request that was silently dropped.
class _DeclinedSection extends StatefulWidget {
  const _DeclinedSection({required this.items});

  final List<Appointment> items;

  @override
  State<_DeclinedSection> createState() => _DeclinedSectionState();
}

class _DeclinedSectionState extends State<_DeclinedSection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  Icon(
                    Icons.do_not_disturb_on_outlined,
                    size: 18,
                    color: scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Declined requests',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '${widget.items.length}',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const Spacer(),
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: const Duration(milliseconds: 160),
                    child: Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            for (final a in widget.items)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  0,
                  AppSpacing.md,
                  AppSpacing.sm,
                ),
                child: Row(
                  children: [
                    UserAvatar(
                      name: a.patientName ?? '',
                      avatarUrl: a.patientAvatarUrl,
                      accent: scheme.onSurfaceVariant,
                      size: 34,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            a.patientName ?? 'Patient',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            // What they had asked for, which is the only thing
                            // that makes a declined row mean anything later.
                            a.preferredFor == null
                                ? 'Declined'
                                : 'Asked for '
                                    '${DateFormat('EEE, d MMM', locale).format(a.preferredFor!.toLocal())}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (a.patientPhone != null)
                      IconButton(
                        tooltip: a.patientPhone,
                        onPressed:
                            () => launchUrl(
                              Uri(scheme: 'tel', path: a.patientPhone),
                            ),
                        icon: Icon(
                          Icons.call_outlined,
                          size: 19,
                          color: AppColors.primary,
                        ),
                      ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

/// The shape of the slice on screen, in three numbers.
///
/// Deliberately derived from the list already loaded rather than fetched
/// separately: a strip that counts one query while the rows below it come from
/// another is a strip that disagrees with what the reader can see, and the desk
/// trusts the rows.
class _StatsStrip extends StatelessWidget {
  const _StatsStrip({
    required this.booked,
    required this.waiting,
    required this.loading,
  });

  final List<Appointment> booked;
  final int waiting;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final live = booked.where((a) => a.status != 'requested').toList();
    final total = live.where((a) => !a.isCancelled).length;
    final freed = live.where((a) => a.status == 'cancelled').length;

    String n(int v) => loading ? '—' : '$v';

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(kSectionRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _Stat(
                icon: Icons.event_available_rounded,
                value: n(total),
                label: 'Booked',
                caption: 'This list',
                tone: AppColors.primary,
              ),
            ),
            VerticalDivider(
              width: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.6),
            ),
            Expanded(
              child: _Stat(
                icon: Icons.hourglass_top_rounded,
                value: n(waiting),
                label: 'Waiting',
                caption: 'To schedule',
                tone:
                    waiting == 0
                        ? scheme.onSurfaceVariant
                        : AppColors.warningOn(context),
              ),
            ),
            VerticalDivider(
              width: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.6),
            ),
            Expanded(
              child: _Stat(
                icon: Icons.event_busy_outlined,
                value: n(freed),
                label: 'Freed up',
                caption: 'Cancelled',
                tone:
                    freed == 0
                        ? scheme.onSurfaceVariant
                        : AppColors.dangerOn(context),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.icon,
    required this.value,
    required this.label,
    required this.caption,
    required this.tone,
  });

  final IconData icon;
  final String value;
  final String label;
  final String caption;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: tone.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(icon, size: 16, color: tone),
        ),
        const SizedBox(height: 6),
        Text(
          value,
          style: TextStyle(
            fontSize: 21,
            height: 1.05,
            fontWeight: FontWeight.w800,
            color: tone,
          ),
        ),
        const SizedBox(height: 1),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
        ),
        Text(
          caption,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 10.5,
            height: 1.2,
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
