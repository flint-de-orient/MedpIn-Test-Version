import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/providers/core_providers.dart';
import '../../shell/presentation/load_stamps.dart';
import '../../chat/data/chat_repository.dart';
import '../../chat/domain/chat_message.dart';
import '../domain/care_summary.dart';
import '../../../shared/providers/active_patient.dart';

/// The patient's home screen, in one request. `/dashboard` already fans its
/// queries out in parallel server-side, so the screen arrives whole rather than
/// filling in section by section on a weak connection.
final careSummaryProvider = FutureProvider.autoDispose<CareSummary>((
  ref,
) async {
  // Whose record. `me` for the account holder, a patient id for somebody this
  // login looks after — watched, so switching in the household picker
  // re-fetches this and everything downstream of it.
  final patient = ref.watch(patientPathProvider);
  // Mounted at /patients/:patientId/dashboard, and `me` resolves to the signed-
  // in patient. A bare /dashboard is a 404 — which is what "could not load your
  // care summary" was.
  final json = await ref
      .read(apiClientProvider)
      .getJson('/patients/$patient/dashboard');
  final care = CareSummary.fromJson(json);
  LoadStamps.mark(LoadStamps.careSummary);
  return care;
});

/// How far back a message from the clinic still belongs on Home.
///
/// Home is about now. A doctor's note from last month is in the conversation,
/// where it can be read in context; on the first screen it would read as news.
const Duration kClinicMessageFreshFor = Duration(days: 14);

/// The latest thing a person at the clinic — the doctor or the front desk —
/// wrote into this patient's conversation, or null when nobody has recently.
///
/// Read from the same thread the Doctor tab shows (`GET /chat/thread`, newest
/// window only), so Home cannot say something the conversation does not.
/// The assistant is not a person at the clinic and is never shown here.
final latestClinicMessageProvider = FutureProvider.autoDispose<ChatMessage?>((
  ref,
) async {
  final page = await ref.watch(chatRepositoryProvider).getThread(limit: 20);
  final cutoff = DateTime.now().subtract(kClinicMessageFreshFor);
  ChatMessage? latest;
  for (final m in page.items) {
    if (!m.isClinician || m.deletedForEveryone) continue;
    if (m.content.trim().isEmpty && m.voiceNotes.isEmpty) continue;
    final at = m.createdAt;
    if (at == null || at.isBefore(cutoff)) continue;
    if (latest == null || at.isAfter(latest.createdAt!)) latest = m;
  }
  return latest;
});
