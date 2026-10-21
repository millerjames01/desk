/**
 * Runs on Desk's own pages. Relays Desk's requests to the extension's
 * background and hands captures from other tabs to Desk.
 */

const version = chrome.runtime.getManifest().version;
const say = (msg) => window.postMessage({ source: 'desk-ext', ...msg }, location.origin);

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.data?.source !== 'desk' || e.data.type !== 'req') return;
  const { id, op, url } = e.data;
  if (op === 'ping') return say({ type: 'res', id, ok: true, value: version });
  try {
    const r = await chrome.runtime.sendMessage({ op, url });
    say({ type: 'res', id, ok: r?.ok, value: r?.value, error: r?.error });
  } catch (err) {
    say({ type: 'res', id, ok: false, error: String(err?.message ?? err) });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'capture') say({ type: 'capture', capture: msg.capture });
});

async function announce() {
  say({ type: 'hello', version });
  // Captures made while no Desk tab was open wait in the background.
  const r = await chrome.runtime.sendMessage({ op: 'take-pending' });
  for (const capture of r?.value ?? []) say({ type: 'capture', capture });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(announce, 300));
else setTimeout(announce, 300);
