import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/secure_store.dart';
import '../../../shared/providers/core_providers.dart';
import '../data/auth_repository.dart';
import '../domain/user.dart';
import '../../../core/session/session_reset.dart';

enum AuthStatus {
  /// Still checking secure storage / calling `/auth/me` on cold start.
  unknown,
  authenticated,
  unauthenticated,
}

class AuthState {
  const AuthState({required this.status, this.user, this.error});

  final AuthStatus status;
  final AppUser? user;
  final ApiException? error;

  const AuthState.unknown() : this(status: AuthStatus.unknown);
  const AuthState.authenticated(AppUser user)
    : this(status: AuthStatus.authenticated, user: user);
  const AuthState.unauthenticated([ApiException? error])
    : this(status: AuthStatus.unauthenticated, error: error);

  bool get isAuthenticated => status == AuthStatus.authenticated;
}

/// Owns the app's authentication lifecycle: bootstrapping from stored
/// tokens, login/register, logout, and reacting to a silent-refresh
/// failure raised by [ApiClient] (see [sessionExpired]).
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._repository, this._secureStore)
    : super(const AuthState.unknown()) {
    _bootstrap();
  }

  final AuthRepository _repository;
  final SecureStore _secureStore;

  bool _busy = false;
  bool get isBusy => _busy;

  Future<void> _bootstrap() async {
    final token = await _secureStore.readAccessToken();
    if (token == null || token.isEmpty) {
      state = const AuthState.unauthenticated();
      return;
    }
    try {
      final result = await _repository.getMe();
      // Deliberately NOT resetting here.
      //
      // This runs from the constructor, and resetSessionState invalidates
      // authRepositoryProvider — which authControllerProvider watches. So the
      // controller was rebuilt by its own bootstrap, ran the constructor
      // again, reset again, and went round for as long as anyone watched: the
      // app sat on its splash screen because the state went back to `unknown`
      // on every lap.
      //
      // Nothing needs clearing anyway. This is the first load of a fresh
      // container — there is no previous session's data in it to leak.
      state = AuthState.authenticated(result.user);
    } on ApiException catch (e) {
      await _secureStore.clear();
      state = AuthState.unauthenticated(e);
    }
  }

  /// Ask for a code. Returns null on success, the failure otherwise.
  Future<({OtpSent? sent, ApiException? error})> requestOtp({
    required String phone,
    required String purpose,
  }) async {
    try {
      return (
        sent: await _repository.requestOtp(phone: phone, purpose: purpose),
        error: null,
      );
    } on ApiException catch (e) {
      return (sent: null, error: e);
    }
  }

  /// Spend a login code. Ends signed in.
  Future<ApiException?> verifyLoginOtp({
    required String phone,
    required String code,
  }) async {
    _busy = true;
    try {
      final result = await _repository.verifyLoginOtp(phone: phone, code: code);
      // Before the new session's screens read anything. A container that was
      // never signed out of — an app resumed onto another account, a refresh
      // that resolved to a different user — has the same stale data with
      // nobody having pressed sign-out.
      resetSessionState();
      state = AuthState.authenticated(result.user);
      return null;
    } on ApiException catch (e) {
      return e;
    } finally {
      _busy = false;
    }
  }

  /// Password sign-in, which only doctors and clinic staff have.
  Future<ApiException?> login({
    required String phone,
    required String password,
  }) async {
    _busy = true;
    try {
      final result = await _repository.login(phone: phone, password: password);
      // Before the new session's screens read anything. A container that was
      // never signed out of — an app resumed onto another account, a refresh
      // that resolved to a different user — has the same stale data with
      // nobody having pressed sign-out.
      resetSessionState();
      state = AuthState.authenticated(result.user);
      return null;
    } on ApiException catch (e) {
      return e;
    } finally {
      _busy = false;
    }
  }

  Future<ApiException?> register({
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
    _busy = true;
    try {
      final result = await _repository.register(
        name: name,
        phoneToken: phoneToken,
        email: email,
        language: language,
        dateOfBirth: dateOfBirth,
        gender: gender,
        address: address,
        heightCm: heightCm,
        weightKg: weightKg,
        systolic: systolic,
        diastolic: diastolic,
        pulse: pulse,
        spo2: spo2,
        glucoseMgDl: glucoseMgDl,
        complaints: complaints,
        diabetesType: diabetesType,
      );
      // Before the new session's screens read anything. A container that was
      // never signed out of — an app resumed onto another account, a refresh
      // that resolved to a different user — has the same stale data with
      // nobody having pressed sign-out.
      resetSessionState();
      state = AuthState.authenticated(result.user);
      return null;
    } on ApiException catch (e) {
      return e;
    } finally {
      _busy = false;
    }
  }

  Future<void> logout() async {
    await _repository.logout();
    // Everything the previous session cached, dropped.
    //
    // Without this the next person to sign in on this handset saw the last
    // one's data: their doctor thread, their doses. The shells are
    // indexedStack, so a visited tab stays mounted and its providers never
    // auto-dispose — they simply hold what they last fetched until something
    // asks again.
    resetSessionState();
    state = const AuthState.unauthenticated();
  }

  /// Called by [ApiClient] when a refresh-token retry fails. Drops the
  /// user straight to "unauthenticated" so the router redirects to login.
  void sessionExpired() {
    if (state.status != AuthStatus.authenticated) return;
    // A sign-out nobody pressed, and the same leak if it is not cleared: the
    // screens stay mounted, holding a patient's data, while the app shows the
    // login page over the top of them.
    resetSessionState();
    state = const AuthState.unauthenticated(
      ApiException(code: 'UNAUTHORIZED', message: 'Session expired'),
    );
  }

  /// Swaps in the user object returned by a successful profile update, so the
  /// rest of the app sees the new name, email, date of birth or gender without
  /// a refetch.
  void replaceUser(AppUser user) {
    if (state.status != AuthStatus.authenticated) return;
    state = AuthState.authenticated(user);
  }

  void updateLocalUserLanguage(String language) {
    final user = state.user;
    if (user == null) return;
    state = AuthState.authenticated(user.copyWith(language: language));
  }
}

final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>((ref) {
      return AuthRepository(
        ref.watch(apiClientProvider),
        ref.watch(secureStoreProvider),
      );
    });

final StateNotifierProvider<AuthController, AuthState> authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
      return AuthController(
        ref.watch(authRepositoryProvider),
        ref.watch(secureStoreProvider),
      );
    });
