/// One meal the patient logged for their dietician.
class FoodLogEntry {
  const FoodLogEntry({
    required this.id,
    required this.mealType,
    required this.note,
    this.photoUrl,
    this.createdAt,
    this.reviewedAt,
    this.mealStatus,
  });

  final String id;
  final String mealType; // breakfast | lunch | dinner | snack | other
  final String note;
  final String? photoUrl; // /api/v1/uploads/:id/raw
  final DateTime? createdAt;

  /// When a dietician ticked this specific meal off, or null while it is still
  /// waiting. Only the dietician panel sets it; the patient's own food screen
  /// never shows it, because "your dietician has read this" is a promise the
  /// clinic should make deliberately rather than as a side effect of a flag.
  final DateTime? reviewedAt;

  bool get needsReview => reviewedAt == null;

  /// The dietician's verdict — on_track | review | concern — or null when they
  /// ticked the meal without one. Their judgement, never a computation: no
  /// photograph carries the portion, the oil, or what was eaten around it.
  final String? mealStatus;

  /// The words the panel shows for it.
  String? get mealStatusLabel => switch (mealStatus) {
    'on_track' => 'On track',
    'review' => 'Review',
    'concern' => 'Concern',
    _ => null,
  };

  factory FoodLogEntry.fromJson(Map<String, dynamic> j) => FoodLogEntry(
    id: j['id']?.toString() ?? '',
    mealType: j['mealType']?.toString() ?? 'other',
    note: j['note']?.toString() ?? '',
    photoUrl:
        (j['photoUrl'] == null || j['photoUrl'].toString().isEmpty)
            ? null
            : j['photoUrl'].toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    reviewedAt: DateTime.tryParse(j['reviewedAt']?.toString() ?? '')?.toLocal(),
    mealStatus: j['mealStatus']?.toString(),
  );
}
