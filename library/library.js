(() => {
  const CT = window.CopyThing;
  const { h, slug, formatBytes, hostOf, copyText, downloadText } = CT.util;
  const PREVIEW = '../preview/preview.html';

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

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => (toast.hidden = true), 1800);
  }

  async function copy(comp) {
    const ok = await copyText(comp.html);
    showToast(ok ? 'Copied HTML to clipboard' : 'Copy failed');
  }

  function download(comp) {
    downloadText(`${slug(comp.name)}.html`, comp.html);
  }

  function openSource(comp) {
    chrome.runtime.sendMessage({ type: 'ct-open-source', url: comp.sourceUrl, scroll: comp.sourceScroll });
  }

  function sourceTitle(comp) {
    const y = comp.sourceScroll?.y;
    return y ? `${comp.sourceUrl}\nOpens scrolled down ${y}px, where it was copied` : comp.sourceUrl;
  }

  async function remove(comp) {
    if (!confirm(`Delete "${comp.name}"?`)) return;
    await CT.storage.remove(comp.id);
    showToast('Deleted');
  }

  function card(comp) {
    const src = `${PREVIEW}?id=${encodeURIComponent(comp.id)}&bg=checker`;
    return h(
      'article',
      { class: 'card' },
      h(
        'button',
        { class: 'thumb', title: 'Open preview', onclick: () => openModal(comp) },
        h('iframe', { src, loading: 'lazy', tabindex: '-1', title: comp.name })
      ),
      h(
        'div',
        { class: 'info' },
        h('h3', { text: comp.name, title: comp.name }),
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
        h('button', { class: 'btn primary', text: 'Copy', onclick: () => copy(comp) }),
        h('button', { class: 'btn secondary', text: 'Download', onclick: () => download(comp) }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', text: 'Delete', onclick: () => remove(comp) })
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
    components = await CT.storage.list();
    const ids = new Set(components.map((c) => c.id));
    for (const id of textCache.keys()) if (!ids.has(id)) textCache.delete(id);
    render();
    if (current && !ids.has(current.id)) modal.close();
  }

  /* ---------- modal ---------- */
  const modalOpen = document.getElementById('modal-open');
  let codeFor = null;

  function setTab(which) {
    for (const t of modal.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === which);
    modalFrame.hidden = which !== 'preview';
    modalCode.hidden = which !== 'code';
    if (which === 'code' && current && codeFor !== current) {
      CT.highlight.render(modalCode, current.html);
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
    modalFrame.removeAttribute('src');
  });

  search.addEventListener('input', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CT.storage.KEY]) load();
  });

  load();
})();
