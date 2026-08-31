import '../../../core/network/api_client.dart';
import '../../../core/storage/secure_store.dart';
import '../domain/user.dart';

/// What `/auth/otp/request` says about the code it just sent.
class OtpSent {
  const OtpSent({
    required this.expiresInSeconds,
    required this.resendAfterSeconds,
    required this.simulated,
  });

  factory OtpSent.fromJson(Map<String, dynamic> j) => OtpSent(
    expiresInSeconds: (j['expiresInSeconds'] as num?)?.toInt() ?? 600,
    resendAfterSeconds: (j['resendAfterSeconds'] as num?)?.toInt() ?? 45,
    simulated: j['simulated'] == true,
  );

  /// How long the code stays good for.
  final int expiresInSeconds;

  /// How long before the server will send another.
  final int resendAfterSeconds;

  /// True when the server has no SMS credentials and logged the code instead
  /// of texting it. Only ever true off production, and the screen says so —
  /// a tester who is not told will sit waiting for a message.
  final bool simulated;
}

/// Result of a successful login/register call.
class AuthResult {
  const AuthResult({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
  });

  final AppUser user;
  final String accessToken;
  final String refreshToken;
}

/// Talks to `/auth/*`. Never touches Riverpod or UI state directly — see
/// `AuthController` for the state machine built on top of this.
class AuthRepository {
  AuthRepository(this._client, this._secureStore);

  final ApiClient _client;
  final SecureStore _secureStore;

  /// Ask for a code. `purpose` is `register` or `login`.
  ///
  /// Throws with a 409 when registering a number that already has an account,
  /// and a 404 when signing in to one that does not — both of which the caller
  /// turns into a sentence and a way out.
  Future<OtpSent> requestOtp({
    required String phone,
    required String purpose,
  }) async {
    final json = await _client.postJson(
      '/auth/otp/request',
      body: {'phone': phone, 'purpose': purpose},
    );
    return OtpSent.fromJson(json);
  }

  /// Spend a login code. Ends with a session.
  Future<AuthResult> verifyLoginOtp({
    required String phone,
    required String code,
  }) async {
    final json = await _client.postJson(
      '/auth/otp/verify',
      body: {'phone': phone, 'purpose': 'login', 'code': code},
    );
    return _resultFromJson(json);
  }

  /// Spend a registration code.
  ///
  /// Ends with a short-lived token rather than a session: the form has still
  /// to be filled in, and this is what carries "the number is theirs" across
  /// that gap so the client is never asked to vouch for itself.
  Future<String> verifyRegisterOtp({
    required String phone,
    required String code,
  }) async {
    final json = await _client.postJson(
      '/auth/otp/verify',
      body: {'phone': phone, 'purpose': 'register', 'code': code},
    );
    return json['phoneToken'] as String;
  }

  Future<AuthResult> register({
    required String name,
    required String phoneToken,
    String? email,
    required String language,
    String? dateOfBirth,
    String? gender,
    String? address,
    double? heightCm,
    double? weightKg,
    int? systolic,
    int? diastolic,
    int? pulse,
    int? spo2,
    int? glucoseMgDl,
    String? complaints,
    String? diabetesType,
  }) async {
    final json = await _client.postJson(
      '/auth/register',
      body: {
        'name': name,
        'phoneToken': phoneToken,
        if (email != null && email.isNotEmpty) 'email': email,
        'language': language,
        if (dateOfBirth != null) 'dateOfBirth': dateOfBirth,
        if (gender != null) 'gender': gender,
        if (address != null && address.isNotEmpty) 'address': address,
        if (heightCm != null) 'heightCm': heightCm,
        if (diabetesType != null) 'diabetesType': diabetesType,
        if (weightKg != null) 'weightKg': weightKg,
        if (systolic != null) 'systolic': systolic,
        if (diastolic != null) 'diastolic': diastolic,
        if (pulse != null) 'pulse': pulse,
        if (spo2 != null) 'spo2': spo2,
        if (glucoseMgDl != null) 'glucoseMgDl': glucoseMgDl,
        if (complaints != null && complaints.isNotEmpty)
          'complaints': complaints,
        if (diabetesType != null) 'diabetesType': diabetesType,
      },
    );
    return _resultFromJson(json);
  }

  /// Password sign-in, which only doctors and clinic staff have.
  Future<AuthResult> login({
    required String phone,
    required String password,
  }) async {
    final json = await _client.postJson(
      '/auth/login',
      body: {'phone': phone, 'password': password},
    );
    return _resultFromJson(json);
  }

  Future<void> logout() async {
    try {
      await _client.postJson('/auth/logout');
    } finally {
      await _secureStore.clear();
    }
  }

  /// `GET /auth/me` returns `{ user, profile }`. The profile carries clinical
  /// fields that do not live on the user record — diabetes type among them.
  Future<({AppUser user, String? diabetesType})> getMe() async {
    final json = await _client.getJson('/auth/me');
    final profile = json['profile'];
    return (
      user: AppUser.fromJson(json['user'] as Map<String, dynamic>),
      diabetesType:
          profile is Map<String, dynamic>
              ? profile['diabetesType']?.toString()
              : null,
    );
  }

  /// Records a weight reading for the signed-in patient.
  ///
  /// A vitals entry, not a profile field. Weight belongs to the series the
  /// doctor reads and that BMI is computed from; writing it onto the profile
  /// as well would leave two copies to disagree with each other, and the one on
  /// the profile would never move again.
  Future<void> recordWeight(String patientId, double weightKg) async {
    await _client.postJson(
      '/patients/$patientId/vitals',
      body: {'weightKg': weightKg},
    );
  }

  /// Diabetes type lives on `PatientProfile`, not `User`, so it has its own
  /// endpoint — `PATCH /auth/me` would silently ignore it.
  Future<void> updateDiabetesType(String diabetesType) async {
    await _client.patchJson(
      '/auth/me/profile',
      body: {'diabetesType': diabetesType},
    );
  }

  /// The full `PatientProfile` from `GET /auth/me` — height, diagnosis date,
  /// allergies, emergency contact, targets.
  Future<Map<String, dynamic>> getProfile() async {
    final json = await _client.getJson('/auth/me');
    final profile = json['profile'];
    return profile is Map<String, dynamic> ? profile : <String, dynamic>{};
  }

  /// Updates the clinical profile fields via `PATCH /auth/me/profile`. Only
  /// non-null keys are sent, so an unedited field is left untouched.
  Future<void> updateProfile({
    double? heightCm,
    String? diabetesType,
    String? diagnosedOn,
    String? chiefComplaint,
    List<String>? allergies,
    Map<String, String>? emergencyContact,
    Map<String, String>? mealTimes,
  }) async {
    await _client.patchJson(
      '/auth/me/profile',
      body: {
        if (heightCm != null) 'heightCm': heightCm,
        if (diagnosedOn != null) 'diagnosedOn': diagnosedOn,
        if (chiefComplaint != null) 'chiefComplaint': chiefComplaint,
        if (allergies != null) 'allergies': allergies,
        if (emergencyContact != null) 'emergencyContact': emergencyContact,
        if (mealTimes != null) 'mealTimes': mealTimes,
      },
    );
  }

  Future<AppUser> updateMe({
    String? name,
    String? email,
    String? language,
    String? dateOfBirth,
    String? gender,
    String? address,
    String? avatarAssetId,
    String? qualifications,
    String? specialty,
    String? registrationNo,
    String? signatureAssetId,
  }) async {
    final json = await _client.patchJson(
      '/auth/me',
      body: {
        if (name != null) 'name': name,
        if (email != null) 'email': email,
        if (language != null) 'language': language,
        if (dateOfBirth != null) 'dateOfBirth': dateOfBirth,
        if (gender != null) 'gender': gender,
        if (address != null) 'address': address,
        if (avatarAssetId != null) 'avatarAssetId': avatarAssetId,
        if (qualifications != null) 'qualifications': qualifications,
        if (specialty != null) 'specialty': specialty,
        if (registrationNo != null) 'registrationNo': registrationNo,
        if (signatureAssetId != null) 'signatureAssetId': signatureAssetId,
      },
    );
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<AuthResult> _resultFromJson(Map<String, dynamic> json) async {
    final user = AppUser.fromJson(json['user'] as Map<String, dynamic>);
    final accessToken = json['accessToken'] as String;
    final refreshToken = json['refreshToken'] as String;
    await _secureStore.saveTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
    );
    return AuthResult(
      user: user,
      accessToken: accessToken,
      refreshToken: refreshToken,
    );
  }
}
