/// Somebody who works at this practice, and what they are here.
///
/// ---- One row, not three lists -------------------------------------------
///
/// This replaces three screens that each knew about one role. The shape they
/// were all missing is
///
///   person → role → department → location → permissions → status
///
/// which is a row. The role was in the URL, so it could not be a column, so
/// there had to be a screen per role — and that is why the dietician path was
/// the one that forgot to create a membership.
class TeamMember {
  const TeamMember({
    required this.id,
    required this.userId,
    required this.name,
    required this.phone,
    required this.role,
    required this.isOwner,
    required this.status,
    required this.permissions,
    required this.usingPreset,
    this.department,
    this.location,
    this.version,
  });

  /// The membership id. Every write here is about the job rather than the
  /// person, so this — not [userId] — is what the routes take.
  final String id;

  /// The account. Needed to tell "this is me" from "this is a colleague".
  final String userId;

  final String name;
  final String phone;

  /// `doctor`, `staff`, `dietician`, `doctor_assistant`, `lab_manager`,
  /// `lab_technician` or `practice_manager` — or a role this build has not
  /// heard of, which the People screen still draws, under Others.
  final String role;

  /// The head. Cannot be demoted or suspended from the app — a practice with
  /// nobody who can administer it is one only we can recover.
  final bool isOwner;

  /// `active`, `invited`, `suspended`, `left`, `disabled`.
  ///
  /// The last two are different things and the screen says which: `left` is a
  /// membership that ended, `disabled` is an account switched off. They need
  /// different levers to undo.
  final String status;

  final List<String> permissions;

  /// True when [permissions] is the role's default rather than a saved list.
  ///
  /// Worth showing: "these are the defaults, not a decision somebody made" is
  /// the difference between reading a grant and trusting one.
  final bool usingPreset;

  final ({String id, String? name})? department;
  final ({String id, String? name})? location;

  /// Which version of this row the screen is showing. Sent back with a change,
  /// so a change made against a row somebody else has since changed is refused
  /// rather than silently undoing theirs. Null from a server that predates it.
  final int? version;

  bool get isActive => status == 'active';

  factory TeamMember.fromJson(Map<String, dynamic> json) {
    ({String id, String? name})? ref(Object? raw) {
      if (raw is! Map<String, dynamic>) return null;
      final id = raw['id']?.toString();
      if (id == null || id.isEmpty) return null;
      return (id: id, name: raw['name']?.toString());
    }

    return TeamMember(
      id: json['id']?.toString() ?? '',
      userId: json['userId']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      role: json['role']?.toString() ?? '',
      isOwner: json['isOwner'] == true,
      status: json['status']?.toString() ?? 'active',
      permissions: ((json['permissions'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      usingPreset: json['usingPreset'] == true,
      department: ref(json['department']),
      location: ref(json['location']),
      version: (json['version'] as num?)?.toInt(),
    );
  }
}

/// The whole answer from `/team`: the people, and what the reader may do.
class TeamRoster {
  const TeamRoster({
    required this.items,
    required this.canManage,
    required this.departments,
    required this.locations,
    required this.staffCap,
    required this.staffUsed,
  });

  final List<TeamMember> items;

  /// Whether this reader holds MANAGE_STAFF.
  ///
  /// Sent by the server rather than worked out from the role, because the
  /// grant is per-person and editable — a practice manager who is not a doctor
  /// may hold it, and a doctor normally does not.
  final bool canManage;

  /// For the pickers, so the screen needs one request rather than three.
  final List<({String id, String name})> departments;
  final List<({String id, String name})> locations;

  /// Null means no cap, which is every practice until somebody types a number.
  final int? staffCap;
  final int staffUsed;

  bool get atCap => staffCap != null && staffUsed >= staffCap!;

  static const empty = TeamRoster(
    items: [],
    canManage: false,
    departments: [],
    locations: [],
    staffCap: null,
    staffUsed: 0,
  );

  factory TeamRoster.fromJson(Map<String, dynamic> json) {
    List<({String id, String name})> refs(Object? raw) {
      return ((raw as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((e) => (id: e['id']?.toString() ?? '', name: e['name']?.toString() ?? ''))
          .where((e) => e.id.isNotEmpty)
          .toList();
    }

    final limits = json['limits'] as Map<String, dynamic>?;
    return TeamRoster(
      items: ((json['items'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TeamMember.fromJson)
          .toList(),
      canManage: json['canManage'] == true,
      departments: refs(json['departments']),
      locations: refs(json['locations']),
      staffCap: (limits?['staff'] as num?)?.toInt(),
      staffUsed: (limits?['used'] as num?)?.toInt() ?? 0,
    );
  }
}
