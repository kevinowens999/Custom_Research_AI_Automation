// Real Edge rendering test, no npm dependencies. Does not use a signed-in profile.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(__dirname, `.browser-profile-${Date.now()}`);
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
let browser;
let diagnostic = '';
child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-4000); });
const deadline = setTimeout(() => { console.error('Browser capture test timed out'); child.kill(); process.exit(1); }, 90000);
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), listeners = new Map();
  socket.onclose = () => { for (const handler of pending.values()) handler.reject(new Error('Browser connection closed')); pending.clear(); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      message.error ? handlers?.reject(new Error(message.error.message)) : handlers?.resolve(message.result);
    } else listeners.get(message.method)?.(message.params);
  };
  return { socket, on: (name, fn) => listeners.set(name, fn), send(method, params = {}) {
    return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  } };
}
async function main() {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Edge startup timeout')), 20000);
    child.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('error', reject);
  });
  browser = await connect(endpoint);
  console.log('Connected to isolated Edge browser');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
  console.log('Connected to test page');
  await page.send('Runtime.enable');
  await page.send('Runtime.addBinding', { name: 'takeTestScreenshot' });
  page.on('Runtime.bindingCalled', async ({ name, payload }) => {
    if (name !== 'takeTestScreenshot') return;
    try {
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await page.send('Runtime.evaluate', { expression: `window.shotResolvers[${payload}](${JSON.stringify(screenshot.data)})` });
    } catch (error) { console.error(error); }
  });
  const html = `<!doctype html><style>article{border:1px solid;padding:10px}h3{font-weight:700}</style>
+  <article><input type="checkbox"><h3>Jane Doe</h3><a aria-label="Company website" href="https://current.example/">Website</a><a href="https://www.linkedin.com/company/current-co/">Company LinkedIn</a><a href="https://www.linkedin.com/in/jane-doe/?trk=contactout">Personal LinkedIn</a><p>Partner at Current &amp; Co in 2022 - Present</p><p>Director at Old Corp in 2010 - 2020</p><a href="mailto:jane@work.com">jane@work.com</a><span>jane@personal.com</span><span>third@example.com</span><button>View phone</button></article>
+  <article><input type="checkbox"><div style="font-weight:700">John Smith</div><a href="https://www.linkedin.com/company/old-corp/">Company LinkedIn</a><a href="https://old-corp.example/">Old employer</a><a href="https://linkedin.com.evil.example/in/john">Fake profile link</a><p>Engineer at Previous Inc in 2001 - 2007</p><span>***@gmail.com</span><button>View email</button></article>
+  <article><input type="checkbox"><h3>Zo? ?</h3><span data-testid="current-company">Example Ltd</span><a href="https://example.test/">Example Ltd</a><a href="https://linkedin.com/in/zoe/">Personal LinkedIn</a><a href="mailto:zoe@example.com">zoe@example.com</a><span>zoe@example.com</span><button>View phone</button></article>`;
  await page.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html.replace(/^\+/gm,'')).toString('base64') });
  await new Promise(resolve => setTimeout(resolve, 300));
  const source = fs.readFileSync(path.join(root, 'extract.js'), 'utf8');
  const result = await page.send('Runtime.evaluate', { returnByValue: true, expression: source + '\nextractContactRows()' });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const rows = result.result.value;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.name), ['Jane Doe', 'John Smith', 'Zo? ?']);
  assert.deepEqual(rows.map(row => row.company), ['Current & Co', '', 'Example Ltd']);
  assert.deepEqual(rows.map(row => row.emails), [['jane@work.com', 'jane@personal.com'], [], ['zoe@example.com']]);
  assert.deepEqual(rows.map(row => row.linkedin), ['https://www.linkedin.com/in/jane-doe/', '', 'https://linkedin.com/in/zoe/']);
  console.log('PASS personal LinkedIn extraction; browser extraction: separate contact rows, current employers, Unicode, masked email rejection and first two distinct emails');
  page.socket.close();
}
main().catch(error => { console.error(error, diagnostic); process.exitCode = 1; }).finally(async () => {
  if (browser) { if (browser.socket.readyState === WebSocket.OPEN) await browser.send('Browser.close').catch(() => {}); browser.socket.close(); }
  child.kill();
  clearTimeout(deadline);
});
