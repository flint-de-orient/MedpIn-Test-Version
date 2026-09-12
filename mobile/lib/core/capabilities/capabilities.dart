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
    this.hasDietician = false,
    this.permissions = const <String>{},
    this.ui,
    this.department,
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

  /// What this person may do, resolved.
  ///
  /// The server sends the role's preset where nobody has customised the grant,
  /// rather than the empty array it stores — two readings of "empty" is how a
  /// screen comes to hide every button from the person who owns the practice.
  final Set<String> permissions;

  /// Whether anybody at this practice writes diet plans.
  ///
  /// Not a capability — a capability is what the product offers, this is who
  /// the practice employs. It arrives in the same response because the
  /// navigation needs it and that is the request the navigation already makes.
  final bool hasDietician;

  /// Has an answer actually arrived?
  ///
  /// False means "not known yet", which is a different thing from "nothing is
  /// available" and has to be, or an empty set would read as a locked-down
  /// account. Every check below leans on this.
  final bool resolved;

  /// Which components this person's home screen is made of, and in what order.
  ///
  /// Null before an answer arrives, and null for a patient — who has no
  /// clinician home screen rather than an empty one. See [DashboardConfig].
  final DashboardConfig? ui;

  /// Which part of the practice they work in. Null for a solo clinic, and for
  /// anybody nobody has assigned — both ordinary, neither a failure.
  final DepartmentRef? department;

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

  /// Whether this person holds a permission.
  ///
  /// Permissive before the answer arrives, exactly as [has] is and for the same
  /// reason: a button that appears a moment late is better than one that
  /// vanishes under somebody's thumb, and the server refuses what it should
  /// either way.
  ///
  /// A caller with no membership — a patient, or an account the backfill has
  /// not reached — holds nothing here, and every screen using it is a
  /// clinician's screen.
  bool can(String permission) => !resolved || permissions.contains(permission);

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
      hasDietician: json['hasDietician'] == true,
      permissions: ((membership?['permissions'] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet(),
      ui: DashboardConfig.fromJson(json['ui'] as Map<String, dynamic>?),
      department: DepartmentRef.fromJson(
        membership?['department'] as Map<String, dynamic>?,
      ),
    );
  }
}

/// A department, named.
///
/// The key is what code reasons about and the name is what a reader sees —
/// already resolved to this account's language by the server, because the
/// fallback ladder (their language, then English, then the key) is one rule
/// and belongs in one place.
class DepartmentRef {
  const DepartmentRef({required this.key, required this.name});

  final String key;
  final String name;

  static DepartmentRef? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    final key = json['key'] as String?;
    if (key == null) return null;
    return DepartmentRef(key: key, name: json['name'] as String? ?? key);
  }
}

/// What this person's home screen is made of.
///
/// ---- Identifiers, and the app decides everything else ------------------
///
/// The server sends names from `services/uiConfig.js` — never layout, never
/// styling, never data. How a component looks, what it fetches and how it
/// behaves are this app's business; whether it is on the screen at all is the
/// server's. A response that carried the other half would be a backend able to
/// draw anything it liked on a clinician's phone.
///
/// Which also means an unknown name is dropped here, not rendered as an error.
/// The server drops what it does not recognise and so does the registry — an
/// app a version behind meets a component that did not exist when it shipped,
/// and the right response is a slightly shorter dashboard rather than a red
/// screen in front of a patient.
class DashboardConfig {
  const DashboardConfig({
    required this.widgets,
    required this.quickActions,
    this.department,
  });

  final List<String> widgets;
  final List<String> quickActions;

  /// The department key this arrangement came from, or null for the general
  /// clinical set.
  final String? department;

  static DashboardConfig? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return DashboardConfig(
      widgets: ((json['widgets'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(growable: false),
      quickActions: ((json['quickActions'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(growable: false),
      department: json['department'] as String?,
    );
  }
}

/// What a person may do, as opposed to what the product offers.
///
/// Mirrors `PERMISSIONS` in models/Membership.js. Written out rather than used
/// as bare strings so a typo is a compile error instead of a feature that is
/// quietly always off — a drifted name resolves to a string the server never
/// sends, `can()` returns false, and the button is gone for everybody, which
/// looks exactly like a decision somebody made on purpose.
abstract final class Perm {
  static const viewPatient = 'VIEW_PATIENT';
  static const editRecord = 'EDIT_RECORD';
  static const prescribe = 'PRESCRIBE';
  static const manageStaff = 'MANAGE_STAFF';
  static const manageDepartment = 'MANAGE_DEPARTMENT';
  static const viewAudit = 'VIEW_AUDIT';
  static const shareRecords = 'SHARE_RECORDS';
}

/// The capability names the app checks. Mirrors `services/capabilities.js`.
///
/// Written out for the same reason [Perm] is, and it is the same failure: a
/// drifted name is a capability the server never sends, and the feature is
/// quietly off everywhere.
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
