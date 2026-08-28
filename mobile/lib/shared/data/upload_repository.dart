import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';

import '../../core/network/api_client.dart';
import '../providers/core_providers.dart';

/// A file stored by `POST /uploads` (API_CONTRACT.md §12).
class MediaAsset {
  const MediaAsset({
    required this.id,
    required this.kind,
    required this.mimeType,
    required this.sizeBytes,
    this.width,
    this.height,
    this.url,
    this.transcript,
    this.needsDarkChip = false,
  });

  final String id;
  final String kind;
  final String mimeType;
  final int sizeBytes;
  final int? width;
  final int? height;
  final String? url;

  /// Words spoken in a voice note, transcribed server-side at upload. Null for
  /// anything else. Sent on as the message text so the assistant answers what
  /// was actually said, and so triage assesses it.
  final String? transcript;

  /// Clinic logos only: the artwork was drawn for a dark background.
  ///
  /// Measured server-side from the mean luminance of the non-transparent
  /// pixels. The app paints such a mark on a dark chip rather than inverting
  /// it — inversion is a per-channel complement and would turn a teal logo
  /// orange, and colour is the part of a logo that carries the brand.
  final bool needsDarkChip;

  factory MediaAsset.fromJson(Map<String, dynamic> json) => MediaAsset(
    id: json['id']?.toString() ?? '',
    kind: json['kind']?.toString() ?? 'other',
    mimeType: json['mimeType']?.toString() ?? 'application/octet-stream',
    sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    width: (json['width'] as num?)?.toInt(),
    height: (json['height'] as num?)?.toInt(),
    url: json['url']?.toString(),
    transcript: json['transcript']?.toString(),
  );
}

/// Upload kinds the server accepts. Anything else is rejected by its zod enum.
class UploadKind {
  UploadKind._();

  static const String footPhoto = 'foot_photo';
  static const String retinalReport = 'retinal_report';
  static const String labReport = 'lab_report';
  static const String prescriptionPdf = 'prescription_pdf';
  static const String mealPhoto = 'meal_photo';
  static const String avatar = 'avatar';
  static const String signature = 'signature';
  static const String clinicLogo = 'clinic_logo';
  static const String voiceNote = 'voice_note';
  static const String other = 'other';
}

/// Talks to `/uploads`.
///
/// The server re-encodes images through sharp, which strips EXIF — patient
/// photos otherwise carry the GPS coordinates of their home.
class UploadRepository {
  UploadRepository(this._client);

  final ApiClient _client;

  /// Server-side limit is `MAX_UPLOAD_MB` (12 by default). Checked here too so
  /// an oversized file fails immediately instead of after a long upload.
  static const int maxBytes = 12 * 1024 * 1024;

  /// MIME types in the server's `ALLOWED_MIME` set.
  static const Set<String> allowedMimeTypes = {
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
    // Voice notes. Recorded as 16 kHz mono WAV (older builds used AAC/m4a).
    'audio/wav',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
  };

  Future<MediaAsset> uploadImage({
    required String path,
    required String filename,
    String kind = UploadKind.other,
    // When a clinician sends a file to a patient, the file must be owned by the
    // PATIENT — otherwise the patient gets a 403 on it and sees a broken box.
    String? patientId,
  }) async {
    final mimeType = _mimeTypeFor(filename);
    final formData = FormData.fromMap({
      'kind': kind,
      if (patientId != null) 'patientId': patientId,
      'file': await MultipartFile.fromFile(
        path,
        filename: filename,
        contentType: MediaType.parse(mimeType),
      ),
    });
    final json = await _client.postMultipart('/uploads', formData: formData);
    return MediaAsset.fromJson(json);
  }

  static String _mimeTypeFor(String filename) {
    final ext = filename.toLowerCase().split('.').last;
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'heic':
      case 'heif':
        return 'image/heic';
      case 'pdf':
        return 'application/pdf';
      case 'doc':
        return 'application/msword';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'xls':
        return 'application/vnd.ms-excel';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'ppt':
        return 'application/vnd.ms-powerpoint';
      case 'pptx':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case 'txt':
        return 'text/plain';
      case 'csv':
        return 'text/csv';
      case 'wav':
        return 'audio/wav';
      case 'm4a':
      case 'aac':
      case 'mp4':
        return 'audio/mp4';
      default:
        return 'image/jpeg';
    }
  }
}

final Provider<UploadRepository> uploadRepositoryProvider =
    Provider<UploadRepository>((ref) {
      return UploadRepository(ref.watch(apiClientProvider));
    });
