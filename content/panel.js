(() => {
  'use strict';
  const CT = (window.CopyThing = window.CopyThing || {});
  if (CT.panel) return;

  const { h, slug, formatBytes, copyText, downloadText } = CT.util;
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const PREVIEW_URL = chrome.runtime.getURL('preview/preview.html');
  const LARGE_NODES = 2000;
  const LARGE_BYTES = 5 * 1024 * 1024;

  const OPTIONS = [
    [
      'minimal',
      'Minimal CSS',
      'Only the styles that change how it looks, as shorthands. Sizes are kept only where the layout needs them',
    ],
    ['pseudo', 'Pseudo-elements', '::before / ::after content'],
    ['fonts', 'Web fonts', 'Include matching @font-face rules'],
    ['svg', 'SVG internals', 'Style shapes inside inline SVGs'],
    ['states', 'Hover / focus', 'Copy :hover, :focus and :active rules'],
    ['images', 'Embed images', 'Inline images as base64 so the file works offline'],
    ['keepClasses', 'Keep classes', 'Keep the original class names'],
    ['pageBg', 'Page background', 'Use the page color behind the component'],
    [
      'tailwind',
      'Tailwind CDN',
      'Keep the Tailwind classes, load Tailwind from its CDN and leave out the CSS those classes already write',
    ],
  ];
  // Options that only apply when the page has something for them.
  const AVAILABLE = {
    tailwind: [(snap) => !!snap?.meta.tailwind, 'No Tailwind CSS found on this page'],
  };

  CT.fetchResource = (url, as) =>
    chrome.runtime
      .sendMessage({ type: 'ct-fetch', url, as })
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

  CT.start = () => {
    if (CT.picker.isActive()) {
      CT.picker.stop();
      return;
    }
    close();
    CT.picker.start((el) => {
      let snap;
      try {
        snap = CT.serializer.capture(el);
      } catch (err) {
        console.error('[Copy Thing]', err);
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
    const host = h('div', { 'data-copything': 'panel' });
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

    const shadow = host.attachShadow({ mode: 'open' });
    const state = {
      snap,
      opts: await CT.storage.getOptions(CT.serializer.DEFAULT_OPTIONS),
      html: '',
      previewHtml: '',
      bytes: 0,
      lines: 0,
      codeStale: true,
      bg: 'checker',
      ready: false,
      seq: 0,
      timer: 0,
    };

    /* ---------- elements ---------- */
    const status = h('div', { class: 'status' });
    const sub = h('span', { class: 'sub' });
    const frame = h('iframe', { class: 'preview', src: PREVIEW_URL, title: 'Component preview' });
    const code = h('pre', { class: 'code', hidden: true });
    const scaleNote = h('span', { class: 'scale' });
    const nameInput = h('input', {
      class: 'name',
      type: 'text',
      placeholder: 'Component name',
      value: snap?.meta.name || '',
      spellcheck: 'false',
    });

    const tabPreview = h('button', { class: 'tab active', text: 'Preview' });
    const tabCode = h('button', { class: 'tab', text: 'HTML' });
    const setTab = (which) => {
      const preview = which === 'preview';
      tabPreview.classList.toggle('active', preview);
      tabCode.classList.toggle('active', !preview);
      frame.hidden = !preview;
      code.hidden = preview;
      if (!preview) showCode();
    };
    const showCode = () => {
      if (!state.codeStale) return;
      CT.highlight.render(code, state.html);
      state.codeStale = false;
    };
    tabPreview.addEventListener('click', () => setTab('preview'));
    tabCode.addEventListener('click', () => setTab('code'));

    const bgSelect = h(
      'select',
      {
        class: 'bg',
        title: 'Preview background (not part of the output)',
        onchange: (e) => {
          state.bg = e.target.value;
          postPreview();
        },
      },
      h('option', { value: 'checker', text: 'Checker' }),
      h('option', { value: 'white', text: 'White' }),
      h('option', { value: 'dark', text: 'Dark' })
    );

    const optionEls = OPTIONS.map(([key, label, title]) => {
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
            CT.storage.setOptions(state.opts);
            scheduleRender();
          },
        }),
        h('span', { text: label })
      );
    });

    const btn = (text, cls, onclick, title) => h('button', { class: `btn ${cls || ''}`, text, onclick, title });

    const header = h(
      'header',
      { class: 'head' },
      h('div', { class: 'title' }, h('strong', { text: 'Copy Thing' }), sub),
      h(
        'div',
        { class: 'head-actions' },
        btn('Library', 'ghost', () => chrome.runtime.sendMessage({ type: 'ct-open-library' }), 'Open component library'),
        btn('✕', 'ghost icon', close, 'Close')
      )
    );

    const panel = h(
      'div',
      { class: 'panel' },
      header,
      h('div', { class: 'toolbar' }, tabPreview, tabCode, h('span', { class: 'spacer' }), scaleNote, bgSelect),
      h('div', { class: 'view' }, frame, code),
      h('div', { class: 'options' }, optionEls),
      h(
        'div',
        { class: 'save' },
        nameInput,
        btn('Save to library', 'secondary', async () => {
          if (!state.html) return;
          await CT.storage.save({
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
          setStatus('Saved to library', 'ok');
        })
      ),
      h(
        'div',
        { class: 'actions' },
        btn('Copy HTML', 'primary', async () => {
          if (!state.html) return;
          const ok = await copyText(state.html, shadow);
          setStatus(ok ? 'Copied to clipboard' : 'Copy failed. Use Download instead.', ok ? 'ok' : 'error');
        }),
        btn('Download .html', 'secondary', () => {
          if (!state.html) return;
          downloadText(`${slug(nameInput.value || snap.meta.name)}.html`, state.html, shadow);
          setStatus('Downloaded', 'ok');
        }),
        btn('Re-pick', 'ghost', () => CT.start(), 'Pick another element')
      ),
      status
    );

    shadow.append(panel);
    try {
      shadow.adoptedStyleSheets = [await getSheet()];
    } catch (err) {
      console.error('[Copy Thing] could not load panel styles', err);
    }
    document.documentElement.appendChild(host);
    host.style.setProperty('visibility', 'visible', 'important');
    enableDrag(host, header);

    /* ---------- behaviour ---------- */
    function setStatus(text, kind) {
      status.textContent = text;
      status.className = `status ${kind || ''}`;
    }

    function postPreview() {
      if (!state.ready || !state.html) return;
      frame.contentWindow.postMessage(
        { type: 'ct-render', html: state.previewHtml, width: snap.meta.width, height: snap.meta.height, bg: state.bg },
        EXT_ORIGIN
      );
    }

    function scheduleRender() {
      clearTimeout(state.timer);
      state.timer = setTimeout(render, 150);
    }

    async function render() {
      const seq = ++state.seq;
      setStatus('Building…');
      try {
        const { html, previewHtml, bytes, classCount, tailwindCount } = await CT.serializer.build(snap, state.opts);
        if (seq !== state.seq || !ui) return;
        state.html = html;
        state.previewHtml = previewHtml;
        state.bytes = bytes;
        state.codeStale = true;
        if (!code.hidden) showCode();
        postPreview();
        const lines = html.replace(/\n$/, '').split('\n').length;
        const delta = state.lines ? lines - state.lines : 0;
        state.lines = lines;
        const lineNote = `${lines} lines${delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})` : ''}`;
        const notes = [lineNote, `${snap.meta.nodeCount} elements`, `${classCount} classes`];
        if (html !== previewHtml) notes.push(`${tailwindCount} Tailwind classes`);
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
        console.error('[Copy Thing]', err);
        if (seq === state.seq) setStatus(`Build failed: ${err.message}`, 'error');
      }
    }

    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== EXT_ORIGIN) return;
      if (e.data?.type === 'ct-rendered') {
        const pct = Math.round(e.data.scale * 100);
        scaleNote.textContent = pct < 100 ? `${pct}%` : '';
      }
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      state.ready = true;
      postPreview();
    });

    ui = { host, onMessage };

    if (!snap) {
      sub.textContent = '';
      setStatus(`Could not copy this element: ${error?.message || error}`, 'error');
      return;
    }
    sub.textContent = `${snap.meta.label}  ${snap.meta.width} × ${snap.meta.height}`;
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

  CT.panel = { open, close };
})();
