import { env } from './env.js';

/**
 * Whether this process may reach a real person, or a real account.
 *
 * ---- The failure this closes -----------------------------------------------
 *
 * Every sender decides "send or log" from whether its credentials are present.
 * That is the right question for a laptop and for a server, and the wrong one
 * for a test run on a laptop whose .env holds the clinic's live keys. With
 * MSG91 configured, the desk-enrolment tests asked MSG91 to text a one-time code
 * to two real-looking Indian numbers from the clinic's sender ID, and the
 * practice-application tests did the same to a third. Any run in which MSG91
 * accepted the request sent a real message to a stranger. The suite only
 * noticed on the day the request timed out.
 *
 * ---- So the answer is about the process, not the configuration ----------
 *
 * A test must never text, email, push or bill anybody, whatever the machine
 * running it has in its .env. Node's test runner marks every file it runs with
 * NODE_TEST_CONTEXT — `npm test` and `node --test one.test.js` alike — and
 * NODE_ENV=test or MEDPIN_OUTBOUND=off say the same for anything started some
 * other way.
 *
 * Read at call time, never cached at import: the order modules were loaded in
 * must not be able to change the answer.
 */
export function outboundBlocked() {
  return (
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.NODE_ENV === 'test' ||
    env.NODE_ENV === 'test' ||
    process.env.MEDPIN_OUTBOUND === 'off'
  );
}
