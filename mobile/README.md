# AKD Care — Mobile App

Patient app for Dr. Amit Kumar Dey, Consultant Physician & Diabetologist.
Flutter 3.29.3 / Dart 3.7.2, Riverpod + go_router + Dio, Material 3.

## Requirements

- Flutter 3.29.3 (Dart 3.7.2) on the `stable` channel.
- The backend from `../API_CONTRACT.md` running locally on port 4000.
- Android SDK + an emulator or device (or Chrome/Windows desktop — the app
  runs on all of them, but push-style flows like `tel:` links are most
  meaningful on Android).

## How to run

```bash
cd mobile
flutter pub get
flutter run
```

`flutter pub get` also regenerates the localization sources under
`lib/l10n/gen/` (via `generate: true` in `pubspec.yaml` + `l10n.yaml`) —
you should see `app_localizations*.dart` appear/refresh there.

## Pointing at the backend

All network config lives in `lib/core/config/app_config.dart`. By default:

| Run target                          | Base URL used                        |
|--------------------------------------|---------------------------------------|
| Android emulator                     | `http://10.0.2.2:4000/api/v1`         |
| Everything else (iOS sim, desktop, web, physical device) | `http://localhost:4000/api/v1` |

**Physical Android device over USB** — the app talks to `localhost`, so
tunnel it from the phone to your dev machine and tell the app to use
`localhost` instead of the emulator alias:

```bash
adb reverse tcp:4000 tcp:4000
flutter run --dart-define=USE_ADB_REVERSE=true
```

**Physical device over Wi-Fi, staging, or any other host** — override the
base URL directly, no code change needed:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.9:4000/api/v1
```

## What is built (deep, working)

- **Onboarding/auth** — splash → language picker (English/বাংলা/हिन्दी,
  first run only) → login/register. JWT pair in `flutter_secure_storage`;
  a Dio interceptor (`core/network/api_client.dart`) attaches the bearer
  token, and on a `401` calls `POST /auth/refresh`, retries the original
  request once, and — if refresh itself fails — clears storage and drops
  the user to `/login` via `go_router`'s `redirect`, reacting live through
  a `ChangeNotifier` bridged to the Riverpod auth state.
- **Home dashboard** — one `GET /patients/me/dashboard` call. Health-score
  ring (custom painter, `shared/widgets/health_ring.dart`), glucose
  sparkline (fl_chart), adherence tile, next-appointment card, open-alerts
  banner, recommendations list, reminder chips (foot/eye/HbA1c due).
  Pull-to-refresh; loading/error/empty states.
- **AI chat** — message list + composer + typing indicator while awaiting
  `POST /chat/message`. **Emergency card** (red, "Go to the nearest
  hospital immediately" + `tel:` Call-clinic button) renders whenever an
  assistant message's `urgency` is `"emergency"`; **urgent card** (amber)
  for `"urgent"`. Both are driven off the per-message `urgency` field so
  they render correctly whether the message just arrived or was reloaded
  from session history. Every assistant message carries the "AI-assisted
  guidance, not a diagnosis" footer. Citation chips render when `citations`
  is non-empty. Session drawer (`GET /chat/sessions`), new-chat, archive,
  and per-message "report this answer" (`POST /chat/messages/:id/flag`).
- **Glucose tracking** — log a reading (value/context/time/notes), list
  with colour-coded flags and swipe-to-delete, 30-day trend chart
  (`GET /glucose/trends`) with a shaded target band and average/min/max/
  est. HbA1c stat tiles.
- **Medications** — today's schedule (`GET /medications/schedule/today`),
  tap a pending slot to mark taken/skipped (skip asks for an optional
  reason), 30-day adherence ring (`GET /medications/adherence`).
- **Shell** — bottom nav: Home / Chat / Track (Glucose + Medications
  sub-tabs) / Care / Profile, via `StatefulShellRoute.indexedStack` so each
  tab keeps its own navigation stack. Profile has a language switcher that
  updates the whole app's locale immediately (and best-effort syncs it to
  `PATCH /auth/me`), plus logout.

## What is stubbed

Per the task brief, the **Care** tab is nav-only: five cards (Foot Care,
Eye Care, Appointments, Prescriptions, Lab Reports) each push a shared
`CarePlaceholderScreen` with a "coming next" empty state. No repositories,
models, or screens exist yet for `/foot`, `/eye`, `/appointments`,
`/prescriptions`, or `/labs` — intentionally out of scope for this pass.

HbA1c, Vitals, and Lifestyle logging (API_CONTRACT.md §3) are not built —
they weren't in this task's required scope either.

## Contract notes / places I had to make a judgment call

- **`ChatSession` shape** (`GET /chat/sessions`) — the contract says "paged
  `ChatSession`" without enumerating fields. `chat/domain/chat_session.dart`
  parses a best-effort set of plausible fields (title, last-message
  preview, last-activity, archived) defensively so an unexpected shape
  degrades gracefully instead of crashing the drawer.
- **Citations/triage are turn-level, not message-level** — `POST
  /chat/message` returns `citations`/`triage` as siblings of `reply`, not
  inside it. The app attaches them to the just-sent assistant message
  client-side; a message reloaded later via `GET
  /chat/sessions/:id/messages` won't carry citations, but it *will* still
  trigger the emergency/urgent card because `urgency` is a genuine
  per-message field in both endpoints.
- **Glucose trend target band** — `GET /glucose/trends` doesn't publish a
  target range. The chart shades the common 70–180 mg/dL band purely as a
  visual reference; each reading's actual colour/flag always comes from
  the server (`reading.flag`), never from this local band.
- **Clinic phone number** — no endpoint in the contract exposes clinic
  contact details, but the emergency/urgent cards need one for `tel:`.
  `AppConfig.clinicPhoneNumber` holds a placeholder — swap it for the real
  number before release.
- **`GlucoseTrends.daily[]` / `.distribution{}`** — parsed as loose
  `Map<String, dynamic>` since the contract doesn't detail their shape;
  not currently rendered (the fully-specified `series`/`stats` cover the
  chart and stat tiles).

No field-name, nesting, or enum-value mismatches were found for anything
the contract *does* fully specify — models were written directly against
`API_CONTRACT.md` and re-checked against it after implementation.

## Commands run

```bash
flutter create --org com.fdo --project-name medpin mobile
flutter pub get              # resolves deps + regenerates l10n
flutter analyze              # 0 issues
flutter test                 # 1/1 passed (smoke test)
flutter build apk --debug    # BUILD SUCCESSFUL — app-debug.apk produced
```

### A machine-specific hiccup, fixed along the way

`flutter analyze`/`dart analyze` initially failed on *every* file —
including Flutter's own freshly-generated scaffold code — with `Undefined
name 'override'`. That turned out to be a corrupted local Dart SDK cache
under `C:\flutter\bin\cache\dart-sdk`, unrelated to this project (verified
by reproducing it on a throwaway vanilla `flutter create` project before
touching this app's code). `flutter precache --force` re-fetched the SDK
artifacts and resolved it. Separately, `flutter build apk --debug` failed
because the installed Android NDK `26.3.11579264` was missing its
`build/cmake` directory; `android/app/build.gradle.kts` now pins
`ndkVersion = "27.0.12077973"` (the version every plugin already requests,
and the one actually complete on this machine) instead of
`flutter.ndkVersion`.

## Design tokens

`core/theme/` — primary teal `#0F766E`, danger `#DC2626`, warning
`#D97706`, success `#059669`, Material 3 seeded light/dark themes, no
custom `fontFamily` (platform default carries full Bengali/Devanagari
coverage), 16sp+ body text, 44px+ tap targets throughout.