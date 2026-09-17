import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/area.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/widgets/clinic_brand.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_notification_sheet.dart';
import 'widgets/load_states.dart';
import 'widgets/panel_ui.dart';
import 'widgets/record_ui.dart';
import 'widgets/waiting_on_consent.dart';

/// The patient list: who needs the doctor, what changed, and when they last
/// wrote.
///
/// ---- A list of patients, not of conversations -----------------------------
///
/// This was the "Care Inbox": a conversation list whose rows opened the chat,
/// with a risk band or an alert as a small mark at most. Between consultations
/// the question is wider than "who wrote" — it is who has an open alert, whose
/// readings have moved, who has gone quiet — and the answer to all of it is the
/// patient's record. So a row now opens the record, says why the patient might
/// need the doctor in words, and keeps the conversation one tap away on its own
/// button, with the unread count on it.
///
/// ---- The server orders the whole roll; the phone pages through it ---------
///
/// This used to fetch the first hundred patients by name and put unread first
/// on the phone. The rule was right and the hundred were the wrong hundred: an
/// unread message from the hundred-and-first patient by name was never
/// fetched. The server now orders every patient before paging, and the rest of
/// the roll is a button at the end of the list.
class PatientsScreen extends ConsumerStatefulWidget {
  const PatientsScreen({super.key});

  @override
  ConsumerState<PatientsScreen> createState() => _PatientsScreenState();
}

/// The three ways to look at the roll. A bounded set, so it is laid out in
/// full rather than in a rail that hides the last one off the edge.
enum _Filter {
  all('All'),
  unread('Unread'),
  atRisk('At risk');

  const _Filter(this.label);
  final String label;
}

class _PatientsScreenState extends ConsumerState<PatientsScreen>
    with WidgetsBindingObserver {
  final _searchController = TextEditingController();
  String _search = '';
  Timer? _debounce;
  Timer? _poll;
  _Filter _filter = _Filter.all;

  /// How many pages of the roll are loaded. Back to one whenever the search or
  /// a filter changes, because a different list starts from its own first page.
  int _pages = 1;

  /// The last list that arrived without an error, the query it answered, and
  /// when. See [build].
  ({PatientsQuery query, Paged<PatientListItem> paged, DateTime at})? _held;

  /// The list is only useful if it is current. There is no socket, so it
  /// re-reads on a timer while on screen and immediately on resume.
  ///
  /// Matched to the conversation screens: this is where a doctor waits for a
  /// patient to reply, and a message that takes twenty seconds to appear reads
  /// as the app being broken.
  static const _pollInterval = Duration(seconds: 3);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) => _refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (!mounted) return;
    // A read still on its way is left to finish. Invalidating restarts it, and
    // on a slow connection each poll would throw away the one before it.
    if (ref.read(patientsProvider(_query)).isLoading) return;
    ref.invalidate(patientsProvider(_query));
  }

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      final next = v.trim();
      if (!mounted || next == _search) return;
      setState(() {
        _search = next;
        _pages = 1;
      });
    });
  }

  void _clearSearch() {
    _debounce?.cancel();
    _searchController.clear();
    setState(() {
      _search = '';
      _pages = 1;
    });
  }

  void _setFilter(_Filter f) {
    if (f == _filter) return;
    setState(() {
      _filter = f;
      _pages = 1;
    });
  }

  PatientsQuery get _query => (
    riskBand: null,
    search: _search.isEmpty ? null : _search,
    // Unread first, newest unread first, then by latest message — or, for
    // "At risk", highest risk first. Either way across the whole roll, on the
    // server, before it is paged.
    sort: _filter == _Filter.atRisk ? 'risk' : 'inbox',
    pages: _pages,
  );

  /// The same patients in the same order, however many pages of them.
  static bool _sameRoll(PatientsQuery a, PatientsQuery b) =>
      a.riskBand == b.riskBand && a.search == b.search && a.sort == b.sort;

  static bool _atRisk(PatientListItem p) =>
      p.riskBand == 'moderate' ||
      p.riskBand == 'high' ||
      p.riskBand == 'critical';

  /// Unread first, then newest message; a patient who has never written sinks
  /// to the bottom. The server's inbox order, kept on the phone as well so
  /// merged pages cannot interleave.
  static List<PatientListItem> _inboxOrder(List<PatientListItem> items) {
    final list = [...items];
    list.sort((a, b) {
      if ((a.unreadCount > 0) != (b.unreadCount > 0)) {
        return a.unreadCount > 0 ? -1 : 1;
      }
      final at = a.lastMessage?.at;
      final bt = b.lastMessage?.at;
      if (at == null && bt == null) return a.name.compareTo(b.name);
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final query = _query;
    final raw = ref.watch(patientsProvider(query));

    // What is on screen, and whether it is current.
    //
    // A refresh keeps its previous value while it runs and, if it fails, keeps
    // it alongside the error — so a dropped connection mid-poll must not turn
    // a full list into "No patients". Another page is a new query with no value
    // yet, so the list it extends is held here instead, and only for the same
    // search: the last search's patients under a new search's words would be a
    // wrong answer, not a steady one.
    final fresh = raw.valueOrNull;
    if (fresh != null && !raw.hasError && !identical(fresh, _held?.paged)) {
      _held = (query: query, paged: fresh, at: DateTime.now());
    }
    final held = _held;
    Paged<PatientListItem>? shown = fresh;
    var growing = false;
    if (shown == null && held != null && _sameRoll(held.query, query)) {
      shown = held.paged;
      growing = query.pages > held.query.pages;
    }
    final error = raw.hasError && !raw.isLoading ? raw.error : null;
    final failure =
        error == null ? null : Failure.of(error, what: 'the patient list');
    final loadingMore = growing && raw.isLoading;
    final moreFailed = growing && error != null;
    // Stale is a refresh of the list on screen that did not arrive. Not a page
    // being added — the button at the end speaks for that.
    final stale = shown != null && error != null && !growing;

    final isDesk = areaPrefix(ref) == '/staff';

    final slivers = <Widget>[
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, 0),
        sliver: SliverToBoxAdapter(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _TitleBlock(
                total:
                    _filter == _Filter.all && shown != null
                        ? shown.total
                        : null,
                searching: _search.isNotEmpty,
              ),
              const SizedBox(height: T.s4),
              _SearchField(
                controller: _searchController,
                onChanged: _onSearchChanged,
                onClear: _clearSearch,
              ),
              const SizedBox(height: T.s3),
              _FilterBar(selected: _filter, onSelect: _setFilter),
              const SizedBox(height: T.s4),
              // Above the roll, because somebody missing from it is the reason
              // a desk arrives at this screen confused.
              const WaitingOnConsent(),
              if (stale && failure!.keepsData) ...[
                StaleNotice(
                  error: error,
                  what: 'the list',
                  loadedAt: held?.at,
                  onRetry: _refresh,
                ),
                const SizedBox(height: T.s3),
              ],
            ],
          ),
        ),
      ),
    ];

    if (failure != null && (!failure.keepsData || shown == null)) {
      // Nothing to show, or an answer that must replace what was shown: a
      // refusal is not something to keep drawing the old list over.
      slivers.add(
        SliverFillRemaining(
          hasScrollBody: false,
          child: FailurePanel(
            error: error!,
            what: 'the patient list',
            onRetry: _refresh,
          ),
        ),
      );
    } else if (shown == null) {
      slivers.add(
        const SliverPadding(
          padding: EdgeInsets.symmetric(horizontal: T.s4),
          sliver: SliverToBoxAdapter(child: _LoadingRows()),
        ),
      );
    } else {
      final paged = shown;
      var items =
          query.sort == 'inbox' ? _inboxOrder(paged.items) : paged.items;
      if (_filter == _Filter.unread) {
        items = items.where((p) => p.unreadCount > 0).toList();
      } else if (_filter == _Filter.atRisk) {
        items = items.where(_atRisk).toList();
      }

      // Offered only where another page could show somebody. Both filters
      // follow the server's order — every unread before every read, every
      // at-risk patient before every low-risk one — so once the last row loaded
      // fails the filter, no later page holds anything it would let through.
      final last = paged.items.isEmpty ? null : paged.items.last;
      final more =
          paged.hasMore &&
          switch (_filter) {
            _Filter.all => true,
            _Filter.unread => (last?.unreadCount ?? 0) > 0,
            _Filter.atRisk => last != null && _atRisk(last),
          };

      if (items.isEmpty && !more) {
        slivers.add(
          SliverFillRemaining(
            hasScrollBody: false,
            child: _EmptyState(
              filter: _filter,
              search: _search,
              isDesk: isDesk,
              onClearSearch: _clearSearch,
              onShowAll: () => _setFilter(_Filter.all),
            ),
          ),
        );
      } else {
        if (items.isNotEmpty) {
          slivers.add(
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: T.s4),
              sliver: DecoratedSliver(
                decoration: T.card(radius: T.rSection),
                sliver: SliverList.builder(
                  itemCount: items.length,
                  itemBuilder:
                      (context, i) => _PatientRow(
                        patient: items[i],
                        first: i == 0,
                        last: i == items.length - 1,
                        onOpen:
                            () => context.push(
                              '${areaPrefix(ref)}/patients/${items[i].id}',
                            ),
                        onConversation:
                            items[i].lastMessage == null
                                ? null
                                : () => context.push(
                                  '${areaPrefix(ref)}/patients/${items[i].id}/thread',
                                  extra: items[i].name,
                                ),
                      ),
                ),
              ),
            ),
          );
        }
        if (more) {
          slivers.add(
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, 0),
              sliver: SliverToBoxAdapter(
                child: _ShowMorePatients(
                  remaining: paged.total - paged.items.length,
                  loading: loadingMore,
                  failed: moreFailed,
                  onPressed:
                      moreFailed ? _refresh : () => setState(() => _pages += 1),
                ),
              ),
            ),
          );
        }
      }
    }

    // Clear of the "Add patient" button: an extended FAB and its margin are
    // nearly ninety points, and the last patient must stay readable to the end.
    slivers.add(
      SliverToBoxAdapter(child: SizedBox(height: isDesk ? T.s8 : T.s12 * 2)),
    );

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this screen and
      // the navigation bar alike.
      backgroundColor: Colors.transparent,
      // The doctor registers from here, because this is where they notice
      // somebody missing from the roll. The desk registers from Today, where
      // the queue is; offering it in both places put two buttons for one act
      // two tabs apart.
      floatingActionButton:
          isDesk
              ? null
              : FloatingActionButton.extended(
                onPressed:
                    () => context.push('${areaPrefix(ref)}/patients/new'),
                backgroundColor: T.primary,
                foregroundColor: Colors.white,
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: Text('Add patient', style: T.bodyStrong),
              ),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const _Header(),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: slivers,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The practice, the bell, and the way to your own profile.
class _Header extends ConsumerWidget {
  const _Header();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final isDesk = areaPrefix(ref) == '/staff';

    return Container(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s2, T.s2),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Row(
        children: [
          // The clinic this app belongs to, not the app.
          const Expanded(child: ClinicWordmark()),
          const SizedBox(width: T.s2),
          PanelNotificationBell(
            onTap: () => showClinicianNotifications(context),
          ),
          Semantics(
            button: true,
            label: isDesk ? 'Your profile' : 'Your profile and settings',
            child: InkWell(
              customBorder: const CircleBorder(),
              // `go`, not `push`: Profile is one of this shell's own tabs, so
              // pushing it stacked a copy while the bar kept the old tab lit.
              onTap:
                  () =>
                      context.go(isDesk ? '/staff/profile' : '/clinician/more'),
              child: SizedBox(
                width: T.tap,
                height: T.tap,
                child: Center(
                  child: UserAvatar(
                    // "Dr Anirban Dey" drew a "D" — the title's initial.
                    name: nameForInitial(user?.name ?? ''),
                    avatarUrl: user?.avatarUrl,
                    accent: T.primary,
                    size: T.s8 + T.s1,
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

class _TitleBlock extends StatelessWidget {
  const _TitleBlock({required this.total, required this.searching});

  /// Patients on the roll, from the server — or matching the search. Null when
  /// no honest count is to hand: while loading, or under a filter that is
  /// applied to loaded pages only.
  final int? total;
  final bool searching;

  @override
  Widget build(BuildContext context) {
    final count = total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text('Patients', style: T.display.copyWith(color: T.ink)),
        ),
        if (count != null && count > 0)
          Text(
            searching
                ? '$count ${count == 1 ? 'patient matches' : 'patients match'}'
                : '$count ${count == 1 ? 'patient' : 'patients'}',
            style: T.body.copyWith(color: T.inkMuted),
          ),
      ],
    );
  }
}

class _SearchField extends StatefulWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(T.rControl),
      borderSide: const BorderSide(color: T.line),
    );
    return TextField(
      controller: widget.controller,
      onChanged: (v) {
        widget.onChanged(v);
        // For the clear button, which depends on whether there is text.
        setState(() {});
      },
      textInputAction: TextInputAction.search,
      style: T.body.copyWith(color: T.ink),
      decoration: InputDecoration(
        hintText: 'Search by name or phone',
        // Wraps at large text rather than cutting the hint to "Search by nam…".
        hintMaxLines: 2,
        hintStyle: T.body.copyWith(color: T.inkFaint),
        prefixIcon: const Icon(Icons.search_rounded, color: T.inkMuted),
        suffixIcon:
            widget.controller.text.isEmpty
                ? null
                : IconButton(
                  tooltip: 'Clear search',
                  onPressed: () {
                    widget.onClear();
                    setState(() {});
                  },
                  icon: const Icon(Icons.close_rounded, color: T.inkMuted),
                ),
        filled: true,
        fillColor: T.surfaceRaised,
        contentPadding: const EdgeInsets.symmetric(vertical: T.s4),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: const BorderSide(color: T.primary, width: 2),
        ),
      ),
    );
  }
}

/// All, Unread, At risk — all three always visible, wrapping onto a second
/// line before any of them is cut.
class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.selected, required this.onSelect});

  final _Filter selected;
  final ValueChanged<_Filter> onSelect;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: T.s2,
      runSpacing: T.s2,
      children: [
        for (final f in _Filter.values)
          _FilterChip(
            label: f.label,
            selected: f == selected,
            onTap: () => onSelect(f),
          ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? T.primary : T.surfaceRaised,
        shape: StadiumBorder(
          side: BorderSide(color: selected ? T.primary : T.line),
        ),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: T.tap,
              minWidth: T.tap,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: T.s4),
              child: Center(
                widthFactor: 1,
                child: Text(
                  label,
                  style: T.bodyStrong.copyWith(
                    color: selected ? Colors.white : T.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Why a patient might need the doctor, in words, worst first.
List<Reading> patientReasons(PatientListItem p, {DateTime? now}) {
  final out = <Reading>[];
  if (p.openAlertCount > 0) {
    out.add((
      word:
          p.openAlertCount == 1
              ? '1 open alert'
              : '${p.openAlertCount} open alerts',
      status: Status.alert,
    ));
  }
  // An urgent message is a reason while it waits to be read; once read, the
  // preview still says what it was.
  final urgency = p.lastMessage?.urgency;
  if (p.unreadCount > 0 && p.lastMessage?.fromPatient == true) {
    if (urgency == 'emergency') {
      out.add((word: 'Emergency message', status: Status.alert));
    } else if (urgency == 'urgent') {
      out.add((word: 'Urgent message', status: Status.alert));
    }
  }
  switch (p.riskBand) {
    case 'critical':
      out.add((word: 'Critical risk', status: Status.alert));
    case 'high':
      out.add((word: 'High risk', status: Status.alert));
    case 'moderate':
      out.add((word: 'Moderate risk', status: Status.watch));
  }
  if (p.checkInOverdue) {
    final at = p.lastReadingAt;
    final days =
        at == null ? null : (now ?? DateTime.now()).difference(at).inDays;
    out.add((
      word: days == null ? 'Check-in overdue' : 'No reading for $days days',
      status: Status.watch,
    ));
  }
  return out;
}

/// The latest figures on the row: the last glucose and when, where the average
/// is heading, and the latest HbA1c. Only what is recorded.
String? patientFigures(PatientListItem p) {
  final parts = <String>[
    if (p.lastReadingValue != null && p.lastReadingAt != null)
      'Glucose ${figure(p.lastReadingValue!)} mg/dL ${whenLabel(p.lastReadingAt!)}',
    if (p.trendDelta != null && p.trend == 'up')
      'average up ${p.trendDelta!.abs()}',
    if (p.trendDelta != null && p.trend == 'down')
      'average down ${p.trendDelta!.abs()}',
    if (p.hba1c != null) 'HbA1c ${figure(p.hba1c!)}%',
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

/// `10:42 AM` today, `Yesterday`, a weekday within the week, else `12 Oct`.
String _stamp(DateTime at) {
  final now = DateTime.now();
  final day = DateTime(at.year, at.month, at.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) {
    final h = at.hour % 12 == 0 ? 12 : at.hour % 12;
    return '$h:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'AM' : 'PM'}';
  }
  if (diff == 1) return 'Yesterday';
  if (diff > 1 && diff < 7) {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][at.weekday - 1];
  }
  return whenLabel(at);
}

/// One patient: who, why they might need the doctor, what they last said, and
/// their latest figures. The row opens the record; the button beside it opens
/// the conversation.
class _PatientRow extends StatelessWidget {
  const _PatientRow({
    required this.patient,
    required this.first,
    required this.last,
    required this.onOpen,
    required this.onConversation,
  });

  final PatientListItem patient;
  final bool first;
  final bool last;
  final VoidCallback onOpen;
  final VoidCallback? onConversation;

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final msg = p.lastMessage;
    final unread = p.unreadCount > 0;
    final reasons = patientReasons(p);
    final figures = patientFigures(p);
    final crowded = MediaQuery.textScalerOf(context).scale(T.s4) > T.s4 * 1.5;
    final name = Text(
      p.name,
      style: T.bodyStrong.copyWith(
        color: T.ink,
        fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
      ),
    );
    final stamp =
        msg == null
            ? null
            : Text(
              _stamp(msg.at),
              style: T.small.copyWith(
                color: unread ? T.primary : T.inkMuted,
                fontWeight: unread ? FontWeight.w700 : FontWeight.w400,
              ),
            );
    final corners = BorderRadius.vertical(
      top: first ? const Radius.circular(T.rSection) : Radius.zero,
      bottom: last ? const Radius.circular(T.rSection) : Radius.zero,
    );

    final preview =
        msg == null
            ? null
            : Text.rich(
              TextSpan(
                children: [
                  // Who spoke, so "answered" and "waiting" are told apart.
                  if (msg.fromAssistant)
                    const TextSpan(text: 'Assistant: ')
                  else if (!msg.fromPatient)
                    const TextSpan(text: 'You: '),
                  if (msg.mediaType != null)
                    WidgetSpan(
                      alignment: PlaceholderAlignment.middle,
                      child: Padding(
                        padding: const EdgeInsets.only(right: T.s1),
                        child: Icon(
                          _mediaIcon(msg.mediaType!),
                          size: T.s4,
                          color: unread ? T.ink : T.inkMuted,
                        ),
                      ),
                    ),
                  TextSpan(text: MarkdownText.toPreview(msg.preview)),
                ],
              ),
              // A preview, one tap from the whole message — so it may be cut,
              // unlike the name or a reason.
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: T.small.copyWith(
                color: unread ? T.ink : T.inkMuted,
                fontWeight: unread ? FontWeight.w600 : FontWeight.w400,
              ),
            );

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!first) const Divider(height: 1, thickness: 1, color: T.line),
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onOpen,
            borderRadius: corners,
            child: Semantics(
              button: true,
              hint: 'Opens the patient record',
              child: Padding(
                padding: const EdgeInsets.all(T.s4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // At very large text the initial gives up its column: it
                    // says nothing the name does not, and beside it a name
                    // broke mid-word, "Chakra / borty".
                    if (!crowded) ...[
                      UserAvatar(
                        name: nameForInitial(p.name),
                        avatarUrl: p.avatarUrl,
                        accent: T.primary,
                        size: T.tap,
                      ),
                      const SizedBox(width: T.s3),
                    ],
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Wraps rather than ellipsises: a name
                              // cut to "Meera Bhattach…" is two people.
                              Expanded(child: name),
                              if (stamp != null && !crowded) ...[
                                const SizedBox(width: T.s2),
                                stamp,
                              ],
                            ],
                          ),
                          if (stamp != null && crowded) stamp,
                          if (reasons.isNotEmpty) ...[
                            const SizedBox(height: T.s1),
                            Wrap(
                              spacing: T.s1,
                              runSpacing: T.s1,
                              children: [
                                for (final r in reasons)
                                  StatusPill(label: r.word, status: r.status),
                              ],
                            ),
                          ],
                          // The conversation button sits on the line it
                          // is about, so only that line gives up width —
                          // beside the whole row it squeezed every name
                          // onto two lines.
                          if (preview != null) ...[
                            const SizedBox(height: T.s1),
                            Row(
                              children: [
                                Expanded(child: preview),
                                if (onConversation != null) ...[
                                  const SizedBox(width: T.s1),
                                  _ConversationButton(
                                    name: p.name,
                                    unread: p.unreadCount,
                                    onTap: onConversation!,
                                  ),
                                ],
                              ],
                            ),
                          ],
                          if (figures != null) ...[
                            const SizedBox(height: T.s1),
                            Text(
                              figures,
                              style: T.small.copyWith(color: T.inkMuted),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The way into the conversation, carrying its unread count.
class _ConversationButton extends StatelessWidget {
  const _ConversationButton({
    required this.name,
    required this.unread,
    required this.onTap,
  });

  final String name;
  final int unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label =
        unread == 0
            ? 'Open the conversation with $name'
            : 'Open the conversation with $name, $unread unread '
                '${unread == 1 ? 'message' : 'messages'}';
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: T.tap / 2,
        child: SizedBox(
          width: T.tap,
          height: T.tap,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Icon(
                unread > 0
                    ? Icons.chat_bubble_rounded
                    : Icons.chat_bubble_outline_rounded,
                color: unread > 0 ? T.primary : T.inkMuted,
              ),
              if (unread > 0)
                Positioned(
                  top: T.s1,
                  right: T.s1 / 2,
                  child: Container(
                    constraints: const BoxConstraints(
                      minWidth: T.s5,
                      minHeight: T.s5,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: T.s1),
                    decoration: const BoxDecoration(
                      // Brand blue, as on the bell: a count of things to
                      // read, not a warning in its own right.
                      color: T.primary,
                      borderRadius: T.rFull,
                    ),
                    child: Center(
                      widthFactor: 1,
                      child: Text(
                        unread > 99 ? '99+' : '$unread',
                        style: T.label.copyWith(color: Colors.white),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A monochrome glyph for a media turn, not an emoji.
IconData _mediaIcon(String type) => switch (type) {
  'voice' => Icons.mic_none_rounded,
  'photo' => Icons.photo_camera_outlined,
  'pdf' => Icons.picture_as_pdf_outlined,
  'document' => Icons.description_outlined,
  _ => Icons.attach_file_rounded,
};

/// The shape of the list while it loads, so the screen does not read as empty
/// on its way.
class _LoadingRows extends StatelessWidget {
  const _LoadingRows();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading patients',
      child: Container(
        decoration: T.card(radius: T.rSection),
        child: Column(
          children: [
            for (var i = 0; i < 4; i++) ...[
              if (i > 0) const Divider(height: 1, thickness: 1, color: T.line),
              Padding(
                padding: const EdgeInsets.all(T.s4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: T.tap,
                      height: T.tap,
                      decoration: const BoxDecoration(
                        color: T.line,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: T.s3),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonLine(width: 160),
                          SizedBox(height: T.s2),
                          SkeletonLine(),
                          SizedBox(height: T.s2),
                          SkeletonLine(width: 120),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Four different nothings, and they mean different things. A search with no
/// match is a typo; nothing unread is a clinic on top of its messages; nobody
/// at risk is good news; an empty roll is a practice with no patients yet.
class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.filter,
    required this.search,
    required this.isDesk,
    required this.onClearSearch,
    required this.onShowAll,
  });

  final _Filter filter;
  final String search;
  final bool isDesk;
  final VoidCallback onClearSearch;
  final VoidCallback onShowAll;

  @override
  Widget build(BuildContext context) {
    final (icon, title, body, action, onAction) = switch ((
      search.isNotEmpty,
      filter,
    )) {
      (true, _) => (
        Icons.search_off_rounded,
        'No patient matches “$search”',
        filter == _Filter.all
            ? 'Check the spelling, or search by phone number instead.'
            : 'Nobody matches under “${filter.label}”. Try All, or check the '
                'spelling.',
        'Clear search',
        onClearSearch,
      ),
      (false, _Filter.unread) => (
        Icons.mark_email_read_outlined,
        'No unread messages',
        'Every message from a patient has been read. New ones appear here as '
            'they arrive.',
        'Show all patients',
        onShowAll,
      ),
      (false, _Filter.atRisk) => (
        Icons.verified_outlined,
        'Nobody is at moderate risk or above',
        'Risk is worked out from readings, open alerts, doses taken and HbA1c. '
            'A patient appears here when theirs rises.',
        'Show all patients',
        onShowAll,
      ),
      (false, _Filter.all) => (
        Icons.groups_outlined,
        'No patients yet',
        isDesk
            ? 'Patients registered at the desk appear here. Register them from '
                'Today.'
            : 'Patients you add, and patients who join the practice, appear '
                'here. Add one with Add patient.',
        null,
        null,
      ),
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(T.s6, T.s6, T.s6, T.s8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Icon(icon, size: T.s12, color: T.inkMuted),
          const SizedBox(height: T.s4),
          Text(
            title,
            textAlign: TextAlign.center,
            style: T.title.copyWith(color: T.ink),
          ),
          const SizedBox(height: T.s2),
          Text(
            body,
            textAlign: TextAlign.center,
            style: T.body.copyWith(color: T.inkMuted),
          ),
          if (action != null) ...[
            const SizedBox(height: T.s5),
            OutlinedButton(
              onPressed: onAction,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(T.tap, T.tap),
              ),
              child: Text(action),
            ),
          ],
        ],
      ),
    );
  }
}

/// The end of what is loaded, and the way past it.
///
/// A button rather than loading on scroll. The list re-reads every page it
/// holds every three seconds, so a page loaded because a thumb flicked past the
/// end would be re-read all day; asked for, it is somebody's decision.
class _ShowMorePatients extends StatelessWidget {
  const _ShowMorePatients({
    required this.remaining,
    required this.loading,
    required this.failed,
    required this.onPressed,
  });

  /// Patients on the roll that are not loaded yet. Not loaded, rather than not
  /// shown: with a filter on, some loaded rows are hidden as well.
  final int remaining;

  final bool loading;
  final bool failed;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final label =
        loading
            ? 'Loading more patients…'
            : failed
            ? 'Could not load more. Try again'
            : 'Show more patients';

    // Full width, and at least a tap tall. A minimum rather than a height, so
    // raised text makes the button taller instead of clipping the words.
    return ConstrainedBox(
      constraints: const BoxConstraints(
        minWidth: double.infinity,
        minHeight: T.tap,
      ),
      child: OutlinedButton(
        onPressed: loading ? null : onPressed,
        style: OutlinedButton.styleFrom(
          backgroundColor: T.surfaceRaised,
          side: const BorderSide(color: T.line),
          padding: const EdgeInsets.symmetric(vertical: T.s3),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, textAlign: TextAlign.center, style: T.bodyStrong),
            if (remaining > 0)
              Text(
                '$remaining more after these',
                textAlign: TextAlign.center,
                style: T.small.copyWith(color: T.inkMuted),
              ),
          ],
        ),
      ),
    );
  }
}
