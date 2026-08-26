# Release signing

Android records an APK's signature at install time and refuses any update that
carries a different one. The key below is therefore a **one-way commitment**:
the moment a build signed with it reaches a real phone, every future update has
to use the same file.

Lose it and there is no migration. Every installed user must uninstall — losing
their login, their glucose unit and theme, and every scheduled medicine
reminder on the device — before they can install again.

Back it up somewhere that will outlive this laptop.

---

## 1. Create the keystore (once, ever)

From `mobile/android/`:

```bash
keytool -genkeypair -v \
  -keystore medpin-release.jks \
  -storetype JKS \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias medpin
```

`keytool` ships with the JDK. If it is not on PATH, it is under
`<Android Studio>/jbr/bin/keytool`.

It asks for a password, then for a name, organisation and country. Those fields
are cosmetic — they are never shown to a patient — but the **password is not**.

`-validity 10000` is about 27 years. Shorter is a trap: a key that expires
strands every user exactly as losing it would.

## 2. Point the build at it

Create `mobile/android/key.properties`:

```properties
storePassword=<the password you chose>
keyPassword=<the same one, unless you set a separate key password>
keyAlias=medpin
storeFile=medpin-release.jks
```

`storeFile` is resolved relative to `mobile/android/`, so the plain filename is
right if the `.jks` sits beside this file.

Both `key.properties` and `*.jks` are gitignored. **Do not commit either**, and
do not paste the password into a chat, an issue or a commit message.

## 3. Back it up

Two things, together, and neither in this repository:

- `medpin-release.jks`
- the password

A password manager entry with the file attached is the usual answer. A copy on
one laptop is not a backup.

## 4. Verify before you ship

`android/app/build.gradle.kts` falls back to the debug key when
`key.properties` is missing, and prints a loud warning when it does. So the
check is simply that the warning is **absent**:

```bash
flutter build apk --release --split-per-abi \
  --target-platform android-arm,android-arm64 \
  --obfuscate --split-debug-info=build/symbols \
  --build-number=<n>
```

Then confirm what actually signed it:

```bash
# From the JDK, or <Android Studio>/jbr/bin/
keytool -printcert -jarfile build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
```

The owner line should be what you typed in step 1 — **not** `CN=Android Debug`.

Finally, install it **over** an existing build rather than onto a clean phone.
An update is the case that breaks; a fresh install always works.

---

## The website build

For a download page, build a **universal** APK rather than the per-ABI split:

```bash
flutter build apk --release \
  --obfuscate --split-debug-info=build/symbols \
  --build-number=<n>
```

One file, one `versionCode`, runs on every phone. It is roughly 8 MB larger
than a split slice, which is the right trade when the alternative is detecting
the visitor's CPU architecture in a web page.

Per-ABI splits also add an offset to each `versionCode` — arm64 `+2000`,
armeabi-v7a `+1000` — so the same release ships as two different numbers. That
is fine for the Play Store, which picks for the device, and a nuisance for a
site and an in-app update check, which have to compare one number.

Serve it over HTTPS as `application/vnd.android.package-archive`.

## Note on the existing installs

Every build handed out before this keystore existed was signed with the debug
key. Those installs **cannot** be updated by a properly signed build — the
first one will fail with:

```
INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match newer version
```

They have to uninstall once, and they lose local data in doing so. That is a
one-time cost and it only grows: the sooner the real key is in use, the fewer
people it touches.
