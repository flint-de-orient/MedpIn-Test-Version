import 'package:medpin/features/clinician/presentation/widgets/home_panel.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_preview/doctor_home_fixtures.dart';
import 'ui_preview/doctor_home_scenario.dart';
import 'ui_preview/preview_harness.dart';

/// The doctor's home, in every state it can be in — and what it must never say
/// in each.
///
/// The home used to have two states: data, or its empty state. A failed request
/// was drawn as "Nobody needs immediate attention" and "No open alerts" under a
/// header reading "Updated just now" beside a green dot; a practice with no
/// readings showed "0%"; a brand-new practice showed a row of zeros. Empty,
/// failed, out of date, not available and refused are different facts, and
/// these tests hold them apart.
void main() {
  setUpAll(loadPreviewFonts);

  final diabetology = doctorCaps(widgets: diabetologyWidgets, specialty: 'diabetology');

  /// Tall enough that every panel is built, not only the first screenful.
  Future<void> open(WidgetTester tester, HomeScenario scenario) async {
    usePhone(tester, height: 7000);
    await pumpDoctorHome(tester, scenario);
  }

  Finder textContaining(String s) => find.textContaining(s, findRichText: true);

  testWidgets('a normal day: who is booked, who is waiting for this doctor, who needs attention', (tester) async {
    await open(tester, HomeScenario(caps: diabetology));

    expect(find.text('13 booked', findRichText: true), findsOneWidget);
    expect(find.text('3 waiting', findRichText: true), findsOneWidget);
    // The colleague's patient waited longest, and is not whom this doctor
    // is offered to see.
    expect(find.text('Start consultation with Farida Begum'), findsOneWidget);
    expect(textContaining('Anjali Sen'), findsWidgets);
    expect(textContaining('for Dr. Ritu Sen'), findsOneWidget);

    expect(find.text('Needs attention'), findsOneWidget);
    expect(find.text('Critical'), findsWidgets);
    // No row of zeros. (The chart's axis says "0%"; a figure never does — see
    // the no-readings test.)
    expect(find.text('0'), findsNothing);

    await leaveHome(tester);
  });

  testWidgets('a brand-new practice says it has no patients, once, and offers to add one', (tester) async {
    await open(tester, HomeScenario(caps: diabetology, empty: true));

    expect(find.text('No patients yet'), findsOneWidget);
    expect(find.text('Nothing booked today.'), findsOneWidget);
    expect(find.text('Add your first patient'), findsOneWidget);
    // Nobody to consult, so no consultation is offered.
    expect(find.textContaining('Start consultation'), findsNothing);
    // The caseload panels step aside rather than each saying it again.
    for (final title in ['Needs attention', 'Blood sugar', 'HbA1c', 'Follow-ups', 'Glucose in range', 'Nutrition']) {
      expect(find.text(title), findsNothing, reason: title);
    }
    expect(textContaining('%'), findsNothing);

    await leaveHome(tester);
  });

  testWidgets('many appointments: four named, the rest counted', (tester) async {
    await open(tester, HomeScenario(caps: diabetology, appointments: () => packedDay(count: 36)));

    expect(find.text('36 booked', findRichText: true), findsOneWidget);
    expect(find.text('4 waiting', findRichText: true), findsOneWidget);
    expect(find.text('20 more later today'), findsOneWidget);
    expect(find.text('View all'), findsWidgets);

    await leaveHome(tester);
  });

  testWidgets('an urgent alert: the patient on the attention card, and one way to the alerts', (tester) async {
    await open(tester, HomeScenario(caps: diabetology));

    expect(textContaining('2 open alerts'), findsOneWidget);
    expect(find.text('3 open alerts'), findsOneWidget);
    // The calm sentence is not said while anybody needs attention.
    expect(textContaining('Nobody'), findsNothing);

    await leaveHome(tester);
  });

  testWidgets('an overdue follow-up is said as overdue, with when it was due', (tester) async {
    await open(tester, HomeScenario(caps: diabetology));

    expect(find.text('Overdue'), findsNWidgets(2));
    expect(textContaining('Was due'), findsNWidgets(2));
    expect(find.text('2 overdue', findRichText: true), findsOneWidget);

    await leaveHome(tester);
  });

  testWidgets('no readings is said in words, never as 0%', (tester) async {
    await open(
      tester,
      HomeScenario(
        caps: diabetology,
        glucose: noReadingsGlucose,
        analytics: (_) => emptyAnalytics(),
        attention: attentionCalm,
      ),
    );

    expect(find.text('Nobody logged a sugar reading in the last 14 days.'), findsOneWidget);
    expect(find.text('No glucose readings logged in the last 14 days.'), findsOneWidget);
    expect(textContaining('0%'), findsNothing);
    // Calm, with no red, and it says what it checked.
    expect(find.text('Nobody on the list is at high risk.'), findsOneWidget);

    await leaveHome(tester);
  });

  testWidgets('a network failure is never an all-clear', (tester) async {
    await open(tester, HomeScenario(caps: diabetology, all: Answer.failed));

    expect(find.text('Could not reach the server. Nothing below is current.'), findsOneWidget);
    expect(find.text('Could not load who needs attention.'), findsOneWidget);
    expect(find.text('Could not load today’s appointments.'), findsOneWidget);
    expect(find.text('Retry'), findsWidgets);

    for (final claim in ['Nobody', 'Nothing booked', 'No patients', 'None due', 'Updated']) {
      expect(textContaining(claim), findsNothing, reason: claim);
    }
    // Starting a consultation does not wait on the appointment list.
    expect(find.text('Start consultation'), findsOneWidget);

    await leaveHome(tester);
  });

  testWidgets('a refresh that fails keeps the figures, and says they are out of date', (tester) async {
    await open(tester, HomeScenario(caps: diabetology, all: Answer.stale));
    expect(textContaining('Updated'), findsOneWidget);
    expect(textContaining('Farida Begum'), findsWidgets);

    await refreshHome(tester);

    // The list is still there — not an error, not an empty state.
    expect(textContaining('Farida Begum'), findsWidgets);
    expect(find.text('13 booked', findRichText: true), findsOneWidget);
    expect(textContaining('Not updated since'), findsOneWidget);
    expect(find.text('Not refreshed. These are the last figures that loaded.'), findsWidgets);
    expect(textContaining('Could not load'), findsNothing);

    await leaveHome(tester);
  });

  testWidgets('loading says nothing about the day before it arrives', (tester) async {
    await open(tester, HomeScenario(caps: diabetology, all: Answer.loading));

    expect(find.byType(PanelLoading), findsWidgets);
    expect(find.text('Loading'), findsOneWidget);
    for (final claim in ['Nobody', 'Nothing booked', 'booked', 'Could not load', 'Updated']) {
      expect(textContaining(claim), findsNothing, reason: claim);
    }

    await leaveHome(tester);
  });

  testWidgets('a panel the server refuses says so, and offers no retry that cannot work', (tester) async {
    await open(
      tester,
      HomeScenario(
        caps: doctorCaps(widgets: physicianWidgets, specialty: 'general_physician'),
        only: const {'bp': Answer.denied},
      ),
    );

    expect(find.text('Your role at this practice does not include blood pressure readings.'), findsOneWidget);
    // Refused is not failed.
    expect(textContaining('Could not load'), findsNothing);
    // And only that panel: the rest of the home loaded.
    expect(find.text('Conditions'), findsOneWidget);
    expect(find.text('Type 2 diabetes'), findsOneWidget);

    await leaveHome(tester);
  });

  testWidgets('each specialty opens onto its own panels', (tester) async {
    // Panel titles, not any text: a lab report can be titled "HbA1c" on a
    // physician's home without it being the HbA1c panel.
    Finder panel(String title) =>
        find.descendant(of: find.byType(PanelHeading), matching: find.text(title));

    await open(tester, HomeScenario(caps: diabetology));
    expect(panel('Blood sugar'), findsOneWidget);
    expect(panel('HbA1c'), findsOneWidget);
    expect(panel('Blood pressure'), findsNothing);
    await leaveHome(tester);

    await open(
      tester,
      HomeScenario(caps: doctorCaps(widgets: physicianWidgets, specialty: 'general_physician')),
    );
    expect(panel('Blood pressure'), findsOneWidget);
    expect(panel('Conditions'), findsOneWidget);
    expect(panel('Recent lab reports'), findsOneWidget);
    expect(panel('HbA1c'), findsNothing);
    await leaveHome(tester);

    await open(tester, HomeScenario(caps: doctorCaps(widgets: cardiologyWidgets, specialty: 'cardiology')));
    expect(panel('ECGs'), findsOneWidget);
    expect(panel('Heart rate'), findsOneWidget);
    expect(panel('LDL cholesterol'), findsOneWidget);
    await leaveHome(tester);
  });

  testWidgets('the header names the practice and the doctor, never the product', (tester) async {
    await open(tester, HomeScenario(caps: diabetology));

    expect(find.text('Dr Dey’s Diabetes, Obesity & Metabolic Clinic'), findsOneWidget);
    expect(textContaining('Dr. Amit Kumar Dey · Consultant Diabetologist'), findsOneWidget);
    expect(find.text('AD'), findsWidgets);
    expect(find.text('D'), findsNothing);
    expect(textContaining('MedPin'), findsNothing);
    expect(textContaining('Doctor Panel'), findsNothing);

    await leaveHome(tester);
  });

  testWidgets('nutrition appears only where somebody answers in it', (tester) async {
    await open(
      tester,
      HomeScenario(
        caps: doctorCaps(
          widgets: diabetologyWidgets,
          hasDietician: false,
          capabilities: const {'PRESCRIPTION', 'ADVANCED_ANALYTICS'},
        ),
      ),
    );
    expect(find.text('Nutrition'), findsNothing);
    await leaveHome(tester);

    await open(tester, HomeScenario(caps: diabetology));
    expect(find.text('Nutrition'), findsOneWidget);
    await leaveHome(tester);
  });

  testWidgets('the tabs are Home, Today, Patients and More', (tester) async {
    await open(tester, HomeScenario(caps: diabetology));
    for (final tab in ['Home', 'Today', 'Patients', 'More']) {
      expect(find.text(tab), findsWidgets, reason: tab);
    }
    expect(find.text('Care'), findsNothing);
    expect(find.text('Profile'), findsNothing);
    await leaveHome(tester);
  });

  testWidgets('text at 1.3 lays out without clipping', (tester) async {
    usePhone(tester, height: 7000);
    await pumpDoctorHome(tester, HomeScenario(caps: diabetology), textScale: 1.3);
    expect(tester.takeException(), isNull);
    expect(find.text('Start consultation with Farida Begum'), findsOneWidget);
    await leaveHome(tester);
  });
}
