import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/sharing_repository.dart';

/// Everything that has happened to who can see the record, newest first.
///
/// Connections and withdrawals, what was shared and taken back, what a clinic
/// asked for, and each time a clinic looked at something only a grant let it
/// see. The last kind is the one that makes sharing trustworthy: a patient who
/// can see every look is a patient who can tell when to stop.
class SharingHistoryScreen extends ConsumerWidget {
  const SharingHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(sharingHistoryProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Sharing history')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(sharingHistoryProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ListView(
            padding: const EdgeInsets.all(T.s4),
            children: [
              LoadFailed(what: 'your sharing history', onRetry: () => ref.invalidate(sharingHistoryProvider)),
            ],
          ),
          data: (items) => items.isEmpty
              ? ListView(
                  padding: const EdgeInsets.all(T.s6),
                  children: [
                    Text(
                      'Nothing has happened yet. When a clinic is connected, when you share something, '
                      'and each time a clinic looks at what you shared, it is listed here.',
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: T.s2),
                  itemBuilder: (context, i) {
                    final item = items[i];
                    return InnerTile(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.sentence, style: T.body.copyWith(color: scheme.onSurface)),
                          if (item.at != null)
                            Text(
                              DateFormat('d MMM yyyy, h:mm a').format(item.at!),
                              style: T.label.copyWith(color: scheme.onSurfaceVariant),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
