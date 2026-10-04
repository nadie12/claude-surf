#!/usr/bin/env node
// claude-surf local server.
// Serves the surf page (surfd.net in an iframe + a status bar) and keeps track
// of what every Claude Code session is doing. Hooks POST state changes here;
// the page listens over Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openBrowser, PORT, HOST } = require('./common');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SETTINGS_FILE = path.join(os.homedir(), '.claude-surf.json');

// Open the browser only if Claude is still busy after this many ms,
// so quick answers don't yank you out of your editor.
const OPEN_DELAY_MS = Number(process.env.CLAUDE_SURF_DELAY_MS ?? 3000);
// A session that hasn't reported in this long is assumed to be idle
// (e.g. the turn was interrupted with Esc, which fires no Stop hook).
const STALE_MS = 30 * 60 * 1000;
// Shut down after this long with no page open and no busy session.
const IDLE_EXIT_MS = 60 * 60 * 1000;

const sessions = new Map(); // id -> { state, project, message, since, updated }
const clients = new Set();
let lastOpen = 0;
let openTimer = null;
let lastActivity = Date.now();

function loadSettings() {
  try {
    return { autoOpen: true, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { autoOpen: true };
  }
}
let settings = loadSettings();
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}

function snapshot() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.state === 'busy' && now - s.updated > STALE_MS) s.state = 'idle';
    if (s.state === 'ended' || now - s.updated > 6 * STALE_MS) sessions.delete(id);
  }
  const list = [...sessions.entries()].map(([id, s]) => ({ id, ...s }));
  const overall = list.some(s => s.state === 'attention') ? 'attention'
    : list.some(s => s.state === 'busy') ? 'busy'
    : list.length ? 'idle' : 'none';
  return { overall, sessions: list, settings, now };
}

function broadcast() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

function anyBusy() {
  return [...sessions.values()].some(s => s.state === 'busy');
}

function openNow() {
  if (!settings.autoOpen || clients.size > 0) return;
  if (Date.now() - lastOpen < 20000) return; // a tab is probably still loading
  lastOpen = Date.now();
  openBrowser(`http://${HOST}:${PORT}/`);
}

function scheduleOpen() {
  if (!settings.autoOpen || clients.size > 0 || openTimer) return;
  openTimer = setTimeout(() => {
    openTimer = null;
    if (anyBusy()) openNow();
  }, OPEN_DELAY_MS);
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const url = new URL(req.url, `http://${HOST}`);

  // Only accept requests addressed to localhost (blocks DNS-rebinding tricks).
  const host = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); return res.end(); }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, app: 'claude-surf', clients: clients.size, autoOpen: settings.autoOpen }));
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/state') {
    // Hooks run locally and send JSON; a browser form can't, so this also
    // stops random web pages from poking the server.
    if (!String(req.headers['content-type']).includes('application/json')) { res.writeHead(415); return res.end(); }
    const b = await readBody(req);
    const id = String(b.session || 'default');
    const prev = sessions.get(id);
    const state = ['busy', 'idle', 'attention', 'ended'].includes(b.state) ? b.state : 'idle';
    // Heartbeats (from PostToolUse) only keep a running turn alive or clear an
    // "attention" state once a permission prompt is answered.
    if (b.heartbeat && (!prev || prev.state === 'idle')) { res.writeHead(204); return res.end(); }
    const keepSince = prev && (b.heartbeat || prev.state === state);
    sessions.set(id, {
      state,
      project: b.project ? path.basename(String(b.project)) : prev?.project || '',
      message: b.message ? String(b.message).slice(0, 200) : '',
      since: keepSince ? prev.since : Date.now(),
      updated: Date.now(),
    });
    // In the desktop app the plugin's pane module opens Claude's own browser pane instead.
    if (state === 'busy' && !b.heartbeat && !b.desktop) scheduleOpen();
    if (b.heartbeat && prev.state === state) { res.writeHead(204); return res.end(); }
    broadcast();
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/open') {
    if (!String(req.headers['content-type']).includes('application/json')) { res.writeHead(415); return res.end(); }
    openNow();
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/settings') {
    if (!String(req.headers['content-type']).includes('application/json')) { res.writeHead(415); return res.end(); }
    const b = await readBody(req);
    if (typeof b.autoOpen === 'boolean') settings.autoOpen = b.autoOpen;
    saveSettings();
    broadcast();
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/shutdown') {
    res.writeHead(204);
    res.end();
    return process.exit(0);
  }

  if (req.method === 'GET') {
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(PUBLIC_DIR, path.normalize(file));
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    return fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  }

  res.writeHead(404);
  res.end();
});

server.on('error', err => {
  // Another instance already owns the port: nothing to do.
  if (err.code === 'EADDRINUSE') process.exit(0);
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`claude-surf listening on http://${HOST}:${PORT}/`);
});

// Keep SSE connections alive, expire stale sessions, and exit when unused.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
  broadcast();
  if (clients.size === 0 && !anyBusy() && Date.now() - lastActivity > IDLE_EXIT_MS) process.exit(0);
}, 15000).unref?.();
