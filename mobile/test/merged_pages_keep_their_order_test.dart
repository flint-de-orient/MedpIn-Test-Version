import 'dart:async';

import 'package:akd_care/features/clinician/data/clinician_repository.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Several pages of the roll, read back as one list.
///
/// The inbox read one page of a hundred patients sorted by name and put unread
/// conversations first on the phone, so an unread message from the
/// hundred-and-first patient by name was never fetched. The server now orders
/// the whole roll before paging it, and the phone reads pages 1..n. These pin
/// how those pages come back together: in the server's order, nobody twice,
/// and the last page deciding whether there is more.

Paged<String> _page(
  List<String> items, {
  int page = 1,
  int total = 0,
  bool hasMore = false,
}) => Paged<String>(
  items: items,
  page: page,
  limit: 100,
  total: total,
  hasMore: hasMore,
);

PatientListItem _patient(String id) =>
    PatientListItem(id: id, name: 'Patient $id', phone: '', riskScore: 0, riskBand: 'low');

/// A roll whose pages answer only when told to, so a test can see which were
/// asked for before any of them came back.
class _Roll implements ClinicianRepository {
  final asked = <({int page, int limit, String sort})>[];
  final answers = <int, Completer<Paged<PatientListItem>>>{};

  @override
  Future<Paged<PatientListItem>> patients({
    String? riskBand,
    String? search,
    String sort = 'risk',
    int page = 1,
    int limit = 50,
  }) {
    asked.add((page: page, limit: limit, sort: sort));
    return (answers[page] = Completer<Paged<PatientListItem>>()).future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('mergePages', () {
    test('keeps the pages in order, and each page in its own order', () {
      // Deliberately not alphabetical. The server's order is the order; a
      // merge that sorted would be a second copy of its rule.
      final merged = mergePages([
        _page(['c', 'a'], total: 4, hasMore: true),
        _page(['d', 'b'], page: 2, total: 4),
      ], idOf: (s) => s);

      expect(merged.items, ['c', 'a', 'd', 'b']);
    });

    test('lists somebody on two pages once, where they first appear', () {
      // Page two was read a moment after page one, and 'b' had moved up in
      // between — so both pages carry them.
      final merged = mergePages([
        _page(['a', 'b'], total: 3, hasMore: true),
        _page(['b', 'c'], page: 2, total: 3),
      ], idOf: (s) => s);

      expect(merged.items, ['a', 'b', 'c']);
    });

    test('matches duplicates by id, not by equality', () {
      final merged = mergePages<({String id, int unread})>([
        Paged(
          items: const [(id: 'a', unread: 2)],
          page: 1,
          limit: 100,
          total: 2,
          hasMore: true,
        ),
        Paged(
          items: const [(id: 'a', unread: 3), (id: 'b', unread: 0)],
          page: 2,
          limit: 100,
          total: 2,
          hasMore: false,
        ),
      ], idOf: (p) => p.id);

      expect(merged.items, const [(id: 'a', unread: 2), (id: 'b', unread: 0)]);
    });

    test('takes total and hasMore from the last page', () {
      // Only the last page knows what lies beyond it.
      final merged = mergePages([
        _page(['a'], total: 250, hasMore: true),
        _page(['b'], page: 2, total: 251, hasMore: true),
      ], idOf: (s) => s);

      expect(merged.total, 251);
      expect(merged.hasMore, isTrue);
    });

    test('says there is no more once the last page does', () {
      final merged = mergePages([
        _page(['a'], total: 2, hasMore: true),
        _page(['b'], page: 2, total: 2),
      ], idOf: (s) => s);

      expect(merged.hasMore, isFalse);
    });

    test('counts the pages it merged', () {
      final merged = mergePages([
        _page(['a'], total: 3, hasMore: true),
        _page(['b'], page: 2, total: 3, hasMore: true),
        _page(['c'], page: 3, total: 3),
      ], idOf: (s) => s);

      expect(merged.page, 3);
      expect(merged.limit, 100);
    });

    test('hands a single page back as it came', () {
      final merged = mergePages([
        _page(['a', 'b'], total: 140, hasMore: true),
      ], idOf: (s) => s);

      expect(merged.items, ['a', 'b']);
      expect(merged.page, 1);
      expect(merged.total, 140);
      expect(merged.hasMore, isTrue);
    });

    test('makes an empty list with nothing more out of no pages', () {
      final merged = mergePages<String>(const [], idOf: (s) => s);

      expect(merged.items, isEmpty);
      expect(merged.total, 0);
      expect(merged.hasMore, isFalse);
    });
  });

  group('patientsProvider', () {
    test('asks for every page at once, a hundred at a time, and merges them', () async {
      final roll = _Roll();
      final container = ProviderContainer(
        overrides: [clinicianRepositoryProvider.overrideWithValue(roll)],
      );
      addTearDown(container.dispose);

      const PatientsQuery query = (
        riskBand: null,
        search: null,
        sort: 'inbox',
        pages: 3,
      );
      container.listen(patientsProvider(query), (_, _) {});
      final result = container.read(patientsProvider(query).future);
      await Future<void>.delayed(Duration.zero);

      // All three on their way before any has answered: in parallel, not one
      // after another.
      expect(roll.asked.map((a) => a.page), [1, 2, 3]);
      expect(roll.asked.map((a) => a.limit).toSet(), {100});
      expect(roll.asked.map((a) => a.sort).toSet(), {'inbox'});

      // Answered out of order, and overlapping — the merge keeps page order.
      roll.answers[3]!.complete(
        Paged(items: [_patient('e')], page: 3, limit: 100, total: 5, hasMore: false),
      );
      roll.answers[1]!.complete(
        Paged(
          items: [_patient('a'), _patient('b')],
          page: 1,
          limit: 100,
          total: 5,
          hasMore: true,
        ),
      );
      roll.answers[2]!.complete(
        Paged(
          items: [_patient('b'), _patient('c')],
          page: 2,
          limit: 100,
          total: 5,
          hasMore: true,
        ),
      );

      final merged = await result;
      expect(merged.items.map((p) => p.id), ['a', 'b', 'c', 'e']);
      expect(merged.page, 3);
      expect(merged.total, 5);
      expect(merged.hasMore, isFalse);
    });

    test('a query of one page asks for page one only', () async {
      final roll = _Roll();
      final container = ProviderContainer(
        overrides: [clinicianRepositoryProvider.overrideWithValue(roll)],
      );
      addTearDown(container.dispose);

      const PatientsQuery query = (
        riskBand: null,
        search: 'dey',
        sort: 'name',
        pages: 1,
      );
      container.listen(patientsProvider(query), (_, _) {});
      final result = container.read(patientsProvider(query).future);
      await Future<void>.delayed(Duration.zero);

      expect(roll.asked, [(page: 1, limit: 100, sort: 'name')]);

      roll.answers[1]!.complete(
        Paged(items: [_patient('a')], page: 1, limit: 100, total: 1, hasMore: false),
      );
      expect((await result).items.single.id, 'a');
    });
  });
}
