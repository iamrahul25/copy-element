(() => {
  'use strict';
  const CT = (window.CopyThing = window.CopyThing || {});
  if (CT.serializer) return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  const DEFAULT_OPTIONS = {
    pseudo: true,
    fonts: true,
    svg: true,
    states: false,
    images: false,
    keepClasses: false,
    pageBg: true,
  };

  // Properties that inherit from the parent. Listing a non-inherited property here would
  // drop needed declarations, so only well-known inherited properties are included.
  const INHERITED = new Set(
    `color font-family font-size font-style font-weight font-stretch font-variant-caps
    font-variant-ligatures font-variant-numeric font-variant-east-asian font-variant-alternates
    font-variant-position font-variant-emoji font-feature-settings font-variation-settings
    font-kerning font-optical-sizing font-size-adjust font-synthesis-weight font-synthesis-style
    font-synthesis-small-caps font-synthesis-position font-palette line-height letter-spacing
    word-spacing text-align text-align-last text-indent text-justify text-transform text-shadow
    text-rendering text-underline-position text-underline-offset text-decoration-skip-ink
    text-emphasis-color text-emphasis-position text-emphasis-style text-orientation
    text-size-adjust -webkit-text-size-adjust text-spacing-trim text-autospace text-wrap-mode
    text-wrap-style white-space white-space-collapse word-break overflow-wrap line-break hyphens
    hyphenate-character -webkit-hyphenate-character tab-size direction writing-mode visibility
    cursor pointer-events list-style-type list-style-position list-style-image quotes
    border-collapse -webkit-border-horizontal-spacing -webkit-border-vertical-spacing
    caption-side empty-cells orphans widows caret-color accent-color color-scheme
    print-color-adjust -webkit-print-color-adjust forced-color-adjust image-rendering paint-order
    fill fill-opacity fill-rule stroke stroke-width stroke-dasharray stroke-dashoffset
    stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity clip-rule color-interpolation
    color-interpolation-filters color-rendering marker-start marker-mid marker-end shape-rendering
    text-anchor dominant-baseline -webkit-text-fill-color -webkit-text-stroke-color
    -webkit-text-stroke-width -webkit-font-smoothing -webkit-text-security -webkit-user-modify
    -webkit-line-break -webkit-rtl-ordering -webkit-highlight -webkit-tap-highlight-color
    math-depth math-style ruby-position`
      .split(/\s+/)
      .filter(Boolean)
  );

  // Color properties whose initial value is currentcolor. Computed styles resolve them to rgb,
  // which would freeze them; keeping `currentcolor` lets them follow color changes (e.g. hover).
  const CURRENTCOLOR = new Set([
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'outline-color',
    'text-decoration-color',
    'column-rule-color',
    'caret-color',
    '-webkit-text-fill-color',
    '-webkit-text-stroke-color',
    'text-emphasis-color',
  ]);

  // Probe values used to detect which inherited properties the browser's default stylesheet
  // sets on a tag (e.g. font-size on <h1>, font on <button>).
  const PROBE_STYLE = [
    'color:rgb(1,2,3)',
    'font-family:ct-probe',
    'font-size:23px',
    'font-style:italic',
    'font-weight:300',
    'font-stretch:condensed',
    'font-variant-caps:small-caps',
    'font-kerning:none',
    'font-feature-settings:"liga" 0',
    'line-height:37px',
    'letter-spacing:3px',
    'word-spacing:3px',
    'text-align:right',
    'text-indent:5px',
    'text-transform:uppercase',
    'text-shadow:rgb(1,2,3) 1px 1px 1px',
    'text-rendering:optimizeLegibility',
    'white-space:pre',
    'word-break:break-all',
    'overflow-wrap:anywhere',
    'line-break:anywhere',
    'hyphens:none',
    'tab-size:3',
    'direction:rtl',
    'visibility:collapse',
    'cursor:crosshair',
    'pointer-events:none',
    'list-style-type:square',
    'list-style-position:inside',
    'quotes:"a" "b"',
    'border-collapse:collapse',
    'border-spacing:3px',
    'caption-side:bottom',
    'empty-cells:hide',
    'caret-color:rgb(4,5,6)',
    'accent-color:rgb(4,5,6)',
    'fill:rgb(1,2,3)',
    'stroke:rgb(1,2,3)',
    'stroke-width:3px',
    'text-anchor:end',
  ].join(';');

  const LOGICAL_RE =
    /^(min-|max-)?(block|inline)-size$|-(block|inline)(-|$)|^border-(start|end)-(start|end)-radius$/;
  const SKIP_RE =
    /^(--|animation|view-transition|will-change$|-webkit-locale$|d$|x$|y$|cx$|cy$|r$|rx$|ry$)/;
  const ROOT_SKIP_RE =
    /^(order|flex-grow|flex-shrink|flex-basis|align-self|justify-self|place-self|grid-row|grid-column|grid-area)/;
  const INSETS = new Set(['top', 'right', 'bottom', 'left']);
  const RULE_STYLE_RE = /^(border-(?:top|right|bottom|left)|outline|column-rule|row-rule)-style$/;
  const EMPTY_SET = new Set();

  const DROP_TAGS = new Set([
    'script',
    'style',
    'link',
    'meta',
    'noscript',
    'template',
    'base',
    'title',
    'head',
  ]);
  const DROP_ATTR_RE =
    /^(on[a-z]+|nonce|integrity|crossorigin|autofocus|_ng|ng-|v-|x-|wire:|jsaction|jscontroller|jsname|jsmodel|jslog|jsdata|jsshadow|jsrenderer)/;
  const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'xlink:href', 'cite', 'background']);
  const ID_REF_ATTRS = [
    'for',
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-activedescendant',
    'aria-details',
    'aria-errormessage',
    'list',
    'form',
    'headers',
    'popovertarget',
    'commandfor',
  ];
  const SVG_URL_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'];
  const TABLE_PARTS = new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup']);

  const STATE_SRC = '(?<!\\\\):(?:hover|focus-visible|focus-within|focus|active)(?![\\w-])';
  const STATE_TEST = new RegExp(STATE_SRC);
  const STATE_ALL = new RegExp(STATE_SRC, 'g');
  const STATE_AT = new RegExp(`^${STATE_SRC}`);
  const PSEUDO_EL_SRC = '(?<!\\\\)(?:::?(?:before|after)|::placeholder)(?![\\w-])';
  const PSEUDO_EL = new RegExp(PSEUDO_EL_SRC);
  const PSEUDO_EL_ALL = new RegExp(PSEUDO_EL_SRC, 'g');
  const OTHER_PSEUDO_EL = /(?<!\\)::(?!before|after|placeholder)[\w-]+/;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function absUrl(value, base) {
    const v = String(value).trim();
    if (!v || /^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(v)) return v;
    try {
      return new URL(v, base || document.baseURI).href;
    } catch {
      return v;
    }
  }

  function absSrcset(value) {
    return value
      .split(',')
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        return [absUrl(url), ...rest].join(' ');
      })
      .join(', ');
  }

  function absCssUrls(text, base) {
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
      const u = url.trim();
      if (/^(data:|blob:|#)/i.test(u)) return match;
      return `url("${absUrl(u, base)}")`;
    });
  }

  function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') {
        cur += c + (text[i + 1] || '');
        i++;
        continue;
      }
      if (quote) {
        if (c === quote) quote = null;
        cur += c;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === sep && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  function splitCompounds(selector) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    let comb = null;
    const flush = () => {
      if (!cur) return;
      parts.push({ sel: cur, comb: parts.length ? comb || ' ' : null });
      cur = '';
      comb = null;
    };
    for (let i = 0; i < selector.length; i++) {
      const c = selector[i];
      if (c === '\\') {
        cur += c + (selector[i + 1] || '');
        i++;
        continue;
      }
      if (quote) {
        if (c === quote) quote = null;
        cur += c;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && /[\s>+~]/.test(c)) {
        flush();
        if (c !== ' ' && !/\s/.test(c)) comb = c;
        continue;
      }
      cur += c;
    }
    flush();
    return parts;
  }

  function hasStateInParens(compound) {
    let depth = 0;
    for (let i = 0; i < compound.length; i++) {
      const c = compound[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ':' && depth > 0 && STATE_AT.test(compound.slice(i))) return true;
    }
    return false;
  }

  function cleanFamily(name) {
    return name.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  }

  // False for values that would print as `prop: ;` (e.g. var() references that resolved to nothing).
  function hasValue(value) {
    return /[^\s,]/.test(String(value || '').replace(/!\s*important\s*$/i, ''));
  }

  function isTransparent(color) {
    if (!color || color === 'transparent') return true;
    return /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
  }

  function describe(el) {
    if (!el || !el.localName) return '';
    let s = el.localName;
    if (el.id) s += `#${el.id}`;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }

  function suggestName(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('title');
    if (label && label.trim()) return label.trim().slice(0, 60);
    const heading = el.querySelector('h1,h2,h3,h4,h5,h6');
    const text = (heading || el).textContent.replace(/\s+/g, ' ').trim();
    if (text) return text.length > 50 ? `${text.slice(0, 47)}…` : text;
    return describe(el);
  }

  /* ------------------------------------------------------------------ */
  /* Default styles (from a clean, hidden same-origin iframe)            */
  /* ------------------------------------------------------------------ */

  function readAll(cs) {
    const out = Object.create(null);
    const color = cs.getPropertyValue('color');
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      let v = cs.getPropertyValue(p);
      if (CURRENTCOLOR.has(p) && v === color) v = 'currentcolor';
      out[p] = v;
    }
    return out;
  }

  function readInherited(cs) {
    const out = Object.create(null);
    const color = cs.getPropertyValue('color');
    for (const p of INHERITED) {
      let v = cs.getPropertyValue(p);
      if (CURRENTCOLOR.has(p) && v === color) v = 'currentcolor';
      out[p] = v;
    }
    return out;
  }

  function createDefaults() {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-copything', 'defaults');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText = [
      'display:block!important',
      'position:fixed!important',
      'left:-20000px!important',
      'top:0!important',
      'width:1200px!important',
      'height:800px!important',
      'border:0!important',
      'visibility:hidden!important',
      'pointer-events:none!important',
    ].join(';');
    document.documentElement.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    try {
      doc.open();
      doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
      doc.close();
    } catch {
      // Trusted Types may block document.write; the initial about:blank document still works.
    }
    const body = doc.body || doc.documentElement.appendChild(doc.createElement('body'));

    const plainSvg = doc.createElementNS(SVG_NS, 'svg');
    body.appendChild(plainSvg);
    const probe = doc.createElement('div');
    probe.style.cssText = PROBE_STYLE;
    body.appendChild(probe);
    const probeSvg = doc.createElementNS(SVG_NS, 'svg');
    probe.appendChild(probeSvg);

    const cache = new Map();

    function make(tag, ns, extra) {
      const el = ns === HTML_NS ? doc.createElement(tag) : doc.createElementNS(ns, tag);
      if (extra.startsWith('type=')) el.setAttribute('type', extra.slice(5));
      else if (extra === 'href') el.setAttribute('href', '#');
      else if (extra === 'open') el.setAttribute('open', '');
      return el;
    }

    function get(tag, ns = HTML_NS, extra = '') {
      const key = `${ns}|${tag}|${extra}`;
      let def = cache.get(key);
      if (def) return def;
      const svgChild = ns === SVG_NS && tag !== 'svg';

      const plainEl = make(tag, ns, extra);
      (svgChild ? plainSvg : body).appendChild(plainEl);
      const plain = readAll(win.getComputedStyle(plainEl));
      let placeholderColor = null;
      if (tag === 'input' || tag === 'textarea') {
        try {
          placeholderColor = win.getComputedStyle(plainEl, '::placeholder').getPropertyValue('color');
        } catch {}
      }
      plainEl.remove();

      const parent = svgChild ? probeSvg : probe;
      const probeEl = make(tag, ns, extra);
      parent.appendChild(probeEl);
      const parentVals = readInherited(win.getComputedStyle(parent));
      const childVals = readInherited(win.getComputedStyle(probeEl));
      const ua = new Set();
      for (const p of INHERITED) if (childVals[p] !== parentVals[p]) ua.add(p);
      probeEl.remove();

      def = { plain, ua, placeholderColor };
      cache.set(key, def);
      return def;
    }

    return { get, destroy: () => frame.remove() };
  }

  function extraFor(el, tag) {
    if (tag === 'input') return `type=${(el.getAttribute('type') || 'text').toLowerCase()}`;
    if (tag === 'button') return `type=${(el.getAttribute('type') || 'submit').toLowerCase()}`;
    if ((tag === 'a' || tag === 'area') && el.hasAttribute('href')) return 'href';
    if (tag === 'details' && el.hasAttribute('open')) return 'open';
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Style diffing                                                       */
  /* ------------------------------------------------------------------ */

  function computeDecls(cs, def, parentInh, overrides, isRoot) {
    const get = (p) => (overrides && p in overrides ? overrides[p] : cs.getPropertyValue(p));
    const color = cs.getPropertyValue('color');
    const position = get('position');
    const transformed =
      get('transform') !== 'none' ||
      get('rotate') !== 'none' ||
      get('scale') !== 'none' ||
      get('translate') !== 'none';
    const hasPerspective = get('perspective') !== 'none';

    const decls = [];
    const inh = Object.create(null);
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (SKIP_RE.test(p) || LOGICAL_RE.test(p)) continue;
      let v = get(p);
      if (CURRENTCOLOR.has(p) && v === color) v = 'currentcolor';
      const inherited = INHERITED.has(p);
      if (inherited) inh[p] = v;
      if (!hasValue(v)) continue;

      if (isRoot && ROOT_SKIP_RE.test(p)) continue;
      if (position === 'static' && INSETS.has(p)) continue;
      if (p === 'transform-origin' && !transformed) continue;
      if (p === 'perspective-origin' && !hasPerspective) continue;

      const ref = inherited && !isRoot && !def.ua.has(p) ? parentInh[p] : def.plain[p];
      if (v === ref) continue;
      decls.push([p, v]);
    }
    addRuleWidths(decls, get);
    return { decls, inh };
  }

  // A line's computed width is 0px whenever its style is none, so the width often matches the
  // default and gets dropped. Once the style is set, the width falls back to `medium` (3px),
  // e.g. Tailwind's `* { border: 0 solid }` would draw a box around every element.
  function addRuleWidths(decls, get) {
    for (let i = 0; i < decls.length; i++) {
      const m = decls[i][0].match(RULE_STYLE_RE);
      if (!m || /^(none|hidden)$/.test(decls[i][1])) continue;
      const widthProp = `${m[1]}-width`;
      const width = get(widthProp);
      if (!hasValue(width) || decls.some(([p]) => p === widthProp)) continue;
      decls.splice(++i, 0, [widthProp, width]);
    }
  }

  function rootOverrides(cs) {
    const o = {
      'margin-top': '0px',
      'margin-right': '0px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      position: 'relative',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
      float: 'none',
    };
    if (/^matrix\(1, 0, 0, 1, /.test(cs.transform)) o.transform = 'none';
    if (cs.translate && cs.translate !== 'none') o.translate = 'none';
    for (const p of ['max-width', 'max-height']) {
      if (cs.getPropertyValue(p).includes('%')) o[p] = 'none';
    }
    for (const p of ['min-width', 'min-height']) {
      if (cs.getPropertyValue(p).includes('%')) o[p] = 'auto';
    }
    return o;
  }

  function pseudoDecls(el, which, elInh, spanDef) {
    let pcs;
    try {
      pcs = getComputedStyle(el, which);
    } catch {
      return null;
    }
    const content = pcs.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') return null;
    if (pcs.getPropertyValue('display') === 'none') return null;
    return computeDecls(pcs, { plain: spanDef.plain, ua: EMPTY_SET }, elInh, null, false).decls;
  }

  /* ------------------------------------------------------------------ */
  /* Capture: synchronous snapshot of DOM + computed styles              */
  /* ------------------------------------------------------------------ */

  function capture(rootEl) {
    if (!(rootEl instanceof Element)) throw new Error('Nothing selected');
    const defaults = createDefaults();
    try {
      const holder = document.createElement('div');
      holder.appendChild(rootEl.cloneNode(true));
      const ctx = {
        rootEl,
        defaults,
        infos: [],
        map: new Map(),
        keepIds: collectReferencedIds(rootEl),
        urlRefs: new Set(),
        families: new Set(),
        docBase: location.href.split('#')[0],
      };
      walk(ctx, rootEl, holder.firstElementChild, null, true);
      removeComments(holder);
      addExternalDefs(ctx, holder);

      const rect = rootEl.getBoundingClientRect();
      const tag = rootEl.localName;
      let tableWrap = null;
      if (TABLE_PARTS.has(tag)) {
        const table = rootEl.closest('table');
        const tcs = table ? getComputedStyle(table) : null;
        tableWrap = {
          tag,
          style: tcs ? `border-collapse: ${tcs.borderCollapse}; border-spacing: ${tcs.borderSpacing}` : '',
        };
      }

      return {
        root: holder.firstElementChild,
        rootEl,
        infos: ctx.infos,
        map: ctx.map,
        cache: {},
        stateCounter: 0,
        meta: {
          label: describe(rootEl),
          name: suggestName(rootEl),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          nodeCount: ctx.infos.length,
          families: [...ctx.families],
          pageBg: pageBackground(rootEl),
          tableWrap,
          sourceUrl: location.href,
          sourceTitle: document.title,
        },
      };
    } finally {
      defaults.destroy();
    }
  }

  function walk(ctx, orig, cl, parentInh, isRoot, parentOneLine = false) {
    const tag = orig.localName;
    const ns = orig.namespaceURI || HTML_NS;
    if (!isRoot && shouldDrop(orig, tag)) {
      cl.remove();
      return;
    }
    const inSvg = ns === SVG_NS;
    let outTag = tag;
    let outNs = ns;
    let recurse = true;

    if (isRoot && (tag === 'body' || tag === 'html')) {
      cl = retag(cl, 'div');
      outTag = 'div';
      outNs = HTML_NS;
    } else if (tag === 'canvas') {
      cl = replaceCanvas(orig, cl);
      outTag = cl.localName;
      recurse = false;
    } else if (tag === 'iframe' || tag === 'frame' || tag === 'object' || tag === 'embed') {
      const div = document.createElement('div');
      cl.replaceWith(div);
      cl = div;
      outTag = 'div';
      outNs = HTML_NS;
      recurse = false;
    } else if (inSvg && tag === 'use') {
      const replaced = resolveUse(ctx, orig, cl);
      if (replaced !== cl) {
        cl = replaced;
        outTag = replaced.localName;
        recurse = false;
      }
    }

    const cs = getComputedStyle(orig);
    const def = ctx.defaults.get(outTag, outNs, outTag === tag ? extraFor(orig, tag) : '');
    const { decls, inh } = computeDecls(cs, def, parentInh, isRoot ? rootOverrides(cs) : null, isRoot);
    fixLocalUrls(ctx, decls);
    for (const f of splitTopLevel(cs.getPropertyValue('font-family'), ',')) ctx.families.add(cleanFamily(f));

    const whiteSpace = cs.getPropertyValue('white-space-collapse') || cs.getPropertyValue('white-space');
    const info = {
      tag: outTag,
      inSvg: inSvg && tag !== 'svg',
      display: cs.getPropertyValue('display'),
      outOfFlow: cs.getPropertyValue('float') !== 'none' || /^(absolute|fixed)$/.test(cs.getPropertyValue('position')),
      preserveSpace: !/^(collapse|normal|nowrap)$/.test(whiteSpace),
      decls,
      before: null,
      after: null,
      placeholder: null,
      origClass: (orig.getAttribute('class') || '').trim(),
      stateClass: null,
    };

    const keepData = new Set();
    if (!inSvg) {
      const spanDef = ctx.defaults.get('span');
      for (const which of ['::before', '::after']) {
        const pd = pseudoDecls(orig, which, inh, spanDef);
        if (!pd) continue;
        fixLocalUrls(ctx, pd);
        for (const [p, v] of pd) {
          if (p === 'content') for (const m of v.matchAll(/attr\(\s*([\w-]+)/g)) keepData.add(m[1].toLowerCase());
          if (p === 'font-family') for (const f of splitTopLevel(v, ',')) ctx.families.add(cleanFamily(f));
        }
        info[which === '::before' ? 'before' : 'after'] = pd;
      }
      if ((tag === 'input' || tag === 'textarea') && orig.hasAttribute('placeholder')) {
        try {
          const c = getComputedStyle(orig, '::placeholder').getPropertyValue('color');
          if (c && c !== def.placeholderColor) info.placeholder = [['color', c]];
        } catch {}
      }
    }

    const oneLine = !inSvg && (parentOneLine || isSingleLine(orig));
    if (oneLine && cs.getPropertyValue('text-wrap-mode') === 'wrap') keepOnOneLine(decls, inh, parentInh);

    cleanAttributes(ctx, cl, inSvg, keepData);
    applyLiveState(orig, cl, tag);

    const idx = ctx.infos.push(info) - 1;
    ctx.map.set(orig, idx);
    cl.setAttribute('data-ct', String(idx));

    if (!recurse) return;
    const origKids = Array.from(orig.children);
    const cloneKids = Array.from(cl.children);
    for (let i = 0; i < origKids.length; i++) {
      if (cloneKids[i]) walk(ctx, origKids[i], cloneKids[i], inh, false, oneLine);
    }
  }

  // Text measured at one zoom level can come out a fraction of a pixel wider at another (pages
  // are often zoomed, the saved file opens at 100%), which makes it wrap inside the frozen width
  // and spill over whatever is below. Content that sat on one line is kept on one line.
  function isSingleLine(el) {
    if (!el.textContent.trim()) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    let top = -Infinity;
    let bottom = Infinity;
    let minHeight = Infinity;
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue;
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      minHeight = Math.min(minHeight, r.height);
    }
    // Glyph boxes can be taller than the line height, so neighbouring lines may overlap slightly.
    return minHeight !== Infinity && bottom - top >= minHeight / 2;
  }

  function keepOnOneLine(decls, inh, parentInh) {
    const i = decls.findIndex(([p]) => p === 'text-wrap-mode');
    if (i >= 0) decls.splice(i, 1);
    if (parentInh?.['text-wrap-mode'] !== 'nowrap') decls.push(['text-wrap-mode', 'nowrap']);
    inh['text-wrap-mode'] = 'nowrap';
  }

  function shouldDrop(el, tag) {
    if (DROP_TAGS.has(tag)) return true;
    if (el.hasAttribute('data-copything')) return true;
    if (tag === 'source' && el.parentElement?.localName === 'picture') return true;
    return false;
  }

  function retag(cl, tag) {
    const el = document.createElement(tag);
    for (const attr of Array.from(cl.attributes)) {
      try {
        el.setAttribute(attr.name, attr.value);
      } catch {}
    }
    while (cl.firstChild) el.appendChild(cl.firstChild);
    cl.replaceWith(el);
    return el;
  }

  function replaceCanvas(orig, cl) {
    let url = null;
    try {
      url = orig.toDataURL();
    } catch {}
    const el = document.createElement(url ? 'img' : 'div');
    if (url) {
      el.setAttribute('src', url);
      el.setAttribute('alt', '');
    }
    cl.replaceWith(el);
    return el;
  }

  function resolveUse(ctx, orig, cl) {
    const href = orig.getAttribute('href') || orig.getAttributeNS(XLINK_NS, 'href') || '';
    if (!href.startsWith('#')) return cl;
    const id = href.slice(1);
    try {
      if (ctx.rootEl.querySelector(`#${CSS.escape(id)}`)) return cl;
    } catch {
      return cl;
    }
    const target = document.getElementById(id);
    if (!target) return cl;

    let el;
    if (target.localName === 'symbol') {
      el = document.createElementNS(SVG_NS, 'svg');
      for (const a of ['viewBox', 'preserveAspectRatio']) {
        if (target.hasAttribute(a)) el.setAttribute(a, target.getAttribute(a));
      }
      for (const a of ['x', 'y', 'width', 'height']) {
        if (orig.hasAttribute(a)) el.setAttribute(a, orig.getAttribute(a));
        else if (a === 'width' || a === 'height') el.setAttribute(a, '100%');
      }
      for (const child of Array.from(target.childNodes)) el.appendChild(child.cloneNode(true));
    } else {
      el = document.createElementNS(SVG_NS, 'g');
      const x = orig.getAttribute('x') || 0;
      const y = orig.getAttribute('y') || 0;
      if (+x || +y) el.setAttribute('transform', `translate(${x} ${y})`);
      const copy = target.cloneNode(true);
      copy.removeAttribute('id');
      el.appendChild(copy);
    }
    cl.replaceWith(el);
    return el;
  }

  function collectReferencedIds(root) {
    const ids = new Set();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of ID_REF_ATTRS) {
        const v = el.getAttribute(a);
        if (v) v.split(/\s+/).forEach((id) => id && ids.add(id));
      }
      for (const a of ['href', 'usemap']) {
        const v = el.getAttribute(a);
        if (v && v.startsWith('#') && v.length > 1) ids.add(v.slice(1));
      }
    }
    return ids;
  }

  function cleanAttributes(ctx, cl, inSvg, keepData) {
    for (const { name, value } of Array.from(cl.attributes)) {
      const n = name.toLowerCase();
      if (n === 'class' || n === 'style' || n === 'data-ct' || DROP_ATTR_RE.test(n)) {
        cl.removeAttribute(name);
        continue;
      }
      if (n.startsWith('data-') && !keepData.has(n)) {
        cl.removeAttribute(name);
        continue;
      }
      if (n === 'id' && !inSvg && !ctx.keepIds.has(value)) {
        cl.removeAttribute(name);
        continue;
      }
      if (URL_ATTRS.has(n)) {
        if (/^\s*javascript:/i.test(value)) cl.setAttribute(name, '#');
        else if (!value.startsWith('#')) cl.setAttribute(name, absUrl(value));
      } else if (n === 'srcset') {
        cl.setAttribute(name, absSrcset(value));
      }
      if (inSvg && SVG_URL_ATTRS.includes(n)) {
        for (const m of value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) ctx.urlRefs.add(m[1]);
      }
    }
  }

  function applyLiveState(orig, cl, tag) {
    if (tag === 'img') {
      let src = orig.currentSrc || orig.getAttribute('src') || '';
      if (src.startsWith('blob:')) src = imageToDataUrl(orig) || src;
      if (src) cl.setAttribute('src', absUrl(src));
      for (const a of ['srcset', 'sizes', 'loading', 'decoding', 'fetchpriority']) cl.removeAttribute(a);
    } else if (tag === 'input') {
      const type = (orig.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') toggleAttr(cl, 'checked', orig.checked);
      else if (type !== 'password' && type !== 'file') cl.setAttribute('value', orig.value);
    } else if (tag === 'textarea') {
      cl.textContent = orig.value;
    } else if (tag === 'option') {
      toggleAttr(cl, 'selected', orig.selected);
    }
  }

  function imageToDataUrl(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL();
    } catch {
      return null;
    }
  }

  function toggleAttr(el, name, on) {
    if (on) el.setAttribute(name, '');
    else el.removeAttribute(name);
  }

  function fixLocalUrls(ctx, decls) {
    for (const d of decls) {
      if (!d[1].includes('url(')) continue;
      d[1] = d[1].replace(/url\((['"]?)([^'")]*)#([^'")]+)\1\)/g, (match, q, pre, id) => {
        if (pre === '' || pre === ctx.docBase) {
          ctx.urlRefs.add(id);
          return `url("#${id}")`;
        }
        return match;
      });
    }
  }

  function removeComments(holder) {
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((c) => c.remove());
  }

  function addExternalDefs(ctx, holder) {
    const root = holder.firstElementChild;
    if (!root || !ctx.urlRefs.size) return;
    const missing = [];
    const queue = [...ctx.urlRefs];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      let inside = null;
      try {
        inside = holder.querySelector(`#${CSS.escape(id)}`);
      } catch {}
      if (inside) continue;
      const target = document.getElementById(id);
      if (!target || target.namespaceURI !== SVG_NS) continue;
      missing.push(target);
      const ref = target.getAttribute('href') || target.getAttributeNS(XLINK_NS, 'href') || '';
      if (ref.startsWith('#')) queue.push(ref.slice(1));
    }
    if (!missing.length) return;

    let host = root.localName === 'svg' ? root : root.querySelector('svg');
    if (!host) {
      if (/^(img|input|br|hr|area|wbr|col)$/.test(root.localName)) return;
      host = document.createElementNS(SVG_NS, 'svg');
      host.setAttribute('width', '0');
      host.setAttribute('height', '0');
      host.setAttribute('aria-hidden', 'true');
      host.setAttribute('style', 'position:absolute');
      root.appendChild(host);
    }
    const defs = document.createElementNS(SVG_NS, 'defs');
    for (const t of missing) defs.appendChild(t.cloneNode(true));
    host.insertBefore(defs, host.firstChild);
  }

  function pageBackground(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!isTransparent(bg)) return bg;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Stylesheet access (readable sheets + cross-origin sheets refetched) */
  /* ------------------------------------------------------------------ */

  async function defaultFetch(url, as) {
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false };
      if (as === 'text') return { ok: true, data: await res.text() };
      const blob = await res.blob();
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  function loadSheets(snap, fetchFn) {
    if (snap.cache.sheets) return snap.cache.sheets;
    snap.cache.sheets = (async () => {
      const entries = [];
      const seen = new Set();
      const take = (sheet) => {
        if (!sheet || seen.has(sheet) || sheet.disabled) return;
        seen.add(sheet);
        if (sheet.ownerNode?.closest?.('[data-copything]')) return;
        try {
          const mt = sheet.media?.mediaText;
          if (mt && !matchMedia(mt).matches) return;
        } catch {}
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          if (sheet.href) entries.push({ href: sheet.href, rules: null, base: sheet.href });
          return;
        }
        for (const r of rules) if (r instanceof CSSImportRule) take(r.styleSheet);
        entries.push({ rules, base: sheet.href || document.baseURI });
      };
      for (const s of document.styleSheets) take(s);
      for (const s of document.adoptedStyleSheets || []) take(s);

      await Promise.all(
        entries
          .filter((e) => !e.rules)
          .map(async (e) => {
            const res = await fetchFn(e.href, 'text');
            if (!res?.ok) return;
            try {
              const sheet = new CSSStyleSheet({ baseURL: e.href });
              sheet.replaceSync(res.data);
              e.rules = sheet.cssRules;
            } catch {}
          })
      );
      return entries.filter((e) => e.rules);
    })();
    return snap.cache.sheets;
  }

  function expandNested(selector, parent) {
    const parents = splitTopLevel(parent, ',').map((s) => s.trim());
    const out = [];
    for (const part of splitTopLevel(selector, ',').map((s) => s.trim())) {
      for (const p of parents) out.push(part.includes('&') ? part.replace(/&/g, p) : `${p} ${part}`);
    }
    return out.join(', ');
  }

  function visitRules(entries, fn) {
    const rec = (rules, base, parentSel) => {
      for (const r of rules) {
        if (r instanceof CSSImportRule) continue;
        if (r instanceof CSSMediaRule) {
          try {
            if (!matchMedia(r.media.mediaText).matches) continue;
          } catch {}
          rec(r.cssRules, base, parentSel);
        } else if (r instanceof CSSSupportsRule) {
          try {
            if (!CSS.supports(r.conditionText)) continue;
          } catch {}
          rec(r.cssRules, base, parentSel);
        } else if (r instanceof CSSStyleRule) {
          const sel = parentSel ? expandNested(r.selectorText, parentSel) : r.selectorText;
          fn({ type: 'style', selector: sel, style: r.style }, base);
          if (r.cssRules && r.cssRules.length) rec(r.cssRules, base, sel);
        } else if (window.CSSNestedDeclarations && r instanceof CSSNestedDeclarations) {
          if (parentSel) fn({ type: 'style', selector: parentSel, style: r.style }, base);
        } else if (r instanceof CSSFontFaceRule) {
          fn({ type: 'font', rule: r }, base);
        } else if (r.cssRules) {
          rec(r.cssRules, base, parentSel);
        }
      }
    };
    for (const e of entries) rec(e.rules, e.base, null);
  }

  /* ------------------------------------------------------------------ */
  /* :hover / :focus / :active rules                                     */
  /* ------------------------------------------------------------------ */

  function resolveVars(value, cs, local, depth = 0) {
    if (depth > 8 || !value.includes('var(')) return value;
    let out = '';
    let i = 0;
    while (i < value.length) {
      const j = value.indexOf('var(', i);
      if (j < 0) {
        out += value.slice(i);
        break;
      }
      out += value.slice(i, j);
      let d = 0;
      let k = j + 3;
      for (; k < value.length; k++) {
        if (value[k] === '(') d++;
        else if (value[k] === ')' && --d === 0) break;
      }
      const inner = value.slice(j + 4, k);
      const [rawName, ...fallbackParts] = splitTopLevel(inner, ',');
      const name = rawName.trim();
      let v = (local.get(name) ?? cs.getPropertyValue(name)).trim();
      if (!v && fallbackParts.length) v = fallbackParts.join(',').trim();
      out += resolveVars(v, cs, local, depth + 1);
      i = k + 1;
    }
    return out;
  }

  function parseDecls(cssText) {
    return splitTopLevel(cssText, ';')
      .map((s) => {
        const i = s.indexOf(':');
        if (i < 0) return null;
        return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      })
      .filter((d) => d && d[0] && hasValue(d[1]));
  }

  function rewriteWhereGroup(sel) {
    // Tailwind v4 style `.a:is(:where(.group):hover *)` -> `:where(.group):hover .a`
    const m = sel.match(/^(.+?):is\(((?:[^()]|\([^()]*\))+?)\s+\*\)(.*)$/);
    return m ? `${m[2]} ${m[1]}${m[3]}` : sel;
  }

  async function getStateRules(snap, fetchFn) {
    if (snap.cache.states) return snap.cache.states;
    const entries = await loadSheets(snap, fetchFn);
    const groups = new Map();

    const classFor = (idx) => {
      const info = snap.infos[idx];
      if (!info.stateClass) info.stateClass = `ct-s${++snap.stateCounter}`;
      return info.stateClass;
    };
    const strip = (s) => s.replace(STATE_ALL, '').replace(PSEUDO_EL_ALL, '').trim() || '*';
    const statesOf = (s) => (s.match(STATE_ALL) || []).join('');
    const pseudoOf = (s) => {
      const m = s.match(PSEUDO_EL);
      if (!m) return '';
      return m[0].startsWith('::') ? m[0] : `:${m[0]}`;
    };

    const handle = (rawSel, style, base) => {
      const sel = rewriteWhereGroup(rawSel.trim());
      if (OTHER_PSEUDO_EL.test(sel)) return;
      const comps = splitCompounds(sel);
      if (!comps.length || comps.some((c) => hasStateInParens(c.sel))) return;
      const last = comps.length - 1;
      const earlier = comps
        .map((c, i) => (i < last && STATE_TEST.test(c.sel) ? i : -1))
        .filter((i) => i >= 0);
      if (earlier.length > 1) return;
      const anc = earlier[0];
      if (anc !== undefined) {
        for (let j = anc + 1; j <= last; j++) if (comps[j].comb !== ' ' && comps[j].comb !== '>') return;
      }
      const baseSel = comps
        .map((c, i) => (i ? (c.comb === ' ' ? ' ' : ` ${c.comb} `) : '') + strip(c.sel))
        .join('');

      let targets;
      try {
        targets = [];
        if (snap.rootEl.matches(baseSel)) targets.push(snap.rootEl);
        targets.push(...snap.rootEl.querySelectorAll(baseSel));
      } catch {
        return;
      }
      if (!targets.length) return;

      const decls = parseDecls(style.cssText);
      const local = new Map(decls.filter(([p]) => p.startsWith('--')).map(([p, v]) => [p, v]));
      const lastSel = comps[last].sel;
      const suffix = statesOf(lastSel) + pseudoOf(lastSel);

      for (const el of targets) {
        const idx = snap.map.get(el);
        if (idx === undefined) continue;
        let selector;
        if (anc === undefined) {
          if (!STATE_TEST.test(lastSel)) continue;
          selector = `.${classFor(idx)}${suffix}`;
        } else {
          const ancSel = strip(comps[anc].sel);
          let ancestor = null;
          for (let n = el.parentElement; n; n = n.parentElement) {
            try {
              if (n.matches(ancSel)) {
                ancestor = n;
                break;
              }
            } catch {
              break;
            }
            if (n === snap.rootEl) break;
          }
          if (!ancestor || !snap.map.has(ancestor)) continue;
          selector = `.${classFor(snap.map.get(ancestor))}${statesOf(comps[anc].sel)} .${classFor(idx)}${suffix}`;
        }
        const cs = getComputedStyle(el);
        const resolved = decls
          .filter(([p]) => !p.startsWith('--'))
          .map(([p, v]) => [p, absCssUrls(resolveVars(v, cs, local), base)])
          .filter(([, v]) => hasValue(v) && !v.includes('var('));
        if (!resolved.length) continue;
        const body = resolved.map(([p, v]) => `  ${p}: ${v};`).join('\n');
        const g = groups.get(body) || new Set();
        g.add(selector);
        groups.set(body, g);
      }
    };

    visitRules(entries, (item, base) => {
      if (item.type !== 'style' || !STATE_TEST.test(item.selector)) return;
      for (const part of splitTopLevel(item.selector, ',')) {
        if (STATE_TEST.test(part)) handle(part, item.style, base);
      }
    });

    snap.cache.states = [...groups].map(([body, sels]) => `${[...sels].join(',\n')} {\n${body}\n}`);
    return snap.cache.states;
  }

  /* ------------------------------------------------------------------ */
  /* Fonts and images                                                    */
  /* ------------------------------------------------------------------ */

  async function getFontFaces(snap, fetchFn) {
    if (snap.cache.fonts) return snap.cache.fonts;
    const used = new Set(snap.meta.families);
    const entries = await loadSheets(snap, fetchFn);
    const out = [];
    const seen = new Set();
    visitRules(entries, (item, base) => {
      if (item.type !== 'font') return;
      const family = cleanFamily(item.rule.style.getPropertyValue('font-family'));
      if (!used.has(family)) return;
      const decls = parseDecls(item.rule.style.cssText).map(([p, v]) => [p, absCssUrls(v, base)]);
      const css = decls.length ? formatBlock('@font-face', decls) : absCssUrls(item.rule.cssText, base);
      if (!css || seen.has(css)) return;
      seen.add(css);
      out.push(css);
    });
    snap.cache.fonts = out;
    return out;
  }

  async function embedImages(snap, holder, css, fetchFn) {
    const cache = (snap.cache.dataUrls = snap.cache.dataUrls || new Map());
    const remote = (u) => /^https?:/i.test(u || '');
    const targets = [];
    for (const el of holder.querySelectorAll('img[src], input[src]')) targets.push([el, 'src']);
    for (const el of holder.querySelectorAll('video[poster]')) targets.push([el, 'poster']);
    for (const el of holder.querySelectorAll('image')) {
      if (el.hasAttribute('href')) targets.push([el, 'href']);
      else if (el.hasAttributeNS(XLINK_NS, 'href')) targets.push([el, 'xlink:href']);
    }
    const urls = new Set(targets.map(([el, a]) => el.getAttribute(a)).filter(remote));
    const cssUrlRe = /url\(\s*(['"]?)(https?:[^'")]+)\1\s*\)/gi;
    for (const m of css.matchAll(cssUrlRe)) urls.add(m[2]);

    await Promise.all(
      [...urls]
        .filter((u) => !cache.has(u))
        .map(async (u) => {
          const res = await fetchFn(u, 'dataurl');
          cache.set(u, res?.ok ? res.data : null);
        })
    );
    for (const [el, a] of targets) {
      const data = cache.get(el.getAttribute(a));
      if (data) el.setAttribute(a, data);
    }
    return css.replace(cssUrlRe, (match, q, u) => (cache.get(u) ? `url("${cache.get(u)}")` : match));
  }

  /* ------------------------------------------------------------------ */
  /* Build: snapshot + options -> standalone HTML document               */
  /* ------------------------------------------------------------------ */

  function formatBlock(selector, decls) {
    const lines = decls.filter(([, v]) => hasValue(v)).map(([p, v]) => `  ${p}: ${v};`);
    return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function wrapTable(el, wrap) {
    const table = document.createElement('table');
    if (wrap.style) table.setAttribute('style', wrap.style);
    let parent = table;
    if (wrap.tag === 'td' || wrap.tag === 'th' || wrap.tag === 'tr') {
      parent = parent.appendChild(document.createElement('tbody'));
    }
    if (wrap.tag === 'td' || wrap.tag === 'th') parent = parent.appendChild(document.createElement('tr'));
    parent.appendChild(el);
    return table;
  }

  async function build(snap, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const fetchFn = CT.fetchResource || defaultFetch;
    const holder = document.createElement('div');
    holder.appendChild(snap.root.cloneNode(true));

    const stateBlocks = opts.states ? await getStateRules(snap, fetchFn) : [];

    const classByKey = new Map();
    const blocks = [];
    const infoByNode = new Map();
    for (const node of holder.querySelectorAll('[data-ct]')) {
      const info = snap.infos[+node.getAttribute('data-ct')];
      node.removeAttribute('data-ct');
      infoByNode.set(node, info);
      const parts = [];
      const decls = !opts.svg && info.inSvg ? [] : info.decls;
      if (decls.length) parts.push(['', decls]);
      if (opts.pseudo && info.before) parts.push(['::before', info.before]);
      if (opts.pseudo && info.after) parts.push(['::after', info.after]);
      if (info.placeholder) parts.push(['::placeholder', info.placeholder]);

      const classes = [];
      if (opts.keepClasses && info.origClass) classes.push(info.origClass);
      if (parts.length) {
        const key = parts.map(([s, d]) => `${s}{${d.map((x) => x.join(':')).join(';')}}`).join('|');
        let cls = classByKey.get(key);
        if (!cls) {
          cls = `ct-${classByKey.size + 1}`;
          classByKey.set(key, cls);
          for (const [s, d] of parts) blocks.push(formatBlock(`.${cls}${s}`, d));
        }
        classes.push(cls);
      }
      if (opts.states && info.stateClass) classes.push(info.stateClass);
      if (classes.length) node.setAttribute('class', classes.join(' '));
    }

    const bodyRule = ['  padding: 16px;'];
    if (opts.pageBg && snap.meta.pageBg) bodyRule.push(`  background: ${snap.meta.pageBg};`);
    const sections = [];
    if (opts.fonts) sections.push(...(await getFontFaces(snap, fetchFn)));
    sections.push('html,\nbody {\n  margin: 0;\n}', `body {\n${bodyRule.join('\n')}\n}`);
    sections.push(...blocks, ...stateBlocks);
    let css = sections.filter(Boolean).join('\n\n');

    if (opts.images) css = await embedImages(snap, holder, css, fetchFn);

    let root = holder.firstElementChild;
    if (snap.meta.tableWrap) root = wrapTable(root, snap.meta.tableWrap);
    const body = CT.format.html(root, 2, (el) => {
      const info = infoByNode.get(el);
      if (!info) return null;
      return {
        display: info.display || 'block',
        outOfFlow: !!info.outOfFlow,
        preserve: !!info.preserveSpace,
        before: opts.pseudo && !!info.before,
        after: opts.pseudo && !!info.after,
      };
    });

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(snap.meta.name || 'Component')}</title>
    <style>
${CT.format.indent(css, 3)}
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;
    return { html, bytes: new Blob([html]).size, classCount: classByKey.size };
  }

  CT.describe = describe;
  CT.serializer = { capture, build, DEFAULT_OPTIONS };
})();
