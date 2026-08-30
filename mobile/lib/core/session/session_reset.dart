library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Throw away every cached answer that belonged to the previous session.
///
/// This exists because of a data leak, not an inconvenience. Signing out and
/// signing in as a different patient left the doctor thread showing the
/// previous patient's conversation and the Medicines tab showing their doses.
/// Neither `login` nor `logout` invalidated anything; both only set the auth
/// state, and every FutureProvider kept whatever it had last fetched.
///
/// `autoDispose` would normally have covered it — unmount the screen and the
/// provider goes. It did not, because all four shells are
/// `StatefulShellRoute.indexedStack`, which deliberately keeps every visited
/// tab alive so switching is instant. A provider inside a living tab is still
/// watched, so it never disposes, and it holds the old patient's data until its
/// next fetch happens to land.
///
/// ---- Why this enumerates rather than lists ---------------------------------
///
/// The obvious fix is to invalidate the providers somebody noticed were stale.
/// That fixes three screens and leaves the fourth to be discovered by a
/// patient. Invalidating the repositories does not work either: 49 providers
/// `watch` one and would cascade, but 40 `read` one and would not.
///
/// So it walks the container. Anything that exists is dropped, which means a
/// provider added next month is covered without anyone remembering this file.
/// The keep-list is the exception, and it is short on purpose.

/// The container the app is running on.
///
/// Set once at startup. A global is not the habit to get into, but the
/// alternative here is worse: `Ref` cannot reach its own container in Riverpod
/// 2, and `ProviderScope.containerOf` needs a BuildContext — which the auth
/// controller, where sign-in and sign-out actually happen, does not have.
ProviderContainer? _appContainer;

/// Called from main() with the container the app was launched on.
void registerSessionContainer(ProviderContainer container) {
  _appContainer = container;
}

/// Providers that must NOT be thrown away when the session changes.
///
/// Matched by name rather than identity, because this file must not import
/// every feature package to name their providers — a core utility depending on
/// all of them is a dependency cycle waiting to happen. Every entry is
/// something that has to survive a session change.
const _keep = <String>{
  // The session itself. Invalidating this mid-sign-in re-enters the code that
  // is calling this function.
  'authControllerProvider',
  // Chosen before anyone signs in, and still true after. Dropping the locale
  // would flip a Bengali reader's app to English on sign-out.
  'localeControllerProvider',
  'themeControllerProvider',
  'appLockProvider',
  // Infrastructure, not data — a token store, an HTTP client, the preferences
  // box. None holds a patient's anything, and recreating them mid-flight tears
  // the socket out from under the request that is signing somebody in.
  'sharedPreferencesProvider',
  'secureStorageProvider',
  'apiClientProvider',
  'imageAuthHeaderProvider',
  // The router holds `rootNavigatorKey`, a global GlobalKey. Recreating it
  // while the old one is still mounted throws "duplicate GlobalKey", and the
  // window for that is exactly the sign-out transition this runs in.
  //
  // It does not need recreating anyway. Signing out redirects to /login, which
  // is outside every shell, so GoRouter disposes the shells and their branch
  // navigators; signing in rebuilds them fresh. The tab stacks reset because
  // the shell is gone, not because the router was replaced.
  'appRouterProvider',
};

/// Drop every cached provider except the few that outlive a session.
///
/// Called on the way in as well as the way out. Out is the obvious one; in
/// matters just as much, because a container that was never signed out of — an
/// app resumed onto a different account, a token refresh that resolved to
/// another user — holds the same stale data with nobody having pressed
/// anything.
void resetSessionState() {
  final container = _appContainer;
  if (container == null) return;

  // Collected before invalidating, not during. Invalidation mutates the element
  // list, and iterating a collection while it is being rebuilt is how this
  // would fail intermittently in front of somebody rather than in a test.
  final origins = [
    for (final element in container.getAllProviderElements()) element.origin,
  ];

  for (final provider in origins) {
    final name = provider.name ?? provider.runtimeType.toString();
    if (_keep.any(name.contains)) continue;
    // `from` is the family a keyed provider was built from. Invalidating the
    // family clears every key at once, which is the point: a stale patientId
    // key is exactly the leak this is here to stop.
    container.invalidate(provider.from ?? provider);
  }
}
