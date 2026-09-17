import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The pushes sharing and feedback send land somewhere in the app.
 *
 * `pushKindsAreRouted.test.js` reads notifications.js. These kinds are sent
 * from services/sharing.js and services/feedback.js, which it does not open —
 * so without this, a patient told "a clinic replied to your feedback" could tap
 * onto the care thread, the app's landing for a kind it has never heard of,
 * and find nothing new there.
 */
const sources = ['../src/services/sharing.js', '../src/services/feedback.js'].map((p) =>
  readFileSync(new URL(p, import.meta.url), 'utf8'),
);
const router = readFileSync(new URL('../../mobile/lib/core/push/push_service.dart', import.meta.url), 'utf8');

const sent = new Set(sources.flatMap((src) => [...src.matchAll(/kind: '([a-z_]+)'/g)].map((m) => m[1])));

describe('sharing and feedback pushes are routed', () => {
  test('the kinds were found', () => {
    for (const kind of ['share_request', 'sharing_question', 'patient_feedback', 'feedback_reply']) {
      assert.ok(sent.has(kind), `no longer sends ${kind}`);
    }
  });

  test('a patient’s kinds open the screen they are about', () => {
    const patientSwitch = router.slice(
      router.indexOf("if (user.role == 'patient')"),
      router.indexOf('// The area this account is allowed into'),
    );
    assert.match(patientSwitch, /case 'feedback_reply':\s*\n\s*router\.go\('\/profile\/feedback\/mine'\)/);
    assert.match(patientSwitch, /case 'share_request':\s*\n\s*case 'sharing_question':\s*\n\s*router\.go\('\/profile\/sharing'\)/);
  });

  test('a clinician’s opens the inbox under their own area', () => {
    assert.match(router, /kind == 'patient_feedback'[\s\S]{0,80}router\.push\('\$area\/feedback'\)/);
    const app = readFileSync(new URL('../../mobile/lib/core/router/app_router.dart', import.meta.url), 'utf8');
    for (const path of ["path: '/clinician/feedback'", "path: '/staff/feedback'"]) {
      assert.ok(app.includes(path), `${path} is not declared, so the tap goes nowhere`);
    }
  });
});
