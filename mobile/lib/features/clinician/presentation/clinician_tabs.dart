import '../../../core/capabilities/capabilities.dart';

/// Which navigation branches this practice can see, in bar order.
///
/// ---- Why this is a function and not an `if` in the shell ---------------
///
/// `StatefulShellRoute.indexedStack` addresses its branches by index. Hiding
/// one does not renumber the rest — branch 3 is still branch 3 — so a bar
/// showing three items has to map its own 0,1,2 onto whichever branches those
/// are. Get that wrong and tapping Profile opens Nutrition, which is the kind
/// of bug that looks like a routing problem for a day.
///
/// So the mapping is one list, computed once, and testable without a widget
/// tree. [barIndexFor] is its inverse and the two are checked against each
/// other rather than being written twice.
///
/// ---- What actually varies ----------------------------------------------
///
/// Home, Care and Profile are the app. Nutrition is the doctor's window onto
/// the dietician↔patient conversations, and those exist when something can
/// answer in them — which is two things, not one:
///
///   the nutrition assistant, which is `AI_ASSISTANT`
///   a dietician, which is a fact about the roster
///
/// Either is enough. Gating on the capability alone hid the tab from a practice
/// that had hired somebody to work in it, and `/team` allows hiring a dietician
/// at any practice type — so a diagnostic centre with one on the payroll had a
/// nutrition stream it could not see. That is not a future case to handle when
/// it arises; it is a combination the app already permits anybody to create.
const _home = 0;
const _care = 1;
const _nutrition = 2;
const _profile = 3;

/// Specialties whose doctors see Nutrition only when somebody writes diet plans.
///
/// The nutrition stream is a diabetes clinic's daily work, and the assistant
/// alone put the tab in front of every cardiologist and general physician. A
/// heart or general clinic that employs a dietician still gets it.
const _nutritionOnlyWithDietician = {'cardiology', 'general_physician'};

List<int> visibleBranches(Capabilities caps) {
  final nutrition =
      _nutritionOnlyWithDietician.contains(caps.ui?.specialty)
          ? caps.hasDietician
          : caps.has(Cap.aiAssistant) || caps.hasDietician;
  return <int>[
    _home,
    _care,
    if (nutrition) _nutrition,
    _profile,
  ];
}

/// Where a branch sits in the bar, or null when the bar is not showing it.
///
/// Null is the case that matters: somebody standing on Nutrition when the
/// capability goes away is on a branch with no tab. The shell reads null as
/// "move them", rather than passing -1 to a widget that will range-check it
/// into the first item and leave them looking at Home labelled Nutrition.
int? barIndexFor(List<int> visible, int branch) {
  final at = visible.indexOf(branch);
  return at < 0 ? null : at;
}
