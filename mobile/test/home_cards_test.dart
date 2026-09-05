import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/features/home/domain/care_summary.dart';

/// Which cards a patient's Home shows, and the household it belongs to.
///
/// The selective half of this is the interesting feature; the permissive half
/// is the one that matters today. Every patient on the live deployment has no
/// conditions recorded yet, so an empty card list must mean "show everything".
/// Read the other way it would blank the Home screen of the clinic that is
/// seeing patients this morning.
CareSummary summary({
  List<String> homeCards = const [],
  List<HouseholdMember> household = const [],
}) => CareSummary.fromJson({
  'profile': const <String, dynamic>{},
  'homeCards': homeCards,
  'people': household.map((m) => {
    'id': m.id,
    'name': m.name,
    'relationship': m.relationship,
    'isSelf': m.isSelf,
  }).toList(),
});

void main() {
  group('an empty card list shows everything', () {
    test('a patient with nothing recorded keeps their glucose chart', () {
      // The state of every patient on the live deployment right now.
      final care = summary();
      expect(care.shows('glucose'), isTrue);
      expect(care.shows('blood_pressure'), isTrue);
      expect(care.shows('anything_at_all'), isTrue);
    });
  });

  group('a card list is honoured once there is one', () {
    final care = summary(homeCards: const ['glucose', 'hba1c']);

    test('cards the conditions asked for are shown', () {
      expect(care.shows('glucose'), isTrue);
      expect(care.shows('hba1c'), isTrue);
    });

    test('cards they did not are not', () {
      // A patient with only asthma should not be shown a blood-sugar chart.
      expect(care.shows('blood_pressure'), isFalse);
      expect(care.shows('diet_plan'), isFalse);
    });
  });

  group('the switcher appears only when there is a choice', () {
    HouseholdMember member(String name, {bool isSelf = false, String rel = 'self'}) =>
        HouseholdMember(id: name, name: name, relationship: rel, isSelf: isSelf);

    test('one person is not a household', () {
      // A switcher above a single name answers a question nobody asked, and it
      // would appear on every screen in the clinic today.
      expect(summary(household: [member('Rahul', isSelf: true)]).isHousehold, isFalse);
    });

    test('none is not a household either', () {
      expect(summary().isHousehold, isFalse);
    });

    test('two or more is', () {
      final care = summary(household: [
        member('Priya', isSelf: true),
        member('Aarav', rel: 'child'),
      ]);
      expect(care.isHousehold, isTrue);
      expect(care.household.first.name, 'Priya');
    });
  });

  group('a condition reads as a person would say it', () {
    test('the type is shown when there is one', () {
      const c = PatientConditionSummary(
        key: 'diabetes',
        name: 'Diabetes',
        detail: {'type': 'type2'},
      );
      expect(c.label, 'Diabetes (Type 2)');
    });

    test('and the name alone when there is not', () {
      // "High blood pressure ()" would be the app showing its own plumbing.
      const c = PatientConditionSummary(key: 'hypertension', name: 'High blood pressure');
      expect(c.label, 'High blood pressure');
    });

    test('an unrecognised type is passed through, not swallowed', () {
      // A type the app has not been taught is still a fact a clinician
      // recorded, and hiding it would be worse than showing it raw.
      const c = PatientConditionSummary(
        key: 'diabetes',
        name: 'Diabetes',
        detail: {'type': 'mody'},
      );
      expect(c.label, 'Diabetes (mody)');
    });
  });
}
