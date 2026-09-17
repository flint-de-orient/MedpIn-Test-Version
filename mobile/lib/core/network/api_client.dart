import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../storage/secure_store.dart';
import 'api_exception.dart';

/// Endpoints that must be called without an `Authorization` header and that
/// must never trigger the refresh-and-retry flow.
const _publicPaths = <String>['/auth/register', '/auth/login', '/auth/refresh', '/health'];

/// Wraps a configured [Dio] instance with:
///  - base URL / timeouts from [AppConfig]
///  - a bearer-token auth interceptor
///  - automatic refresh-and-retry-once on a 401 response
///  - mapping of every failure into an [ApiException] so callers never see
///    raw [DioException]s.
///
/// Repositories should depend on this class only — never construct their
/// own [Dio].
class ApiClient {
  ApiClient({
    required SecureStore secureStore,
    VoidCallback? onAuthExpired,
    VoidCallback? onTokensRefreshed,
  }) : _secureStore = secureStore,
      _onAuthExpired = onAuthExpired,
      _onTokensRefreshed = onTokensRefreshed,
      _dio = Dio(
        BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: AppConfig.connectTimeout,
          receiveTimeout: AppConfig.receiveTimeout,
          headers: const {'Content-Type': 'application/json'},
        ),
      ),
      // Bare client used only for the token-refresh call itself, so that
      // refreshing never recurses through the auth interceptor below.
      _refreshDio = Dio(
        BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: AppConfig.connectTimeout,
          receiveTimeout: AppConfig.receiveTimeout,
          headers: const {'Content-Type': 'application/json'},
        ),
      ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final isPublic = _publicPaths.any((p) => options.path.startsWith(p));
          if (!isPublic) {
            final token = await _secureStore.readAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final isPublic = _publicPaths.any((p) => error.requestOptions.path.startsWith(p));
          final alreadyRetried = error.requestOptions.extra['akdRetried'] == true;

          if (!isPublic && error.response?.statusCode == 401 && !alreadyRetried) {
            try {
              final newAccessToken = await _refreshAccessToken();
              if (newAccessToken != null) {
                final retryOptions = error.requestOptions;
                retryOptions.extra['akdRetried'] = true;
                retryOptions.headers['Authorization'] = 'Bearer $newAccessToken';
                final response = await _dio.fetch(retryOptions);
                handler.resolve(response);
                return;
              }
            } catch (_) {
              // fall through to auth-expired handling below
            }
            await _secureStore.clear();
            _onAuthExpired?.call();
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final Dio _refreshDio;
  final SecureStore _secureStore;
  final VoidCallback? _onAuthExpired;

  /// Fired after the access token is rotated, so callers holding a copy of it
  /// can discard theirs. See the call site for why this matters to avatars.
  final VoidCallback? _onTokensRefreshed;

  // Ensures concurrent 401s trigger exactly one refresh call.
  Completer<String?>? _refreshInFlight;

  Future<String?> _refreshAccessToken() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight.future;

    final completer = Completer<String?>();
    _refreshInFlight = completer;

    () async {
      try {
        final refreshToken = await _secureStore.readRefreshToken();
        if (refreshToken == null || refreshToken.isEmpty) {
          completer.complete(null);
          return;
        }
        final response = await _refreshDio.post(
          '/auth/refresh',
          data: {'refreshToken': refreshToken},
        );
        final data = response.data as Map<String, dynamic>;
        final newAccess = data['accessToken'] as String?;
        final newRefresh = data['refreshToken'] as String?;
        if (newAccess == null || newRefresh == null) {
          completer.complete(null);
          return;
        }
        await _secureStore.saveTokens(accessToken: newAccess, refreshToken: newRefresh);
        // Anything holding a copy of the old access token is now broken.
        // `Image.network` fetches owner-protected photos with a header built
        // outside Dio, so without this it keeps presenting the dead token, gets
        // a 401, and silently falls back to an initial — the photo simply stops
        // appearing about thirty minutes after sign-in.
        _onTokensRefreshed?.call();
        completer.complete(newAccess);
      } catch (_) {
        completer.complete(null);
      } finally {
        _refreshInFlight = null;
      }
    }();

    return completer.future;
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final response = await _run(() => _dio.get(path, queryParameters: _cleanQuery(query)));
    return _asMap(response.data);
  }

  /// [headers] are for what a request needs to say about itself — above all
  /// an `Idempotency-Key`, which a retry must repeat. They ride on the request
  /// options, so the refresh-and-retry after a 401 sends them again unchanged.
  Future<Map<String, dynamic>> postJson(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Map<String, String>? headers,
  }) async {
    final response = await _run(
      () => _dio.post(
        path,
        data: body,
        queryParameters: _cleanQuery(query),
        options: headers == null ? null : Options(headers: headers),
      ),
    );
    return _asMap(response.data);
  }

  /// [headers] as for [postJson]: an appointment confirmed, moved or cancelled
  /// carries an `Idempotency-Key` that a retry must repeat.
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Object? body,
    Map<String, String>? headers,
  }) async {
    final response = await _run(
      () => _dio.patch(
        path,
        data: body,
        options: headers == null ? null : Options(headers: headers),
      ),
    );
    return _asMap(response.data);
  }

  /// For endpoints that replace a whole document rather than merge fields.
  Future<Map<String, dynamic>> putJson(
    String path, {
    Object? body,
  }) async {
    final response = await _run(() => _dio.put(path, data: body));
    return _asMap(response.data);
  }

  /// [body] is optional because most deletes identify the resource by path,
  /// but a few — detaching a device token, for one — name it in the payload.
  Future<void> delete(String path, {Map<String, dynamic>? body}) async {
    await _run(() => _dio.delete(path, data: body));
  }

  /// Fetches an owner-protected file's raw bytes.
  ///
  /// Used for voice notes and documents rather than streaming or
  /// `Dio.download`: the player and any external viewer need the Authorization
  /// header, and on Android a header-bearing URL is served through a local proxy
  /// that is unreliable over HTTPS. This goes through the NORMAL request path, so
  /// the token is attached AND a 401 refreshes-and-retries correctly. That last
  /// part is why `download` was wrong: its retry after a token refresh re-issues
  /// through `fetch`, which does not re-save the file — leaving a 0-byte
  /// download that then fails to decode. The caller writes the bytes to disk.
  Future<List<int>> getBytes(String path) async {
    final response = await _run(
      () => _dio.get<List<int>>(path, options: Options(responseType: ResponseType.bytes)),
    );
    return response.data ?? const <int>[];
  }

  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required FormData formData,
  }) async {
    // The client's default Content-Type is application/json, which is wrong for
    // a file upload: it overrides the multipart boundary Dio must generate, so
    // the server cannot parse the file and the upload fails. Force multipart
    // here so Dio computes the boundary from the FormData.
    final response = await _run(
      () => _dio.post(
        path,
        data: formData,
        options: Options(contentType: Headers.multipartFormDataContentType),
      ),
    );
    return _asMap(response.data);
  }

  /// Opens a Server-Sent Events stream and yields `(event, data)` pairs as they
  /// arrive. Used for streaming the chat reply token by token. Errors surface as
  /// [ApiException] so the caller can fall back to the non-streaming path.
  Stream<(String, Map<String, dynamic>)> postSse(String path, {Object? body}) async* {
    final Response<ResponseBody> response;
    try {
      response = await _dio.post<ResponseBody>(
        path,
        data: body,
        options: Options(
          responseType: ResponseType.stream,
          headers: {'Accept': 'text/event-stream'},
        ),
      );
    } on DioException catch (e) {
      throw _mapError(e);
    }

    var buffer = '';
    await for (final chunk in response.data!.stream) {
      buffer += utf8.decode(chunk, allowMalformed: true);
      // SSE frames are separated by a blank line.
      var sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        final frame = buffer.substring(0, sep);
        buffer = buffer.substring(sep + 2);
        final parsed = _parseFrame(frame);
        if (parsed != null) yield parsed;
        sep = buffer.indexOf('\n\n');
      }
    }
  }

  (String, Map<String, dynamic>)? _parseFrame(String frame) {
    String? event;
    final dataLines = <String>[];
    for (final line in frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.add(line.substring(5).trimLeft());
      }
    }
    if (event == null || dataLines.isEmpty) return null;
    try {
      final decoded = jsonDecode(dataLines.join('\n'));
      return (event, decoded is Map<String, dynamic> ? decoded : {'value': decoded});
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic>? _cleanQuery(Map<String, dynamic>? query) {
    if (query == null) return null;
    final cleaned = <String, dynamic>{};
    for (final entry in query.entries) {
      if (entry.value != null) cleaned[entry.key] = entry.value;
    }
    return cleaned;
  }

  Map<String, dynamic> _asMap(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data == null) return const {};
    return {'value': data};
  }

  Future<Response<dynamic>> _run(Future<Response<dynamic>> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  ApiException _mapError(DioException e) {
    final response = e.response;
    if (response == null) {
      final isTimeout =
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.sendTimeout;
      return ApiException(
        code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: e.message ?? 'Network error',
      );
    }

    final data = response.data;
    if (data is Map<String, dynamic> && data['error'] is Map<String, dynamic>) {
      final error = data['error'] as Map<String, dynamic>;
      final rawDetails = error['details'];
      final details = <ApiErrorDetail>[];
      if (rawDetails is List) {
        for (final d in rawDetails) {
          if (d is Map<String, dynamic>) details.add(ApiErrorDetail.fromJson(d));
        }
      }
      return ApiException(
        code: error['code']?.toString() ?? 'UNKNOWN',
        message: error['message']?.toString() ?? 'Request failed',
        details: details,
        statusCode: response.statusCode,
      );
    }

    return ApiException(
      code: 'UNKNOWN',
      message: 'Request failed with status ${response.statusCode}',
      statusCode: response.statusCode,
    );
  }
}

typedef VoidCallback = void Function();
