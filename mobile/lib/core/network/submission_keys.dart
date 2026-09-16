import 'dart:convert';
import 'dart:math';

/// Names a clinical submission so that retrying it cannot write it twice.
///
/// ---- The failure ----------------------------------------------------------
///
/// A doctor finishes a consultation and taps Issue. On a clinic's connection
/// the request arrives, the vitals and the prescription are written, and the
/// answer is lost on the way back. The screen shows a timeout and the doctor
/// taps again — and without anything to tie the two attempts together the
/// server writes a second prescription and a second blood pressure.
///
/// ---- The rule -------------------------------------------------------------
///
/// One of these lives as long as a screen does. The key it gives for a request
/// is that screen's random nonce, the purpose, and a fingerprint of exactly
/// what is being sent:
///
///  * tapped again with nothing changed → the same key, and the server answers
///    with what the first attempt wrote;
///  * corrected and sent again → a new key, so the correction is recorded
///    rather than silently answered with the old values;
///  * the same consultation opened again tomorrow → a new screen, a new nonce.
///
/// The server refuses a key it has seen with different contents, so nothing
/// here needs to be secret — only stable while the content is, and different
/// when it is not.
class SubmissionKeys {
  SubmissionKeys({Random? random}) : _nonce = _hex(random ?? Random.secure(), 16);

  final String _nonce;

  /// The `Idempotency-Key` for sending [body] for [purpose] from this screen.
  ///
  /// Matches the server's `^[A-Za-z0-9._:-]{8,128}$`.
  String keyFor(String purpose, Object? body) {
    final canonical = _canonical(body);
    // Two 32-bit FNV-1a passes with different starting points: plenty to tell
    // one version of a form from the next, and exact on every platform —
    // arithmetic past 2^53 is not, on the web.
    final a = _fnv1a32(canonical, 0x811C9DC5);
    final b = _fnv1a32(canonical, 0x050C5D1F);
    return '$_nonce:$purpose:${_pad(a)}${_pad(b)}';
  }

  static String _pad(int v) => v.toRadixString(16).padLeft(8, '0');

  static String _hex(Random r, int bytes) =>
      List.generate(bytes, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();

  /// JSON with map keys in a fixed order, so building the same body in a
  /// different order is still the same request.
  static String _canonical(Object? value) {
    if (value is Map) {
      final keys = value.keys.map((k) => k.toString()).toList()..sort();
      return '{${keys.map((k) => '${jsonEncode(k)}:${_canonical(value[k])}').join(',')}}';
    }
    if (value is List) return '[${value.map(_canonical).join(',')}]';
    if (value is DateTime) return jsonEncode(value.toIso8601String());
    return jsonEncode(value);
  }

  /// 32-bit FNV-1a over the UTF-8 bytes.
  ///
  /// The prime is 2^24 + 403, so the multiply is written as a shift and a small
  /// product. Neither side reaches 2^53, which keeps the result identical on
  /// the web, where integers are doubles.
  static int _fnv1a32(String input, int seed) {
    var h = seed;
    for (final byte in utf8.encode(input)) {
      h ^= byte;
      h = ((h * 403) + ((h << 24) & 0xFFFFFFFF)) & 0xFFFFFFFF;
    }
    return h;
  }
}
