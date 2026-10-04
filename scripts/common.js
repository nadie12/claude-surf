const { spawn } = require('child_process');

const PORT = Number(process.env.CLAUDE_SURF_PORT || 7357);
const HOST = '127.0.0.1';

function openBrowser(url) {
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  let child;
  if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '""', url], opts);
  else if (process.platform === 'darwin') child = spawn('open', [url], opts);
  else child = spawn('xdg-open', [url], opts);
  child.on('error', () => {});
  child.unref();
}

module.exports = { PORT, HOST, openBrowser };
