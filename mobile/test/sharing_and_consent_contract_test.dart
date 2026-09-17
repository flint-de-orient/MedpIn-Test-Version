import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/patient_registration.dart';
import 'package:medpin/features/feedback/data/feedback_repository.dart';
import 'package:medpin/features/sharing/data/sharing_repository.dart';

/// The words and shapes the app and the server have to agree on, for sharing,
/// desk consent and feedback.
///
/// Two languages, no compiler between them. A category the app cannot name is
/// one a patient would be asked to share without being told what it is; a
/// desk answer sent as "no" when nobody asked is a decision recorded for a
/// patient who never made it.
void main() {
  group('the categories a patient shares', () {
    test('are exactly the server’s, and every one has words', () {
      final model = File('../backend/src/models/ShareGrant.js').readAsStringSync();
      final block = model.substring(
        model.indexOf('export const SHARE_CATEGORY'),
        model.indexOf('});', model.indexOf('export const SHARE_CATEGORY')),
      );
      final server = RegExp(r":\s*'([a-z_]+)'").allMatches(block).map((m) => m.group(1)!).toSet();

      expect(server, isNotEmpty, reason: 'the server list was not found');
      expect(ShareCategory.all.toSet(), server);
      for (final c in ShareCategory.all) {
        expect(ShareCategory.label(c), isNot(c), reason: '$c has no words');
      }
    });

    test('own logs and history are the server’s groupings, and do not overlap', () {
      final model = File('../backend/src/models/ShareGrant.js').readAsStringSync();
      Set<String> group(String name) {
        final at = model.indexOf('export const $name');
        final block = model.substring(at, model.indexOf(']);', at));
        final names = RegExp(r'SHARE_CATEGORY\.([A-Z_]+)').allMatches(block).map((m) => m.group(1)!.toLowerCase());
        return names.toSet();
      }

      expect(ShareCategory.ownLogs.toSet(), group('OWN_LOG_CATEGORIES'));
      expect(ShareCategory.history.toSet(), group('HISTORY_CATEGORIES'));
      expect(ShareCategory.ownLogs.toSet().intersection(ShareCategory.history.toSet()), isEmpty);
    });

    test('a sentence reads as one', () {
      expect(ShareCategory.sentence(['prescriptions']), 'Prescriptions');
      expect(ShareCategory.sentence(['prescriptions', 'ecg', 'notes']), 'Prescriptions, ECGs and Clinical notes');
      expect(ShareCategory.sentence(const []), '');
    });
  });

  group('the desk’s answers go with the code', () {
    test('not asked sends only the code, so nothing is recorded for the patient', () {
      expect(ConsentShareAnswers.notAsked.confirmBody('123456'), {'code': '123456'});
    });

    test('asked sends both answers, a no included', () {
      const answers = ConsentShareAnswers(asked: true, ownLogs: true);
      expect(answers.confirmBody('123456'), {
        'code': '123456',
        'share': {'ownLogs': true, 'history': false},
      });
    });

    test('the confirmation names the patient and says what is not shared', () {
      final c = EnrolmentConfirmation.fromJson({
        'patient': {'id': 'p1', 'name': 'Meera'},
        'sharing': {'notShared': ['prescriptions', 'notes'], 'ownLogsShared': true, 'historyShared': false},
      });
      expect(c.patientId, 'p1');
      expect(c.patientName, 'Meera');
      expect(c.notShared, ['prescriptions', 'notes']);
      expect(c.sharingSummary, contains('not their earlier history'));
    });
  });

  group('nothing about an account before consent', () {
    test('a pending registration carries no id, and the name the desk typed', () {
      final r = PatientRegistration.fromJson({
        'name': 'Typed At The Desk',
        'phone': '+919800000001',
        'existing': true,
        'enrollmentId': 'e1',
        'consentRequired': true,
        'message': 'This number already has a MedPin account.',
      });
      expect(r.id, isEmpty);
      expect(r.name, 'Typed At The Desk');
      expect(r.isEnrolledNow, isFalse);
    });

    test('a waiting request from before the desk’s words were kept shows the number, or says so', () {
      final withNumber = PendingEnrolment.fromJson({'id': 'e1', 'name': null, 'phone': '+919800000001'});
      expect(withNumber.label, '+919800000001');

      final bare = PendingEnrolment.fromJson({'id': 'e2'});
      expect(bare.label, 'Name not recorded');
    });
  });

  group('feedback says where it went', () {
    test('a clinic subject names its practice; the app names none', () {
      expect(feedbackBody(about: 'clinic', practiceId: 'pr1', message: ' Long wait '), {
        'about': 'clinic',
        'practiceId': 'pr1',
        'message': 'Long wait',
      });
      expect(feedbackBody(about: 'app', practiceId: 'pr1', patientId: 'x', rating: 2), {'about': 'app', 'rating': 2});
    });

    test('each destination is said in words, and never "the clinic received this" for MedPin', () {
      MyFeedback item(String routedTo, {String? practice}) => MyFeedback.fromJson({
        'id': '1',
        'routedTo': routedTo,
        if (practice != null) 'practice': {'id': 'p', 'name': practice},
      });
      expect(item('practice', practice: 'Salt Lake').destination, 'Sent to Salt Lake');
      expect(item('platform').destination, 'Sent to the MedPin team');
      expect(item('private').destination, startsWith('Kept private'));
    });

    test('read state in the inbox is this reader’s own', () {
      final entry = InboxFeedback.fromJson({
        'id': 'f1',
        'reviewed': false,
        'reviewedBy': [
          {'name': 'Dr Sen', 'at': '2026-09-16T10:00:00Z'},
        ],
      });
      expect(entry.reviewedByMe, isFalse, reason: 'a colleague reading it marked it read for this person');
      expect(entry.reviewedBy.single.name, 'Dr Sen');
    });
  });
}
