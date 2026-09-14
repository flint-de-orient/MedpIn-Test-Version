import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { generate } from './gemini.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { countAiCall } from './allowance.js';

/**
 * Turns a patient's voice note into text the rest of the pipeline can use.
 *
 * This runs *before* triage, and that ordering is the point: the deterministic
 * rule engine reads text, so a patient who says "I have chest pain" out loud
 * must reach the same escalation as one who typed it. Transcribing server-side
 * rather than on the handset is what makes that true regardless of whether the
 * phone has a speech recogniser, or one that speaks Bengali.
 */
const SYSTEM = `You transcribe voice messages from patients of a diabetes and hormone clinic in India.

Rules:
- Return ONLY the words spoken. No summary, no commentary, no speaker labels.
- Transcribe in the language actually spoken — English, Bengali or Hindi. Do not translate.
- Keep numbers as digits: "two forty" spoken about a sugar reading becomes "240".
- Keep medicine names as spoken, even if unfamiliar.
- If the audio is silent or unintelligible, return exactly: [unclear]`;

/**
 * Audio containers gemini-2.5-flash accepts inline. The phone records AAC in an
 * MP4 container (audio/mp4 · m4a), which is NOT one of these — sending it as-is
 * makes Gemini reject the request, and every note comes back "could not make
 * out the recording". Anything outside this set is transcoded first.
 */
const GEMINI_AUDIO_MIME = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
]);

/**
 * Transcodes any recording to 16 kHz mono FLAC — a format Gemini reads reliably
 * and small enough to upload inline. Speech is fully intelligible at 16 kHz
 * mono, and FLAC is lossless, so nothing a clinician might need is lost. The
 * stored file is left untouched (still the original m4a) for playback.
 */
async function transcodeForGemini(buffer) {
  if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');

  const base = join(tmpdir(), `vn-${randomUUID()}`);
  const inPath = `${base}.in`;
  const outPath = `${base}.flac`;
  await writeFile(inPath, buffer);

  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        '-y',
        '-i', inPath,
        '-ac', '1',
        '-ar', '16000',
        // Clean the audio before transcription: band-limit to the speech range
        // (drop rumble + hiss), FFT-denoise, then normalise loudness. This
        // meaningfully lifts accuracy on noisy phone recordings without
        // distorting the words.
        '-af', 'highpass=f=80,lowpass=f=7500,afftdn=nf=-25,dynaudnorm=f=200',
        outPath,
      ]);
      let stderr = '';
      ff.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      ff.on('error', reject);
      ff.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`)),
      );
    });
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/**
 * Re-encodes any recording to MP3 (mono, ~64 kbps). This is the format the note
 * is *stored and served* in, and picking MP3 fixes both ends of voice at once:
 *
 * - Playback: MP3 is natively decodable by the phone's player (ExoPlayer). The
 *   old path stored the raw recording and the player mislabelled it, so it
 *   silently refused to start. An .mp3 file just plays.
 * - Transcription: MP3 is one of the containers Gemini reads directly, so no
 *   second conversion is needed before triage.
 *
 * Mono at a modest bitrate keeps a five-minute note small while leaving speech
 * fully intelligible for a clinician listening back.
 */
export async function transcodeToMp3(buffer) {
  if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');

  const base = join(tmpdir(), `vn-${randomUUID()}`);
  const inPath = `${base}.in`;
  const outPath = `${base}.mp3`;
  await writeFile(inPath, buffer);

  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        '-y',
        '-i', inPath,
        '-ac', '1',
        '-b:a', '64k',
        '-c:a', 'libmp3lame',
        outPath,
      ]);
      let stderr = '';
      ff.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      ff.on('error', reject);
      ff.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`)),
      );
    });
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/**
 * @param {Buffer} buffer raw audio bytes as uploaded
 * @param {string} mimeType the recording's content type
 * @returns {Promise<string|null>} spoken words, or null when nothing usable
 */
export async function transcribeVoiceNote(buffer, mimeType, practiceId = null) {
  try {
    let audioBuffer = buffer;
    let audioMime = mimeType;

    // Always run the recording through the denoise/normalise transcode so Gemini
    // hears the cleanest possible speech — this is the main accuracy lever. If
    // ffmpeg is unavailable, fall back to the raw audio when Gemini can read the
    // format directly (an m4a container it cannot read still needs the convert).
    try {
      audioBuffer = await transcodeForGemini(buffer);
      audioMime = 'audio/flac';
    } catch (err) {
      if (!GEMINI_AUDIO_MIME.has(mimeType)) throw err;
      audioBuffer = buffer;
      audioMime = mimeType;
    }

    const result = await generate({
      system: SYSTEM,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Transcribe this voice message.' },
            { inlineData: { mimeType: audioMime, data: audioBuffer.toString('base64') } },
          ],
        },
      ],
      model: env.GEMINI_VISION_MODEL,
      // Transcription is not a creative task; drift here invents symptoms.
      temperature: 0,
    });
    // Metered after the call: a request that failed on the provider's side
    // cost the practice nothing. `countAiCall` records the tokens and the
    // per-kind count without touching the reply allowance — see
    // allowance.js on why starting to would be an outage, not a price.
    countAiCall(practiceId, 'transcribe', result?.usage);

    const text = (result?.text ?? '').trim();
    if (!text || text === '[unclear]') return null;
    return text;
  } catch (err) {
    // Never fatal. A failed transcription costs the assistant its answer, but
    // the recording is already stored and the clinic can still listen to it —
    // losing the message entirely would be far worse.
    logger.error({ err: err?.message }, 'voice note transcription failed');
    return null;
  }
}
