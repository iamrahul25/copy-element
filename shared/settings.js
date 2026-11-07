(() => {
  const UIP = (globalThis.UiPicker = globalThis.UiPicker || {});
  if (UIP.settings) return;

  const KEY = 'settings';
  const DEFAULTS = { zoom: 1 };
  // Interface sizes, stepped through like the browser's zoom levels.
  const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  let values = { ...DEFAULTS };
  const listeners = new Set();

  const notify = () => {
    for (const { key, fn } of listeners) fn(values[key]);
  };

  const ready = chrome.storage.local
    .get(KEY)
    .then((result) => {
      values = { ...DEFAULTS, ...(result[KEY] || {}) };
      notify();
    })
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    values = { ...DEFAULTS, ...(changes[KEY].newValue || {}) };
    notify();
  });

  const get = (key) => values[key];

  function set(key, value) {
    values = { ...values, [key]: value };
    notify();
    return chrome.storage.local.set({ [KEY]: values });
  }

  /** Calls `fn(value)` now and whenever `key` changes. Returns a function that stops it. */
  function watch(key, fn) {
    const entry = { key, fn };
    fn(values[key]);
    listeners.add(entry);
    return () => listeners.delete(entry);
  }

  function stepZoom(dir) {
    const z = values.zoom;
    const next =
      dir > 0 ? ZOOM_LEVELS.find((l) => l > z + 0.001) : ZOOM_LEVELS.findLast((l) => l < z - 0.001);
    if (next) set('zoom', next);
  }

  /**
   * Keeps `el` at the interface size. Also sets `--zoom`, because viewport units inside a zoomed
   * element are zoomed too: `calc(100vh / var(--zoom))` is the full viewport height.
   */
  function applyZoom(el) {
    return watch('zoom', (z) => {
      el.style.setProperty('zoom', String(z));
      el.style.setProperty('--zoom', String(z));
    });
  }

  /**
   * The settings button and the menu it opens. `buttonClass` styles the button to match its header.
   * Returns { el, destroy }.
   */
  function menu({ buttonClass = 'btn ghost icon' } = {}) {
    const { h } = UIP.util;
    const { icon } = UIP;
    let stopOutside = null;

    const smallBtn = (iconName, label, onclick) =>
      h('button', { type: 'button', class: 'btn ghost icon sm', title: label, 'aria-label': label, onclick }, icon(iconName));

    const zoomOut = smallBtn('minus', 'Smaller', () => stepZoom(-1));
    const zoomIn = smallBtn('plus', 'Larger', () => stepZoom(1));
    const zoomValue = h('output', { class: 'settings-value', 'aria-live': 'polite' });
    const reset = h('button', {
      type: 'button',
      class: 'btn outline sm',
      text: 'Reset',
      title: 'Back to 100%',
      onclick: () => set('zoom', DEFAULTS.zoom),
    });

    const panel = h(
      'div',
      { class: 'settings-menu', role: 'dialog', 'aria-label': 'Settings', hidden: true },
      h(
        'div',
        { class: 'settings-head' },
        h('h3', { text: 'Settings' }),
        smallBtn('x', 'Close settings', () => {
          toggle(false);
          button.focus();
        })
      ),
      h(
        'div',
        { class: 'settings-row' },
        h(
          'div',
          { class: 'settings-text' },
          h('strong', { text: 'Interface size' }),
          h('span', { text: 'Text, buttons, icons and previews' })
        ),
        h('div', { class: 'settings-stepper', role: 'group', 'aria-label': 'Interface size' }, zoomOut, zoomValue, zoomIn)
      ),
      h('div', { class: 'settings-foot' }, reset)
    );

    const button = h(
      'button',
      {
        type: 'button',
        class: buttonClass,
        title: 'Settings',
        'aria-label': 'Settings',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        onclick: () => toggle(panel.hidden),
      },
      icon('settings')
    );
    const el = h('div', { class: 'settings' }, button, panel);

    function toggle(show) {
      panel.hidden = !show;
      button.setAttribute('aria-expanded', String(show));
      stopOutside?.();
      stopOutside = null;
      if (!show) return;
      const onDown = (e) => {
        if (!e.composedPath().includes(el)) toggle(false);
      };
      document.addEventListener('pointerdown', onDown, true);
      stopOutside = () => document.removeEventListener('pointerdown', onDown, true);
    }

    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || panel.hidden) return;
      e.preventDefault();
      toggle(false);
      button.focus();
    });

    const stopWatch = watch('zoom', (z) => {
      zoomValue.textContent = `${Math.round(z * 100)}%`;
      zoomOut.disabled = z <= ZOOM_LEVELS[0] + 0.001;
      zoomIn.disabled = z >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1] - 0.001;
      reset.disabled = Math.abs(z - DEFAULTS.zoom) < 0.001;
    });

    return {
      el,
      destroy() {
        stopWatch();
        stopOutside?.();
      },
    };
  }

  UIP.settings = { ready, ZOOM_LEVELS, get, set, watch, stepZoom, applyZoom, menu };
})();
