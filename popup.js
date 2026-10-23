const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const status = document.querySelector("#status");
const pages = document.querySelector("#pages");
const mode = document.querySelector("#mode");
const retry = document.querySelector("#retry");
retry.addEventListener("click", async () => {
  busy = true;
  retry.disabled = true;
  try { await command("retry-download"); } catch (error) { failed(error); }
  finally { busy = false; retry.disabled = false; }
});
let tabId;
let busy = false;
async function command(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, tabId, ...extra });
  if (result.error) throw new Error(result.error);
  status.textContent = result.message;
  start.disabled = result.running;
  stop.disabled = !result.running;
  pages.disabled = result.running;
  mode.disabled = result.running;
  if (result.running && result.mode) mode.value = result.mode;
  retry.disabled = result.running;
  if (result.running) pages.value = result.pages;
}
function failed(error) { status.textContent = error.message; }
start.addEventListener("click", async () => {
  if (!pages.reportValidity()) return;
  busy = true;
  start.disabled = true;
  try { await command("start", { pages: Number(pages.value), mode: mode.value }); }
  catch (error) { failed(error); start.disabled = false; }
  finally { busy = false; }
});
stop.addEventListener("click", async () => {
  busy = true;
  try { await command("stop"); } catch (error) { failed(error); }
  finally { busy = false; }
});
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url || "about:blank");
    if (url.protocol !== "https:" || !(url.hostname === "contactout.com" || url.hostname.endsWith(".contactout.com"))) {
      status.textContent = "Open a ContactOut results page first.";
      return;
    }
    tabId = tab.id;
    await command("status");
    setInterval(() => { if (!busy) command("status").catch(failed); }, 500);
  } catch (error) { failed(error); }
})();
