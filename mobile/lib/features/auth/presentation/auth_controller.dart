import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/secure_store.dart';
import '../../../shared/providers/core_providers.dart';
import '../data/auth_repository.dart';
import '../domain/user.dart';

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
      return (sent: await _repository.requestOtp(phone: phone, purpose: purpose), error: null);
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
    String? inviteCode,
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
        inviteCode: inviteCode,
      );
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
    state = const AuthState.unauthenticated();
  }

  /// Called by [ApiClient] when a refresh-token retry fails. Drops the
  /// user straight to "unauthenticated" so the router redirects to login.
  void sessionExpired() {
    if (state.status != AuthStatus.authenticated) return;
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
