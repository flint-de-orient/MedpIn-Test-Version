import 'package:medpin/shared/providers/core_providers.dart';
import 'package:medpin/shared/providers/theme_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<ProviderContainer> containerWith(Map<String, Object> initial) async {
    SharedPreferences.setMockInitialValues(initial);
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('ThemeController', () {
    test('opens light when nothing has been chosen', () async {
      // Light-first by decision, not by accident: the dark palette is
      // unfinished, and a patient whose phone is in dark mode should meet the
      // app the clinic showed them. Following the device is still selectable.
      final c = await containerWith({});
      expect(c.read(themeControllerProvider), ThemeMode.light);
    });

    test('restores a stored choice', () async {
      for (final (stored, expected) in [
        ('light', ThemeMode.light),
        ('dark', ThemeMode.dark),
        ('system', ThemeMode.system),
      ]) {
        final c = await containerWith({'akd_theme_mode': stored});
        expect(c.read(themeControllerProvider), expected, reason: stored);
      }
    });

    test('falls back to light for an unrecognised stored value', () async {
      // A value written by an older or newer build must not crash the app.
      final c = await containerWith({'akd_theme_mode': 'sepia'});
      expect(c.read(themeControllerProvider), ThemeMode.light);
    });

    test('persists each choice so it survives a restart', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final first = ProviderContainer(
        overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      );
      await first
          .read(themeControllerProvider.notifier)
          .setMode(ThemeMode.dark);
      expect(first.read(themeControllerProvider), ThemeMode.dark);
      first.dispose();

      // A fresh container over the same storage stands in for a relaunch.
      final second = ProviderContainer(
        overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      );
      addTearDown(second.dispose);
      expect(second.read(themeControllerProvider), ThemeMode.dark);
    });

    test('setting the current mode again is a no-op', () async {
      final c = await containerWith({});
      var notifications = 0;
      c.listen(themeControllerProvider, (_, _) => notifications++);

      // Light, because that is where an unset container starts — setting the
      // mode it is already in is the no-op being tested.
      await c.read(themeControllerProvider.notifier).setMode(ThemeMode.light);
      expect(notifications, 0, reason: 'no rebuild should be triggered');

      await c.read(themeControllerProvider.notifier).setMode(ThemeMode.dark);
      expect(notifications, 1);
    });
  });
}
