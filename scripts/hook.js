#!/usr/bin/env node
// Claude Code hook entry point: `node hook.js <busy|heartbeat|idle|attention|ended|open|stop>`
// Reports the session's state to the local server, starting it if needed.
// Never prints to stdout (UserPromptSubmit stdout would be added to Claude's context)
// and always exits 0 so it can't block Claude.

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { PORT, HOST, openBrowser } = require('./common');

const action = process.argv[2] || 'idle';

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      host: HOST, port: PORT, path: urlPath, method, timeout: 1000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

async function isUp() {
  try {
    const r = await request('GET', '/health');
    return JSON.parse(r.body).app === 'claude-surf';
  } catch { return false; }
}

async function ensureServer() {
  if (await isUp()) return true;
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await isUp()) return true;
  }
  return false;
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve({});
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    setTimeout(() => resolve({}), 500);
  });
}

(async () => {
  if (process.env.CLAUDE_SURF_DISABLE === '1') return;

  if (action === 'stop') {
    try { await request('POST', '/shutdown', {}); } catch {}
    return;
  }

  const input = await readStdin();

  // "Claude is waiting for your input" fires a minute after a turn ends; that's not news.
  if (action === 'attention' && (input.notification_type === 'idle_prompt' || /waiting for your input/i.test(input.message || ''))) return;

  // Nothing to report for a session that ends while the server is down.
  if (['ended', 'idle', 'heartbeat'].includes(action) && !(await isUp())) return;
  if (!(await ensureServer())) return;

  if (action === 'open') {
    openBrowser(`http://${HOST}:${PORT}/`);
    return;
  }

  await request('POST', '/state', {
    session: input.session_id,
    project: input.cwd,
    state: action === 'heartbeat' ? 'busy' : action,
    heartbeat: action === 'heartbeat',
    message: input.message,
  }).catch(() => {});
})().catch(() => {}).finally(() => process.exit(0));
