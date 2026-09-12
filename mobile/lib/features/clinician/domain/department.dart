/// A specialty this practice runs.
///
/// ---- Two kinds, and the difference matters on screen --------------------
///
/// Shared rows belong to the platform: Cardiology means the same thing in Salt
/// Lake and in Behala, and a hundred practices each keeping their own copy is a
/// hundred spellings of it. A practice sees them and cannot edit them — one
/// clinic renaming "Cardiologist" would rename it on everybody's letterhead.
///
/// Its own rows are the ones it added: "Diabetic Foot Clinic", "Antenatal Day
/// Unit". Those it may rename, reorder and retire.
///
/// So the list is a mix, and the screen has to say which is which — otherwise
/// the edit affordance is missing on half the rows for no visible reason.
class Department {
  const Department({
    required this.id,
    required this.key,
    required this.name,
    required this.isShared,
    required this.isActive,
    this.homeCards = const [],
    this.hasAssistant = false,
    this.sortIndex = 0,
    this.widgets = const [],
    this.quickActions = const [],
    this.usingDefault = true,
  });

  final String id;

  /// The stable identifier: `diabetology`, `foot_clinic`. Not shown as a
  /// label — it is what the assistant scope and the seed data key off.
  final String key;

  /// In the reader's language, resolved server-side.
  final String name;

  /// Platform-wide, therefore read-only here.
  final bool isShared;

  /// Retired rather than deleted. A department with history behind it stays,
  /// so a prescription written under it still says what it said.
  final bool isActive;

  /// Which Home cards this department's patients see.
  final List<String> homeCards;

  /// Whether it can answer a patient at all.
  ///
  /// A department with no assistant scope gets no assistant — never a general
  /// one. The thread screen reads this to say so rather than showing a composer
  /// that silently does nothing.
  final bool hasAssistant;

  /// Display order, set by whoever runs the practice.
  final int sortIndex;

  /// What this department's clinicians see on their home screen, resolved.
  ///
  /// The resolved list, not the stored one. Every row in the database has an
  /// empty `widgets` array and empty means "the platform's default for this
  /// specialty applies" — so the raw value would show every department as
  /// configured to display nothing, and somebody would then "fix" what was
  /// already correct. The same mistake `/me/capabilities` made with
  /// `permissions`, which is why the server sends both this and the flag.
  final List<String> widgets;
  final List<String> quickActions;

  /// Whether that arrangement is the platform's or this practice's.
  ///
  /// The distinction the resolved list alone cannot carry, and the one that
  /// tells somebody whether they are looking at a decision anybody here made.
  final bool usingDefault;

  factory Department.fromJson(Map<String, dynamic> json) {
    return Department(
      id: json['id']?.toString() ?? '',
      key: json['key']?.toString() ?? '',
      // `name` is already resolved into the reader's language server-side.
      // `names` is the raw map beside it, which this screen has no use for.
      name: json['name']?.toString() ?? json['key']?.toString() ?? '',
      // Sent explicitly. Inferring it from a missing `practice` key — which
      // toPublic does not send at all — would have marked every row shared and
      // hidden the edit affordance on the ones a practice owns.
      isShared: json['isShared'] == true,
      isActive: json['isActive'] != false,
      hasAssistant: json['hasAssistant'] == true,
      sortIndex: (json['sortIndex'] as num?)?.toInt() ?? 0,
      homeCards: ((json['homeCards'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      widgets: ((json['widgets'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      quickActions: ((json['quickActions'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      // Absent means the platform's, which is what an older server that does
      // not send the field is describing.
      usingDefault: json['usingDefault'] != false,
    );
  }
}
