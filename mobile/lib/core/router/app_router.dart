import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/appointments/domain/clinic.dart';
import '../../features/clinician/domain/knowledge_chunk.dart';
import '../../features/auth/presentation/auth_controller.dart';
import 'area.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/doctor_password_login_screen.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/chat/presentation/chat_tab.dart';
import '../../features/chat/presentation/nutrition_chat_screen.dart';
import '../../features/medications/presentation/medications_screen.dart';
import '../../features/medications/presentation/dose_history_screen.dart';
import '../../features/prescriptions/presentation/prescriptions_screen.dart';
import '../../features/medications/presentation/reminder_times_screen.dart';
import '../../features/foodlog/presentation/food_log_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/labtests/presentation/lab_tests_screen.dart';
import '../../features/clinician/presentation/alerts_screen.dart';
import '../../features/clinician/presentation/appointments_admin_screen.dart';
import '../../features/clinician/presentation/clinic_edit_screen.dart';
import '../../features/clinician/presentation/clinics_screen.dart';
import '../../features/clinician/presentation/departments_screen.dart';
import '../../features/clinician/presentation/team_screen.dart';
import '../../features/clinician/presentation/chat_review_detail_screen.dart';
import '../../features/clinician/presentation/chat_review_screen.dart';
import '../../features/clinician/presentation/chat_summaries_screen.dart';
import '../../features/clinician/presentation/clinician_dashboard_screen.dart';
import '../../features/clinician/presentation/clinician_more_screen.dart';
import '../../features/clinician/presentation/clinician_shell.dart';
import '../../features/clinician/presentation/knowledge_edit_screen.dart';
import '../../features/clinician/presentation/export_screen.dart';
import '../../features/clinician/presentation/daily_report_screen.dart';
import '../../features/clinician/presentation/feedback_inbox_screen.dart';
import '../../features/clinician/presentation/knowledge_screen.dart';
import '../../features/clinician/presentation/patient_thread_screen.dart';
import '../../features/clinician/presentation/nutrition_inbox_screen.dart';
import '../../features/clinician/presentation/add_patient_screen.dart';
import '../../features/clinician/presentation/consult_screen.dart';
import '../../features/clinician/presentation/patients_screen.dart';
import '../../features/clinician/presentation/billing_screen.dart';
import '../../features/clinician/presentation/practice_screen.dart';
import '../../features/clinician/presentation/patient_profile_screen.dart';
import '../../features/clinician/presentation/prescription_list_screen.dart';
import '../../features/dietician/presentation/diet_plan_screen.dart';
import '../../features/dietician/presentation/dietician_dashboard_screen.dart';
import '../../features/dietician/presentation/dietician_patients_screen.dart';
import '../../features/dietician/presentation/dietician_patient_screen.dart';
import '../../features/dietician/presentation/dietician_profile_screen.dart';
import '../../features/dietician/presentation/dietician_chat_screen.dart';
import '../../features/dietician/presentation/dietician_shell.dart';
import '../../features/onboarding/presentation/language_picker_screen.dart';
import '../../features/onboarding/presentation/splash_screen.dart';
import '../../features/profile/presentation/edit_profile_screen.dart';
import '../../features/profile/presentation/health_details_screen.dart';
import '../../features/profile/presentation/feedback_screen.dart';
import '../../features/profile/presentation/my_feedback_screen.dart';
import '../../features/sharing/presentation/sharing_screen.dart';
import '../../features/sharing/presentation/sharing_history_screen.dart';
import '../../features/profile/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../shared/providers/locale_provider.dart';
import '../../features/staff/presentation/staff_profile_screen.dart';
import '../../features/staff/presentation/staff_today_screen.dart';
import '../../features/staff/presentation/staff_shell.dart';
import '../../features/appointments/presentation/book_appointment_screen.dart';
import '../../features/appointments/presentation/my_appointments_screen.dart';

/// Bridges Riverpod state changes into something [GoRouter]'s
/// `refreshListenable` can observe, so a login/logout or a first-time
/// language pick immediately re-runs [_redirect] without any manual
/// navigation calls from the screens themselves.
class _RouterRefreshNotifier extends ChangeNotifier {
  _RouterRefreshNotifier(Ref ref) {
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
    ref.listen(localeControllerProvider, (_, _) => notifyListeners());
  }
}

/// The root navigator, so an incoming-call dialog can be shown over whatever
/// screen is on top from outside the widget tree (a push message handler).
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Which area this person belongs in, or null for a patient.
///
/// This was three functions — `_isDoctor`, `_isStaff`, `_isDietician` — asked
/// in sequence, with the patient app as what happened when none of them
/// matched. That is fine while every role is named and silently wrong the
/// moment one is not: a lab technician would have signed in and landed on the
/// patient's Assistant tab.
///
/// The table in [areaForRole] names every role the server defines, and
/// `roles.test.js` fails if one is missing from it. A role that is genuinely
/// absent resolves to null here, which sends them to the patient app as
/// before — but now that is the answer for patients rather than the answer for
/// everybody the code forgot.
String? _areaOf(AuthState s) => areaForRole[s.user?.role ?? ''];

String? _redirect(Ref ref, GoRouterState state) {
  final authState = ref.read(authControllerProvider);
  final hasLanguage =
      ref.read(localeControllerProvider.notifier).hasChosenLanguage;
  final loc = state.matchedLocation;

  const splash = '/splash';
  const language = '/language';
  const login = '/login';
  const register = '/register';
  // Landing tabs after login. The patient app now opens on the Assistant and
  // the clinician app on Patients (the former Home/Dashboard tabs were removed).
  const home = '/home';
  // The clinician area's tab, named here because it is also the last resort
  // for an area whose home nobody declared. The other three live in
  // [homeForArea], beside the table that decides which area somebody is in.
  const clinicianHome = '/clinician/dashboard';

  // Everything under /login counts, not just /login itself. The doctor's
  // password screen is /login/password, and an exact-match check bounced an
  // unauthenticated caller straight back to /login — so the link looked like
  // it did nothing.
  final isAuthRoute =
      loc == register || loc == login || loc.startsWith('$login/');

  if (authState.status == AuthStatus.unknown) {
    return loc == splash ? null : splash;
  }

  if (!hasLanguage) {
    return loc == language ? null : language;
  }

  if (authState.status == AuthStatus.unauthenticated) {
    return isAuthRoute ? null : login;
  }

  /*
   * Authenticated. Each area is kept out of the others' tree.
   *
   * One lookup rather than a chain of role tests, so that somebody whose role
   * the app has not been taught about cannot arrive here by falling off the
   * end of it. The four landing tabs above are still named for readability;
   * [homeForArea] is what actually decides, and it lives beside the table that
   * decides the area.
   */
  final inClinicianArea = loc.startsWith('/clinician');
  final inDieticianArea = loc.startsWith('/dietician');

  final area = _areaOf(authState);
  if (area != null) {
    return loc.startsWith(area) ? null : (homeForArea[area] ?? clinicianHome);
  }

  // A patient must never linger in a clinician or dietician area.
  if (inClinicianArea || inDieticianArea) return home;
  if (loc == splash || loc == language || isAuthRoute) return home;
  return null;
}

final Provider<GoRouter> appRouterProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _RouterRefreshNotifier(ref);

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: refreshNotifier,
    redirect: (context, state) => _redirect(ref, state),
    routes: [
      // The patient's own appointments — bookings and pending requests.
      //
      // The screen existed and was reachable from nowhere: no route, no link.
      // A patient could see the next appointment on Home and had no way to see
      // the one after it, or to check whether last month's visit happened.
      // Not a tab, though: appointments are consulted a few times per visit,
      // not daily, and a sixth tab would spend most of its life empty.
      GoRoute(
        path: '/appointments',
        builder: (context, state) => const MyAppointmentsScreen(),
      ),
      // The patient's own booking flow: pick a free slot from the published
      // schedule, which confirms immediately.
      //
      // The screen has existed all along and no route pointed at it. The Book
      // button on the appointments screen pushed '/care/appointments/book',
      // there is no '/care' branch and no errorBuilder, so a patient tapping
      // Book got go_router's "page not found" — the one button in the app whose
      // whole job is getting them seen.
      GoRoute(
        path: '/appointments/book',
        builder: (context, state) => const BookAppointmentScreen(),
      ),
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/language',
        builder: (context, state) => const LanguagePickerScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      // Pushed from a quiet link on the login screen. Patients and dieticians
      // have no password at all, so this is not a second tab beside the code
      // form — it is somewhere only the doctor goes.
      GoRoute(
        path: '/login/password',
        builder: (context, state) => const DoctorPasswordLoginScreen(),
      ),

      // Clinical-alert triage, chat review and knowledge curation are pushed
      // over the clinician shell from several places, so they live at the root.
      GoRoute(
        path: '/clinician/alerts',
        builder: (context, state) => const AlertsScreen(),
      ),
      GoRoute(
        path: '/clinician/appointments',
        builder: (context, state) => const AppointmentsAdminScreen(),
      ),
      GoRoute(
        path: '/clinician/practice',
        builder: (context, state) => const PracticeScreen(),
      ),
      GoRoute(
        path: '/clinician/billing',
        builder: (context, state) => const BillingScreen(),
      ),
      GoRoute(
        path: '/clinician/clinics',
        builder: (context, state) => const ClinicsScreen(),
      ),
      GoRoute(
        path: '/clinician/departments',
        builder: (context, state) => const DepartmentsScreen(),
      ),
      GoRoute(
        path: '/clinician/clinics/new',
        builder: (context, state) => const ClinicEditScreen(),
      ),
      GoRoute(
        path: '/clinician/clinics/edit',
        builder:
            (context, state) =>
                ClinicEditScreen(clinic: state.extra as Clinic?),
      ),
      GoRoute(
        path: '/clinician/chat-review',
        // ?tab=nutrition opens straight on the nutrition threads, so the
        // dashboard's "N nutrition unread" lands on the messages it counted
        // rather than on the flagged queue.
        builder:
            (context, state) =>
                ChatReviewScreen(initialTab: state.uri.queryParameters['tab']),
      ),
      GoRoute(
        path: '/clinician/chat-review/:id',
        builder:
            (context, state) =>
                ChatReviewDetailScreen(sessionId: state.pathParameters['id']!),
      ),
      // The day's conversations, summarised. The evening digest opens here.
      GoRoute(
        path: '/clinician/chat-summaries',
        builder: (context, state) => const ChatSummariesScreen(),
      ),
      // One screen where there were two.
      //
      // Front desk and Clinic care each knew about one role, because the role
      // was in the URL — which is also why a practice could not add a doctor at
      // all. Role is a column now, so this is one list.
      //
      // The old paths redirect rather than 404: they are in the muscle memory
      // of the one clinic already using this, and a dead link is a worse
      // welcome than a screen with more on it than expected.
      GoRoute(
        path: '/clinician/team',
        builder: (context, state) => const TeamScreen(),
      ),
      GoRoute(
        path: '/clinician/staff',
        redirect: (context, state) => '/clinician/team',
      ),
      GoRoute(
        path: '/clinician/dieticians',
        redirect: (context, state) => '/clinician/team',
      ),
      GoRoute(
        path: '/clinician/feedback',
        builder: (context, state) => const FeedbackInboxScreen(),
      ),
      GoRoute(
        path: '/clinician/export',
        builder: (context, state) => const ExportScreen(),
      ),
      GoRoute(
        path: '/clinician/daily-report',
        builder: (context, state) => const DailyReportScreen(),
      ),
      GoRoute(
        path: '/clinician/knowledge',
        builder: (context, state) => const KnowledgeScreen(),
      ),
      GoRoute(
        path: '/clinician/knowledge/new',
        builder: (context, state) => const KnowledgeEditScreen(),
      ),
      GoRoute(
        path: '/clinician/knowledge/edit',
        builder:
            (context, state) =>
                KnowledgeEditScreen(chunk: state.extra as KnowledgeChunk?),
      ),
      // No '/clinician/messages': the Messages tab is the inbox, and a second
      // route by the same name pointed at the retired DirectMessage table —
      // the same word opening different data.
      // Messaging a patient opens their real conversation — the same thread the
      // patient reads on their Care Team screen — rather than a clinic-only
      // inbox holding a different half of the exchange.
      GoRoute(
        path: '/clinician/patients/:id/thread',
        builder:
            (context, state) => PatientThreadScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      // The patient's prescriptions, with per-document PDF download.
      GoRoute(
        path: '/clinician/patients/:id/prescriptions',
        builder:
            (context, state) => PrescriptionListScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      // The consultation flow: vitals → diagnosis → advice → prescription.
      GoRoute(
        path: '/clinician/patients/:id/consult',
        builder:
            (context, state) => ConsultScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      // Receptionist intake. Declared BEFORE the `:id` route so the static
      // `new` segment is matched as the form, not as a patient id.
      GoRoute(
        path: '/clinician/patients/new',
        builder: (context, state) => const AddPatientScreen(),
      ),
      // The patient profile: who they are, the prescribing form, and the
      // clinical record beneath it — one screen per patient. Top-level so it
      // opens as a full page from the chat thread instead of a blank scaffold
      // inside the shell.
      GoRoute(
        path: '/clinician/patients/:id',
        builder:
            (context, state) =>
                PatientProfileScreen(patientId: state.pathParameters['id']!),
      ),

      // Editing your own details is a form, not a place. Nested inside a shell
      // branch it kept the tab bar on screen, so a half-finished form could be
      // abandoned with one tap on a tab and no warning — and the bar sat under
      // the Save button, taking the space the keyboard needed. Pushed on top of
      // whichever tab you came from, Back returns you to it.
      GoRoute(
        path: '/dietician/profile/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/clinician/more/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),

      // ---- Dietician app ------------------------------------------------
      // A patient, their diet plan and the nutrition chat sit outside the shell:
      // they are pushed on top of whichever tab you came from, so going back
      // returns you to the dashboard or the list, whichever it was.
      GoRoute(
        path: '/dietician/patients/:id',
        builder:
            (context, state) => DieticianPatientScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      GoRoute(
        path: '/dietician/patients/:id/diet',
        builder:
            (context, state) => DietPlanScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      GoRoute(
        path: '/dietician/patients/:id/chat',
        builder:
            (context, state) => DieticianChatScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),

      // ---- The front desk ---------------------------------------------
      //
      // Staff had the doctor's four tabs. Their Home opened on Live Triage —
      // HbA1c and clinical alerts, answering "who needs a doctor", which is
      // not a question a receptionist should be deciding — and their Profile
      // offered his letterhead, professional details and digital signature.
      //
      // These four are the desk's actual work: the day and who is waiting on
      // an answer, the patient roll, the conversations, and the clinic's own
      // record.
      GoRoute(
        path: '/staff/patients/new',
        builder: (context, state) => const AddPatientScreen(),
      ),
      // The full diary, under the desk's own prefix.
      //
      // It is the same screen the doctor reaches at /clinician/appointments,
      // and it has to be mounted twice because the redirect above bounces a
      // staff account out of /clinician/* by design. Managing the day's
      // appointments — confirming, starting, completing, marking a no-show —
      // is the front desk's job before it is anybody else's, so Today's
      // "Manage queue" and "View calendar" had nowhere to lead until this
      // existed.
      GoRoute(
        path: '/staff/appointments',
        builder: (context, state) => const AppointmentsAdminScreen(),
      ),
      // What patients registered here have written about their care, under the
      // desk's own prefix for the same reason as the diary above: the desk
      // reads patients, is told when feedback arrives, and is bounced out of
      // /clinician/*.
      GoRoute(
        path: '/staff/feedback',
        builder: (context, state) => const FeedbackInboxScreen(),
      ),
      GoRoute(
        path: '/staff/profile/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/staff/clinics/new',
        builder: (context, state) => const ClinicEditScreen(),
      ),
      GoRoute(
        path: '/staff/clinics/:id',
        builder:
            (context, state) =>
                ClinicEditScreen(clinic: state.extra as Clinic?),
      ),
      // The desk opens a patient the same way the doctor does.
      //
      // There was no such route, so every path to a patient record — finishing
      // a registration, tapping a name — pushed `/clinician/patients/:id`,
      // which the redirect bounces staff straight out of. What the receptionist
      // got was a white screen and nothing saying why.
      //
      // The screen is safe to share: the server refuses prescribing and alert
      // resolution for staff whatever the app draws, and a front desk that
      // cannot look up the patient in front of it cannot do its job.
      GoRoute(
        path: '/staff/patients/:id',
        builder:
            (context, state) =>
                PatientProfileScreen(patientId: state.pathParameters['id']!),
      ),
      // Reading one is the desk's job — reprinting a prescription for a
      // patient who lost theirs is most of what a front desk is asked for.
      // Writing one is not, and the server refuses a POST from staff whatever
      // this app draws.
      GoRoute(
        path: '/staff/patients/:id/prescriptions',
        builder:
            (context, state) => PrescriptionListScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),
      GoRoute(
        path: '/staff/patients/:id/thread',
        builder:
            (context, state) => PatientThreadScreen(
              patientId: state.pathParameters['id']!,
              patientName: state.extra as String?,
            ),
      ),

      StatefulShellRoute.indexedStack(
        builder:
            (context, state, navigationShell) =>
                StaffShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/today',
                builder: (context, state) => const StaffTodayScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/patients',
                builder: (context, state) => const PatientsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/profile',
                builder: (context, state) => const StaffProfileScreen(),
              ),
            ],
          ),
        ],
      ),

      StatefulShellRoute.indexedStack(
        builder:
            (context, state, navigationShell) =>
                DieticianShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/dietician/dashboard',
                builder: (context, state) => const DieticianDashboardScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/dietician/patients',
                // ?filter=review|noplan|critical|high — the dashboard counts
                // link straight to the worklist they stand for, so tapping "3
                // reviews due" lands on those three rather than on everyone.
                builder:
                    (context, state) => DieticianPatientsScreen(
                      initialFilter: state.uri.queryParameters['filter'],
                    ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/dietician/profile',
                builder: (context, state) => const DieticianProfileScreen(),
              ),
            ],
          ),
        ],
      ),

      // ---- Patient app --------------------------------------------------
      // Three tabs: the AI/clinic Assistant, Medicines, and Profile.
      StatefulShellRoute.indexedStack(
        builder:
            (context, state, navigationShell) =>
                AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const HomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/chat',
                // ChatTab, not ChatScreen. It resolves to exactly the same
                // screen for a patient with one conversation — every patient
                // today — and shows a list the first time there is a choice.
                builder: (context, state) => const ChatTab(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/medications',
                builder: (context, state) => const MedicationsScreen(),
                routes: [
                  GoRoute(
                    path: 'reminders',
                    builder: (context, state) => const ReminderTimesScreen(),
                  ),
                  GoRoute(
                    path: 'history',
                    builder: (context, state) => const DoseHistoryScreen(),
                  ),
                  GoRoute(
                    path: 'prescriptions',
                    builder: (context, state) => const PrescriptionsScreen(),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              // The dietician conversation IS the food log: a photo sent here
              // becomes a log entry server-side. The old list lives on as a
              // history view pushed from inside it.
              GoRoute(
                path: '/food-log',
                builder: (context, state) => const NutritionChatScreen(),
                routes: [
                  GoRoute(
                    path: 'history',
                    builder: (context, state) => const FoodLogScreen(),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileScreen(),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (context, state) => const EditProfileScreen(),
                  ),
                  GoRoute(
                    path: 'health',
                    builder: (context, state) => const HealthDetailsScreen(),
                  ),
                  GoRoute(
                    path: 'notifications',
                    builder: (context, state) => const NotificationsScreen(),
                  ),
                  GoRoute(
                    path: 'tests',
                    builder: (context, state) => const LabTestsScreen(),
                  ),
                  GoRoute(
                    path: 'feedback',
                    builder: (context, state) => const FeedbackScreen(),
                    routes: [
                      // What was sent, where it went, and any reply.
                      GoRoute(
                        path: 'mine',
                        builder: (context, state) => const MyFeedbackScreen(),
                      ),
                    ],
                  ),
                  // "Who can see my records?", and what has happened to it.
                  GoRoute(
                    path: 'sharing',
                    builder: (context, state) => const SharingScreen(),
                    routes: [
                      GoRoute(
                        path: 'history',
                        builder: (context, state) => const SharingHistoryScreen(),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),

      // ---- Clinician app (doctor + staff) -------------------------------
      // Two tabs: Patients (where a patient is opened and prescribed for) and
      // Profile. Appointments, clinics and knowledge tools remain reachable from
      // the Profile hub's shortcuts.
      StatefulShellRoute.indexedStack(
        builder:
            (context, state, navigationShell) =>
                ClinicianShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/clinician/dashboard',
                builder: (context, state) => const ClinicianDashboardScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/clinician/patients',
                builder: (context, state) => const PatientsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/clinician/nutrition',
                builder: (context, state) => const NutritionInboxScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/clinician/more',
                builder: (context, state) => const ClinicianMoreScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
