import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';

/// Which branch of the app the signed-in user lives in.
///
/// The doctor and the front desk share several screens — the patient roll, the
/// care inbox, registration — but they live under different route prefixes, and
/// the router bounces anyone who strays into the other's tree.
///
/// Those shared screens used to push `/clinician/...` outright. For the doctor
/// that was correct and for staff it was a dead end: tapping a patient, or the
/// register button, or finishing a registration, all redirected straight back
/// to Today, and nothing said why. The screen looked broken because half its
/// destinations were in an area its own user is not allowed into.
///
/// So a screen that both roles use asks for the prefix rather than assuming
/// one. It is a function of who is signed in, which is exactly what the router
/// is deciding on.
String areaPrefix(WidgetRef ref) =>
    ref.read(authControllerProvider).user?.role == 'staff'
        ? '/staff'
        : '/clinician';
