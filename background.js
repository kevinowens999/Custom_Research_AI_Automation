importScripts("excel.js");
let job = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const supported = address => {
  try { const url = new URL(address); return url.protocol === "https:" && (url.hostname === "contactout.com" || url.hostname.endsWith(".contactout.com")); }
  catch { return false; }
};
function view(j) { return { running: j.running, message: j.message, pages: j.pages, completed: j.completed }; }
async function report(j, message) {
  j.message = message;
  await chrome.storage.session.set({ [`job-${j.tabId}`]: view(j) });
}
function check(j) { if (j.cancelled) throw new Error("Stopped by you."); }
async function pause(j, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) { check(j); await sleep(Math.min(100, ms - elapsed)); }
  check(j);
}
async function page(j, action, argument) {
  check(j);
  if (!supported((await chrome.tabs.get(j.tabId)).url)) throw new Error("The tab left ContactOut. Stopped.");
  check(j);
  const [result] = await chrome.scripting.executeScript({ target: { tabId: j.tabId },
    func: (method, value) => globalThis.__coPage[method](value), args: [action, argument ?? null] });
  check(j);
  return result.result;
}
async function inject(j) {
  check(j);
  if (!supported((await chrome.tabs.get(j.tabId)).url)) throw new Error("The tab left ContactOut.");
  await chrome.scripting.executeScript({ target: { tabId: j.tabId }, files: ["reveal.js"] });
}
async function waitReady(j, before) {
  let stable = "", since = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    check(j);
    try {
      await inject(j);
      const info = await page(j, "info");
      const changed = !before || (before.range ? info.range && info.range !== before.range :
        before.links && info.links && info.links !== before.links);
      const signature = JSON.stringify(info);
      if (info.ready && !info.busy && changed && (info.range || info.count || info.links)) {
        if (signature !== stable) { stable = signature; since = Date.now(); }
        if (Date.now() - since >= 2000) return info;
      } else { stable = ""; since = 0; }
    } catch (error) {
      check(j);
      if (!supported((await chrome.tabs.get(j.tabId)).url)) throw error;
      stable = "";
    }
    await pause(j, 500);
  }
  throw new Error(before ? "Next page did not finish loading or could not be verified. Stopped." : "ContactOut results did not finish loading.");
}
async function exportWorkbook(j) {
  if (!j.rows.length) return;
  const id = await chrome.downloads.download({ url: makeContactWorkbook(j.rows),
    filename: `contactout/${j.stamp}-contacts.xlsx`, conflictAction: "uniquify", saveAs: false });
  for (let attempt = 0; attempt < 240; attempt++) {
    const [download] = await chrome.downloads.search({ id });
    if (download?.state === "complete") return;
    if (!download || download.state === "interrupted") throw new Error("Excel download failed. Collected rows are retained for Retry download.");
    await sleep(250);
  }
  throw new Error("Excel download timed out. Check Downloads before retrying.");
}
async function collect(j) {
  check(j);
  await chrome.scripting.executeScript({ target: { tabId: j.tabId }, files: ["extract.js"] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId: j.tabId }, func: () => globalThis.extractContactRows() });
  check(j);
  for (const row of result.result) {
    const key = row.profile || JSON.stringify([row.name, row.company, row.emails]);
    if (!j.keys.has(key)) { j.keys.add(key); j.rows.push(row); }
  }
  await chrome.storage.session.set({ [`rows-${j.tabId}`]: { rows: j.rows, stamp: j.stamp } });
}
async function run(j) {
  let attached = false;
  try {
    await chrome.debugger.attach({ tabId: j.tabId }, "1.3");
    attached = true;
    let info = await waitReady(j);
    for (let index = 1; index <= j.pages; index++) {
      check(j);
      await page(j, "reset");
      for (let clicks = 0; clicks < 25; clicks++) {
        const current = await page(j, "info");
        if ((info.range && current.range !== info.range) || (info.links && current.links !== info.links))
          throw new Error("The results changed during processing. Stopped.");
        if (!await page(j, "clickEmail")) break;
        await report(j, `Page ${index}/${j.pages}: clicked ${clicks + 1}/25 email buttons...`);
        await pause(j, 1000);
        let settled = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          if (await page(j, "emailSettled")) { settled = true; break; }
          await pause(j, 250);
        }
        if (!settled) throw new Error("An email button did not finish updating. Stopped without retrying the click.");
      }
      await pause(j, 2000);
      const finalInfo = await page(j, "info");
      if (info.range && finalInfo.range !== info.range) throw new Error("The results page changed during processing. Stopped.");
      if (finalInfo.busy) throw new Error("ContactOut is still loading. Stopped before collecting contacts.");
      await report(j, `Page ${index}/${j.pages}: collecting contacts...`);
      await collect(j);
      j.completed++;
      if (index === j.pages) break;
      if (!finalInfo.range && !finalInfo.links) throw new Error("Cannot verify page changes on this layout. Contacts collected; stopped before Next.");
      await report(j, `Collected ${j.rows.length} contacts from ${j.completed}/${j.pages} pages. Opening Next...`);
      if (!await page(j, "next")) {
        await report(j, `Reached the last page after ${j.completed} pages.`);
        return;
      }
      info = await waitReady(j, finalInfo);
    }
    await report(j, `Finished ${j.completed} pages.`);
  } catch (error) {
    await report(j, `${j.cancelled ? "Stopped by you." : error.message} ${j.completed} pages collected.`);
  } finally {
    const outcome = j.message;
    if (j.rows.length) {
      try {
        await report(j, `Saving ${j.rows.length} contacts to Excel...`);
        await exportWorkbook(j);
        await report(j, `${outcome} Saved ${j.rows.length} contacts to Downloads/contactout.`);
      } catch (error) { await report(j, `${outcome} ${error.message}`); }
    }
    j.detaching = true;
    if (attached) await chrome.debugger.detach({ tabId: j.tabId }).catch(() => {});
    j.running = false;
    await report(j, j.message);
  }
}
async function handle(message) {
  const { type, tabId } = message;
  if (type === "status") {
    if (job?.tabId === tabId) return view(job);
    const key = `job-${tabId}`;
    const saved = (await chrome.storage.session.get(key))[key];
    if (saved?.running) return { ...saved, running: false, message: "The previous run was interrupted. Press Start to begin again from this page." };
    return saved || { running: false, message: "Ready.", pages: 1 };
  }
  if (type === "stop") {
    if (job?.tabId === tabId && job.running) { job.cancelled = true; await report(job, "Stopping..."); }
    return handle({ type: "status", tabId });
  }
  if (type === "retry-download") {
    if (job?.running) throw new Error("Wait for the current run to finish.");
    const saved = (await chrome.storage.session.get(`rows-${tabId}`))[`rows-${tabId}`];
    if (!saved?.rows.length) throw new Error("No collected contacts are available in this browser session.");
    await exportWorkbook(saved);
    return { running: false, message: `Downloaded ${saved.rows.length} contacts.`, pages: 1 };
  }
  if (type !== "start") throw new Error("Unknown command.");
  if (job?.running) {
    if (job.tabId === tabId) return view(job);
    throw new Error("A run is active in another tab. Stop that run first.");
  }
  if (!Number.isInteger(message.pages) || message.pages < 1 || message.pages > 100) throw new Error("Enter a whole number from 1 to 100.");
  if (!supported((await chrome.tabs.get(tabId)).url)) throw new Error("Open a ContactOut results page first.");
  if (job?.running) throw new Error("A run is already active.");
  job = { tabId, pages: message.pages, running: true, cancelled: false, completed: 0, rows: [], keys: new Set(),
    message: "Starting...", stamp: new Date().toISOString().replace(/[:.]/g, "-") };
  await report(job, job.message);
  void run(job);
  return view(job);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  handle(message).then(reply, error => reply({ error: error.message }));
  return true;
});
chrome.debugger.onDetach.addListener(source => { if (job?.running && !job.detaching && source.tabId === job.tabId) job.cancelled = true; });
chrome.tabs.onRemoved.addListener(tabId => { if (job?.tabId === tabId) job.cancelled = true; });
