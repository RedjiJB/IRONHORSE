// A minimal, purpose-built static page for the supervisor live-roster and
// approve/reject queue -- plain HTML/JS, no framework, no build step.
// This is NOT the long-term frontend decision (Phase 0 kept the vendored
// OpenConstructionERP fork for that, see ROADMAP.md) -- integrating this
// domain into that fork's data model is real, separate work not done yet.
// This page exists so Phase 1's supervisor features are actually usable
// and testable in a browser today, matching PRECEDENT-ARCHITECTURE.md §7's
// discipline of never leaving a built backend with no real surface calling
// it.
import type { Router } from "../router.js";

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>IRONHORSE -- Supervisor</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
  button { cursor: pointer; padding: 0.25rem 0.6rem; margin-right: 0.25rem; }
  #login { display: flex; gap: 0.5rem; align-items: center; }
  #status { font-size: 0.85rem; color: #666; margin-top: 0.5rem; }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
  .on-duty { background: #d4f7dc; }
  .off-duty { background: #eee; color: #888; }
</style>
</head>
<body>
  <h1>IRONHORSE -- Supervisor</h1>
  <div id="login">
    <input id="phone" placeholder="Supervisor phone (e.g. +15550002222)" size="28">
    <button id="loginBtn">Log in</button>
    <span id="who"></span>
  </div>
  <div id="status"></div>

  <h2>Live roster</h2>
  <table id="rosterTable"><thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody></tbody></table>

  <h2>Pending approvals</h2>
  <table id="pendingTable"><thead><tr><th>Summary</th><th>Submitted</th><th></th></tr></thead><tbody></tbody></table>

<script src="/app.js"></script>
</body>
</html>`;

const APP_JS = `
let token = null;

function setStatus(msg) { document.getElementById('status').textContent = msg; }

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || ('HTTP ' + res.status));
  return body;
}

async function login() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) return;
  try {
    const result = await api('/auth/dev-login', { method: 'POST', body: JSON.stringify({ phone }) });
    token = result.accessToken;
    document.getElementById('who').textContent = 'Logged in as ' + result.guard.name + ' (' + result.guard.role + ')';
    setStatus('');
    await refresh();
  } catch (err) {
    setStatus('Login failed: ' + err.message);
  }
}

async function refresh() {
  if (!token) return;
  try {
    const { guards } = await api('/guards/on-duty');
    const rosterBody = document.querySelector('#rosterTable tbody');
    rosterBody.innerHTML = guards.map((g) =>
      '<tr><td>' + g.name + '</td><td>' + g.role + '</td><td><span class="badge ' +
      (g.on_duty_site_id ? 'on-duty' : 'off-duty') + '">' +
      (g.on_duty_site_id ? 'On duty' : 'Off duty') + '</span></td></tr>'
    ).join('');

    const { pending } = await api('/confirmations/pending');
    const pendingBody = document.querySelector('#pendingTable tbody');
    pendingBody.innerHTML = pending.map((p) =>
      '<tr><td>' + p.summary + '</td><td>' + new Date(p.created_at).toLocaleString() + '</td><td>' +
      '<button data-approve="' + p.id + '">Approve</button>' +
      '<button data-reject="' + p.id + '">Reject</button></td></tr>'
    ).join('');
  } catch (err) {
    setStatus('Refresh failed: ' + err.message);
  }
}

document.addEventListener('click', async (e) => {
  const approveId = e.target.getAttribute && e.target.getAttribute('data-approve');
  const rejectId = e.target.getAttribute && e.target.getAttribute('data-reject');
  if (approveId) {
    await api('/confirmations/' + approveId + '/approve', { method: 'POST', body: '{}' });
    await refresh();
  } else if (rejectId) {
    await api('/confirmations/' + rejectId + '/reject', { method: 'POST', body: '{}' });
    await refresh();
  }
});

document.getElementById('loginBtn').addEventListener('click', login);
setInterval(refresh, 10000);
`;

export function registerUiRoutes(router: Router): void {
  router.get("/", (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });

  router.get("/app.js", (_req, res) => {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(APP_JS);
  });
}
