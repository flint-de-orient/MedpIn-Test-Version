import 'dart:async';

/// "A message just arrived in this thread — go and read it."
///
/// The chat screens refetch on a two-second timer. That timer is a backstop,
/// not the mechanism, and treating it as the mechanism is what produced
/// "messages do not arrive in real time": every failure inside the poll is
/// swallowed on purpose (a poll that throws must cost one tick, not the
/// screen), so when it stops working there is no error, no banner and no way
/// to tell — the thread simply goes quiet while the server has the reply.
///
/// The server already pushes on every clinician and dietician reply. Foreground
/// FCM was raising a notification banner and nothing else, so the screen the
/// patient was looking at learned about the message from a tray notification it
/// could not read. This carries that push into the app.
///
/// Deliberately tiny: a broadcast of thread kinds, no payload beyond which
/// thread. The screens own what "refetch" means; this only says when.
class ChatPushSignal {
  ChatPushSignal._();

  static final ChatPushSignal instance = ChatPushSignal._();

  final _controller = StreamController<ChatThreadKind>.broadcast();

  /// Fires when a push says this kind of thread has a new message.
  Stream<ChatThreadKind> get stream => _controller.stream;

  /// Called from the push service. Unknown kinds are ignored rather than
  /// broadcast to everyone — a prescription notification must not make two
  /// chat screens refetch.
  void fromPushData(Map<String, dynamic> data) {
    switch (data['kind']?.toString()) {
      case 'clinician_reply':
        _controller.add(ChatThreadKind.care);
      case 'nutrition_message':
      case 'dietician_reply':
        _controller.add(ChatThreadKind.nutrition);
    }
  }

  /// For tests and for a screen that wants to nudge itself.
  void emit(ChatThreadKind kind) => _controller.add(kind);
}

/// Which conversation a push belongs to.
enum ChatThreadKind {
  /// The doctor/clinic thread on the patient's Doctor tab.
  care,

  /// The dietician thread on the patient's Dietician tab.
  nutrition,
}
