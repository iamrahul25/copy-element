(() => {
  const UIP = (globalThis.UiPicker = globalThis.UiPicker || {});
  if (UIP.theme) return;

  const KEY = 'theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  // 'light' | 'dark', or null to follow the system until the user picks one.
  let mode = null;
  const listeners = new Set();

  const current = () => mode || (media.matches ? 'dark' : 'light');
  const notify = () => {
    for (const fn of listeners) fn(current());
  };

  const ready = chrome.storage.local
    .get(KEY)
    .then((result) => {
      mode = result[KEY] || null;
      notify();
    })
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    mode = changes[KEY].newValue || null;
    notify();
  });
  media.addEventListener('change', () => {
    if (!mode) notify();
  });

  /** Calls `fn(mode)` now and on every change. Returns a function that stops it. */
  function watch(fn) {
    fn(current());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  UIP.theme = {
    ready,
    current,
    watch,

    toggle() {
      mode = current() === 'dark' ? 'light' : 'dark';
      notify();
      return chrome.storage.local.set({ [KEY]: mode });
    },

    /** Keeps `el` (a page root or shadow host) in the current mode. Returns a function that stops it. */
    apply(el) {
      return watch((m) => el.style.setProperty('color-scheme', m, 'important'));
    },
  };
})();
