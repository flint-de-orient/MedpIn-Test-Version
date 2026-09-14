/// A doctor-approved knowledge entry the assistant retrieves from
/// (`/doctor/knowledge`). Only `approved` chunks are ever served to patients.
class KnowledgeChunk {
  const KnowledgeChunk({
    required this.id,
    required this.docId,
    required this.title,
    required this.content,
    required this.language,
    required this.category,
    required this.status,
    this.section,
    this.tags = const [],
    this.version = 1,
    this.hasEmbedding = false,
    this.isShared = false,
    this.sourceCitation,
    this.approvedAt,
    this.updatedAt,
  });

  final String id;
  final String docId;
  final String title;
  final String content;
  final String language; // en | bn | hi
  final String category;
  final String status; // draft | pending_review | approved | retired
  final String? section;
  final List<String> tags;
  final int version;
  final bool hasEmbedding;

  /// The platform's own clinical content, served to every practice.
  ///
  /// Read-only from the app. Any doctor editing, approving or retiring it would
  /// change what every practice's assistant tells patients, which is why the
  /// server refuses — and why the edit screen must not offer controls that
  /// would only come back refused.
  final bool isShared;

  final String? sourceCitation;
  final DateTime? approvedAt;
  final DateTime? updatedAt;

  bool get isApproved => status == 'approved';

  /// Categories the backend's zod enum accepts.
  static const categories = [
    'diabetes_basics',
    'hypoglycaemia',
    'hyperglycaemia',
    'insulin',
    'oral_medication',
    'diet',
    'exercise',
    'foot_care',
    'eye_care',
    'kidney',
    'hypertension',
    'sick_day_rules',
    'emergency',
    'clinic_info',
    'general',
  ];

  factory KnowledgeChunk.fromJson(Map<String, dynamic> j) => KnowledgeChunk(
    id: j['id']?.toString() ?? '',
    docId: j['docId']?.toString() ?? '',
    title: j['title']?.toString() ?? '',
    content: j['content']?.toString() ?? '',
    language: j['language']?.toString() ?? 'en',
    category: j['category']?.toString() ?? 'general',
    status: j['status']?.toString() ?? 'draft',
    section: j['section']?.toString(),
    tags: (j['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    version: (j['version'] as num?)?.toInt() ?? 1,
    hasEmbedding: j['hasEmbedding'] == true,
    // Absent means editable, which is what an older server not sending the
    // field is describing — it did not refuse edits either.
    isShared: j['isShared'] == true,
    sourceCitation: j['sourceCitation']?.toString(),
    approvedAt: DateTime.tryParse(j['approvedAt']?.toString() ?? '')?.toLocal(),
    updatedAt: DateTime.tryParse(j['updatedAt']?.toString() ?? '')?.toLocal(),
  );
}
