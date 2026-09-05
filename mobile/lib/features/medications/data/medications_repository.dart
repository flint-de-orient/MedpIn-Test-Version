import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/medication.dart';
import '../../../shared/providers/active_patient.dart';

/// Talks to `/patients/me/medications*` (API_CONTRACT.md §4).
class MedicationsRepository {
  MedicationsRepository(this._client, this._patient);

  final ApiClient _client;

  /// `me`, or the id of somebody this login looks after. Held rather than read
  /// per call so the provider rebuilds when the active patient changes, and
  /// everything watching it re-fetches without being told to.
  final String _patient;

  String get _base => '/patients/$_patient/medications';

  Future<List<Medication>> getMedications() async {
    final json = await _client.getJson(_base);
    final items = json['items'] as List<dynamic>? ?? const [];
    return items
        .map((e) => Medication.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<TodaySchedule> getTodaySchedule() async {
    final json = await _client.getJson('$_base/schedule/today');
    return TodaySchedule.fromJson(json);
  }

  /// The patient's past doses (taken/skipped/missed) over [days] days, newest
  /// first — powers the medicine-taking history screen.
  Future<List<DoseHistoryEntry>> getDoseHistory({int days = 14}) async {
    final json = await _client.getJson(
      '$_base/schedule/history',
      query: {'days': days},
    );
    final items = json['doses'] as List<dynamic>? ?? const [];
    return items
        .map((e) => DoseHistoryEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Adds a medicine to the patient's tracker. [schedule] is a list of
  /// `{time: "HH:mm", relationToMeal}` maps — the daily dose times the reminders
  /// are built from.
  Future<Medication> createMedication({
    required String name,
    required String form,
    String? strength,
    String? dose,
    required List<Map<String, String>> schedule,
    String? instructions,
  }) async {
    final json = await _client.postJson(
      _base,
      body: {
        'name': name,
        'form': form,
        if (strength != null && strength.isNotEmpty) 'strength': strength,
        if (dose != null && dose.isNotEmpty) 'dose': dose,
        'schedule': schedule,
        if (instructions != null && instructions.isNotEmpty)
          'instructions': instructions,
      },
    );
    return Medication.fromJson(json['medication'] as Map<String, dynamic>);
  }

  /// Stops (soft-deletes) a medicine so it drops out of the schedule and its
  /// reminders stop.
  Future<void> stopMedication(String id) async {
    await _client.delete('$_base/$id');
  }

  /// Overrides a medicine's reminder times by hand. Each entry is
  /// `{time: "HH:mm", relationToMeal}`. The server marks it customised so a later
  /// meal-time change won't move it.
  Future<void> updateSchedule(
    String id,
    List<Map<String, String>> schedule,
  ) async {
    await _client.patchJson('$_base/$id', body: {'schedule': schedule});
  }

  /// Uploads a photo of a prescription; the server reads it and creates the
  /// medicines it finds. Returns what was created (or `readable: false` if the
  /// photo couldn't be read).
  Future<PrescriptionScanResult> scanPrescription({
    required String path,
    required String filename,
  }) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(
        path,
        filename: filename,
        contentType: MediaType.parse(_imageMime(filename)),
      ),
    });
    final json = await _client.postMultipart('$_base/scan', formData: formData);
    return PrescriptionScanResult.fromJson(json);
  }

  /// Save the medicines the patient has just looked at.
  ///
  /// Sends the reviewed items back rather than the photograph. Re-reading the
  /// picture would run the model a second time and could return a different
  /// list from the one on screen — the patient would be approving one thing and
  /// saving another, which is exactly what splitting this in two prevents.
  Future<PrescriptionScanResult> confirmScannedMedicines({
    required List<ScannedMedicine> items,
    Map<String, dynamic>? prescriber,
  }) async {
    final json = await _client.postJson(
      '$_base/scan/confirm',
      body: {
        'items': [for (final i in items) i.toJson()],
        if (prescriber != null) 'prescriber': prescriber,
      },
    );
    return PrescriptionScanResult.fromJson({...json, 'readable': true});
  }

  static String _imageMime(String filename) {
    switch (filename.toLowerCase().split('.').last) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }

  Future<void> logDose({
    required String medicationId,
    required DateTime scheduledFor,
    required String status,
    num? unitsAdministered,
    String? injectionSite,
    String? skipReason,
  }) async {
    await _client.postJson(
      '$_base/$medicationId/log',
      body: {
        'scheduledFor': scheduledFor.toUtc().toIso8601String(),
        'status': status,
        if (unitsAdministered != null) 'unitsAdministered': unitsAdministered,
        if (injectionSite != null) 'injectionSite': injectionSite,
        if (skipReason != null) 'skipReason': skipReason,
      },
    );
  }

  Future<MedicationAdherence> getAdherence({int days = 30}) async {
    final json = await _client.getJson(
      '$_base/adherence',
      query: {'days': days},
    );
    return MedicationAdherence.fromJson(json);
  }
}

final Provider<MedicationsRepository> medicationsRepositoryProvider =
    Provider<MedicationsRepository>((ref) {
      return MedicationsRepository(ref.watch(apiClientProvider), ref.watch(patientPathProvider));
    });
