(() => {
  'use strict';
  const UIP = (window.UiPicker = window.UiPicker || {});
  if (UIP.panel) return;

  const { h, slug, formatBytes, copyText, downloadText } = UIP.util;
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const PREVIEW_URL = chrome.runtime.getURL('preview/preview.html');
  const LARGE_NODES = 2000;
  const LARGE_BYTES = 5 * 1024 * 1024;

  const OPTIONS = {
    minimal: [
      'Minimal CSS',
      'Only the styles that change how it looks, as shorthands. Sizes are kept only where the layout needs them',
    ],
    pseudo: ['Pseudo-elements', '::before / ::after content'],
    fonts: ['Web fonts', 'Include matching @font-face rules'],
    states: ['Hover / focus', 'Copy :hover, :focus and :active rules'],
    svg: ['SVG internals', 'Style shapes inside inline SVGs'],
    images: ['Embed images', 'Inline images as base64 so the file works offline'],
    keepClasses: ['Keep classes', 'Keep the original class names'],
    pageBg: ['Page background', 'Use the page color behind the component'],
    tailwind: [
      'Tailwind CDN',
      'Keep the Tailwind classes, load Tailwind from its CDN and leave out the CSS those classes already write',
    ],
  };
  const OPTION_GROUPS = [
    ['Styles (CSS)', 'brush', ['minimal', 'pseudo', 'fonts', 'states']],
    ['Assets', 'image', ['svg', 'images']],
    ['Output', 'gear', ['keepClasses', 'pageBg', 'tailwind']],
  ];
  // Options that only apply when the page has something for them.
  const AVAILABLE = {
    tailwind: [(snap) => !!snap?.meta.tailwind, 'No Tailwind CSS found on this page'],
  };
  const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

  const icon = UIP.icon;

  const fmt = (n) => Number(n).toLocaleString('en-US');

  UIP.fetchResource = (url, as) =>
    chrome.runtime
      .sendMessage({ type: 'uip-fetch', url, as })
      .catch((err) => ({ ok: false, error: String(err) }));

  let sheetPromise = null;
  function getSheet() {
    if (!sheetPromise) {
      sheetPromise = fetch(chrome.runtime.getURL('content/panel.css'))
        .then((r) => r.text())
        .then((text) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(text);
          return sheet;
        });
    }
    return sheetPromise;
  }

  let ui = null;

  UIP.start = () => {
    if (UIP.picker.isActive()) {
      UIP.picker.stop();
      return;
    }
    close();
    UIP.picker.start((el) => {
      let snap;
      try {
        snap = UIP.serializer.capture(el);
      } catch (err) {
        console.error('[UI Picker]', err);
        open(null, err);
        return;
      }
      open(snap);
    });
  };

  function close() {
    if (!ui) return;
    window.removeEventListener('message', ui.onMessage);
    ui.host.remove();
    ui = null;
  }

  async function open(snap, error) {
    close();
    const host = h('div', { 'data-ui-picker': 'panel' });
    for (const [k, v] of Object.entries({
      all: 'initial',
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      'z-index': '2147483647',
      visibility: 'hidden',
    })) {
      host.style.setProperty(k, v, 'important');
    }
    for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    });

    const shadow = host.attachShadow({ mode: 'open' });
    const state = {
      snap,
      opts: await UIP.storage.getOptions(UIP.serializer.DEFAULT_OPTIONS),
      html: '',
      previewHtml: '',
      bytes: 0,
      lines: 0,
      codeStale: true,
      bg: 'checker',
      zoom: 'fit',
      scale: 1,
      ready: false,
      seq: 0,
      timer: 0,
    };

    /* ---------- elements ---------- */
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const frame = h('iframe', { class: 'preview', src: PREVIEW_URL, title: 'Component preview' });
    const code = h('pre', { class: 'code', hidden: true });
    const nameInput = h('input', {
      class: 'name',
      type: 'text',
      placeholder: 'Component name',
      'aria-label': 'Component name',
      value: snap?.meta.name || '',
      spellcheck: 'false',
    });

    const btn = (text, cls, onclick, title, iconName) =>
      h(
        'button',
        { class: `btn ${cls || ''}`, onclick, title, 'aria-label': text ? null : title },
        iconName && icon(iconName),
        text && h('span', { text })
      );

    const selectBox = (iconName, title, options, onchange) =>
      h(
        'label',
        { class: iconName ? 'select has-icon' : 'select', title },
        iconName && icon(iconName),
        h('select', { onchange: (e) => onchange(e.target.value) }, options),
        h('span', { class: 'chevron' }, icon('chevron'))
      );

    const zoomFit = h('option', { value: 'fit', text: 'Fit' });
    const zoomSelect = selectBox(
      null,
      'Preview zoom',
      [zoomFit, ...ZOOMS.map((z) => h('option', { value: String(z), text: `${Math.round(z * 100)}%` }))],
      (value) => setZoom(value)
    );
    const zoomStep = (dir) => {
      const next =
        dir > 0
          ? ZOOMS.find((z) => z > state.scale + 0.001)
          : ZOOMS.findLast((z) => z < state.scale - 0.001);
      if (next) setZoom(String(next));
    };
    const zoomOut = btn('', 'zoom-btn', () => zoomStep(-1), 'Zoom out', 'minus');
    const zoomIn = btn('', 'zoom-btn', () => zoomStep(1), 'Zoom in', 'plus');
    const zoomControls = h(
      'div',
      { class: 'zoom' },
      h('div', { class: 'zoom-btns' }, zoomOut, zoomIn),
      zoomSelect
    );
    const bgSelect = selectBox(
      'checker',
      'Preview background (not part of the output)',
      [
        h('option', { value: 'checker', text: 'Checker' }),
        h('option', { value: 'white', text: 'White' }),
        h('option', { value: 'dark', text: 'Dark' }),
      ],
      (value) => {
        state.bg = value;
        postPreview();
      }
    );

    const tabPreview = h('button', { class: 'tab active', role: 'tab', 'aria-selected': 'true', text: 'Preview' });
    const tabCode = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'false', text: 'HTML' });
    const setTab = (which) => {
      const preview = which === 'preview';
      tabPreview.classList.toggle('active', preview);
      tabCode.classList.toggle('active', !preview);
      tabPreview.setAttribute('aria-selected', String(preview));
      tabCode.setAttribute('aria-selected', String(!preview));
      frame.hidden = !preview;
      code.hidden = preview;
      zoomControls.hidden = !preview;
      if (!preview) showCode();
    };
    const showCode = () => {
      if (!state.codeStale) return;
      UIP.highlight.render(code, state.html);
      state.codeStale = false;
    };
    tabPreview.addEventListener('click', () => setTab('preview'));
    tabCode.addEventListener('click', () => setTab('code'));

    const optionEl = (key) => {
      const [label, title] = OPTIONS[key];
      const [available, why] = AVAILABLE[key] || [];
      const enabled = !available || available(snap);
      return h(
        'label',
        { class: enabled ? 'opt' : 'opt disabled', title: enabled ? title : why },
        h('input', {
          type: 'checkbox',
          checked: enabled && !!state.opts[key],
          disabled: !enabled,
          onchange: (e) => {
            state.opts[key] = e.target.checked;
            UIP.storage.setOptions(state.opts);
            scheduleRender();
          },
        }),
        h('span', { text: label })
      );
    };

    const statValues = {};
    const stat = (key, iconName, label) =>
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat-ico' }, icon(iconName)),
        h('div', { class: 'stat-text' }, (statValues[key] = h('strong', { text: '–' })), h('span', { text: label }))
      );

    // Shows a check and `text` on the button for a moment, as confirmation next to where the user clicked.
    const flash = (button, text) => {
      clearTimeout(button.flashTimer);
      button.original ||= [...button.childNodes];
      button.classList.add('done');
      button.replaceChildren(icon('check'), h('span', { text }));
      button.flashTimer = setTimeout(() => {
        button.classList.remove('done');
        button.replaceChildren(...button.original);
      }, 1600);
    };

    const saveBtn = btn(
      'Save to library',
      'secondary',
      async () => {
        if (!state.html) return;
        await UIP.storage.save({
          name: nameInput.value.trim() || snap.meta.name || 'Component',
          html: state.html,
          previewHtml: state.previewHtml !== state.html ? state.previewHtml : undefined,
          sourceUrl: snap.meta.sourceUrl,
          sourceTitle: snap.meta.sourceTitle,
          sourceScroll: snap.meta.scroll,
          width: snap.meta.width,
          height: snap.meta.height,
          sizeBytes: state.bytes,
        });
        flash(saveBtn, 'Saved');
        setStatus('Saved to library', 'ok');
      },
      null,
      'bookmark'
    );
    const copyBtn = btn(
      'Copy HTML',
      'primary',
      async () => {
        if (!state.html) return;
        const ok = await copyText(state.html, shadow);
        if (ok) flash(copyBtn, 'Copied');
        setStatus(ok ? 'Copied to clipboard' : 'Copy failed. Use Download instead.', ok ? 'ok' : 'error');
      },
      null,
      'copy'
    );
    const downloadBtn = btn(
      'Download .html',
      'secondary',
      () => {
        if (!state.html) return;
        downloadText(`${slug(nameInput.value || snap.meta.name)}.html`, state.html, shadow);
        flash(downloadBtn, 'Downloaded');
        setStatus('Downloaded', 'ok');
      },
      null,
      'download'
    );
    const outputButtons = [saveBtn, copyBtn, downloadBtn];
    const setOutputReady = (ready) => {
      for (const b of outputButtons) b.disabled = !ready;
    };
    setOutputReady(false);

    const titleEl = h('strong', { text: 'UI Picker' });
    const header = h(
      'header',
      { class: 'head' },
      h('span', { class: 'logo' }, icon('logo')),
      h(
        'div',
        { class: 'title' },
        titleEl,
        h('span', { class: 'tagline', text: 'Select any element on a website and extract clean HTML and CSS.' })
      ),
      btn(
        'Library',
        'secondary',
        () => chrome.runtime.sendMessage({ type: 'uip-open-library' }),
        'Open component library',
        'folder'
      ),
      btn('', 'ghost icon', close, 'Close', 'x')
    );

    const panel = h(
      'div',
      { class: 'panel' },
      header,
      h(
        'section',
        { class: 'stats' },
        stat('lines', 'code', 'Lines of code'),
        stat('nodes', 'layers', 'Elements'),
        stat('classes', 'hash', 'Classes'),
        stat('size', 'file', 'Size')
      ),
      h(
        'section',
        { class: 'viewer' },
        h(
          'div',
          { class: 'toolbar' },
          h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Output view' }, tabPreview, tabCode),
          h('span', { class: 'spacer' }),
          zoomControls,
          bgSelect
        ),
        h('div', { class: 'view' }, frame, code)
      ),
      h(
        'section',
        { class: 'options' },
        h(
          'div',
          { class: 'options-head' },
          h('h2', { text: 'Extraction options' }),
          h('span', { class: 'hint', text: 'Choose what to include in the extracted code.' })
        ),
        h(
          'div',
          { class: 'groups' },
          OPTION_GROUPS.map(([label, iconName, keys]) =>
            h(
              'div',
              { class: 'group' },
              h('div', { class: 'group-head' }, icon(iconName), h('span', { text: label })),
              h('div', { class: 'group-body' }, keys.map(optionEl))
            )
          )
        )
      ),
      h('div', { class: 'save' }, h('label', { class: 'field' }, icon('file'), nameInput), saveBtn),
      h(
        'div',
        { class: 'actions' },
        copyBtn,
        downloadBtn,
        btn('Re-pick element', 'ghost', () => UIP.start(), 'Pick another element', 'refresh')
      ),
      status
    );

    shadow.append(panel);
    try {
      shadow.adoptedStyleSheets = [await getSheet()];
    } catch (err) {
      console.error('[UI Picker] could not load panel styles', err);
    }
    document.documentElement.appendChild(host);
    host.style.setProperty('visibility', 'visible', 'important');
    enableDrag(host, header);

    /* ---------- behaviour ---------- */
    const STATUS_ICONS = { ok: 'check', warn: 'alert', error: 'alert' };
    function setStatus(text, kind) {
      const name = STATUS_ICONS[kind];
      status.replaceChildren(...(name ? [icon(name)] : []), h('span', { text }));
      status.className = `status ${kind || ''}`;
    }

    const zoomValue = () => (state.zoom === 'fit' ? 0 : Number(state.zoom));

    function postPreview() {
      if (!state.ready || !state.html) return;
      frame.contentWindow.postMessage(
        {
          type: 'uip-render',
          html: state.previewHtml,
          width: snap.meta.width,
          height: snap.meta.height,
          bg: state.bg,
          zoom: zoomValue(),
        },
        EXT_ORIGIN
      );
    }

    function setZoom(value) {
      state.zoom = value;
      zoomSelect.querySelector('select').value = value;
      postZoom();
    }

    function postZoom() {
      if (!state.ready) return;
      frame.contentWindow.postMessage({ type: 'uip-zoom', zoom: zoomValue() }, EXT_ORIGIN);
    }

    function scheduleRender() {
      clearTimeout(state.timer);
      state.timer = setTimeout(render, 150);
    }

    async function render() {
      const seq = ++state.seq;
      setStatus('Building…', 'busy');
      try {
        const { html, previewHtml, bytes, classCount, tailwindCount } = await UIP.serializer.build(snap, state.opts);
        if (seq !== state.seq || !ui) return;
        state.html = html;
        state.previewHtml = previewHtml;
        state.bytes = bytes;
        state.codeStale = true;
        setOutputReady(true);
        if (!code.hidden) showCode();
        postPreview();
        const lines = html.replace(/\n$/, '').split('\n').length;
        const delta = state.lines ? lines - state.lines : 0;
        state.lines = lines;
        statValues.lines.textContent = fmt(lines);
        statValues.classes.textContent = fmt(classCount);
        statValues.size.textContent = formatBytes(bytes);
        const lineNote = `${fmt(lines)} lines${delta ? ` (${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))})` : ''}`;
        const notes = [lineNote, `${fmt(snap.meta.nodeCount)} elements`, `${fmt(classCount)} classes`];
        if (html !== previewHtml) notes.push(`${fmt(tailwindCount)} Tailwind classes`);
        notes.push(formatBytes(bytes));
        let kind = '';
        if (snap.meta.nodeCount > LARGE_NODES) {
          notes.push('large element');
          kind = 'warn';
        }
        if (bytes > LARGE_BYTES) {
          notes.push('output over 5 MB');
          kind = 'warn';
        }
        setStatus(notes.join(' · '), kind);
      } catch (err) {
        console.error('[UI Picker]', err);
        if (seq === state.seq) setStatus(`Build failed: ${err.message}`, 'error');
      }
    }

    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== EXT_ORIGIN) return;
      if (e.data?.type !== 'uip-rendered') return;
      state.scale = e.data.scale;
      if (e.data.fit) zoomFit.textContent = `Fit ${Math.round(e.data.scale * 100)}%`;
      zoomOut.disabled = state.scale <= ZOOMS[0] + 0.001;
      zoomIn.disabled = state.scale >= ZOOMS[ZOOMS.length - 1] - 0.001;
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      state.ready = true;
      postPreview();
    });

    ui = { host, onMessage };

    if (!snap) {
      setStatus(`Could not copy this element: ${error?.message || error}`, 'error');
      return;
    }
    titleEl.title = `${snap.meta.label}  ${snap.meta.width} × ${snap.meta.height}`;
    statValues.nodes.textContent = fmt(snap.meta.nodeCount);
    render();
  }

  function enableDrag(host, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const rect = host.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const left = Math.min(Math.max(0, ev.clientX - dx), innerWidth - rect.width);
        const top = Math.min(Math.max(0, ev.clientY - dy), innerHeight - 40);
        host.style.setProperty('left', `${left}px`, 'important');
        host.style.setProperty('top', `${top}px`, 'important');
        host.style.setProperty('right', 'auto', 'important');
        host.style.setProperty('bottom', 'auto', 'important');
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  UIP.panel = { open, close };
})();
