/// Structured error surfaced to the UI layer for any non-2xx API response
/// or transport-level failure. Screens key off [code] to show localized,
/// friendly copy instead of raw server text.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.details = const [],
    this.detailsMap = const {},
    this.statusCode,
  });

  /// From the server's `{ "error": { code, message, details } }` envelope.
  ///
  /// `details` is a list of field problems on VALIDATION_ERROR and an object
  /// on some refusals (API_CONTRACT.md) — the question "which practice is this
  /// message for?" among them, which carries the triage verdict and the
  /// emergency instructions. Each shape lands in its own field; neither is
  /// dropped for being the other.
  factory ApiException.fromErrorBody(Map<String, dynamic> error, {int? statusCode}) {
    final rawDetails = error['details'];
    return ApiException(
      code: error['code']?.toString() ?? 'UNKNOWN',
      message: error['message']?.toString() ?? 'Request failed',
      details: [
        if (rawDetails is List)
          for (final d in rawDetails)
            if (d is Map<String, dynamic>) ApiErrorDetail.fromJson(d),
      ],
      detailsMap: rawDetails is Map<String, dynamic> ? rawDetails : const {},
      statusCode: statusCode,
    );
  }

  /// One of the backend's documented error codes (e.g. `VALIDATION_ERROR`),
  /// or a client-side synthetic code such as `NETWORK_ERROR`/`UNKNOWN`.
  final String code;

  /// Raw message from the server (or a client-generated fallback). Prefer
  /// mapping [code] to a localized string in the UI rather than showing
  /// this directly to patients.
  final String message;

  /// Field-level validation problems, when the server sent any.
  final List<ApiErrorDetail> details;

  /// The server's `details` when it sent an object rather than a list.
  final Map<String, dynamic> detailsMap;

  final int? statusCode;

  bool get isUnauthorized => code == 'UNAUTHORIZED' || statusCode == 401;
  bool get isNetworkError => code == 'NETWORK_ERROR';

  @override
  String toString() => 'ApiException($code, $message)';
}

class ApiErrorDetail {
  const ApiErrorDetail({required this.path, required this.message});

  final String path;
  final String message;

  factory ApiErrorDetail.fromJson(Map<String, dynamic> json) {
    return ApiErrorDetail(
      path: json['path']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
    );
  }
}
