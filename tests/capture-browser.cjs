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
  const helpers = fs.readFileSync(path.join(root, 'reveal.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'capture.js'), 'utf8');
  const output = path.join(__dirname, 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { kind: 'nested', nested: true, dpr: 1 }, { kind: 'nested', nested: true, dpr: 1.25 },
    { kind: 'document', nested: false, dpr: 1 }, { kind: 'document', nested: false, dpr: 1.25 },
    { kind: 'hidden-div-controls', nested: true, dpr: 1, hidden: true },
    { kind: 'hidden-no-controls', nested: true, dpr: 1.25, hidden: true, noControls: true }
  ];
  for (const { kind, nested, dpr, hidden, noControls } of cases) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: dpr, mobile: false });
    const rows = Array.from({ length: 25 }, (_, i) => `<article style="height:180px;background:rgb(${20 + i * 8},80,120)"><b>CONTACT ${i + 1}</b><span>person${i + 1}@example.com</span>${noControls ? '' : hidden ? '<div role="button">View phone</div>' : '<button>View phone</button>'}</article>`).join('');
    const html = `<style>*{box-sizing:border-box}body{margin:0;background:white;font:20px Arial}header{height:60px;background:#ddd}aside{position:fixed;left:0;top:60px;width:200px;height:400px;background:#eee}main{margin-left:200px;width:1000px;${nested ? `height:480px;overflow-y:${hidden ? 'hidden' : 'auto'}` : ''}}article{padding:20px}span{float:right}footer{height:40px;background:#bbb}</style><header>ContactOut test header</header><aside>Search filters</aside><main>${rows}</main><footer>Pagination</footer>`;
    await page.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = await page.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{
      ${helpers}
      window.shotResolvers = [];
      const scroller = ${nested ? "document.querySelector('main')" : 'document.scrollingElement'};
      scroller.scrollTop = 137;
      const before = scroller.scrollTop;
      let shots = 0;
      const url = await captureLongPage({step: async (method,arg)=>__coPage[method](arg), wait: ms=>new Promise(r=>setTimeout(r,ms)), check(){}, progress(){},
        shot: ()=>new Promise(resolve=>{const id=shotResolvers.push(resolve)-1; shots++; takeTestScreenshot(String(id));})});
      __coPage.restoreCapture();
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width,bitmap.height); const ctx=canvas.getContext('2d'); ctx.drawImage(bitmap,0,0);
      const colors = Array.from({length:25},(_,i)=>Array.from(ctx.getImageData(Math.round(500*${dpr}),Math.round((60+i*180+90)*${dpr}),1,1).data));
      return {url, width:bitmap.width,height:bitmap.height,colors,shots,restored:scroller.scrollTop===before};
    })()` });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    const value = result.result.value;
    assert.equal(value.width, 1200 * dpr);
    assert.equal(value.height, (nested ? 4820 : 4600) * dpr);
    assert.equal(value.restored, true);
    assert.ok(value.shots > 5);
    value.colors.forEach((color, i) => assert.deepEqual(color, [20 + i * 8, 80, 120, 255], `Row ${i + 1} has wrong pixels`));
    const name = `${kind}-${dpr}.png`;
    fs.writeFileSync(path.join(output, name), Buffer.from(value.url.split(',')[1], 'base64'));
    console.log(`PASS ${name}: ${value.width}x${value.height}, ${value.shots} tiles, all 25 rows, scroll restored`);
  }
  page.socket.close();
}
main().catch(error => { console.error(error, diagnostic); process.exitCode = 1; }).finally(async () => {
  if (browser) { if (browser.socket.readyState === WebSocket.OPEN) await browser.send('Browser.close').catch(() => {}); browser.socket.close(); }
  child.kill();
  clearTimeout(deadline);
});
