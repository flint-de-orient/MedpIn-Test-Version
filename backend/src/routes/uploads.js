import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { needsDarkChip } from '../services/logoLuminance.js';
import { transcribeVoiceNote, transcodeToMp3 } from '../services/ai/transcribe.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { User, ROLES } from '../models/User.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { assessSignature, makeSignatureTransparent } from '../services/signature.js';

const router = Router();

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

/**
 * Voice notes. Android records AAC in an MP4 container, which browsers and
 * recorders label inconsistently — all four spellings below are the same file,
 * so all four are accepted rather than rejecting a patient's recording over a
 * header string.
 */
const AUDIO_MIME = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

/**
 * Documents a patient or clinician can share in chat — PDFs, Office files, plain
 * text and CSV. Stored byte-for-byte and served for download; never re-encoded.
 */
const DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'text/plain',
  'text/csv',
]);

const ALLOWED_MIME = new Set([...IMAGE_MIME, ...AUDIO_MIME, ...DOCUMENT_MIME]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(badRequest(`Unsupported file type: ${file.mimetype}. Upload an image, PDF, document or voice note.`));
    }
    cb(null, true);
  },
});

/** File extension for a stored document, so a download keeps its real type. */
function documentExtension(mime) {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/vnd.ms-powerpoint':
      return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx';
    case 'text/csv':
      return 'csv';
    case 'text/plain':
      return 'txt';
    default:
      return 'bin';
  }
}

/** File extension for a stored voice note, so the served file plays natively. */
function audioExtension(mime) {
  switch (mime) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
    case 'audio/webm':
      return 'webm';
    // audio/mp4, m4a, x-m4a and aac are all AAC-in-MP4.
    default:
      return 'm4a';
  }
}

async function uploadRoot() {
  const dir = path.resolve(process.cwd(), env.UPLOAD_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

router.post(
  '/',
  requireAuth,
  upload.single('file'),
  validate({
    body: z.object({
      kind: z.enum([
        'foot_photo',
        'retinal_report',
        'lab_report',
        'prescription_pdf',
        'meal_photo',
        'avatar',
        'signature',
        'clinic_logo',
        'voice_note',
        'other',
      ]),
      patientId: z.string().optional(),
    }),
  }),
  audit('create', 'MediaAsset'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded');

    // Clinicians may upload on a patient's behalf; patients only for themselves.
    let owner = req.user._id;
    if (req.body.patientId && req.user.role !== ROLES.PATIENT) owner = req.body.patientId;

    const root = await uploadRoot();
    const isDocument = DOCUMENT_MIME.has(req.file.mimetype);
    const isAudio = AUDIO_MIME.has(req.file.mimetype);

    let width = null;
    let height = null;
    let buffer = req.file.buffer;
    let mimeType = req.file.mimetype;
    /// Set for a clinic logo: true when the artwork needs a dark ground.
    let needsDark = false;

    // A signature is not a clinical photo: the paper it was written on has to
    // go, or it lands on the prescription as a grey rectangle.
    if (req.body.kind === 'signature' && !isDocument && !isAudio) {
      const verdict = await assessSignature(req.file.buffer);
      if (!verdict.ok) throw badRequest(verdict.reason);

      const cut = await makeSignatureTransparent(req.file.buffer);
      buffer = cut.buffer;
      mimeType = 'image/png';
      width = cut.width;
      height = cut.height;
    } else if (req.body.kind === 'clinic_logo' && !isDocument && !isAudio) {
      // A logo keeps its transparency, so PNG rather than WebP-with-a-white-box
      // behind it — a mark that arrives cut out has to stay cut out or it lands
      // on the letterhead as a rectangle.
      //
      // It is also measured rather than altered: artwork drawn for a dark
      // letterhead is flagged so the app can paint a dark chip behind it.
      // Inverting it instead would turn this clinic's teal orange, and the
      // colour is the part of a logo that carries the brand.
      const image = sharp(req.file.buffer, { failOn: 'none' }).rotate();
      const meta = await image.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      buffer = await image
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      mimeType = 'image/png';
      needsDark = await needsDarkChip(buffer).catch(() => false);
    } else if (!isDocument && !isAudio) {
      // Normalise to WebP: strips EXIF (which can carry GPS location of a
      // patient's home) and keeps clinical photos to a sane size.
      const image = sharp(req.file.buffer, { failOn: 'none' }).rotate();
      const meta = await image.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      buffer = await image.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
      mimeType = 'image/webp';
    }

    if (isAudio) {
      // Re-encode every recording to MP3 — one format for storage, playback and
      // transcription. The device's own codec (AAC-in-MP4, or a WAV the player
      // mislabelled) is exactly what broke playback and transcription before;
      // MP3 is decoded natively by both the phone player and Gemini. If the
      // encode ever fails we keep the original bytes so a note is never lost.
      try {
        buffer = await transcodeToMp3(req.file.buffer);
        mimeType = 'audio/mpeg';
      } catch (err) {
        logger.error({ err: err?.message }, 'voice note MP3 transcode failed; storing original');
      }
    }

    // Extension follows the FINAL mime, so an MP3 note serves as MP3 (and plays)
    // while a rare fallback still serves in its own container.
    const ext = isDocument
      ? documentExtension(mimeType)
      : isAudio
        ? audioExtension(mimeType)
        : mimeType === 'image/png'
          ? 'png'
          : 'webp';
    const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const fullPath = path.join(root, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Transcribed here, once, rather than on every read. Awaited on purpose:
    // the client sends the message immediately after the upload returns, and a
    // transcript that arrived later would miss triage entirely — the rule
    // engine reads text, so a spoken "chest pain" has to be text before the
    // message is assessed.
    let transcript = null;
    if (isAudio) transcript = await transcribeVoiceNote(buffer, mimeType);

    await fs.writeFile(fullPath, buffer);

    const asset = await MediaAsset.create({
      owner,
      uploadedBy: req.user._id,
      kind: req.body.kind,
      storageKey: key,
      originalName: req.file.originalname?.slice(0, 260),
      mimeType,
      sizeBytes: buffer.length,
      width,
      height,
      transcript,
    });

    res.status(201).json({
      id: asset._id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      // The original filename, so a document shows its real name in chat.
      name: asset.originalName ?? null,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      // Returned so the client can send the spoken words as the message text,
      // which is what the assistant answers and what triage assesses.
      transcript: asset.transcript ?? null,
      // Only meaningful for a clinic logo: the artwork was drawn for a dark
      // background, so the app should paint a dark chip behind it rather than
      // invert it. Measured on the pixels, not guessed from the file name.
      needsDarkChip: needsDark,
      url: `/api/v1/uploads/${asset._id}/raw`,
      createdAt: asset.createdAt,
    });
  }),
);

router.get(
  '/:id/raw',
  requireAuth,
  audit('read', 'MediaAsset'),
  asyncHandler(async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id);
    if (!asset || asset.deletedAt) throw notFound('File not found');

    const isOwner = asset.owner.toString() === req.user._id.toString();
    const isClinician = req.user.role !== ROLES.PATIENT;
    let allowed = isOwner || isClinician;

    // A patient can also view a file that appears in their OWN chat thread — a
    // photo or voice note the clinic sent them. This covers files still owned by
    // the clinician from before uploads were owned by the patient, so older
    // received images stop showing as broken boxes without a data migration.
    // Scoped to the patient's own messages, so it never exposes another
    // patient's media.
    if (!allowed && req.user.role === ROLES.PATIENT) {
      allowed = await ChatMessage.exists({ patient: req.user._id, attachments: asset._id });
    }

    // A staff member's profile photo is readable by anyone signed in. The whole
    // point of the doctor's and dietician's picture is that the patient sees
    // who is talking to them, and owner-only access made every one of those
    // avatars a 403 that fell back to a grey initial.
    //
    // Deliberately staff only: a patient's own photo stays private to them and
    // the clinic, so this cannot leak one patient's face to another.
    if (!allowed) {
      allowed = await User.exists({
        avatarAssetId: asset._id,
        role: { $ne: ROLES.PATIENT },
      });
    }

    if (!allowed) throw forbidden('You do not have access to this file');

    req.patientId = asset.owner;

    const root = await uploadRoot();
    const fullPath = path.join(root, asset.storageKey);

    try {
      await fs.access(fullPath);
    } catch {
      logger.error({ assetId: asset._id.toString(), key: asset.storageKey }, 'media file missing from disk');
      throw notFound('File is no longer available');
    }

    res.type(asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(fullPath);
  }),
);

router.delete(
  '/:id',
  requireAuth,
  audit('update', 'MediaAsset'),
  asyncHandler(async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id);
    if (!asset) throw notFound('File not found');
    if (asset.owner.toString() !== req.user._id.toString() && req.user.role === ROLES.PATIENT) {
      throw forbidden('You do not have access to this file');
    }
    // Soft delete only — the bytes stay for the medical record.
    asset.deletedAt = new Date();
    await asset.save();
    res.status(204).end();
  }),
);

/** Loads assets as base64 for the vision model. */
export async function loadAssetsForAi(assetIds, { max = 3 } = {}) {
  const assets = await MediaAsset.find({ _id: { $in: assetIds }, deletedAt: null }).limit(max).lean();
  const root = await uploadRoot();

  const out = [];
  for (const a of assets) {
    if (!a.mimeType.startsWith('image/')) continue;
    try {
      const buf = await fs.readFile(path.join(root, a.storageKey));
      // Gemini handles JPEG more reliably than WebP for vision input.
      const jpeg = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
      out.push({ mimeType: 'image/jpeg', base64: jpeg.toString('base64'), assetId: a._id });
    } catch (err) {
      logger.warn({ err: err?.message, assetId: a._id.toString() }, 'could not load asset for AI');
    }
  }
  return out;
}

export default router;
