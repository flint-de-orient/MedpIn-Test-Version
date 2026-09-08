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
/// answer in them — the nutrition assistant, which is `AI_ASSISTANT`.
///
/// A practice with a dietician employed but no assistant capability would keep
/// the tab hidden, which is wrong in principle and true of nothing today: the
/// only type without `AI_ASSISTANT` is a diagnostic centre, and none exists.
/// When one does, this reads the roster as well and the change is here.
const _home = 0;
const _care = 1;
const _nutrition = 2;
const _profile = 3;

List<int> visibleBranches(Capabilities caps) {
  return <int>[
    _home,
    _care,
    if (caps.has(Cap.aiAssistant)) _nutrition,
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
