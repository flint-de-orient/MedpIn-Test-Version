/// Generic wrapper for the API's paged-list shape (API_CONTRACT.md
/// "Conventions"): `{ items, page, limit, total, hasMore }`.
class Paged<T> {
  const Paged({
    required this.items,
    required this.page,
    required this.limit,
    required this.total,
    required this.hasMore,
  });

  final List<T> items;
  final int page;
  final int limit;
  final int total;
  final bool hasMore;

  factory Paged.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromJsonT,
  ) {
    return Paged<T>(
      items: (json['items'] as List<dynamic>? ?? const [])
          .map((e) => fromJsonT(e as Map<String, dynamic>))
          .toList(),
      page: (json['page'] as num?)?.toInt() ?? 1,
      limit: (json['limit'] as num?)?.toInt() ?? 50,
      total: (json['total'] as num?)?.toInt() ?? 0,
      hasMore: json['hasMore'] as bool? ?? false,
    );
  }

  static Paged<T> empty<T>() =>
      Paged<T>(items: const [], page: 1, limit: 50, total: 0, hasMore: false);
}

/// Pages 1..n of one list, read as a single [Paged].
///
/// Items stay in page order, because the server orders the whole list before
/// it pages it: page one then page two already is the order, and sorting again
/// here would be the server's rule written out a second time.
///
/// Duplicates are dropped by [idOf], keeping the first. Pages read in parallel
/// can overlap — a message arriving between two reads lifts somebody from page
/// two onto page one, and both answers carry them — and the first sighting is
/// the one in the order being shown.
///
/// `total` and `hasMore` are the last page's, because it is the only one that
/// knows what lies beyond it. `page` is how many pages were merged.
Paged<T> mergePages<T>(
  List<Paged<T>> pages, {
  required Object? Function(T item) idOf,
}) {
  if (pages.isEmpty) return Paged.empty<T>();

  final seen = <Object?>{};
  final items = <T>[];
  for (final page in pages) {
    for (final item in page.items) {
      if (seen.add(idOf(item))) items.add(item);
    }
  }

  final last = pages.last;
  return Paged<T>(
    items: items,
    page: pages.length,
    limit: last.limit,
    total: last.total,
    hasMore: last.hasMore,
  );
}
