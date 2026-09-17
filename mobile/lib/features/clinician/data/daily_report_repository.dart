import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/daily_report.dart';

/// What the doctor is about to do with the PDF. The server writes it into the
/// audit log with the export, because it cannot see a share sheet itself.
enum DailyReportPurpose { view, share }

/// Talks to `/doctor/reports/daily`.
///
/// Nothing here sends a report anywhere. The server hands the document to this
/// phone, and where it goes after that is chosen by the doctor in the phone's
/// own share sheet — WhatsApp is one of the places a phone can send a file, and
/// never a place this app sends one.
class DailyReportRepository {
  DailyReportRepository(this._client);

  final ApiClient _client;

  /// The day as data, for the preview.
  Future<DailyReport> preview(String date) async {
    final json = await _client.getJson(
      '/doctor/reports/daily',
      query: {'date': date, 'format': 'json'},
    );
    return DailyReport.fromJson(json);
  }

  /// The PDF bytes. Each call is one generation in the audit log.
  Future<List<int>> pdf(String date, DailyReportPurpose purpose) {
    return _client.getBytes('/doctor/reports/daily?date=$date&purpose=${purpose.name}');
  }
}

final dailyReportRepositoryProvider = Provider<DailyReportRepository>(
  (ref) => DailyReportRepository(ref.watch(apiClientProvider)),
);

/// The preview for one clinic-local date, `YYYY-MM-DD`.
final dailyReportProvider = FutureProvider.autoDispose.family<DailyReport, String>(
  (ref, date) => ref.watch(dailyReportRepositoryProvider).preview(date),
);
