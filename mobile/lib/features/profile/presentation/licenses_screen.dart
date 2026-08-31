import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/disclosure_tile.dart';

/// The open-source licences, with a search box.
///
/// Flutter's own LicensePage is complete and correct and lists a hundred-odd
/// packages with no way to find one. That is fine until somebody actually needs
/// to check a particular licence — a compliance question, a legal review — at
/// which point scrolling a hundred entries is the only option it offers.
///
/// Written out rather than wrapped because LicensePage exposes no filter. It
/// reads the same LicenseRegistry, so the content is identical; only finding
/// something in it is different.
class LicensesScreen extends StatefulWidget {
  const LicensesScreen({super.key});

  @override
  State<LicensesScreen> createState() => _LicensesScreenState();
}

class _LicensesScreenState extends State<LicensesScreen> {
  final _search = TextEditingController();
  late final Future<List<_Package>> _packages = _load();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Every licence the app has registered, grouped by the package it belongs
  /// to. One package can carry several licences and one licence can cover
  /// several packages, which is why this is a fold rather than a map.
  Future<List<_Package>> _load() async {
    final byPackage = <String, List<String>>{};
    await for (final entry in LicenseRegistry.licenses) {
      final text = entry.paragraphs.map((p) => p.text).join('\n\n');
      for (final package in entry.packages) {
        byPackage.putIfAbsent(package, () => []).add(text);
      }
    }
    final list =
        byPackage.entries
            .map((e) => _Package(name: e.key, licences: e.value))
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Open-source licences'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(62),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.sm,
            ),
            child: TextField(
              controller: _search,
              onChanged: (v) => setState(() => _query = v),
              decoration: InputDecoration(
                hintText: 'Search packages…',
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: scheme.onSurfaceVariant,
                ),
                suffixIcon:
                    _query.isEmpty
                        ? null
                        : IconButton(
                          icon: const Icon(Icons.close_rounded),
                          onPressed:
                              () => setState(() {
                                _search.clear();
                                _query = '';
                              }),
                        ),
                filled: true,
                fillColor: scheme.surfaceContainerHigh.withValues(alpha: 0.55),
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(28),
                  borderSide: BorderSide.none,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(28),
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(28),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
        ),
      ),
      body: FutureBuilder<List<_Package>>(
        future: _packages,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final q = _query.trim().toLowerCase();
          final shown =
              q.isEmpty
                  ? snapshot.data!
                  : snapshot.data!
                      .where((p) => p.name.toLowerCase().contains(q))
                      .toList();

          if (shown.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.xl),
                child: Text(
                  'No package matches “${_query.trim()}”.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.only(bottom: AppSpacing.xl),
            itemCount: shown.length + 1,
            separatorBuilder:
                (_, _) => Divider(
                  height: 1,
                  color: scheme.outlineVariant.withValues(alpha: 0.5),
                ),
            itemBuilder: (context, i) {
              if (i == 0) {
                return Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    AppSpacing.sm,
                    AppSpacing.md,
                    AppSpacing.md,
                  ),
                  child: Text(
                    '${AppConfig.appName} v${AppConfig.appVersion} is built on '
                    '${snapshot.data!.length} open-source packages.',
                    style: TextStyle(
                      fontSize: 13.5,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                );
              }
              final p = shown[i - 1];
              return DisclosureTile(
                title: Text(
                  p.name,
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  p.licences.length == 1
                      ? '1 licence'
                      : '${p.licences.length} licences',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                childrenPadding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  0,
                  AppSpacing.md,
                  AppSpacing.md,
                ),
                children: [
                  for (final text in p.licences)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.md),
                      child: SelectableText(
                        text,
                        style: TextStyle(
                          fontSize: 12.5,
                          height: 1.45,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _Package {
  const _Package({required this.name, required this.licences});

  final String name;
  final List<String> licences;
}
