import 'package:akd_care/core/network/api_client.dart';
import 'package:akd_care/core/network/submission_keys.dart';
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/features/appointments/data/appointment_repository.dart';
import 'package:flutter_test/flutter_test.dart';

/// Every appointment write names itself, so sending it again cannot write twice.
///
/// The server answers a repeated `Idempotency-Key` with what the first attempt
/// did. That protects nothing unless the app sends one: a booking confirmed
/// again after a timeout, a request sent twice, a move retried after the token
/// was refreshed. Same form sent again → same key; anything changed → a new one.

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

/// Records what each write would have sent, and answers like the server.
class _Recorder extends ApiClient {
  _Recorder() : super(secureStore: _NoSession());

  final sent = <({String method, String path, Map<String, String>? headers})>[];

  Map<String, dynamic> get _appointment => {
    'appointment': {'id': 'a1', 'status': 'confirmed', 'mode': 'in_clinic'},
  };

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Map<String, String>? headers,
  }) async {
    sent.add((method: 'POST', path: path, headers: headers));
    return _appointment;
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Object? body,
    Map<String, String>? headers,
  }) async {
    sent.add((method: 'PATCH', path: path, headers: headers));
    return _appointment;
  }
}

/// The server's rule for a key.
final _serverKey = RegExp(r'^[A-Za-z0-9._:-]{8,128}$');

void main() {
  late _Recorder client;
  late AppointmentRepository repo;

  setUp(() {
    client = _Recorder();
    repo = AppointmentRepository(client);
  });

  String keyOf(int i) => client.sent[i].headers!['Idempotency-Key']!;

  test('every write carries a key the server accepts', () async {
    final at = DateTime.utc(2026, 9, 20, 4, 30);
    await repo.book(clinicId: 'c1', scheduledForIso: at.toIso8601String());
    await repo.requestAppointment(preferredFor: DateTime(2026, 9, 21));
    await repo.confirmRequest('a1', clinicId: null, scheduledFor: at);
    await repo.reschedule('a1', at.toIso8601String());
    await repo.cancel('a1');

    expect(client.sent, hasLength(5));
    for (var i = 0; i < 5; i++) {
      expect(keyOf(i), matches(_serverKey), reason: '${client.sent[i].path} sent no usable key');
    }
  });

  test('the same form sent again is the same key, and a changed one is not', () async {
    final screen = SubmissionKeys();
    final ten = DateTime.utc(2026, 9, 20, 4, 30).toIso8601String();
    final eleven = DateTime.utc(2026, 9, 20, 5, 30).toIso8601String();

    await repo.book(clinicId: 'c1', scheduledForIso: ten, submission: screen);
    await repo.book(clinicId: 'c1', scheduledForIso: ten, submission: screen);
    await repo.book(clinicId: 'c1', scheduledForIso: eleven, submission: screen);

    expect(keyOf(1), keyOf(0), reason: 'a retry of the same booking had a new key');
    expect(keyOf(2), isNot(keyOf(0)), reason: 'a different time reused the key');
  });

  test('one key never stands for two appointments', () async {
    final screen = SubmissionKeys();
    await repo.cancel('a1', submission: screen);
    await repo.cancel('a2', submission: screen);
    expect(keyOf(1), isNot(keyOf(0)));
  });
}
