const SCRIPTS = [
  'shared/util.js',
  'shared/storage.js',
  'shared/theme.js',
  'shared/settings.js',
  'shared/highlight.js',
  'shared/icons.js',
  'content/format.js',
  'content/tokens.js',
  'content/serializer.js',
  'content/picker.js',
  'content/panel.js',
];

const LIBRARY_URL = chrome.runtime.getURL('library/library.html');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'uip-library',
    title: 'Open component library',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'uip-library') openLibrary();
});

chrome.action.onClicked.addListener((tab) => startOnTab(tab));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'uip-fetch') {
    fetchResource(msg.url, msg.as).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true;
  }
  if (msg?.type === 'uip-capture-pixels') {
    capturePixels(sender.tab?.windowId, msg.rect).then(
      (bins) => sendResponse({ ok: true, bins }),
      (err) => sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true;
  }
  if (msg?.type === 'uip-open-library') {
    openLibrary();
  }
  if (msg?.type === 'uip-open-source') {
    openSource(msg.url, msg.scroll);
  }
  if (msg?.type === 'uip-open-full') {
    openFull(msg, sender.tab);
  }
  return false;
});

async function startOnTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: SCRIPTS });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.UiPicker.start(),
    });
  } catch (err) {
    flagUnsupported(tab.id);
  }
}

function flagUnsupported(tabId) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title: "UI Picker can't run on this page" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'UI Picker: pick an element (Alt+Shift+C)' });
  }, 4000);
}

async function openLibrary() {
  const [existing] = await chrome.tabs.query({ url: LIBRARY_URL });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: LIBRARY_URL });
  }
}

const VIEW_PREFIX = 'view:';
const VIEW_TTL = 24 * 60 * 60 * 1000;

// Shows the panel's current component full size in a new tab next to the page. It is kept in
// storage, not the URL, because it can be megabytes; leftovers expire after a day.
async function openFull({ name, html, previewHtml, width, height }, tab) {
  const store = chrome.storage.local;
  const keys = store.getKeys ? await store.getKeys() : Object.keys(await store.get(null));
  const views = await store.get(keys.filter((k) => k.startsWith(VIEW_PREFIX)));
  const stale = Object.keys(views).filter((k) => Date.now() - (views[k]?.createdAt || 0) > VIEW_TTL);
  if (stale.length) await store.remove(stale);
  const key = `${VIEW_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.local.set({ [key]: { name, html, previewHtml, width, height, createdAt: Date.now() } });
  const url = chrome.runtime.getURL(`preview/preview.html?view=${encodeURIComponent(key)}`);
  await chrome.tabs.create(
    tab ? { url, index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : { url }
  );
}

// Opens the page a component was copied from, scrolled to where it was when it was picked.
async function openSource(url, scroll) {
  const tab = await chrome.tabs.create({ url });
  if (!scroll?.x && !scroll?.y) return;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, func: restoreScroll, args: [scroll.x || 0, scroll.y || 0] })
      .catch(() => {});
  };
  const onUpdated = (tabId, info) => {
    if (tabId === tab.id && info.status === 'complete') restore();
  };
  const onRemoved = (tabId) => {
    if (tabId !== tab.id) return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  const current = await chrome.tabs.get(tab.id).catch(() => null);
  if (current?.status === 'complete') restore();
}

// Runs in the page. Lazy-loaded content can make the page too short at first, and some sites
// reset the scroll after loading, so keep applying it until it sticks or the user scrolls.
function restoreScroll(x, y) {
  const deadline = Date.now() + 10000;
  let stopped = false;
  let settled = 0;
  const stop = () => (stopped = true);
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    addEventListener(type, stop, { once: true, passive: true, capture: true });
  }
  const tick = () => {
    if (stopped) return;
    if (Math.abs(scrollX - x) < 2 && Math.abs(scrollY - y) < 2) settled++;
    else {
      settled = 0;
      scrollTo({ left: x, top: y, behavior: 'instant' });
    }
    if (settled < 4 && Date.now() < deadline) setTimeout(tick, 250);
  };
  tick();
}

const MAX_SAMPLE_PIXELS = 250000;

// Screenshots the visible tab, crops it to `rect` (CSS pixels of the viewport) and returns a
// histogram of its colors as [r, g, b, count], with channels rounded to 6 bits.
async function capturePixels(windowId, rect) {
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const scale = bitmap.width / rect.viewportWidth;
    const sx = Math.max(0, Math.floor(rect.left * scale));
    const sy = Math.max(0, Math.floor(rect.top * scale));
    const sw = Math.min(bitmap.width - sx, Math.ceil(rect.width * scale));
    const sh = Math.min(bitmap.height - sy, Math.ceil(rect.height * scale));
    if (sw < 1 || sh < 1) return [];
    const shrink = Math.min(1, Math.sqrt(MAX_SAMPLE_PIXELS / (sw * sh)));
    const w = Math.max(1, Math.round(sw * shrink));
    const h = Math.max(1, Math.round(sh * shrink));
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    // Nearest-neighbour sampling, so downscaling doesn't invent blended colors.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 2) << 12) | ((data[i + 1] >> 2) << 6) | (data[i + 2] >> 2);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    return [...bins].map(([k, n]) => [((k >> 12) & 63) * 4 + 2, ((k >> 6) & 63) * 4 + 2, (k & 63) * 4 + 2, n]);
  } finally {
    bitmap.close();
  }
}

async function fetchResource(url, as) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  if (as === 'text') return { ok: true, data: await res.text() };
  const type = (res.headers.get('content-type') || guessType(url)).split(';')[0].trim();
  const buf = await res.arrayBuffer();
  return { ok: true, data: `data:${type};base64,${toBase64(buf)}` };
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function guessType(url) {
  const ext = (url.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
    }[ext] || 'application/octet-stream'
  );
}
