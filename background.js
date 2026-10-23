const SCRIPTS = [
  'shared/util.js',
  'shared/storage.js',
  'content/serializer.js',
  'content/picker.js',
  'content/panel.js',
];

const LIBRARY_URL = chrome.runtime.getURL('library/library.html');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ct-library',
    title: 'Open component library',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'ct-library') openLibrary();
});

chrome.action.onClicked.addListener((tab) => startOnTab(tab));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ct-fetch') {
    fetchResource(msg.url, msg.as).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true;
  }
  if (msg?.type === 'ct-open-library') {
    openLibrary();
  }
  return false;
});

async function startOnTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: SCRIPTS });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.CopyThing.start(),
    });
  } catch (err) {
    flagUnsupported(tab.id);
  }
}

function flagUnsupported(tabId) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title: "Copy Thing can't run on this page" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Copy Thing: pick an element (Alt+Shift+C)' });
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
