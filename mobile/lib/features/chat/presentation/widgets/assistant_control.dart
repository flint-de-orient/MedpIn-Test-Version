import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../shared/providers/core_providers.dart';

/// Which of a patient's two conversations a control refers to.
enum ThreadKind {
  care('care'),
  nutrition('nutrition');

  const ThreadKind(this.wire);

  final String wire;
}

/// Tells the server a clinician is reading this thread, for as long as the
/// screen is up.
///
/// A heartbeat, not an open/close pair. A close that never arrives — the app
/// killed, the battery flat, a tunnel — would mute the assistant on a
/// conversation nobody is actually watching, and it would stay muted. Each
/// beat only extends the hold by a minute and a half, so silence resolves
/// itself.
///
/// Every failure is swallowed. The consequence of a missed beat is that the
/// assistant answers a message a clinician was about to answer, which is the
/// behaviour that existed before any of this and is not worth an error banner
/// over a thread.
class ClinicianPresence {
  ClinicianPresence(this._ref, {required this.patientId, required this.kind});

  /// A WidgetRef, because this is owned by a screen's State rather than by a
  /// provider — the beat lives exactly as long as the screen does.
  final WidgetRef _ref;
  final String patientId;
  final ThreadKind kind;

  /// Comfortably inside the server's 90-second window, so one dropped request
  /// does not hand the conversation back mid-sentence.
  static const _interval = Duration(seconds: 40);

  Timer? _timer;

  void start() {
    if (_timer != null) return;
    _beat();
    _timer = Timer.periodic(_interval, (_) => _beat());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _beat() async {
    try {
      await _ref
          .read(apiClientProvider)
          .postJson(
            '/chat/patients/$patientId/presence',
            body: {'kind': kind.wire},
          );
    } catch (_) {
      // See the class comment: a missed beat costs nothing worth reporting.
    }
  }
}

/// The clinician's switch for whether the assistant answers in this thread.
///
/// Deliberately in the thread's own header rather than a settings screen: the
/// decision is about *this* conversation and is usually made on opening it —
/// "I will take this one myself."
///
/// Off is a promise to reply. The label says so, because a thread with the
/// assistant off and nobody watching is a question into silence, and the
/// person flipping it is the only one who can know that.
class AssistantToggle extends ConsumerStatefulWidget {
  const AssistantToggle({
    super.key,
    required this.patientId,
    required this.kind,
    this.onChanged,
  });

  final String patientId;
  final ThreadKind kind;
  final ValueChanged<bool>? onChanged;

  @override
  ConsumerState<AssistantToggle> createState() => _AssistantToggleState();
}

class _AssistantToggleState extends ConsumerState<AssistantToggle> {
  bool _on = true;
  bool _busy = false;
  bool _loaded = false;

  /// On, but not answering: somebody from the clinic has this thread open, so
  /// the assistant is holding back rather than replying over a message being
  /// typed. Shown as its own state because "Assistant on" beside an assistant
  /// that visibly does not answer reads as a broken switch — which is how it
  /// was reported, twice.
  bool _held = false;

  /// The control repolls, because the thing it reports can change without the
  /// clinician touching anything: presence lapses ninety seconds after the
  /// last heartbeat, and a colleague may open or leave the same thread.
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 10), (_) => _load());
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  /// Reads the thread's real state once. Optimistic default of on: that is
  /// what an untouched thread means, so the common case renders correctly
  /// even before this returns.
  Future<void> _load() async {
    try {
      final json = await ref
          .read(apiClientProvider)
          .getJson(
            '/chat/patients/${widget.patientId}/assistant',
            query: {'kind': widget.kind.wire},
          );
      if (!mounted) return;
      setState(() {
        _on = json['assistantEnabled'] != false;
        _held = json['heldByPresence'] == true;
        _loaded = true;
      });
    } catch (_) {
      // Leave it showing the default rather than an error: the switch still
      // works, and the next tap writes the truth either way.
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _set(bool next) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _busy = true;
      _on = next;
      // Whatever the server decides, it is no longer merely holding: this is
      // now a decision somebody made.
      _held = false;
    });
    try {
      await ref
          .read(apiClientProvider)
          .patchJson(
            '/chat/patients/${widget.patientId}/assistant',
            body: {'kind': widget.kind.wire, 'enabled': next},
          );
      widget.onChanged?.call(next);
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              next
                  ? 'The assistant will answer this thread again'
                  : 'The assistant is off — this patient is waiting on you',
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      // Put it back: the switch must not show a state the server rejected.
      if (mounted) setState(() => _on = !next);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Nothing until the real state is known — a control that flips a moment
    // after it appears reads as though it changed something.
    if (!_loaded) return const SizedBox(width: 12);
    return Tooltip(
      message:
          _held
              ? 'On, but waiting while you have this thread open. '
                  'Tap to let it answer anyway.'
              : _on
              ? 'The assistant answers when you are not here'
              : 'You are answering this thread yourself',
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        // Held means on-but-waiting, so the useful action is "answer anyway"
        // rather than "turn off" — the clinician is looking at this control
        // precisely because the assistant is not replying.
        onTap: _busy ? null : () => _set(_held ? true : !_on),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_busy)
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(
                  _held
                      ? Icons.pause_circle_outline_rounded
                      : _on
                      ? Icons.auto_awesome_rounded
                      : Icons.person_rounded,
                  size: 16,
                  color:
                      _held
                          ? scheme.tertiary
                          : _on
                          ? scheme.primary
                          : scheme.onSurfaceVariant,
                ),
              const SizedBox(width: 6),
              Text(
                _held
                    ? 'Paused — you are here'
                    : _on
                    ? 'Assistant on'
                    : 'You are replying',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color:
                      _held
                          ? scheme.tertiary
                          : _on
                          ? scheme.primary
                          : scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
