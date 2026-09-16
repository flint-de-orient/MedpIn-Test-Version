/**
 * pm2, for both environments — and the one place their ports are declared.
 *
 *   pm2 start deploy/ecosystem.config.cjs --only clinq
 *   pm2 start deploy/ecosystem.config.cjs --only clinq-staging
 *   pm2 save
 *
 * ---- Why both live in one file ------------------------------------------
 *
 * Because the thing that goes wrong with a second environment is that it stops
 * being separate. A port reused, a database name copied, an upload directory
 * shared — each is invisible until staging writes to production, and by then
 * the question "were they ever actually separate" has no quick answer.
 *
 * Declared together, the differences are readable in one screen, and
 * `deploymentIsSeparate.test.js` asserts them: different port, different database,
 * different upload directory, different working copy.
 *
 * ---- What is deliberately NOT here --------------------------------------
 *
 * Secrets. pm2 reads `env_file`, and the two `.env` files stay on the server,
 * never in git. This file names which one each app reads and nothing else.
 */
module.exports = {
  apps: [
    {
      name: 'clinq',
      cwd: '/var/www/clinq/backend',
      script: 'src/server.js',
      env_file: '/var/www/clinq/backend/.env',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // The scheduler runs here and only here. Two processes sending the same
      // medication reminder is worse than none sending it: a patient who is
      // messaged twice about one dose stops trusting the messages.
      autorestart: true,
      time: true,
    },
    {
      name: 'clinq-staging',
      // Its own working copy, so a `git pull` on one cannot move the other.
      // A shared checkout with two branches was considered and rejected: the
      // failure mode is production running staging's code between a checkout
      // and a restart, which is a window nobody would think to look at.
      cwd: '/var/www/clinq-staging/backend',
      script: 'src/server.js',
      env_file: '/var/www/clinq-staging/backend/.env',
      env: {
        // Genuinely production mode, not 'development'.
        //
        // Staging exists to be a rehearsal, and half the behaviour worth
        // rehearsing is production-only: error detail is withheld, the
        // scheduler arms, cookies are Secure. A staging box running in
        // development mode rehearses a different application.
        NODE_ENV: 'production',
        PORT: 4001,
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      autorestart: true,
      time: true,
    },
  ],
};
