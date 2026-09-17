import '../../../core/capabilities/capabilities.dart';

/// Which navigation branches this person can see, in bar order.
///
/// ---- Why this is a function and not an `if` in the shell ---------------
///
/// `StatefulShellRoute.indexedStack` addresses its branches by index. Hiding
/// one does not renumber the rest — branch 3 is still branch 3 — so a bar
/// showing three items has to map its own 0,1,2 onto whichever branches those
/// are. Get that wrong and tapping More opens Today, which is the kind of bug
/// that looks like a routing problem for a day.
///
/// So the mapping is one list, computed once, and testable without a widget
/// tree. [barIndexFor] is its inverse and the two are checked against each
/// other rather than being written twice.
///
/// ---- Home · Today · Patients · More -------------------------------------
///
/// The bar was Home · Care · Nutrition · Profile: no tab for the day, the
/// patient roll hidden behind the word "Care", and the dietician's
/// conversations promoted to a top-level tab of the doctor's app. Nutrition is
/// now reached from the home's nutrition card, where the practice has somebody
/// answering in it — see `NutritionCard` and the route at /clinician/nutrition.
///
/// ---- What varies, and why none of it is a role name ---------------------
///
///   Today     when this person's home is made of the day — the server put
///             TODAYS_CLINIC on it. The bench and a practice manager's
///             screen have no day, and a diary tab for them is a list of
///             somebody else's work. Before the answer arrives, shown.
///   Patients  when they may read patients at all (VIEW_PATIENT). A practice
///             manager's preset withholds it and the roll refused them with
///             an error; a tab that can only fail is not a tab.
///
/// Home and More are never hidden: a bar that can empty itself is a bar
/// somebody can be stranded in.
const homeBranch = 0;
const todayBranch = 1;
const patientsBranch = 2;
const moreBranch = 3;

List<int> visibleBranches(Capabilities caps) {
  final ui = caps.ui;
  return <int>[
    homeBranch,
    if (ui == null || ui.widgets.contains('TODAYS_CLINIC')) todayBranch,
    if (caps.can(Perm.viewPatient)) patientsBranch,
    moreBranch,
  ];
}

/// Where a branch sits in the bar, or null when the bar is not showing it.
///
/// Null is the case that matters: somebody standing on Today when their home
/// stops having a day is on a branch with no tab. The shell reads null as
/// "move them", rather than passing -1 to a widget that will range-check it
/// into the first item and leave them looking at Home labelled Today.
int? barIndexFor(List<int> visible, int branch) {
  final at = visible.indexOf(branch);
  return at < 0 ? null : at;
}
