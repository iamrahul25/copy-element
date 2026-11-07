(() => {
  'use strict';
  const UIP = (window.UiPicker = window.UiPicker || {});
  if (UIP.panel) return;

  const { h, slug, formatBytes, copyText, downloadText, loadSheets } = UIP.util;
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const PREVIEW_URL = chrome.runtime.getURL('preview/preview.html?interactive');
  const LARGE_NODES = 2000;
  const LARGE_BYTES = 5 * 1024 * 1024;

  // [label, one-line description, longer tooltip]
  const OPTIONS = {
    pseudo: ['Pseudo-elements', 'Copy ::before and ::after content'],
    states: ['Hover / focus', 'Copy :hover, :focus and :active styles'],
    fonts: ['Web fonts', 'Include the @font-face rules it uses'],
    svg: ['SVG internals', 'Style shapes inside inline SVGs'],
    images: ['Embed images', 'Inline images so the file works offline', 'Inline images as base64 so the file works offline'],
    keepClasses: ['Keep classes', 'Keep the original class names'],
    pageBg: ['Page background', 'Use the page color behind it', 'Use the page color behind the component'],
    tailwind: [
      'Tailwind CDN',
      'Keep Tailwind classes, load it from a CDN',
      'Keep the Tailwind classes, load Tailwind from its CDN and leave out the CSS those classes already write',
    ],
  };
  // Options that only apply when the page has something for them.
  const AVAILABLE = {
    tailwind: [(snap) => !!snap?.meta.tailwind, 'No Tailwind CSS found on this page'],
  };
  const CLEAN_OUTPUT = [
    'Clean output',
    'Best for most elements',
    'On: only the styles that change how it looks, as shorthands, with sizes kept only where the layout needs them. Off: every computed style, for pixel-exact copies',
  ];
  // Preview canvas only; not part of the output. [value, label, icon]
  const BACKGROUNDS = [
    ['dots', 'Dotted', 'dots'],
    ['light', 'Light', 'square'],
    ['dark', 'Dark', 'square-fill'],
  ];
  const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
  const TAGLINE = 'Pick any element, get clean HTML and CSS.';

  const icon = UIP.icon;

  const fmt = (n) => Number(n).toLocaleString('en-US');

  UIP.fetchResource = (url, as) =>
    chrome.runtime
      .sendMessage({ type: 'uip-fetch', url, as })
      .catch((err) => ({ ok: false, error: String(err) }));

  let ui = null;
  let advancedOpen = false;

  UIP.start = () => {
    if (UIP.picker.isActive()) {
      UIP.picker.stop();
      return;
    }
    close();
    UIP.picker.start(async (el) => {
      let snap;
      try {
        snap = UIP.serializer.capture(el);
      } catch (err) {
        console.error('[UI Picker]', err);
        open(null, err);
        return;
      }
      await UIP.tokens.measurePixels(el, snap.meta.tokens, snap.meta.pageBg);
      open(snap);
    });
  };

  function close() {
    if (!ui) return;
    window.removeEventListener('message', ui.onMessage);
    for (const stop of ui.cleanup) stop();
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
    await Promise.all([UIP.theme.ready, UIP.settings.ready]);
    const cleanup = [UIP.theme.apply(host)];
    const state = {
      snap,
      opts: await UIP.storage.getOptions(UIP.serializer.DEFAULT_OPTIONS),
      html: '',
      previewHtml: '',
      bytes: 0,
      lines: 0,
      codeStale: true,
      bg: BACKGROUNDS[0][0],
      zoom: 'fit',
      scale: 1,
      ready: false,
      seq: 0,
      timer: 0,
    };

    /* ---------- elements ---------- */
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const frame = h('iframe', {
      class: 'preview',
      src: PREVIEW_URL,
      title: 'Component preview. Scroll to zoom, drag to move around when zoomed in',
    });
    const code = h('pre', { class: 'code', hidden: true });

    const btn = (text, cls, onclick, title, iconName) =>
      h(
        'button',
        { type: 'button', class: `btn ${cls || ''}`, onclick, title, 'aria-label': text ? null : title },
        iconName && icon(iconName),
        text && h('span', { text })
      );

    // A row of buttons where exactly one is active. `items` are [value, text, title].
    const segmented = (label, items, value, onselect, tabs = false) => {
      const attr = tabs ? 'aria-selected' : 'aria-pressed';
      const buttons = new Map();
      const select = (v) => {
        for (const [key, b] of buttons) {
          b.classList.toggle('active', key === v);
          b.setAttribute(attr, String(key === v));
        }
      };
      for (const [key, text, title] of items) {
        const onclick = () => {
          select(key);
          onselect(key);
        };
        buttons.set(key, h('button', { type: 'button', class: 'segment', role: tabs && 'tab', text, title, onclick }));
      }
      select(value);
      const group = h('div', { class: 'segmented', role: tabs ? 'tablist' : 'group', 'aria-label': label }, [...buttons.values()]);
      group.select = select;
      return group;
    };

    /* stats */
    const pill = (singular, plural = `${singular}s`) => {
      const value = h('strong', { text: '–' });
      const label = h('span', { text: plural });
      const delta = h('span', { class: 'delta' });
      return {
        el: h('span', { class: 'pill' }, value, label, delta),
        set(n, change = 0) {
          value.textContent = fmt(n);
          label.textContent = n === 1 ? singular : plural;
          delta.textContent = change ? `${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}` : '';
        },
      };
    };
    const stats = {
      lines: pill('line'),
      nodes: pill('element'),
      classes: pill('class', 'classes'),
      tailwind: pill('Tailwind class', 'Tailwind classes'),
    };
    stats.tailwind.el.hidden = true;
    const sizeValue = h('strong', { text: '–' });

    /* preview toolbar */
    const zoomStep = (dir) => {
      const next =
        dir > 0
          ? ZOOMS.find((z) => z > state.scale + 0.001)
          : ZOOMS.findLast((z) => z < state.scale - 0.001);
      if (next) setZoom(String(next));
    };
    const zoomOut = btn('', 'ghost icon sm', () => zoomStep(-1), 'Zoom out', 'minus');
    const zoomIn = btn('', 'ghost icon sm', () => zoomStep(1), 'Zoom in', 'plus');
    const zoomValue = btn('Fit', 'ghost sm zoom-value', () => setZoom('fit'), 'Fit to preview');
    const bgBtn = btn('', 'ghost icon sm', () => {
      const i = BACKGROUNDS.findIndex(([value]) => value === state.bg);
      setBg((i + 1) % BACKGROUNDS.length);
    });
    const previewTools = h('div', { class: 'zoom' }, zoomOut, zoomValue, zoomIn, bgBtn);

    const setTab = (which) => {
      const preview = which === 'preview';
      frame.hidden = !preview;
      code.hidden = preview;
      previewTools.hidden = !preview;
      if (!preview) showCode();
    };
    const showCode = () => {
      if (!state.codeStale) return;
      UIP.highlight.render(code, state.html);
      state.codeStale = false;
    };
    const tabs = segmented(
      'Output view',
      [
        ['preview', 'Preview'],
        ['code', 'HTML'],
      ],
      'preview',
      setTab,
      true
    );

    /* extracted colors and fonts */
    const tokens = snap?.meta.tokens || { colors: [], fonts: [] };
    const percent = (n) => (n <= 0 ? '0%' : n < 1 ? '<1%' : `${Math.round(n)}%`);
    const usage = (pct) => {
      const fill = h('span');
      fill.style.setProperty('width', `${Math.max(pct, 2)}%`);
      return h('span', { class: 'token-usage' }, h('span', { class: 'meter' }, fill), h('span', { class: 'token-pct', text: percent(pct) }));
    };
    const tokenRow = (tile, name, meta, pct, props) =>
      h(
        'button',
        { type: 'button', class: 'token', ...props },
        tile,
        h('span', { class: 'token-main' }, name, h('span', { class: 'token-meta', text: meta })),
        usage(pct)
      );
    const sizeRange = (sizes) => (sizes.length > 1 ? `${sizes[0]}–${sizes[sizes.length - 1]}px` : `${sizes[0]}px`);
    const tokenList = (items, empty, row) =>
      h('div', { class: 'token-list' }, items.length ? items.map(row) : h('p', { class: 'token-empty', text: empty }));

    // Hovering a color or font marks it in the preview; a clicked font stays marked otherwise.
    let markedFont = null;
    let hovered = null;
    const sendMark = () => {
      const target = hovered || (markedFont && { stacks: markedFont.stacks });
      frame.contentWindow?.postMessage({ type: 'uip-highlight', ...target }, EXT_ORIGIN);
    };
    const hoverMark = (target) => {
      const enter = () => {
        hovered = target;
        sendMark();
      };
      const leave = () => {
        if (hovered !== target) return;
        hovered = null;
        sendMark();
      };
      return {
        onmouseenter: enter,
        onmouseleave: leave,
        onfocus: (e) => e.target.matches(':focus-visible') && enter(),
        onblur: leave,
      };
    };

    // Copies `value` and says so in the row's second line for a moment.
    const copyFromRow = async (row, value, meta) => {
      const label = row.querySelector('.token-meta');
      clearTimeout(row.flashTimer);
      const ok = await copyText(value, shadow);
      label.textContent = ok ? `Copied ${value}` : 'Copy failed';
      row.classList.toggle('done', ok);
      row.flashTimer = setTimeout(() => {
        label.textContent = meta;
        row.classList.remove('done');
      }, 1400);
    };

    const colorList = tokenList(tokens.colors, 'No colors found in this element.', (c) => {
      const value = c.alpha < 1 ? `${c.hex}${Math.round(c.alpha * 255).toString(16).padStart(2, '0')}` : c.hex;
      const tile = h('span', { class: 'swatch' });
      tile.style.setProperty('--swatch', value);
      const roles = c.roles.map((r) => r[0].toUpperCase() + r.slice(1));
      const meta = [...roles, c.count && `${fmt(c.count)} ${c.count === 1 ? 'use' : 'uses'}`].filter(Boolean).join(' · ');
      const row = tokenRow(tile, h('span', { class: 'token-name mono', text: value }), meta, c.pct, {
        title: `Copy ${value}`,
        ...hoverMark({ color: { hex: c.hex, alpha: c.alpha } }),
        onclick: () => copyFromRow(row, value, meta),
      });
      return row;
    });

    const fontRows = new Map();
    const markFont = (font) => {
      markedFont = font === markedFont ? null : font;
      for (const [f, row] of fontRows) row.setAttribute('aria-pressed', String(f === markedFont));
      if (markedFont && frame.hidden) {
        tabs.select('preview');
        setTab('preview');
      }
      sendMark();
    };
    const fontList = tokenList(tokens.fonts, 'No text in this element.', (f) => {
      const tile = h('span', { class: 'swatch glyph', text: 'Aa' });
      const name = h('span', { class: 'token-name font-name', text: f.name });
      for (const el of [tile, name]) el.style.setProperty('font-family', f.stacks[0]);
      const notes = [f.weights.join(' · '), sizeRange(f.sizes)];
      if (f.declared) notes.push(`fallback for ${f.declared}`);
      else if (f.generic) notes.push('browser default');
      const meta = notes.join(' · ');
      const row = tokenRow(tile, name, meta, f.pct, {
        title: `Copy ${f.name} and highlight its text in the preview`,
        'aria-pressed': 'false',
        ...hoverMark({ stacks: f.stacks }),
        onclick: () => {
          markFont(f);
          copyFromRow(row, f.name, meta);
        },
      });
      fontRows.set(f, row);
      return row;
    });
    fontList.hidden = true;

    const TOKEN_HINTS = {
      colors: 'Hover to find, click to copy.',
      fonts: 'Hover to find, click to copy and mark.',
    };
    const tokenHint = h('p', { text: TOKEN_HINTS.colors });
    const tokenTabs = segmented(
      'Extracted styles',
      [
        ['colors', `Colors · ${tokens.colors.length}`, 'Colors used in the element'],
        ['fonts', `Fonts · ${tokens.fonts.length}`, 'Fonts used in the element'],
      ],
      'colors',
      (which) => {
        colorList.hidden = which !== 'colors';
        fontList.hidden = which !== 'fonts';
        tokenHint.textContent = TOKEN_HINTS[which];
      }
    );

    /* options */
    const checkbox = ([label, desc, tooltip], checked, onchange, disabledWhy) =>
      h(
        'label',
        { class: disabledWhy ? 'opt disabled' : 'opt', title: disabledWhy || tooltip || desc },
        h('input', {
          type: 'checkbox',
          checked: !disabledWhy && checked,
          disabled: !!disabledWhy,
          onchange: (e) => onchange(e.target.checked),
        }),
        h('span', { class: 'opt-text' }, h('span', { class: 'opt-label', text: label }), h('span', { class: 'opt-desc', text: desc }))
      );

    const cleanOutput = checkbox(CLEAN_OUTPUT, !!state.opts.minimal, (on) => {
      state.opts.minimal = on;
      UIP.storage.setOptions(state.opts);
      scheduleRender();
    });

    const optionEl = (key) => {
      const [available, why] = AVAILABLE[key] || [];
      const enabled = !available || available(snap);
      return checkbox(
        OPTIONS[key],
        !!state.opts[key],
        (on) => {
          state.opts[key] = on;
          UIP.storage.setOptions(state.opts);
          scheduleRender();
        },
        enabled ? null : why
      );
    };
    const advanced = h('div', { class: 'advanced', hidden: !advancedOpen }, cleanOutput, Object.keys(OPTIONS).map(optionEl));
    const disclosure = h(
      'button',
      {
        type: 'button',
        class: 'disclosure',
        'aria-expanded': String(advancedOpen),
        onclick: () => {
          advancedOpen = advanced.hidden;
          advanced.hidden = !advancedOpen;
          disclosure.setAttribute('aria-expanded', String(advancedOpen));
        },
      },
      icon('chevron'),
      h('span', { text: 'Advanced options' })
    );

    // Shows a check (and `text`, unless it is an icon button) for a moment, as confirmation next to where the user clicked.
    const flash = (button, text) => {
      clearTimeout(button.flashTimer);
      button.original ||= [...button.childNodes];
      button.classList.add('done');
      const iconOnly = button.classList.contains('icon');
      button.replaceChildren(icon('check'), ...(iconOnly ? [] : [h('span', { text })]));
      button.flashTimer = setTimeout(() => {
        button.classList.remove('done');
        button.replaceChildren(...button.original);
      }, 1600);
    };

    /* save */
    const nameInput = h('input', {
      class: 'name',
      type: 'text',
      placeholder: 'Component name',
      'aria-label': 'Component name',
      value: snap?.meta.name || '',
      spellcheck: 'false',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          toggleSave(false);
        }
      },
    });
    const confirmSaveBtn = btn('Save', 'primary', () => save());
    const saveRow = h(
      'div',
      { class: 'save', hidden: true },
      nameInput,
      confirmSaveBtn,
      btn('', 'ghost icon', () => toggleSave(false), 'Cancel', 'x')
    );
    const bookmarkBtn = btn('', 'outline icon', () => toggleSave(saveRow.hidden), 'Save to library', 'bookmark');
    bookmarkBtn.setAttribute('aria-expanded', 'false');

    function toggleSave(show) {
      saveRow.hidden = !show;
      bookmarkBtn.setAttribute('aria-expanded', String(show));
      if (show) {
        nameInput.focus();
        nameInput.select();
      } else {
        bookmarkBtn.focus();
      }
    }

    async function save() {
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
      toggleSave(false);
      flash(bookmarkBtn);
      setStatus('Saved to library', 'ok');
    }

    /* actions */
    const copyBtn = btn(
      'Copy HTML',
      'primary',
      async () => {
        if (!state.html) return;
        const ok = await copyText(state.html, shadow);
        if (ok) flash(copyBtn, 'Copied');
        else setStatus('Copy failed. Use Download instead.', 'error');
      },
      null,
      'copy'
    );
    const downloadBtn = btn(
      'Download',
      'outline',
      () => {
        if (!state.html) return;
        downloadText(`${slug(nameInput.value || snap.meta.name)}.html`, state.html, shadow);
        flash(downloadBtn, 'Downloaded');
      },
      'Download .html',
      'download'
    );
    /* window controls */
    const light = (cls, title, iconName, onclick) =>
      h('button', { type: 'button', class: `light ${cls}`, title, 'aria-label': title, onclick }, icon(iconName));
    const minimizeBtn = light('minimize', 'Minimize', 'minus', () => setMinimized(!panel.classList.contains('minimized')));
    const maximizeBtn = light('maximize', 'Open in a new tab', 'maximize', () => {
      if (!state.html) return;
      chrome.runtime.sendMessage({
        type: 'uip-open-full',
        name: nameInput.value.trim() || snap.meta.name || 'Component',
        html: state.html,
        previewHtml: state.previewHtml,
        width: snap.meta.width,
        height: snap.meta.height,
      });
    });
    const lights = h('div', { class: 'lights' }, maximizeBtn, minimizeBtn, light('close', 'Close (Esc)', 'x', close));

    function setMinimized(on) {
      pinTopLeft(host);
      panel.classList.toggle('minimized', on);
      minimizeBtn.title = on ? 'Restore' : 'Minimize';
      minimizeBtn.setAttribute('aria-label', minimizeBtn.title);
      requestAnimationFrame(() => keepInView(host));
    }

    const outputButtons = [copyBtn, downloadBtn, bookmarkBtn, confirmSaveBtn, maximizeBtn];
    const setOutputReady = (ready) => {
      for (const b of outputButtons) b.disabled = !ready;
    };
    setOutputReady(false);

    const themeBtn = btn('', 'ghost icon', () => UIP.theme.toggle());
    cleanup.push(
      UIP.theme.watch((mode) => {
        const next = mode === 'dark' ? 'light' : 'dark';
        themeBtn.replaceChildren(icon(next === 'dark' ? 'moon' : 'sun'));
        themeBtn.title = `Switch to ${next} mode`;
        themeBtn.setAttribute('aria-label', themeBtn.title);
      })
    );
    const settings = UIP.settings.menu();
    cleanup.push(settings.destroy);

    const titleEl = h('strong', { text: 'UI Picker' });
    const header = h(
      'header',
      { class: 'head' },
      h('img', { class: 'logo', src: chrome.runtime.getURL('icons/icon-128.png'), alt: '', draggable: 'false' }),
      h(
        'div',
        { class: 'title' },
        titleEl,
        h('span', { class: 'tagline', text: TAGLINE, title: TAGLINE })
      ),
      btn('Library', 'outline', () => chrome.runtime.sendMessage({ type: 'uip-open-library' }), 'Open component library', 'folder'),
      themeBtn,
      settings.el,
      lights
    );

    const panel = h(
      'div',
      { class: 'panel' },
      h(
        'section',
        { class: 'top' },
        header,
        h(
          'div',
          { class: 'stats' },
          stats.lines.el,
          stats.nodes.el,
          stats.classes.el,
          stats.tailwind.el,
          h('span', { class: 'pill' }, sizeValue)
        )
      ),
      h(
        'div',
        { class: 'scroll' },
        h(
          'section',
          { class: 'viewer' },
          h('div', { class: 'toolbar' }, tabs, h('span', { class: 'spacer' }), previewTools),
          h(
            'div',
            { class: 'view' },
            frame,
            code,
            btn('Re-pick', 'outline sm repick', () => UIP.start(), 'Pick another element', 'refresh')
          )
        ),
        h('section', { class: 'options' }, disclosure, advanced),
        h(
          'section',
          { class: 'tokens' },
          h(
            'div',
            { class: 'option-row' },
            h('div', { class: 'option-text' }, h('h2', null, icon('palette'), h('span', { text: 'Extracted styles' })), tokenHint),
            tokenTabs
          ),
          colorList,
          fontList
        )
      ),
      h('footer', { class: 'foot' }, saveRow, h('div', { class: 'actions' }, copyBtn, downloadBtn, bookmarkBtn), status)
    );

    cleanup.push(UIP.settings.applyZoom(panel));
    shadow.append(panel);
    try {
      shadow.adoptedStyleSheets = await loadSheets('shared/theme.css', 'content/panel.css', 'shared/settings.css');
    } catch (err) {
      console.error('[UI Picker] could not load panel styles', err);
    }
    document.documentElement.appendChild(host);
    host.style.setProperty('visibility', 'visible', 'important');
    enableDrag(host, header);
    cleanup.push(UIP.settings.watch('zoom', () => requestAnimationFrame(() => keepInView(host))));

    /* ---------- behaviour ---------- */
    const STATUS_ICONS = { ok: 'check', warn: 'alert', error: 'alert' };
    function setStatus(text, kind) {
      const name = STATUS_ICONS[kind];
      if (text) status.replaceChildren(...(name ? [icon(name)] : []), h('span', { text }));
      else status.replaceChildren();
      status.className = `status ${kind || ''}`;
    }

    const zoomLevel = () => (state.zoom === 'fit' ? 0 : Number(state.zoom));

    function postPreview() {
      if (!state.ready || !state.html) return;
      frame.contentWindow.postMessage(
        {
          type: 'uip-render',
          html: state.previewHtml,
          width: snap.meta.width,
          height: snap.meta.height,
          bg: state.bg,
          zoom: zoomLevel(),
        },
        EXT_ORIGIN
      );
    }

    function setBg(index) {
      const [value, label, iconName] = BACKGROUNDS[index];
      state.bg = value;
      bgBtn.replaceChildren(icon(iconName));
      const title = `Preview background: ${label} (not part of the output)`;
      bgBtn.title = title;
      bgBtn.setAttribute('aria-label', title);
      if (state.ready) frame.contentWindow.postMessage({ type: 'uip-bg', bg: value }, EXT_ORIGIN);
    }
    setBg(0);

    function setZoom(value) {
      state.zoom = value;
      if (state.ready) frame.contentWindow.postMessage({ type: 'uip-zoom', zoom: zoomLevel() }, EXT_ORIGIN);
    }

    function scheduleRender() {
      clearTimeout(state.timer);
      state.timer = setTimeout(render, 150);
    }

    async function render() {
      const seq = ++state.seq;
      const busy = setTimeout(() => seq === state.seq && setStatus('Building…', 'busy'), 300);
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
        stats.lines.set(lines, state.lines ? lines - state.lines : 0);
        state.lines = lines;
        stats.classes.set(classCount);
        stats.tailwind.set(tailwindCount);
        stats.tailwind.el.hidden = html === previewHtml;
        sizeValue.textContent = formatBytes(bytes);
        const warnings = [];
        if (snap.meta.nodeCount > LARGE_NODES) warnings.push(`Large element (${fmt(snap.meta.nodeCount)} elements)`);
        if (bytes > LARGE_BYTES) warnings.push('Output is over 5 MB');
        setStatus(warnings.join(' · '), warnings.length ? 'warn' : '');
      } catch (err) {
        console.error('[UI Picker]', err);
        if (seq === state.seq) setStatus(`Build failed: ${err.message}`, 'error');
      } finally {
        clearTimeout(busy);
      }
    }

    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== EXT_ORIGIN) return;
      if (e.data?.type !== 'uip-rendered') return;
      state.scale = e.data.scale;
      state.zoom = e.data.fit ? 'fit' : String(e.data.scale);
      zoomValue.querySelector('span').textContent = `${Math.round(e.data.scale * 100)}%`;
      zoomValue.title = e.data.fit ? 'Fitted to the preview' : 'Fit to preview';
      zoomOut.disabled = state.scale <= ZOOMS[0] + 0.001;
      zoomIn.disabled = state.scale >= ZOOMS[ZOOMS.length - 1] - 0.001;
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      state.ready = true;
      postPreview();
    });

    ui = { host, onMessage, cleanup };

    if (!snap) {
      setStatus(`Could not copy this element: ${error?.message || error}`, 'error');
      return;
    }
    titleEl.title = `${snap.meta.label}  ${snap.meta.width} × ${snap.meta.height}`;
    stats.nodes.set(snap.meta.nodeCount);
    render();
  }

  function enableDrag(host, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .settings-menu')) return;
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

  // Anchored at the bottom, the header would drop down when the panel shrinks.
  function pinTopLeft(host) {
    const rect = host.getBoundingClientRect();
    host.style.setProperty('left', `${rect.left}px`, 'important');
    host.style.setProperty('top', `${rect.top}px`, 'important');
    host.style.setProperty('right', 'auto', 'important');
    host.style.setProperty('bottom', 'auto', 'important');
  }

  // After a drag the panel is placed by its top left corner, so growing it can push it off screen.
  function keepInView(host) {
    if (!host.isConnected || host.style.getPropertyValue('right') !== 'auto') return;
    const rect = host.getBoundingClientRect();
    const left = Math.min(Math.max(0, rect.left), Math.max(0, innerWidth - rect.width));
    const top = Math.min(Math.max(0, rect.top), Math.max(0, innerHeight - rect.height));
    host.style.setProperty('left', `${left}px`, 'important');
    host.style.setProperty('top', `${top}px`, 'important');
  }

  UIP.panel = { open, close };
})();
