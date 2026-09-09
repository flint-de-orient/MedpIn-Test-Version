import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Fail fast on misconfiguration. A healthcare service silently starting with a
 * missing JWT secret or no AI key is worse than not starting at all.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be >= 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be >= 16 chars'),

  // The platform admin's own signing key. Separate from the clinic's on
  // purpose: a clinic token put in front of the admin verifier must fail
  // signature verification rather than a role check, because there is no role
  // check to forget. Setting this to the same value as JWT_ACCESS_SECRET
  // defeats the whole arrangement, and the boot check says so.
  // Empty is allowed and means the admin panel is switched off — every
  // deployment that exists today is in that state, and a required secret here
  // would stop the clinic's own API booting. Set, it must be long: this is the
  // key to every practice on the platform.
  ADMIN_JWT_SECRET: z
    .string()
    .default('')
    .refine((v) => v === '' || v.length >= 32, {
      message: 'ADMIN_JWT_SECRET must be empty (admin disabled) or >= 32 chars',
    }),
  ACCESS_TOKEN_TTL: z.string().default('30m'),
  REFRESH_TOKEN_TTL: z.string().default('60d'),

  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_VISION_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBED_MODEL: z.string().default('text-embedding-004'),

  // Absolute path to the Firebase service-account JSON. Optional: without it
  // notifications are logged rather than sent, so a development machine needs
  // no credentials. Never the key itself — that file can push to every device
  // registered to the project and belongs on the server, not in config.
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // Atlas Vector Search is used when available; otherwise the RAG layer falls
  // back to in-process cosine similarity (fine for a single-clinic corpus).
  USE_ATLAS_VECTOR_SEARCH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  VECTOR_INDEX_NAME: z.string().default('knowledge_vector_index'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(12),

  CLINIC_NAME: z.string().default('Dr. Amit Kumar Dey Clinic'),

  // What build of the app the server expects to be talking to.
  //
  // ANDROID_MIN_BUILD is a floor, not a preference: below it the client is
  // known to misbehave against this server rather than merely be old. The scan
  // route is why it exists — it stopped creating medicines and began returning
  // a preview, so a client from before that change photographs a prescription,
  // reads created:[] and shows the patient nothing at all. No error, no
  // explanation, and nothing on the app side that would lead anyone here.
  //
  // Default 0 so a server that has not been told anything gates nobody. A
  // version check that locks people out by accident is worse than none.
  ANDROID_MIN_BUILD: z.coerce.number().int().min(0).default(0),
  ANDROID_LATEST_BUILD: z.coerce.number().int().min(0).default(0),
  ANDROID_LATEST_VERSION: z.string().default(''),
  APP_DOWNLOAD_URL: z.string().default(''),
  // The number a patient in an emergency is told to ring.
  //
  // It used to default to '+91-0000000000', and that placeholder is spoken
  // straight to patients: the assistant's emergency and urgent replies tell
  // them to call it, in all three languages. A deployment that forgot this line
  // was handing someone with chest pain a fake number. The prescription PDF
  // already refused to print a placeholder; the prompts never learned to.
  //
  // Empty by default now, and `clinicEmergencyPhone()` refuses to speak one
  // that has not been set. Production is checked at boot besides.
  CLINIC_EMERGENCY_PHONE: z.string().default(''),
  DOCTOR_DISPLAY_NAME: z.string().default('Dr. Amit Kumar Dey'),

  // Anyone who registers with this exact code becomes a dietician instead of a
  // patient. Change it per clinic; keep it private (shared only with dieticians
  // the doctor is onboarding).
  DIETICIAN_INVITE_CODE: z.string().min(4).default('CLINQ-DIET-2026'),

  // ---- Email ---------------------------------------------------------------
  //
  // Only the operator console sends any: a password reset and an address
  // confirmation. Patients and clinicians are reached by SMS and push, because
  // a clinic's patients do not reliably have email and do reliably have a
  // phone.
  //
  // Unset means the message is written to the log rather than delivered, so the
  // flow can be exercised without a mail account. See services/mailer.js.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  /// The From address. Falls back to SMTP_USER, which is right for most
  /// providers and wrong for the ones that require a verified sender.
  SMTP_FROM: z.string().default(''),

  /// Where the console lives, for the links in those emails.
  ///
  /// Not derived from the request: a reset link built from a forged Host header
  /// is a reset link pointing at somebody else's server, and the recipient
  /// cannot tell.
  ADMIN_CONSOLE_URL: z.string().default(''),

  // ---- Subscriptions and payment (Razorpay) --------------------------------
  //
  // Blank until somebody pastes the keys, and blank is a working state: with no
  // key id the billing surface is off, exactly as the admin console is off
  // without ADMIN_JWT_SECRET. A half-configured payment integration is worse
  // than an absent one — it takes money and cannot confirm it.
  //
  // The two secrets are different things and are not interchangeable:
  //
  //   RAZORPAY_KEY_SECRET      signs API calls to Razorpay. Server only.
  //   RAZORPAY_WEBHOOK_SECRET  verifies that a webhook POST came from Razorpay
  //                            and not from anybody who guessed the URL.
  //
  // Using the API secret to check a webhook signature is the commonest way this
  // integration is got wrong, and it fails open: every forged callback is
  // accepted, including "payment succeeded".
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  // A Razorpay subscription is created against a Plan created in their
  // dashboard, so the price lives there and these are the ids pointing at it.
  // Named per plan rather than one map, so a missing one is a startup-time
  // question rather than a runtime undefined at checkout.
  RAZORPAY_PLAN_ESSENTIAL: z.string().default(''),
  RAZORPAY_PLAN_PROFESSIONAL: z.string().default(''),
  RAZORPAY_PLAN_ENTERPRISE: z.string().default(''),

  // Where Razorpay sends the customer back to after checkout. Not derived from
  // the request, for the same reason ADMIN_CONSOLE_URL is not.
  RAZORPAY_CALLBACK_URL: z.string().default(''),

  /*
   * Days between a subscription's retries being exhausted and anything being
   * withheld from the practice.
   *
   * Seven, chosen deliberately: long enough to reach a practice manager who is
   * on leave, short enough that a lapse is not free service.
   *
   * Zero switches the whole thing off — nothing is ever withheld — which is the
   * setting for a deployment that would rather chase a lapse as a conversation.
   */
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),

  // ---- SMS one-time passcodes (MSG91) ------------------------------------
  //
  // Left blank in development on purpose. With no auth key the OTP service
  // does not call MSG91 at all — it logs the code instead, so the flow can be
  // exercised end to end without spending an SMS or needing a real handset.
  // That fallback refuses to run when NODE_ENV is production: a clinic that
  // deploys without credentials must fail loudly at the first request rather
  // than print patients' login codes into the server log.
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_SENDER_ID: z.string().default(''),

  // One approved template per purpose. India's DLT registration ties the
  // sender, the template and its wording together, so these are not
  // interchangeable and the text cannot be edited from here.
  MSG91_TEMPLATE_LOGIN: z.string().default(''),
  MSG91_TEMPLATE_REGISTER: z.string().default(''),
  // Consent for a desk enrolling a patient who already has an account. Empty
  // until a template is approved with DLT, and the sender falls back to the
  // registration one meanwhile — see services/sms.js.
  MSG91_TEMPLATE_ENROL: z.string().default(''),

  // Ten minutes, because that is what the approved templates tell the patient
  // ("OTP is valid for 10 minutes only"). The message and the server have to
  // agree; changing this without re-registering the template makes the SMS
  // lie.
  OTP_TTL_MINUTES: z.coerce.number().min(1).max(30).default(10),

  // Wrong guesses allowed before the code is burned and a new one must be
  // requested.
  OTP_MAX_ATTEMPTS: z.coerce.number().min(1).max(10).default(5),

  // How long a caller must wait before asking for another code for the same
  // number and purpose.
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().min(15).max(300).default(45),

  // Clinic wall-clock timezone. All appointment slot times are computed in this
  // zone, so the schedule is correct no matter what timezone the server runs in
  // (a VPS is often UTC). India is a single zone.
  CLINIC_TZ: z.string().default('Asia/Kolkata'),

  // How many minutes a "before food" / "after food" dose is reminded before or
  // after the meal. A clinic-wide clinical convention rather than a magic
  // number — change it here and every schedule (re)computed afterwards uses it.
  // Existing reminders pick the new value up on the next meal-time edit or
  // re-prescription (when their times are re-derived).
  MEAL_OFFSET_BEFORE_MIN: z.coerce.number().min(0).max(180).default(30),
  MEAL_OFFSET_AFTER_MIN: z.coerce.number().min(0).max(180).default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error('Copy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
