/**
 * MedPin admin — the whole panel.
 *
 * No framework. Four screens with no shared mutable state beyond "am I signed
 * in" earn neither a build step nor a virtual DOM, and a third toolchain is a
 * real ongoing cost for one developer already running Flutter and Node.
 *
 * ---- The token lives in memory, not in storage ---------------------------
 *
 * `localStorage` survives the tab closing, which is convenient and wrong for
 * this account: it can suspend every practice on the platform, and anything
 * that can run script on this origin could read it back. Held in a variable, a
 * closed tab is a signed-out session and the two-hour server expiry is a
 * ceiling rather than a formality.
 *
 * The cost is a sign-in after every refresh. For a panel used a few times a
 * week by one person, that is the right trade.
 */

// Same-origin is wrong here on purpose: this page is served from its own
// subdomain precisely so it is not the API's origin.
//
// 4000 because that is what `PORT` is in the backend's .env and what
// `npm start` prints. It was 3000 — a plausible default that was simply not
// this project's, so the panel opened locally and every call failed on a
// refused connection with nothing to say why.
//
// `?api=` overrides it, for the case where the API is on another port or
// machine. Query-string only: nothing persists it, so a stale value cannot
// outlive the tab and point a later session somewhere unexpected.
const LOCAL = new Set(['localhost', '127.0.0.1']);
const API =
  new URLSearchParams(location.search).get('api') ??
  (LOCAL.has(location.hostname)
    ? 'http://127.0.0.1:4000/api/v1'
    : 'https://clinq.flintdeorient.in/api/v1');

let token = null;
let admin = null;
let statusFilter = '';
let totpEnabled = false;

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- network */

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // A 404 on this namespace means ADMIN_JWT_SECRET is unset on the server —
  // the panel is switched off rather than broken, and saying so saves an hour
  // of looking for a bug that is a missing environment variable.
  if (res.status === 404 && !path.startsWith('/admin/practices/')) {
    throw new Error('The admin API is switched off on this server (ADMIN_JWT_SECRET is not set).');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* a 204 or an HTML error page; handled by the status check below */
  }

  if (!res.ok) {
    // An expired session should return you to the sign-in screen rather than
    // leaving a dead page behind an error message.
    if (res.status === 401 && token) signOut();
    const err = new Error(data?.error?.message ?? `Request failed (${res.status})`);
    // The code, not just the sentence. `TOTP_REQUIRED` arrives as a 401 and
    // means "carry on", where every other 401 here means "start again" — a
    // caller matching on the wording would break the moment it was reworded.
    err.code = data?.error?.code ?? null;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ chrome */

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function signOut() {
  token = null;
  admin = null;
  $('mainView').hidden = true;
  $('who').hidden = true;
  $('resetView').hidden = true;
  $('loginView').hidden = false;
  $('password').value = '';
  // Both legs reset together. A stale code left in the box would be submitted
  // with the next attempt and fail for a reason nobody could see.
  $('totpRow').hidden = true;
  $('loginTotp').value = '';
  $('loginBtn').textContent = 'Sign in';
}

/* ------------------------------------------------------------------- login */

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.hidden = true;
  $('loginBtn').disabled = true;

  const code = $('loginTotp').value.trim();

  try {
    const out = await call('/admin/auth/login', {
      method: 'POST',
      body: {
        email: $('email').value.trim(),
        password: $('password').value,
        ...(code ? { totp: code } : {}),
      },
    });
    signedIn(out);
  } catch (ex) {
    // The password was right and the account has a factor. Not a failure —
    // ask for the code and keep everything else where it is, because clearing
    // the form and starting over is how a second factor gets turned off again.
    if (ex.code === 'TOTP_REQUIRED') {
      $('totpRow').hidden = false;
      $('loginBtn').textContent = 'Verify';
      $('loginTotp').value = '';
      $('loginTotp').focus();
      showError(err, ex.message);
    } else {
      $('loginTotp').value = '';
      showError(err, ex.message);
    }
  } finally {
    $('loginBtn').disabled = false;
  }
});

/** Both ways in end here: the login, and a reset followed by a login. */
function signedIn(out) {
  token = out.token;
  admin = out.admin;

  $('whoEmail').textContent = admin.email;
  $('who').hidden = false;
  $('loginView').hidden = true;
  $('resetView').hidden = true;
  $('mainView').hidden = false;
  $('password').value = '';
  $('loginTotp').value = '';
  $('totpRow').hidden = true;
  $('loginBtn').textContent = 'Sign in';

  // The server returns this on every sign-in so the panel can say something.
  // An account that can suspend every practice on the platform and is held by
  // a password alone should be told, every time, until it is not.
  totpEnabled = Boolean(out.totpEnabled ?? admin.totpEnabled);

  // Always the practice list, even for somebody who signed out from the audit
  // tab. The panel is opened to find out what is waiting.
  openTab('practices');
}

$('signOut').addEventListener('click', signOut);

/* ------------------------------------------------------------------- reset */

$('forgotBtn').addEventListener('click', () => {
  $('resetError').hidden = true;
  $('resetForm').reset();
  // Carried across rather than retyped — whoever is here has already told the
  // page who they are once.
  $('rEmail').value = $('email').value.trim();
  $('loginView').hidden = true;
  $('resetView').hidden = false;
});

$('backBtn').addEventListener('click', () => {
  $('resetView').hidden = true;
  $('loginView').hidden = false;
});

$('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('resetError');
  err.hidden = true;

  const newPassword = $('rPassword').value;
  if (newPassword.length < 12) {
    return showError(err, 'Choose a password of at least 12 characters.');
  }

  $('resetBtn').disabled = true;
  try {
    const totp = $('rTotp').value.trim();
    await call('/admin/auth/reset', {
      method: 'POST',
      body: {
        email: $('rEmail').value.trim(),
        token: $('rToken').value.trim(),
        newPassword,
        ...(totp ? { totp } : {}),
      },
    });

    // No session comes back, deliberately: choosing a password is not signing
    // in. So this lands on the login with the email filled and the rest empty.
    $('email').value = $('rEmail').value.trim();
    $('resetForm').reset();
    $('resetView').hidden = true;
    $('loginView').hidden = false;
    $('password').focus();
    toast('Password changed. Sign in with it.');
  } catch (ex) {
    showError(err, ex.message);
  } finally {
    $('resetBtn').disabled = false;
  }
});

/* --------------------------------------------------------------- practices */

/** Status and verification are different facts, so they are different badges. */
function badges(p) {
  const status = { active: 'ok', onboarding: 'warn', suspended: 'bad' }[p.status] ?? 'mute';
  const verify = { verified: 'ok', pending: 'warn', rejected: 'bad' }[p.verification] ?? 'mute';
  return `
    <span class="badge ${status}">${p.status}</span>
    <span class="badge ${verify}">${p.verification}</span>`;
}

/** True when this practice is waiting on the operator to do something. */
const isWaiting = (p) => p.verification === 'pending' || p.status === 'onboarding';

function render(items) {
  const list = $('practiceList');

  if (!items.length) {
    list.innerHTML = `<p class="empty">${
      statusFilter
        ? 'No practices with that status.'
        : 'No practices yet. Add the first one above.'
    }</p>`;
    return;
  }

  // Anything waiting on a decision sorts to the top: the panel is opened to
  // find out what needs doing, not to browse.
  const sorted = [...items].sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)));

  list.innerHTML = sorted
    .map(
      (p) => `
    <article class="card ${isWaiting(p) ? 'waiting' : ''}">
      <div class="top">
        <div>
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">
            ${p.registrationNo ? `Reg. ${escapeHtml(p.registrationNo)} · ` : ''}${p.locations} location${
              p.locations === 1 ? '' : 's'
            } · ${p.staff} staff
          </div>
        </div>
        <div class="badges">${badges(p)}</div>
      </div>
      <div class="actions">
        ${
          p.verification !== 'verified'
            ? `<button class="ghost small" data-verify="${p.id}">Mark verified</button>`
            : ''
        }
        ${
          p.verification !== 'rejected'
            ? `<button class="ghost small" data-reject="${p.id}" data-name="${escapeAttr(
                p.name,
              )}">Reject</button>`
            : ''
        }
        ${
          p.status !== 'active'
            ? `<button class="ghost small" data-activate="${p.id}">Activate</button>`
            : `<button class="ghost small" data-suspend="${p.id}" data-name="${escapeAttr(
                p.name,
              )}">Suspend</button>`
        }
      </div>
    </article>`,
    )
    .join('');
}

async function loadPractices() {
  try {
    const out = await call(`/admin/practices${statusFilter ? `?status=${statusFilter}` : ''}`);
    render(out.items);
  } catch (ex) {
    $('practiceList').innerHTML = `<p class="error">${escapeHtml(ex.message)}</p>`;
  }
}

/* Delegated, so the buttons rendered above need no wiring of their own. */
$('practiceList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const { verify, reject, activate, suspend, name } = btn.dataset;

  try {
    if (verify) {
      await call(`/admin/practices/${verify}/verification`, {
        method: 'POST',
        body: { verification: 'verified' },
      });
      toast('Marked verified');
    } else if (activate) {
      await call(`/admin/practices/${activate}/status`, {
        method: 'POST',
        body: { status: 'active' },
      });
      toast('Activated');
    } else if (reject || suspend) {
      // Both need a reason, and the server refuses without one. Asking here
      // rather than letting the request fail keeps the explanation in front of
      // the person who has to write it.
      const isReject = Boolean(reject);
      const reason = await askReason({
        // The name again, in the dialog, even though it was on the row that was
        // clicked. With several practices on screen the row and the dialog are
        // different moments, and this is the one that does something.
        title: isReject ? `Reject ${name}` : `Suspend ${name}`,
        why: isReject
          ? 'The applicant sees this. Say what was wrong with the registration.'
          : 'Staff will not be able to sign in. Patients keep their records, prescriptions and reminders.',
        confirm: isReject ? 'Reject' : 'Suspend',
      });
      if (reason === null) return;

      if (isReject) {
        await call(`/admin/practices/${reject}/verification`, {
          method: 'POST',
          body: { verification: 'rejected', reason },
        });
        toast('Rejected');
      } else {
        await call(`/admin/practices/${suspend}/status`, {
          method: 'POST',
          body: { status: 'suspended', reason },
        });
        toast('Suspended');
      }
    } else {
      return;
    }
    await loadPractices();
  } catch (ex) {
    toast(ex.message);
  }
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.chip')) c.classList.remove('is-on');
    chip.classList.add('is-on');
    statusFilter = chip.dataset.status;
    loadPractices();
  });
}

/* ------------------------------------------------------------------ create */

$('newBtn').addEventListener('click', () => {
  $('newForm').reset();
  $('newError').hidden = true;
  $('newDialog').showModal();
});

$('newForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'create') return;
  e.preventDefault();

  const name = $('pName').value.trim();
  if (name.length < 2) return showError($('newError'), 'A practice needs a name.');

  try {
    await call('/admin/practices', {
      method: 'POST',
      body: {
        name,
        doctorDisplayName: $('pDoctor').value.trim() || undefined,
        registrationNo: $('pReg').value.trim() || undefined,
      },
    });
    $('newDialog').close();
    toast('Practice created — onboarding, unverified');
    await loadPractices();
  } catch (ex) {
    showError($('newError'), ex.message);
  }
});

/* ------------------------------------------------------------------ reason */

/** Resolves with the text, or null when cancelled. */
function askReason({ title, why, confirm }) {
  return new Promise((resolve) => {
    const dialog = $('reasonDialog');
    $('reasonTitle').textContent = title;
    $('reasonWhy').textContent = why;
    $('reasonOk').textContent = confirm;
    $('reasonText').value = '';
    $('reasonError').hidden = true;

    const onSubmit = (e) => {
      if (e.submitter?.value !== 'ok') return; // cancel closes on its own
      const text = $('reasonText').value.trim();
      if (!text) {
        e.preventDefault();
        return showError($('reasonError'), 'A reason is required.');
      }
      cleanup();
      resolve(text);
    };
    const onClose = () => {
      cleanup();
      resolve(null);
    };
    function cleanup() {
      $('reasonForm').removeEventListener('submit', onSubmit);
      dialog.removeEventListener('close', onClose);
    }

    $('reasonForm').addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose, { once: true });
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------- audit */

async function loadAudit() {
  const body = $('auditTable').querySelector('tbody');
  try {
    const out = await call('/admin/audit?limit=100');
    body.innerHTML = out.items.length
      ? out.items
          .map(
            (r) => `<tr>
              <td class="num">${new Date(r.at).toLocaleString()}</td>
              <td>${escapeHtml(r.admin)}</td>
              <td class="mono">${escapeHtml(r.action)}</td>
              <td>${diffOf(r)}</td>
              <td>${r.reason ? escapeHtml(r.reason) : '<span class="badge mute">—</span>'}</td>
            </tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>';
  } catch (ex) {
    body.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(ex.message)}</td></tr>`;
  }
}

/* ----------------------------------------------------------------- account */

/**
 * The account screen, and the only place the second factor can be changed.
 *
 * These routes existed before this screen did, which meant enrolling was a
 * documented curl exercise — and worse, the login had no field for a code, so
 * turning the factor on locked you out of the panel that turned it on. A route
 * with no caller is a feature nobody has.
 */
async function loadAccount() {
  try {
    // `/me` rather than the login response: after enabling or disabling the
    // factor, the response is the record, and re-reading it means the screen
    // agrees with the server rather than with what was true at sign-in.
    const out = await call('/admin/me');
    admin = out.admin;
  } catch (ex) {
    toast(ex.message);
    return;
  }

  $('acEmail').textContent = admin.email;
  $('acName').textContent = admin.name || '—';
  $('acLast').textContent = admin.lastLoginAt
    ? new Date(admin.lastLoginAt).toLocaleString()
    : 'This is the first one.';

  totpEnabled = Boolean(admin.totpEnabled);
  showTotp(totpEnabled ? 'on' : 'off');
}

/** One of three: 'off', 'setup' (mid-enrolment), 'on'. */
function showTotp(state) {
  $('totpOff').hidden = state !== 'off';
  $('totpSetup').hidden = state !== 'setup';
  $('totpOn').hidden = state !== 'on';
  $('totpState').textContent = {
    off: 'Off. Your password is the only thing protecting this account.',
    setup: 'Not on yet — finish by entering a code from the app.',
    on: 'On. A code from your authenticator app is needed at every sign-in.',
  }[state];
  // The nag disappears the moment it is dealt with, not at the next sign-in.
  $('totpNag').hidden = state === 'on';
}

$('totpSetupBtn').addEventListener('click', async () => {
  $('totpError').hidden = true;
  try {
    const out = await call('/admin/me/totp/setup', { method: 'POST' });
    // Grouped in fours. This gets typed into a phone by hand, and an unbroken
    // run of base32 is where the typing goes wrong.
    $('totpSecret').textContent = (out.secret.match(/.{1,4}/g) ?? []).join(' ');
    $('totpSecret').dataset.raw = out.secret;
    $('enableTotp').value = '';
    showTotp('setup');
    $('enableTotp').focus();
  } catch (ex) {
    toast(ex.message);
  }
});

$('copySecret').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('totpSecret').dataset.raw ?? '');
    toast('Copied');
  } catch {
    // http, or a browser that refuses. The key is on screen either way, which
    // is the part that matters.
    toast('Copy is blocked here — type it from the screen.');
  }
});

$('totpEnableBtn').addEventListener('click', async () => {
  const err = $('totpError');
  err.hidden = true;
  const code = $('enableTotp').value.trim();
  if (!/^\d{6}$/.test(code)) return showError(err, 'Six digits from the app.');

  $('totpEnableBtn').disabled = true;
  try {
    await call('/admin/me/totp/enable', { method: 'POST', body: { totp: code } });
    totpEnabled = true;
    showTotp('on');
    $('disableTotp').value = '';
    toast('Two-factor is on');
  } catch (ex) {
    showError(err, ex.message);
  } finally {
    $('totpEnableBtn').disabled = false;
  }
});

$('totpCancelBtn').addEventListener('click', () => {
  // The secret is on the account now but the factor is off, so nothing is
  // broken by walking away — starting again mints a new one.
  showTotp('off');
});

$('totpDisableBtn').addEventListener('click', async () => {
  const err = $('disableError');
  err.hidden = true;
  const code = $('disableTotp').value.trim();
  if (!/^\d{6}$/.test(code)) return showError(err, 'Six digits from the app.');

  $('totpDisableBtn').disabled = true;
  try {
    await call('/admin/me/totp/disable', { method: 'POST', body: { totp: code } });
    totpEnabled = false;
    showTotp('off');
    toast('Two-factor is off');
  } catch (ex) {
    showError(err, ex.message);
  } finally {
    $('totpDisableBtn').disabled = false;
  }
});

$('nagBtn').addEventListener('click', () => openTab('account'));

/* -------------------------------------------------------------------- tabs */

function openTab(view) {
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('is-on', t.dataset.view === view);
  }
  $('practicesView').hidden = view !== 'practices';
  $('auditView').hidden = view !== 'audit';
  $('accountView').hidden = view !== 'account';
  // Not above the screen that fixes it, where it would be a banner pointing at
  // the button underneath it.
  $('totpNag').hidden = totpEnabled || view === 'account';

  // Loaded on arrival rather than once at sign-in. Coming back to a tab after
  // acting on another one should show what is true now, not what was true
  // several decisions ago.
  if (view === 'practices') loadPractices();
  if (view === 'audit') loadAudit();
  if (view === 'account') loadAccount();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => openTab(tab.dataset.view));
}

/**
 * "active -> suspended", from whichever fields actually moved.
 *
 * "Changed permission" with no values is an entry nobody can review, and the
 * question asked six months later is always what it used to be. Only the keys
 * that differ, so a row reads as a change rather than two copies of a record.
 */
function diffOf(r) {
  if (!r.after) return '<span class="badge mute">—</span>';
  // Nothing existed before a creation, and `null` says that rather than
  // pretending the fields moved from empty.
  if (!r.before) return '<span class="badge mute">created</span>';

  const moved = Object.keys(r.after).filter((k) => r.before[k] !== r.after[k]);
  if (!moved.length) return '<span class="badge mute">no change</span>';

  return moved
    .map(
      (k) =>
        `<span class="diff"><s>${escapeHtml(r.before[k] ?? '—')}</s> ` +
        `<b>${escapeHtml(r.after[k] ?? '—')}</b></span>`,
    )
    .join(' ');
}

/* ------------------------------------------------------------------ escape */

// Practice names are typed by whoever created them and rendered into innerHTML.
// Not a hostile-input problem so much as an apostrophe problem — but the two
// are the same bug, and the fix is the same.
function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
const escapeAttr = escapeHtml;
