import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Filing a paper prescription is not writing one.
 *
 * The clinic's pilot runs on paper: the doctor writes fifty prescriptions by
 * hand and the desk photographs each one. So the front desk must be able to put
 * a prescription into the system — while prescribing stays doctor-only, which
 * the rest of this suite spends some effort enforcing.
 *
 * Those two are compatible, but only if the record keeps them apart. The danger
 * is a scanned prescription that looks exactly like a composed one: it would
 * name a receptionist as the prescriber, or claim the doctor typed medicines
 * they wrote on paper, or — worst — present an empty `items` array that
 * everything downstream reads as "this patient is on no medication".
 */
const route = readFileSync(new URL('../src/routes/prescriptions.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/models/Prescription.js', import.meta.url), 'utf8');

const scan = route.slice(route.indexOf("'/scan',"), route.indexOf('export default router'));

describe('a paper prescription, filed', () => {
  test('the desk may file one', () => {
    // requireClinician, not requireDoctor. This is the one prescription-shaped
    // action that is genuinely front-desk work.
    assert.match(scan, /requireClinician/);
    assert.ok(!/requireDoctor/.test(scan), 'filing was locked to the doctor');
  });

  test('but the record does not say they wrote it', () => {
    // `doctor` is whose prescription it is — their name is on the paper. The
    // desk goes in `uploadedBy`. Collapsing the two would either credit a
    // receptionist with prescribing or record the doctor as having used an app
    // they never opened.
    assert.match(scan, /doctor: doctor\._id/);
    assert.match(scan, /uploadedBy: req\.user\._id/);
    assert.ok(
      !/doctor: req\.user\._id/.test(scan),
      'the filer was recorded as the prescriber',
    );
  });

  test('and it is marked as never having been typed in', () => {
    // An empty `items` on a scanned prescription means "not entered", not
    // "none prescribed". Anything reading medication history has to be able to
    // tell, so the distinction is a stored field rather than an inference.
    assert.match(scan, /source: 'scanned'/);
    assert.match(model, /enum: \['composed', 'scanned'\]/);
    assert.match(model, /default: 'composed'/);
  });

  test('the date on the paper wins over the date it was filed', () => {
    // A week of prescriptions photographed in one sitting would otherwise all
    // land on today, putting every visit on the wrong day in every list that
    // sorts by it.
    assert.match(scan, /issuedOn: req\.body\.issuedOn \?\? new Date\(\)/);
  });

  test('the scan comes back with its type', () => {
    // A photograph is re-encoded to WebP on upload; one supplied as a PDF stays
    // a PDF. A phone opens a file by its name, so saving it under the wrong
    // extension finds no app that will take it.
    assert.match(route, /scanMimeType: p\.scanFile\?\.mimeType \?\? null/);
    // And every query that serialises one has to populate it, or the field is
    // silently null on the exact screens that need it.
    const populates = route.match(/populate\('scanFile', 'mimeType'\)/g) ?? [];
    assert.equal(populates.length, 3, 'a query serialises a scan without its type');
  });

  test('the file has to exist before a record points at it', () => {
    // The upload and the record are two calls, so a client can post an id for
    // something that was never uploaded or has since been deleted.
    assert.match(scan, /MediaAsset\.findOne\(\{[\s\S]*deletedAt: null/);
    assert.match(scan, /if \(!asset\) throw notFound/);
  });
});
