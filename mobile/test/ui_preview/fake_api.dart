// The server's JSON, answered from memory.
//
// Some screens read a repository straight from initState, or a private
// provider that cannot be overridden by name. Faking the client underneath
// keeps those screens on their real repositories and real parsing, so a preview
// shows what the app would draw from what the server actually sends.
import 'package:medpin/core/network/api_client.dart';

typedef JsonRoute = Object? Function(String path, Map<String, dynamic>? query);

class FakeApi implements ApiClient {
  FakeApi(this.onGet);

  /// Answers a GET with a JSON map, or throws to stand for a failed request.
  final JsonRoute onGet;

  final posted = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final answer = onGet(path, query);
    if (answer is Future) return (await answer) as Map<String, dynamic>;
    return (answer as Map<String, dynamic>?) ?? const {};
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Map<String, String>? headers,
  }) async {
    posted.add(path);
    return const {};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, {Object? body, Map<String, String>? headers}) async =>
      const {};

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
