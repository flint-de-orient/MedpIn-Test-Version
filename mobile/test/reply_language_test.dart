import 'package:medpin/shared/providers/locale_provider.dart';
import 'package:flutter_test/flutter_test.dart';

/// Regression guard for the reported bug: an English UI, an English question,
/// and a Bengali answer — because the demo account was seeded `language: 'bn'`
/// and the chat screen sent the account language instead of the app's.
void main() {
  group('resolveReplyLanguage', () {
    test('the displayed app language wins over the account language', () {
      expect(
        resolveReplyLanguage(appLocale: 'en', accountLanguage: 'bn'),
        'en',
        reason: 'an English UI must not answer in Bengali',
      );
      expect(
        resolveReplyLanguage(appLocale: 'bn', accountLanguage: 'en'),
        'bn',
      );
      expect(
        resolveReplyLanguage(appLocale: 'hi', accountLanguage: 'en'),
        'hi',
      );
    });

    test('falls back to the account language before English', () {
      // The picker runs before login, so the locale can legitimately be null.
      expect(
        resolveReplyLanguage(appLocale: null, accountLanguage: 'bn'),
        'bn',
      );
      expect(
        resolveReplyLanguage(appLocale: null, accountLanguage: 'hi'),
        'hi',
      );
    });

    test('falls back to English when neither is usable', () {
      expect(resolveReplyLanguage(), 'en');
      expect(
        resolveReplyLanguage(appLocale: null, accountLanguage: null),
        'en',
      );
    });

    test(
      'ignores unsupported codes rather than passing them to the server',
      () {
        // The server enum is en|bn|hi; anything else is a 400.
        expect(
          resolveReplyLanguage(appLocale: 'fr', accountLanguage: 'bn'),
          'bn',
        );
        expect(
          resolveReplyLanguage(appLocale: 'ta', accountLanguage: 'zz'),
          'en',
        );
        expect(resolveReplyLanguage(appLocale: '', accountLanguage: ''), 'en');
      },
    );

    test('every returned value is one the server accepts', () {
      for (final a in [null, 'en', 'bn', 'hi', 'fr', '']) {
        for (final b in [null, 'en', 'bn', 'hi', 'zz', '']) {
          expect(
            supportedLanguageCodes,
            contains(resolveReplyLanguage(appLocale: a, accountLanguage: b)),
            reason:
                'appLocale=$a accountLanguage=$b produced an unsupported code',
          );
        }
      }
    });
  });
}
