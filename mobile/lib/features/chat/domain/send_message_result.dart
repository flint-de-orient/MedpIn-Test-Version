import 'chat_alert.dart';
import 'chat_message.dart';
import 'citation.dart';
import 'triage.dart';

/// Full response of `POST /chat/message` (API_CONTRACT.md §2) — the core
/// endpoint of the app.
class SendMessageResult {
  const SendMessageResult({
    required this.sessionId,
    required this.userMessage,
    this.reply,
    required this.triage,
    required this.alert,
    required this.citations,
  });

  final String sessionId;
  final ChatMessage userMessage;

  /// Null when the assistant deliberately stayed quiet — a clinician is
  /// holding this conversation, or has switched it off for this thread. The
  /// patient's own message still came back; there is simply no answer yet,
  /// and a person is writing one.
  final ChatMessage? reply;
  final Triage triage;
  final ChatAlert? alert;
  final List<Citation> citations;

  factory SendMessageResult.fromJson(Map<String, dynamic> json) {
    final citations =
        (json['citations'] as List<dynamic>? ?? const [])
            .map((e) => Citation.fromJson(e as Map<String, dynamic>))
            .toList();
    final triage = Triage.fromJson(
      json['triage'] as Map<String, dynamic>? ?? const {},
    );
    return SendMessageResult(
      sessionId: json['sessionId']?.toString() ?? '',
      userMessage: ChatMessage.fromJson(
        json['userMessage'] as Map<String, dynamic>,
      ),
      reply:
          json['reply'] == null
              ? null
              : ChatMessage.fromJson(
                json['reply'] as Map<String, dynamic>,
              ).copyWith(citations: citations, triage: triage),
      triage: triage,
      alert:
          json['alert'] == null
              ? null
              : ChatAlert.fromJson(json['alert'] as Map<String, dynamic>),
      citations: citations,
    );
  }
}
