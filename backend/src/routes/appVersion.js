import { Router } from 'express';

import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/errors.js';

const router = Router();

/**
 * What build of the app this server expects to be talking to.
 *
 * Deliberately unauthenticated. The one moment this matters most is a client so
 * old it cannot log in — and a gate you have to sign in to reach is a gate that
 * cannot catch the case it exists for.
 *
 * Two numbers, and the difference between them is the whole point:
 *
 *   - `minBuild` is a floor. Below it the client is known to *misbehave* against
 *     this server, not merely to be old. The scan route is the reason it exists:
 *     it stopped creating medicines and began returning a preview, so an older
 *     app photographs a prescription, reads `created: []` and shows the patient
 *     nothing whatever. No error, no explanation, nothing on the app side that
 *     would lead anyone to look at the server. Being told to update is a far
 *     better experience than a feature that silently does nothing.
 *   - `latestBuild` is a suggestion. Newer exists; carry on if you like.
 *
 * Both default to 0, so a server nobody has configured gates nobody. Locking a
 * patient out of their own medicines because an environment variable was
 * mistyped is a worse failure than running a slightly old app.
 */
router.get(
  '/version',
  asyncHandler(async (req, res) => {
    res.json({
      android: {
        minBuild: env.ANDROID_MIN_BUILD,
        latestBuild: env.ANDROID_LATEST_BUILD,
        latestVersion: env.ANDROID_LATEST_VERSION || null,
      },
      // Where a blocked patient actually gets the new app. Null when unset, and
      // the client then says to contact the clinic rather than showing a button
      // that goes nowhere.
      downloadUrl: env.APP_DOWNLOAD_URL || null,
    });
  }),
);

export default router;
