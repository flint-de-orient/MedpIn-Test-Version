/**
 * MedPin admin — the whole panel.
 *
 * No framework. Three screens with no shared mutable state beyond "am I signed
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
const API =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/v1'
    : 'https://clinq.flintdeorient.in/api/v1';

let token = null;
let admin = null;
let statusFilter = '';

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
    throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
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
  $('loginView').hidden = false;
  $('password').value = '';
}

/* ------------------------------------------------------------------- login */

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.hidden = true;
  $('loginBtn').disabled = true;

  try {
    const out = await call('/admin/auth/login', {
      method: 'POST',
      body: { email: $('email').value.trim(), password: $('password').value },
    });
    token = out.token;
    admin = out.admin;

    $('whoEmail').textContent = admin.email;
    $('who').hidden = false;
    $('loginView').hidden = true;
    $('mainView').hidden = false;
    $('password').value = '';
    await loadPractices();
  } catch (ex) {
    showError(err, ex.message);
  } finally {
    $('loginBtn').disabled = false;
  }
});

$('signOut').addEventListener('click', signOut);

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
        title: isReject ? 'Reject this practice' : `Suspend ${name}`,
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
              <td>${r.reason ? escapeHtml(r.reason) : '<span class="badge mute">—</span>'}</td>
            </tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>';
  } catch (ex) {
    body.innerHTML = `<tr><td colspan="4" class="error">${escapeHtml(ex.message)}</td></tr>`;
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.remove('is-on');
    tab.classList.add('is-on');
    const audit = tab.dataset.view === 'audit';
    $('auditView').hidden = !audit;
    $('practicesView').hidden = audit;
    if (audit) loadAudit();
  });
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
