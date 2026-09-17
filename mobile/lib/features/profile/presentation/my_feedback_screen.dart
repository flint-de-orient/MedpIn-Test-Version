import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../feedback/data/feedback_repository.dart';

/// What the patient has sent, where it went, whether anybody has read it, and
/// what they said back.
///
/// The thank-you screen promised a reply "in your care thread", and nothing
/// connected a piece of feedback to anything anybody wrote there. Replies now
/// belong to the feedback they answer, and this is where the patient reads
/// them.
class MyFeedbackScreen extends ConsumerWidget {
  const MyFeedbackScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myFeedbackProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Your feedback')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/profile/feedback'),
        icon: const Icon(Icons.rate_review_outlined),
        label: const Text('Send feedback'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myFeedbackProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ListView(
            padding: const EdgeInsets.all(T.s4),
            children: [LoadFailed(what: 'your feedback', onRetry: () => ref.invalidate(myFeedbackProvider))],
          ),
          data: (items) => items.isEmpty
              ? ListView(
                  padding: const EdgeInsets.all(T.s6),
                  children: [
                    Text(
                      'You have not sent any feedback yet. What you send, and any reply, appears here.',
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12 + T.s12),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: T.s3),
                  itemBuilder: (context, i) => _MyFeedbackCard(item: items[i]),
                ),
        ),
      ),
    );
  }
}

class _MyFeedbackCard extends StatelessWidget {
  const _MyFeedbackCard({required this.item});

  final MyFeedback item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final when = item.createdAt == null ? '' : DateFormat('d MMM yyyy').format(item.createdAt!);

    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(item.destination, style: T.label.copyWith(color: scheme.onSurfaceVariant)),
          const SizedBox(height: T.s1),
          if (item.message.isNotEmpty) Text(item.message, style: T.body.copyWith(color: scheme.onSurface)),
          if (item.rating != null) Text('Rated ${item.rating} out of 5', style: T.small.copyWith(color: scheme.onSurface)),
          const SizedBox(height: T.s1),
          Text(
            [
              when,
              if (item.routedTo != 'private') item.seen ? 'Read' : 'Not read yet',
            ].where((s) => s.isNotEmpty).join(' · '),
            style: T.label.copyWith(color: scheme.onSurfaceVariant),
          ),
          for (final r in item.replies) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Reply from ${r.fromName ?? 'your clinic'}${r.byName == null ? '' : ' — ${r.byName}'}',
                    style: T.label.copyWith(color: scheme.primary),
                  ),
                  const SizedBox(height: T.s1),
                  Text(r.body, style: T.body.copyWith(color: scheme.onSurface)),
                  if (r.at != null)
                    Text(DateFormat('d MMM yyyy, h:mm a').format(r.at!), style: T.label.copyWith(color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
