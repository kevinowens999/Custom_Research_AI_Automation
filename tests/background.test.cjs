const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(options = {}) {
  let clock = 0, current = 1, clicks = 0, listener, context, nexts = 0;
  const saved = {}, downloads = [], exported = [], events = [];
  const chrome = {
    runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { async get(key) { return { [key]: saved[key] }; }, async set(value) { Object.assign(saved, structuredClone(value));
      if (options.stopPage && value['job-1']?.message.includes(`Page ${options.stopPage}/`) && clicks === 3) vm.runInContext('job.cancelled=true', context);
    } } },
    tabs: { async get() { return { url: 'https://contactout.com/search' }; }, onRemoved: { addListener() {} } },
    scripting: { async executeScript(args) {
      if (args.files) return [];
      const action = args.args?.[0];
      let result;
      if (!action) result = Array.from({ length: 25 }, (_, i) => ({ name: `Contact ${current}-${i}`, company: 'Company', emails: options.revealedOnly && i >= 3 ? [] : [`person${i}@example.com`, `personal${i}@example.com`, `third${i}@example.com`], profile: `https://linkedin.com/in/${current}-${i}` }));
      else if (action === 'info' || action === 'reset') { if (action === 'reset') clicks = 0; result = { range: `page ${current}`, links: `links-${current}`, ready: true, busy: false, count: 25 - clicks }; }
      else if (action === 'clickEmail') { clicks++; events.push('click'); result = true; }
      else if (action === 'emailSettled') result = !options.unsettled;
      else if (action === 'next') { nexts++; result = !options.last; if (result && !options.unchanged) current++; }
      return [{ result }];
    } },
    debugger: { async attach() {}, async detach() {}, onDetach: { addListener() {} }, async sendCommand() { throw new Error('No screenshot commands allowed'); } },
    downloads: { async download(args) { downloads.push(args); return downloads.length; }, async search() { return [{ state: options.failedDownload ? 'interrupted' : 'complete' }]; } }
  };
  class Clock extends Date { static now() { return clock; } }
  context = vm.createContext({ chrome, URL, Date: Clock, console, importScripts() {}, makeContactWorkbook(rows) { exported.push(structuredClone(rows)); return 'data:test'; }, setTimeout(fn, ms) { clock += ms; setImmediate(fn); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  const send = message => new Promise(resolve => listener({ tabId: 1, ...message }, { id: 'test' }, resolve));
  async function finish() { for (let i = 0; i < 30000; i++) { await new Promise(resolve => setImmediate(resolve)); if (saved['job-1']?.running === false) return saved['job-1']; } throw new Error('Timeout'); }
  return { send, finish, downloads, exported, saved, events, get nexts() { return nexts; } };
}
test('ten pages yield one Excel download with 250 contacts and nine Next clicks', async () => {
  const app = setup(); await app.send({ type: 'start', pages: 10 }); const state = await app.finish();
  assert.equal(state.completed, 10); assert.equal(app.downloads.length, 1); assert.equal(app.exported[0].length, 250); assert.equal(app.nexts, 9);
  assert.match(app.downloads[0].filename, /^contactout\/.*-contacts.xlsx$/); assert.equal(app.saved['rows-1'].rows.length, 250);
});
test('Stop exports only completed pages', async () => {
  const app = setup({ stopPage: 2 }); await app.send({ type: 'start', pages: 10 }); const state = await app.finish();
  assert.match(state.message, /Stopped by you/); assert.equal(app.exported[0].length, 25); assert.equal(app.events.length, 28);
});
test('failure to change pages exports completed contacts without repeating them', async () => {
  const app = setup({ unchanged: true }); await app.send({ type: 'start', pages: 2 }); await app.finish(); assert.equal(app.exported[0].length, 25);
});
test('last page exports the available contacts', async () => {
  const app = setup({ last: true }); await app.send({ type: 'start', pages: 10 }); assert.match((await app.finish()).message, /last page/); assert.equal(app.exported[0].length, 25);
});
test('failed download retains the checkpoint and can be retried', async () => {
  const options = { failedDownload: true }, app = setup(options); await app.send({ type: 'start', pages: 1 });
  assert.match((await app.finish()).message, /download failed/); options.failedDownload = false;
  await app.send({ type: 'retry-download' }); assert.equal(app.downloads.length, 2); assert.equal(app.exported[1].length, 25);
});
test('no completed pages means no empty workbook on an unsettled reveal', async () => {
  const app = setup({ unsettled: true }); await app.send({ type: 'start', pages: 1 }); await app.finish(); assert.equal(app.downloads.length, 0);
});

test('revealed mode never clicks View email and exports only unmasked contacts over three pages', async () => {
  const app = setup({ revealedOnly: true });
  await app.send({ type: 'start', pages: 3, mode: 'revealed' });
  const state = await app.finish();
  assert.equal(state.mode, 'revealed');
  assert.equal(state.completed, 3);
  assert.equal(app.events.length, 0);
  assert.equal(app.nexts, 2);
  assert.equal(app.exported[0].length, 9);
  assert.equal(app.exported[0][0].emails.length, 3);
});
