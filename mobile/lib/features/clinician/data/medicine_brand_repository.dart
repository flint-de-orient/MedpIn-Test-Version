import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';

/// A brand the clinic prescribes, and what is in it.
class MedicineBrand {
  const MedicineBrand({
    required this.name,
    required this.strengthLabel,
    required this.compositionLabel,
    this.strengthUnit,
    this.form = 'tablet',
    this.note = '',
  });

  final String name;

  /// The strength as it should be written: "500/1" for a combination, "1" for
  /// a single agent. Empty when the product has no meaningful single figure.
  final String strengthLabel;

  /// "Metformin 500 mg + Glimepiride 1 mg" — what a prescriber reads to check
  /// they picked the right product.
  final String compositionLabel;

  /// The unit every component shares, or null for a mixed-unit product.
  final String? strengthUnit;

  final String form;
  final String note;

  /// The strength the prescription should carry, unit included.
  String get strengthWithUnit =>
      strengthLabel.isEmpty || strengthUnit == null
          ? strengthLabel
          : '$strengthLabel $strengthUnit';

  factory MedicineBrand.fromJson(Map<String, dynamic> j) => MedicineBrand(
    name: j['name']?.toString() ?? '',
    strengthLabel: j['strengthLabel']?.toString() ?? '',
    compositionLabel: j['compositionLabel']?.toString() ?? '',
    strengthUnit: j['strengthUnit']?.toString(),
    form: j['form']?.toString() ?? 'tablet',
    note: j['note']?.toString() ?? '',
  );
}

class MedicineBrandRepository {
  MedicineBrandRepository(this._client);

  final ApiClient _client;

  /// Suggestions for the medicine field.
  Future<List<MedicineBrand>> search(String query) async {
    final json = await _client.getJson(
      '/medicine-brands',
      query: {if (query.trim().isNotEmpty) 'q': query.trim()},
    );
    return (json['items'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(MedicineBrand.fromJson)
        .toList();
  }

  /// The brand as typed, or null when the clinic's list does not carry it.
  ///
  /// Null is a real answer, not a failure: an unknown brand should produce no
  /// warning at all rather than a guess about a product nobody has recorded.
  Future<MedicineBrand?> lookup(String name) async {
    if (name.trim().isEmpty) return null;
    final json = await _client.getJson(
      '/medicine-brands/lookup',
      query: {'name': name.trim()},
    );
    final b = json['brand'];
    return b is Map<String, dynamic> ? MedicineBrand.fromJson(b) : null;
  }
}

final medicineBrandRepositoryProvider = Provider<MedicineBrandRepository>(
  (ref) => MedicineBrandRepository(ref.watch(apiClientProvider)),
);

/// Suggestions for what the prescriber has typed so far.
final medicineBrandSearchProvider = FutureProvider.autoDispose
    .family<List<MedicineBrand>, String>(
      (ref, q) => ref.watch(medicineBrandRepositoryProvider).search(q),
    );
