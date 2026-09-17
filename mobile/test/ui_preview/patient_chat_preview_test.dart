import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/features/chat/presentation/chat_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patient_preview_harness.dart';

/// The patient's conversation with their clinic: the assistant, the doctor and
/// the desk in one thread, a reply on its way, a send that failed, an empty
/// thread, and larger text.
void main() {
  setUpAll(loadPreviewFonts);

  testWidgets('chat — assistant, doctor and desk', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/chat',
      overrides: patientOverrides(),
      size: const Size(360, 1500),
    );
    await capture(tester, 'chat_thread');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('chat — waiting for a reply', (tester) async {
    final base = typicalChat();
    await pumpPatientApp(
      tester,
      location: '/chat',
      overrides: patientOverrides(
        chat: ChatState(
          sessionId: base.sessionId,
          messages: [
            ...base.messages,
            chatMsg(
              'c7',
              'user',
              'Can I eat mango?',
              at: DateTime.now(),
            ),
          ],
          isSending: true,
        ),
      ),
    );
    await capture(tester, 'chat_sending');
    await unmount(tester);
  });

  testWidgets('chat — a send that failed', (tester) async {
    final base = typicalChat();
    await pumpPatientApp(
      tester,
      location: '/chat',
      overrides: patientOverrides(
        chat: ChatState(
          sessionId: base.sessionId,
          messages: base.messages,
          error: const ApiException(
            code: 'NETWORK_ERROR',
            message: 'Could not send that message. Please try again.',
          ),
        ),
      ),
    );
    await capture(tester, 'chat_failed_send');
    await unmount(tester);
  });

  testWidgets('chat — nothing said yet', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/chat',
      overrides: patientOverrides(chat: const ChatState(sessionId: 's1')),
    );
    await capture(tester, 'chat_empty');
    await unmount(tester);
  });

  testWidgets('chat — text at 1.3', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/chat',
      overrides: patientOverrides(),
      textScale: kLargeTextScale,
      size: const Size(360, 1500),
    );
    await capture(tester, 'chat_text_1_3');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });
}
