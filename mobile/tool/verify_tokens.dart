// Fails when UI code invents a value instead of taking one from the tokens.
//
// A design system that is merely documented drifts back within a fortnight —
// the "just this once, 13px" is always reasonable in the moment. This makes it
// cost something: run it in CI, or before a release, and off-scale values stop
// being a matter of discipline.
//
//   dart run tool/verify_tokens.dart            # report and fail on violations
//   dart run tool/verify_tokens.dart --summary  # counts only, never fails
//   dart run tool/verify_tokens.dart --max=570  # fail only above a ceiling
//
// The ceiling is the ratchet, and it is how this gets run at all. Failing
// outright on an existing 570 would block every release, so the release script
// pins today's count and fails anything above it: the debt cannot grow, and
// every file cleaned lowers the bar behind it. Lower the number in
// build_release.sh whenever the count drops.
//
// Deliberately a lint over source text rather than an analyzer plugin: it needs
// no package, no analysis server, and it reads in one sitting.

import 'dart:io';

/// Files allowed to hold raw values — the token definitions themselves.
const _exempt = <String>[
  'lib/core/theme/tokens.dart',
  'lib/core/theme/app_colors.dart',
  'lib/core/theme/app_theme.dart',
  'lib/core/theme/app_spacing.dart',
  'lib/core/theme/app_depth.dart',
  // The hero band. It holds the one figure in the app deliberately off the
  // type scale — a screen's subject that is merely one step larger than a
  // heading does not read as a subject. Exempt by name so the exception is a
  // decision recorded here, not a value that slipped past.
  'lib/shared/widgets/hero_band.dart',
];

/// The 4px grid. 0 is always fine; 2 is allowed only as a border width, which
/// is matched separately and never as spacing.
const _grid = <int>{0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96};

/// The type scale from T. Anything else is a size someone eyeballed.
const _typeScale = <num>{12, 14, 16, 20, 32};

class Violation {
  Violation(this.file, this.line, this.rule, this.text);
  final String file;
  final int line;
  final String rule;
  final String text;
}

void main(List<String> args) {
  final summaryOnly = args.contains('--summary');
  final maxArg = args.firstWhere((a) => a.startsWith('--max='), orElse: () => '');
  final ceiling = maxArg.isEmpty ? null : int.tryParse(maxArg.substring(6));
  final root = Directory('lib');
  if (!root.existsSync()) {
    stderr.writeln('run me from the mobile/ directory');
    exit(2);
  }

  final violations = <Violation>[];

  for (final entity in root.listSync(recursive: true)) {
    if (entity is! File || !entity.path.endsWith('.dart')) continue;
    final rel = entity.path.replaceAll(r'\', '/');
    if (_exempt.any(rel.endsWith)) continue;
    if (rel.endsWith('.g.dart') || rel.contains('/l10n/gen/')) continue;

    final lines = entity.readAsLinesSync();
    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      final trimmed = line.trimLeft();
      if (trimmed.startsWith('//') || trimmed.startsWith('///')) continue;

      void flag(String rule) =>
          violations.add(Violation(rel, i + 1, rule, trimmed));

      // Off-scale type.
      for (final m in RegExp(r'fontSize:\s*([0-9.]+)').allMatches(line)) {
        final v = num.tryParse(m.group(1)!);
        if (v != null && !_typeScale.contains(v)) flag('type');
      }

      // Off-grid spacing.
      final spacing = RegExp(
        r'(?:EdgeInsets\.(?:all|symmetric|only|fromLTRB)\(|'
        r'SizedBox\(\s*(?:width|height):\s*|'
        r'(?:horizontal|vertical|left|top|right|bottom|spacing|runSpacing|gap):\s*)'
        r'([0-9]+(?:\.[0-9]+)?)',
      );
      for (final m in spacing.allMatches(line)) {
        final v = num.tryParse(m.group(1)!);
        if (v != null && (v != v.round() || !_grid.contains(v.round()))) {
          flag('spacing');
        }
      }

      // Colours mixed straight into a widget.
      if (RegExp(r'Color\(0x[0-9a-fA-F]{6,8}\)').hasMatch(line)) {
        flag('colour');
      }

      // A radius that is not one of the three.
      for (final m
          in RegExp(r'Radius\.circular\(\s*([0-9.]+)').allMatches(line)) {
        final v = num.tryParse(m.group(1)!);
        if (v != null && ![12, 16, 20, 999].contains(v)) flag('radius');
      }

      // Black shadows — the harsh-elevation tell.
      if (RegExp(r'BoxShadow\(').hasMatch(line) &&
          RegExp(r'Colors\.black').hasMatch(line)) {
        flag('shadow');
      }
    }
  }

  final byRule = <String, int>{};
  for (final v in violations) {
    byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  }

  if (violations.isEmpty) {
    stdout.writeln('tokens: clean — every value comes from T');
    return;
  }

  if (ceiling != null) {
    final over = violations.length - ceiling;
    if (over > 0) {
      stderr.writeln(
        'tokens: ${violations.length} violations, $over above the ceiling of '
        '$ceiling. Take the new values from T, or raise the ceiling in '
        'build_release.sh and say why.',
      );
      exit(1);
    }
    stdout.writeln(
      'tokens: ${violations.length} violations, within the ceiling of $ceiling'
      '${violations.length < ceiling ? ' — lower it to ${violations.length}' : ''}',
    );
    return;
  }

  if (!summaryOnly) {
    final byFile = <String, List<Violation>>{};
    for (final v in violations) {
      byFile.putIfAbsent(v.file, () => []).add(v);
    }
    final worst = byFile.entries.toList()
      ..sort((a, b) => b.value.length.compareTo(a.value.length));
    for (final e in worst.take(12)) {
      stdout.writeln('\n${e.key}  (${e.value.length})');
      for (final v in e.value.take(4)) {
        final snippet =
            v.text.length > 78 ? '${v.text.substring(0, 78)}…' : v.text;
        stdout.writeln('  ${v.line}: [${v.rule}] $snippet');
      }
      if (e.value.length > 4) {
        stdout.writeln('  … ${e.value.length - 4} more');
      }
    }
    if (worst.length > 12) {
      stdout.writeln('\n… and ${worst.length - 12} more files');
    }
  }

  final summary =
      byRule.entries.map((e) => '${e.value} ${e.key}').join(' · ');
  stdout.writeln('\ntokens: ${violations.length} violations — $summary');
  stdout.writeln('across ${violations.map((v) => v.file).toSet().length} files');

  if (!summaryOnly) exit(1);
}
