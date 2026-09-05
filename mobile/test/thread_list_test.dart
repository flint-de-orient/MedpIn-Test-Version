import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/features/chat/domain/thread_group.dart';

/// Grouping conversations by practice, and the rule that matters most.
///
/// A patient with one practice and one thread must come out of this as one
/// thread with no list and no chooser — because that is what they have today
/// and nothing about their care changed. The list is what appears the first
/// time somebody sees a second doctor, not a new screen everybody gets.
ThreadList parse(Map<String, dynamic> json) => ThreadList.fromJson(json);

Map<String, dynamic> thread(String id, {String? department, bool hasAssistant = true, int count = 3}) => {
  'id': id,
  if (department != null) 'department': {'id': 'd-$id', 'key': department, 'name': department},
  'hasAssistant': hasAssistant,
  'messageCount': count,
  'highestUrgency': 'routine',
};

/// Named `practiceGroup`, not `group` — the latter is the test framework's,
/// and shadowing it turns every enclosing block into a call to this instead.
Map<String, dynamic> practiceGroup(String? practice, List<Map<String, dynamic>> threads) => {
  if (practice != null) 'practice': {'id': 'p', 'name': practice},
  'enrollment': practice == null ? null : 'e',
  'threads': threads,
};

void main() {
  group('one conversation renders as one conversation', () {
    test('a single thread needs no list', () {
      final list = parse({
        'groups': [practiceGroup('Dey Diabetes Clinic', [thread('t1')])],
      });
      expect(list.needsList, isFalse);
      expect(list.only?.id, 't1');
    });

    test('and an unlabelled group is still one thread', () {
      // Pre-migration: no enrolments, so nothing to group by. Precisely
      // today's screen.
      final list = parse({
        'groups': [practiceGroup(null, [thread('t1')])],
      });
      expect(list.needsList, isFalse);
      expect(list.groups.single.practiceName, isNull);
    });

    test('no conversations at all is not a list either', () {
      expect(parse({'groups': []}).needsList, isFalse);
      expect(parse({'groups': []}).only, isNull);
    });
  });

  group('a list appears when there is a choice', () {
    test('two practices', () {
      final list = parse({
        'groups': [
          practiceGroup('Dey Diabetes Clinic', [thread('t1')]),
          practiceGroup('Lake Town Heart Centre', [thread('t2')]),
        ],
      });
      expect(list.needsList, isTrue);
      expect(list.all.length, 2);
      expect(list.only, isNull);
    });

    test('or one practice with two departments', () {
      // The polyclinic case: one relationship, two specialties, two threads.
      final list = parse({
        'groups': [
          practiceGroup('City Polyclinic', [
            thread('t1', department: 'Cardiologist'),
            thread('t2', department: 'Dermatologist'),
          ]),
        ],
      });
      expect(list.needsList, isTrue);
      expect(list.all.map((t) => t.departmentName), ['Cardiologist', 'Dermatologist']);
    });
  });

  group('a thread says whose it is', () {
    test('the department when there is one', () {
      final t = ChatThread.fromJson(thread('t1', department: 'Cardiologist'));
      expect(t.labelWithin('City Polyclinic'), 'Cardiologist');
    });

    test('the practice when there is not', () {
      // A null department is the practice's general thread, which is what a
      // single-specialty clinic has and what every existing conversation is.
      final t = ChatThread.fromJson(thread('t1'));
      expect(t.labelWithin('Dey Diabetes Clinic'), 'Dey Diabetes Clinic');
    });

    test('and something sensible when it knows neither', () {
      final t = ChatThread.fromJson(thread('t1'));
      expect(t.labelWithin(null), 'Your care team');
    });
  });

  group('a department with no assistant says so', () {
    test('the flag survives the wire', () {
      final t = ChatThread.fromJson(thread('t1', department: 'Cardiologist', hasAssistant: false));
      expect(t.hasAssistant, isFalse);
    });

    test('and defaults to true, so a clinic without departments is unaffected', () {
      // Dr. Dey's thread has no department and every existing session is his
      // shape. Defaulting to false would silence the assistant that works.
      final t = ChatThread.fromJson({'id': 't1'});
      expect(t.hasAssistant, isTrue);
    });
  });
}
