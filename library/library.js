(() => {
  const UIP = window.UiPicker;
  const { h, slug, formatBytes, hostOf, copyText, downloadText } = UIP.util;
  const { icon } = UIP;
  const PREVIEW = '../preview/preview.html';

  for (const el of document.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon));

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const noResults = document.getElementById('no-results');
  const count = document.getElementById('count');
  const search = document.getElementById('search');
  const toast = document.getElementById('toast');
  const modal = document.getElementById('modal');
  const modalFrame = document.getElementById('modal-frame');
  const modalCode = document.getElementById('modal-code');
  const modalBg = document.getElementById('modal-bg');
  const modalScale = document.getElementById('modal-scale');

  let components = [];
  let current = null;
  const textCache = new Map();

  function textOf(comp) {
    if (!textCache.has(comp.id)) {
      const doc = new DOMParser().parseFromString(comp.html, 'text/html');
      textCache.set(comp.id, (doc.body?.textContent || '').replace(/\s+/g, ' ').toLowerCase());
    }
    return textCache.get(comp.id);
  }

  function matches(comp, query) {
    if (!query) return true;
    return query
      .split(/\s+/)
      .every(
        (word) =>
          (comp.name || '').toLowerCase().includes(word) ||
          (comp.sourceUrl || '').toLowerCase().includes(word) ||
          (comp.sourceTitle || '').toLowerCase().includes(word) ||
          textOf(comp).includes(word)
      );
  }

  function metaLine(comp) {
    const parts = [hostOf(comp.sourceUrl)];
    if (comp.width && comp.height) parts.push(`${comp.width} × ${comp.height}`);
    if (comp.sizeBytes) parts.push(formatBytes(comp.sizeBytes));
    parts.push(new Date(comp.createdAt).toLocaleDateString());
    return parts.filter(Boolean).join(' · ');
  }

  function showToast(text, ok = true) {
    toast.replaceChildren(icon(ok ? 'check' : 'alert'), h('span', { text }));
    toast.classList.toggle('error', !ok);
    // Re-showing puts the popover back on top of the top layer, above an open dialog.
    if (toast.matches(':popover-open')) toast.hidePopover();
    toast.showPopover();
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.hidePopover(), 3000);
  }

  async function copy(comp) {
    const ok = await copyText(comp.html);
    showToast(ok ? 'Copied HTML to clipboard' : 'Copy failed. Use Download instead.', ok);
  }

  function download(comp) {
    downloadText(`${slug(comp.name)}.html`, comp.html);
    showToast('Download started');
  }

  const button = (text, cls, iconName, onclick, label) =>
    h(
      'button',
      { class: `btn ${cls}`, onclick, title: label, 'aria-label': text ? null : label },
      icon(iconName),
      text && h('span', { text })
    );

  function openSource(comp) {
    chrome.runtime.sendMessage({ type: 'uip-open-source', url: comp.sourceUrl, scroll: comp.sourceScroll });
  }

  function sourceTitle(comp) {
    const y = comp.sourceScroll?.y;
    return y ? `${comp.sourceUrl}\nOpens scrolled down ${y}px, where it was copied` : comp.sourceUrl;
  }

  async function remove(comp) {
    if (!confirm(`Delete "${comp.name}"?`)) return;
    await UIP.storage.remove(comp.id);
    showToast('Deleted');
  }

  function card(comp) {
    const src = `${PREVIEW}?id=${encodeURIComponent(comp.id)}&bg=checker`;
    return h(
      'article',
      { class: 'card' },
      h(
        'button',
        { class: 'thumb', title: 'Open preview', 'aria-label': `Open preview of ${comp.name}`, onclick: () => openModal(comp) },
        h('iframe', { src, loading: 'lazy', tabindex: '-1', title: comp.name })
      ),
      h(
        'div',
        { class: 'info' },
        h('h2', { text: comp.name, title: comp.name }),
        h(
          'p',
          { class: 'meta' },
          comp.sourceUrl
            ? h('a', {
                href: comp.sourceUrl,
                target: '_blank',
                rel: 'noreferrer',
                text: metaLine(comp),
                title: sourceTitle(comp),
                onclick: (e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  openSource(comp);
                },
              })
            : metaLine(comp)
        )
      ),
      h(
        'div',
        { class: 'actions' },
        button('Copy HTML', 'primary', 'copy', () => copy(comp)),
        button('Download', 'secondary', 'download', () => download(comp), 'Download .html'),
        button('', 'danger icon', 'trash', () => remove(comp), `Delete "${comp.name}"`)
      )
    );
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = components.filter((c) => matches(c, query));
    grid.replaceChildren(...visible.map(card));
    count.textContent = components.length ? `${components.length} saved` : '';
    empty.hidden = components.length > 0;
    noResults.hidden = !(components.length > 0 && visible.length === 0);
  }

  async function load() {
    components = await UIP.storage.list();
    const ids = new Set(components.map((c) => c.id));
    for (const id of textCache.keys()) if (!ids.has(id)) textCache.delete(id);
    render();
    if (current && !ids.has(current.id)) modal.close();
  }

  /* ---------- modal ---------- */
  const modalOpen = document.getElementById('modal-open');
  let codeFor = null;

  function setTab(which) {
    for (const t of modal.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === which);
      t.setAttribute('aria-selected', String(t.dataset.tab === which));
    }
    modalFrame.hidden = which !== 'preview';
    modalCode.hidden = which !== 'code';
    if (which === 'code' && current && codeFor !== current) {
      UIP.highlight.render(modalCode, current.html);
      codeFor = current;
    }
  }

  function openModal(comp) {
    current = comp;
    document.getElementById('modal-name').textContent = comp.name;
    document.getElementById('modal-meta').textContent = metaLine(comp);
    modalOpen.hidden = !comp.sourceUrl;
    modalOpen.title = comp.sourceUrl ? sourceTitle(comp) : '';
    modalFrame.src = `${PREVIEW}?id=${encodeURIComponent(comp.id)}&bg=${modalBg.value}`;
    setTab('preview');
    modal.showModal();
  }

  modal.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  modalBg.addEventListener('change', () => current && (modalFrame.src = `${PREVIEW}?id=${encodeURIComponent(current.id)}&bg=${modalBg.value}`));
  document.getElementById('modal-close').addEventListener('click', () => modal.close());
  document.getElementById('modal-copy').addEventListener('click', () => current && copy(current));
  document.getElementById('modal-download').addEventListener('click', () => current && download(current));
  modalOpen.addEventListener('click', () => current && openSource(current));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
  modal.addEventListener('close', () => {
    current = null;
    codeFor = null;
    modalCode.replaceChildren();
    modalScale.textContent = '';
    modalFrame.removeAttribute('src');
  });
  window.addEventListener('message', (e) => {
    if (e.source !== modalFrame.contentWindow || e.data?.type !== 'uip-rendered') return;
    const pct = Math.round(e.data.scale * 100);
    modalScale.textContent = pct < 100 ? `${pct}%` : '';
  });

  search.addEventListener('input', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UIP.storage.KEY]) load();
  });

  load();
})();
