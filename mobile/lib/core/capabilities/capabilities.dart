import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shared/providers/core_providers.dart';

/// What this account may see and do, as the server works it out.
///
/// ---- Why the app is told rather than deciding ---------------------------
///
/// The alternative is a switch in here: `if (plan == 'hospital') showTabs()`.
/// That puts the product's shape in the client, where it ships on a release
/// cycle measured in app-store reviews and where two phones disagree the moment
/// one is a version behind. A practice upgrading its plan would keep seeing the
/// old navigation until every doctor updated the app.
///
/// So the server answers *what is available* and the app answers *where to put
/// it*. A capability the server stops sending disappears on the next load, on
/// every device at once.
///
/// ---- And this is not a security boundary -------------------------------
///
/// Nothing here is trusted. The routes are guarded server-side; this exists so
/// the app does not offer a button that would come back 403, which is a
/// courtesy to the person holding the phone rather than a control on them.
class Capabilities {
  const Capabilities({
    required this.practiceType,
    required this.specialty,
    required this.plan,
    required this.practice,
    required this.effective,
    required this.role,
    required this.isOwner,
    required this.resolved,
  });

  /// What kind of organisation. Null for a practice nobody has classified,
  /// which is every one created before types existed.
  final String? practiceType;
  final String? specialty;
  final String? plan;

  /// What the organisation has.
  final Set<String> practice;

  /// What this person may use — the smaller of the two, and the one to build
  /// navigation from.
  final Set<String> effective;

  final String? role;
  final bool isOwner;

  /// Has an answer actually arrived?
  ///
  /// False means "not known yet", which is a different thing from "nothing is
  /// available" and has to be, or an empty set would read as a locked-down
  /// account. Every check below leans on this.
  final bool resolved;

  /// The permissive default, used before the first response arrives.
  ///
  /// Everything on, because the server is the thing that refuses and a screen
  /// hidden while a request is in flight is a screen that flickers away under
  /// somebody's thumb. A button that turns out not to work is a worse
  /// experience than a slow one; a navigation bar that rearranges itself twice
  /// on every cold start is worse than both.
  ///
  /// Which is also the rule the server follows — see the note on absence in
  /// `services/capabilities.js`. Both ends treat "unknown" as "do not narrow",
  /// and they have to agree or one of them is hiding what the other permits.
  static const unknown = Capabilities(
    practiceType: null,
    specialty: null,
    plan: null,
    practice: <String>{},
    effective: <String>{},
    role: null,
    isOwner: false,
    resolved: false,
  );

  bool has(String capability) => !resolved || effective.contains(capability);

  /// True when the practice has it and this person does not — the case worth
  /// saying something different about, because one is a sale and the other is
  /// a conversation with whoever runs the practice.
  bool withheld(String capability) =>
      resolved && practice.contains(capability) && !effective.contains(capability);

  factory Capabilities.fromJson(Map<String, dynamic> json) {
    final membership = json['membership'] as Map<String, dynamic>?;
    return Capabilities(
      resolved: true,
      practiceType: json['practiceType'] as String?,
      specialty: json['specialty'] as String?,
      plan: json['plan'] as String?,
      practice: ((json['practice'] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet(),
      effective: ((json['effective'] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet(),
      role: membership?['role'] as String?,
      isOwner: membership?['isOwner'] == true,
    );
  }
}

/// The capability names the app checks. Mirrors `services/capabilities.js`.
///
/// Written out rather than used as bare strings so a typo is a compile error
/// instead of a feature that is quietly always off — which is the failure mode
/// that is hardest to notice, because a hidden button looks like a decision.
abstract final class Cap {
  static const prescription = 'PRESCRIPTION';
  static const labOrder = 'LAB_ORDER';
  static const labResult = 'LAB_RESULT';
  static const department = 'DEPARTMENT';
  static const multiLocation = 'MULTI_LOCATION';
  static const aiAssistant = 'AI_ASSISTANT';
  static const advancedAnalytics = 'ADVANCED_ANALYTICS';
  static const advancedReports = 'ADVANCED_REPORTS';
  static const reportExport = 'REPORT_EXPORT';
  static const departmentAnalytics = 'DEPARTMENT_ANALYTICS';
  static const staffAnalytics = 'STAFF_ANALYTICS';
  static const scheduledReports = 'SCHEDULED_REPORTS';
}

/// Fetched once per sign-in and cached.
///
/// Not `autoDispose`: this is read by the navigation, so disposing it when the
/// last screen using it goes away means re-fetching on the next tab change.
final capabilitiesProvider = FutureProvider<Capabilities>((ref) async {
  final json = await ref.watch(apiClientProvider).getJson('/me/capabilities');
  return Capabilities.fromJson(json);
});

/// The answer without the loading state, for a widget that only needs to know
/// whether to draw something.
///
/// Falls back to [Capabilities.unknown] while loading and on failure. A failed
/// capability fetch must not empty the app — the routes still refuse what they
/// should, and a doctor whose network blipped should see their practice rather
/// than a stripped-down version of it.
final capabilitySetProvider = Provider<Capabilities>((ref) {
  return ref.watch(capabilitiesProvider).valueOrNull ?? Capabilities.unknown;
});
