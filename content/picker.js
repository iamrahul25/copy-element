(() => {
  'use strict';
  const CT = (window.CopyThing = window.CopyThing || {});
  if (CT.picker) return;

  const ACCENT = '#6366f1';
  let active = null;

  function css(el, styles) {
    for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v, 'important');
    return el;
  }

  // Picks an element under the cursor. A full-viewport overlay sits on top of the page so the
  // page never receives hover/click events: the captured styles are the element's resting state.
  function start(onPick, onCancel) {
    stop();

    const host = document.createElement('div');
    host.setAttribute('data-copything', 'picker');
    css(host, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      'z-index': '2147483647',
      cursor: 'crosshair',
      'pointer-events': 'auto',
    });
    const shadow = host.attachShadow({ mode: 'open' });

    const box = css(document.createElement('div'), {
      position: 'fixed',
      display: 'none',
      'pointer-events': 'none',
      'box-sizing': 'border-box',
      border: `2px solid ${ACCENT}`,
      background: 'rgba(99, 102, 241, 0.12)',
      'border-radius': '2px',
      transition: 'all 50ms ease-out',
    });
    const label = css(document.createElement('div'), {
      position: 'fixed',
      display: 'none',
      'pointer-events': 'none',
      background: '#111827',
      color: '#fff',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      padding: '3px 7px',
      'border-radius': '4px',
      'white-space': 'nowrap',
      'max-width': '70vw',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
    });
    const hint = css(document.createElement('div'), {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      'pointer-events': 'none',
      background: '#111827',
      color: '#fff',
      font: '13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
      padding: '8px 14px',
      'border-radius': '999px',
      'box-shadow': '0 6px 24px rgba(0,0,0,.25)',
      'white-space': 'nowrap',
    });
    hint.textContent = 'Click to copy  ·  ↑ parent  ·  ↓ child  ·  Enter select  ·  Esc cancel';
    shadow.append(box, label, hint);
    document.documentElement.appendChild(host);

    let current = null;
    let lastX = -1;
    let lastY = -1;
    let frame = 0;

    const elementAt = (x, y) => {
      host.style.setProperty('pointer-events', 'none', 'important');
      let el = document.elementFromPoint(x, y);
      host.style.setProperty('pointer-events', 'auto', 'important');
      if (!el || el.closest('[data-copything]')) return null;
      if (el === document.documentElement) el = document.body;
      return el;
    };

    const highlight = (el) => {
      current = el;
      if (!el) {
        box.style.setProperty('display', 'none', 'important');
        label.style.setProperty('display', 'none', 'important');
        return;
      }
      const r = el.getBoundingClientRect();
      css(box, {
        display: 'block',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      label.textContent = `${CT.describe(el)}   ${Math.round(r.width)} × ${Math.round(r.height)}`;
      const top = r.top > 28 ? r.top - 26 : Math.min(r.bottom + 4, innerHeight - 26);
      css(label, {
        display: 'block',
        left: `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`,
        top: `${Math.max(4, top)}px`,
      });
    };

    const isOurs = (e) => e.composedPath().includes(host);

    const onMove = (e) => {
      if (!isOurs(e)) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        highlight(elementAt(lastX, lastY));
      });
    };

    const block = (e) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'click') return;
      const el = current || elementAt(e.clientX, e.clientY);
      if (el) pick(el);
    };

    const onKey = (e) => {
      const handled = ['Escape', 'ArrowUp', 'ArrowDown', 'Enter'];
      if (!handled.includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        cleanup();
        onCancel?.();
      } else if (e.key === 'Enter') {
        if (current) pick(current);
      } else if (e.key === 'ArrowUp') {
        if (current && current.parentElement && current !== document.body) highlight(current.parentElement);
      } else if (e.key === 'ArrowDown') {
        if (current?.firstElementChild) highlight(current.firstElementChild);
      }
    };

    const onScroll = () => {
      if (current) highlight(current);
    };

    const pointerEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];
    window.addEventListener('mousemove', onMove, true);
    for (const t of pointerEvents) window.addEventListener(t, block, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);

    function pick(el) {
      try {
        onPick(el);
      } finally {
        cleanup();
      }
    }

    function cleanup() {
      if (!active) return;
      active = null;
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove, true);
      for (const t of pointerEvents) window.removeEventListener(t, block, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      host.remove();
    }

    active = { cleanup };
  }

  function stop() {
    active?.cleanup();
  }

  CT.picker = { start, stop, isActive: () => !!active };
})();
