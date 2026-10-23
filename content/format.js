(() => {
  'use strict';
  const CT = (window.CopyThing = window.CopyThing || {});
  if (CT.format) return;

  const INDENT = '  ';
  const MAX_WIDTH = 100;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Only ASCII whitespace collapses in CSS; &nbsp; is content and must stay put.
  const WS_SPLIT = /[ \t\n\r\f]+/;
  const WS_ONLY = /^[ \t\n\r\f]*$/;

  const RAW_TAGS = new Set(['pre', 'textarea', 'listing', 'xmp', 'plaintext', 'script', 'style']);
  const SVG_RAW_TAGS = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style', 'script', 'foreignObject']);
  const TABLE_WRAP_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);

  // Whitespace-only text between children of these containers is not rendered.
  const FLEX_GRID = /(^|[\s-])(flex|grid)\b/;
  const BLOCK_LEVEL = /^(block|flex|grid|table|list-item|flow-root|-webkit-box)/;
  // Block containers drop collapsible whitespace at the start of their first line and end of their last.
  const BLOCK_CONTAINER = /^(block|inline-block|flow-root|table-cell|table-caption|-webkit-box|-webkit-inline-box)/;

  const pad = (level) => INDENT.repeat(level);

  function indent(text, level) {
    const p = pad(level);
    return text
      .split('\n')
      .map((line) => (line ? p + line : line))
      .join('\n');
  }

  function escapeText(s) {
    return s.replace(/[&<>\u00a0]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u00a0': '&nbsp;' })[c]);
  }

  function tagsOf(el) {
    const shallow = el.cloneNode(false).outerHTML;
    const m = shallow.match(/<\/[^<>]+>$/);
    return m ? [shallow.slice(0, -m[0].length), m[0]] : [shallow, ''];
  }

  function glue(a, b) {
    return [...a.slice(0, -1), a[a.length - 1] + b[0], ...b.slice(1)];
  }

  // Lays out chunks on lines, breaking only at the separators (which stand for collapsible
  // whitespace). Returns lines; the first continues `cur`, later ones are fully indented.
  function layout(chunks, forced, cur, level, offset = 0) {
    const out = [];
    chunks.forEach((chunk, i) => {
      if (i > 0 && cur.trim()) {
        const width = cur.length + (out.length ? 0 : offset) + 1 + chunk[0].length;
        if (forced[i - 1] || width > MAX_WIDTH) {
          out.push(cur);
          cur = pad(level);
        } else {
          cur += ' ';
        }
      }
      cur += chunk[0];
      for (const line of chunk.slice(1)) {
        out.push(cur);
        cur = line;
      }
    });
    out.push(cur);
    return out;
  }

  /**
   * Pretty-prints `root` as HTML without changing how it renders.
   * `infoOf(el)` returns `{ display, outOfFlow, preserve, before, after }` for captured HTML
   * elements: the computed display, whether it is floated or absolutely positioned, whether
   * white-space is preserved, and whether ::before / ::after are emitted. Elements without info
   * are printed verbatim (SVG and table wrappers excepted). Returns the markup indented to `level`.
   */
  function html(root, level, infoOf) {
    const isBlockLevel = (el) => {
      const info = infoOf(el);
      return !!info && (info.display === 'none' || BLOCK_LEVEL.test(info.display));
    };
    // Whitespace next to an in-flow block box ends up at a line edge, where it collapses away.
    // Floats and absolutely positioned boxes sit inside the line, so they don't qualify.
    const splitsLines = (el) => {
      const info = infoOf(el);
      return !!info && !info.outOfFlow && BLOCK_LEVEL.test(info.display) && !info.display.startsWith('table-');
    };

    function modeOf(el, parentCtx) {
      const tag = el.localName;
      if (el.namespaceURI === SVG_NS) return { mode: SVG_RAW_TAGS.has(tag) ? 'raw' : 'block' };
      const info = infoOf(el);
      if (!info) return { mode: TABLE_WRAP_TAGS.has(tag) ? 'block' : 'raw' };
      if (RAW_TAGS.has(tag) || info.preserve) return { mode: 'raw' };

      const ctx = (info.display === 'contents' ? parentCtx : info.display) || 'block';
      if (ctx === 'none' || FLEX_GRID.test(ctx)) return { mode: 'block', ctx };

      const container = BLOCK_CONTAINER.test(ctx);
      const kids = Array.from(el.childNodes);
      const blockKids =
        kids.every((k) =>
          k.nodeType === Node.TEXT_NODE
            ? WS_ONLY.test(k.data)
            : k.nodeType !== Node.ELEMENT_NODE || isBlockLevel(k)
        ) &&
        (container || kids.some((k) => k.nodeType === Node.ELEMENT_NODE));
      if (blockKids) return { mode: 'block', ctx };

      return {
        mode: 'inline',
        ctx,
        trimStart: container && !info.before,
        trimEnd: container && !info.after,
      };
    }

    // Returns lines: the first is unindented (the caller places it), the rest are absolute.
    function render(el, lvl, parentCtx) {
      const [open, close] = tagsOf(el);
      if (!close) return [open];
      const { mode, ctx, trimStart, trimEnd } = modeOf(el, parentCtx);
      if (mode === 'raw') return el.outerHTML.split('\n');
      return mode === 'block'
        ? renderBlock(el, lvl, ctx, open, close)
        : renderInline(el, lvl, ctx, open, close, trimStart, trimEnd);
    }

    function renderBlock(el, lvl, ctx, open, close) {
      const lines = [open];
      for (const k of el.childNodes) {
        if (k.nodeType === Node.ELEMENT_NODE) {
          const sub = render(k, lvl + 1, ctx);
          lines.push(pad(lvl + 1) + sub[0], ...sub.slice(1));
        } else if (k.nodeType === Node.TEXT_NODE && !WS_ONLY.test(k.data)) {
          const words = k.data.trim().split(WS_SPLIT).map((w) => [escapeText(w)]);
          lines.push(...layout(words, [], pad(lvl + 1), lvl + 1));
        }
      }
      if (lines.length === 1) return [open + close];
      if (lines.length === 2) {
        const one = open + lines[1].trim() + close;
        if (pad(lvl).length + one.length <= MAX_WIDTH) return [one];
      }
      lines.push(pad(lvl) + close);
      return lines;
    }

    function renderInline(el, lvl, ctx, open, close, trimStart, trimEnd) {
      const items = [];
      const ws = (force) => {
        const last = items[items.length - 1];
        if (last && last.ws) last.force = last.force || force;
        else items.push({ ws: true, force });
      };
      for (const k of el.childNodes) {
        if (k.nodeType === Node.TEXT_NODE) {
          k.data.split(WS_SPLIT).forEach((word, i) => {
            if (i) ws(false);
            if (word) items.push({ lines: [escapeText(word)] });
          });
        } else if (k.nodeType === Node.ELEMENT_NODE) {
          const block = splitsLines(k);
          if (block) ws(true);
          items.push({ lines: render(k, lvl + 1, ctx) });
          // Whitespace right after a <br> starts the next line, so it collapses away too.
          if (block || (k.localName === 'br' && k.namespaceURI !== SVG_NS)) ws(true);
        }
      }

      const leadWs = !!items[0]?.ws;
      if (leadWs) items.shift();
      const trailWs = !!items[items.length - 1]?.ws;
      if (trailWs) items.pop();

      const chunks = [];
      const forced = [];
      let cur = null;
      for (const it of items) {
        if (it.ws) {
          chunks.push(cur);
          forced.push(it.force);
          cur = null;
        } else {
          cur = cur ? glue(cur, it.lines) : it.lines;
        }
      }
      if (cur) chunks.push(cur);

      const lead = leadWs && !trimStart ? ' ' : '';
      const trail = trailWs && !trimEnd ? ' ' : '';
      if (!chunks.length) return [open + (lead || trail) + close];

      if (chunks.every((c) => c.length === 1) && !forced.some(Boolean)) {
        const one = open + lead + chunks.map((c) => c[0]).join(' ') + trail + close;
        if (pad(lvl).length + one.length <= MAX_WIDTH) return [one];
      }

      const lines =
        trimStart || leadWs
          ? [open, ...layout(chunks, forced, pad(lvl + 1), lvl + 1)]
          : layout(chunks, forced, open, lvl + 1, pad(lvl).length);
      if (trimEnd || trailWs) lines.push(pad(lvl) + close);
      else lines[lines.length - 1] += close;
      return lines;
    }

    const lines = render(root, level, 'block');
    return [pad(level) + lines[0], ...lines.slice(1)].join('\n');
  }

  CT.format = { html, indent };
})();
