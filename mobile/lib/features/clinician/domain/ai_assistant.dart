import 'package:flutter/foundation.dart';

/// One specialty's AI assistant, as the doctor who may approve it sees it.
///
/// Every field comes from the server, which answers from the same function the
/// assistant asks before replying to a patient. The app decides nothing here:
/// if [state] says off, it is off — whatever this screen showed a moment ago.
@immutable
class AiAssistant {
  const AiAssistant({
    required this.departmentId,
    required this.departmentKey,
    required this.specialty,
    required this.state,
    required this.reason,
    required this.version,
    required this.knowledgeVersion,
    this.covers = const [],
    this.refuses = const [],
    this.warningSigns = const [],
    this.sourceCount = 0,
    this.isAiDrafted = false,
    this.knowledge = const AssistantKnowledge(),
    this.reviewNotes = const [],
    this.approval,
    this.canApprove = false,
    this.canWithdraw = false,
    this.updatesAvailable = false,
  });

  final String departmentId;
  final String departmentKey;

  /// The specialty's name, in the doctor's language.
  final String specialty;

  /// `on`, `off` or `withdrawn`.
  final String state;

  /// Why it is off, as the server says it — `scope_not_approved` and the rest.
  final String reason;

  /// The configuration version being approved.
  final int version;

  /// The knowledge base version being approved.
  final String knowledgeVersion;

  final List<String> covers;
  final List<String> refuses;
  final List<String> warningSigns;
  final int sourceCount;
  final bool isAiDrafted;
  final AssistantKnowledge knowledge;
  final List<ReviewNote> reviewNotes;
  final AssistantApproval? approval;
  final bool canApprove;
  final bool canWithdraw;

  /// Approved, but the knowledge or wording has been revised since.
  final bool updatesAvailable;

  bool get isOn => state == 'on';
  bool get isWithdrawn => state == 'withdrawn';

  factory AiAssistant.fromJson(Map<String, dynamic> j) {
    final department = j['department'] as Map<String, dynamic>? ?? const {};
    final scope = j['scopeText'] as Map<String, dynamic>? ?? const {};
    List<String> strings(Object? v) =>
        (v as List?)?.map((e) => e.toString()).toList() ?? const [];
    return AiAssistant(
      departmentId: department['id']?.toString() ?? '',
      departmentKey: department['key']?.toString() ?? '',
      specialty: department['name']?.toString() ?? '',
      state: j['state']?.toString() ?? 'off',
      reason: j['reason']?.toString() ?? '',
      version: (scope['version'] as num?)?.toInt() ?? 1,
      knowledgeVersion: j['knowledgeVersion']?.toString() ?? '',
      covers: strings(scope['covers']),
      refuses: strings(scope['refuses']),
      warningSigns: strings(scope['redFlags']),
      sourceCount: (scope['sources'] as List?)?.length ?? 0,
      isAiDrafted: scope['isAiDrafted'] == true,
      knowledge: AssistantKnowledge.fromJson(
        j['knowledge'] as Map<String, dynamic>? ?? const {},
      ),
      reviewNotes:
          (j['reviewNotes'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ReviewNote.fromJson)
              .toList() ??
          const [],
      approval:
          j['approval'] is Map<String, dynamic>
              ? AssistantApproval.fromJson(j['approval'] as Map<String, dynamic>)
              : null,
      canApprove: j['canApprove'] == true,
      canWithdraw: j['canWithdraw'] == true,
      updatesAvailable: j['updatesAvailable'] == true,
    );
  }
}

/// How much guidance the assistant has, approved here and waiting.
@immutable
class AssistantKnowledge {
  const AssistantKnowledge({
    this.approved = 0,
    this.waiting = 0,
    this.byLanguage = const {},
  });

  final int approved;
  final int waiting;

  /// Passages in each language, approved or waiting — what one approval covers.
  final Map<String, int> byLanguage;

  int get total => approved + waiting;

  factory AssistantKnowledge.fromJson(Map<String, dynamic> j) {
    final approved = j['approved'] as Map<String, dynamic>? ?? const {};
    final pending = j['pending'] as Map<String, dynamic>? ?? const {};
    int count(Map<String, dynamic> m, String language) =>
        ((m['byLanguage'] as Map?)?[language] as num?)?.toInt() ?? 0;
    return AssistantKnowledge(
      approved: (approved['total'] as num?)?.toInt() ?? 0,
      waiting: (pending['total'] as num?)?.toInt() ?? 0,
      byLanguage: {
        for (final language in const ['en', 'bn', 'hi'])
          language: count(approved, language) + count(pending, language),
      },
    );
  }
}

/// Something the doctor should know before approving.
@immutable
class ReviewNote {
  const ReviewNote({required this.title, required this.detail});

  final String title;
  final String detail;

  factory ReviewNote.fromJson(Map<String, dynamic> j) => ReviewNote(
    title: j['title']?.toString() ?? '',
    detail: j['detail']?.toString() ?? '',
  );
}

/// Who approved it here, when, and whether it has since been withdrawn.
@immutable
class AssistantApproval {
  const AssistantApproval({
    this.approvedAt,
    this.approvedByName,
    this.withdrawnAt,
    this.withdrawnByName,
  });

  final DateTime? approvedAt;
  final String? approvedByName;
  final DateTime? withdrawnAt;
  final String? withdrawnByName;

  factory AssistantApproval.fromJson(Map<String, dynamic> j) {
    String? nameOf(Object? who) =>
        who is Map<String, dynamic> ? who['name']?.toString() : null;
    DateTime? at(Object? v) =>
        v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    return AssistantApproval(
      approvedAt: at(j['approvedAt']),
      approvedByName: nameOf(j['approvedBy']),
      withdrawnAt: at(j['withdrawnAt']),
      withdrawnByName: nameOf(j['withdrawnBy']),
    );
  }
}
