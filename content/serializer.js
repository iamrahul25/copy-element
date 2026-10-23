(() => {
  'use strict';
  const CT = (window.CopyThing = window.CopyThing || {});
  if (CT.serializer) return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  const DEFAULT_OPTIONS = {
    minimal: true,
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
    'row-rule-color',
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
  const EM_DEFAULT_RE = /^(margin|padding)-(top|right|bottom|left)$/;
  const FLEX_GRID_PARENT = /(^|[\s-])(flex|grid)\b/;
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

  const SIDES = ['top', 'right', 'bottom', 'left'];
  const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  // Behaviour-only properties: they don't change how the component looks at rest.
  const MIN_SKIP_RE =
    /^(transition|touch-action$|(-webkit-)?user-select$|-webkit-user-drag$|-webkit-tap-highlight-color$|(-webkit-)?print-color-adjust$|scroll-behavior$|scroll-snap|overscroll-behavior)/;
  // Replaced (or emptied) elements have no content to size them, so their sizes always stay.
  const FIXED_SIZE_TAGS = new Set(['img', 'video', 'canvas', 'audio', 'input', 'select', 'textarea', 'iframe', 'frame', 'object', 'embed']);
  const SIZE_RE = /^(width|height|(min|max)-(width|height)|flex|flex-basis|aspect-ratio)$/;
  const SIZE_TOLERANCE = 0.5;
  const PIN_ROUNDS = 12;

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

  function hiddenFrame(name, width, height) {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-copything', name);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText = [
      'display:block!important',
      'position:fixed!important',
      'left:-20000px!important',
      'top:0!important',
      `width:${width}px!important`,
      `height:${height}px!important`,
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
    if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
    return { frame, doc, win };
  }

  function createDefaults() {
    const { frame, doc, win } = hiddenFrame('defaults', 1200, 800);
    const body = doc.body;

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
    const fontSize = get('font-size');

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
      // UA margins such as `p { margin: 1em 0 }` scale with font-size, so an equal value only
      // matches the default when the font-size matches too.
      if (v === ref && !(EM_DEFAULT_RE.test(p) && ref !== '0px' && fontSize !== def.plain['font-size'])) continue;
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
    const { decls } = computeDecls(pcs, { plain: spanDef.plain, ua: EMPTY_SET }, elInh, null, false);
    return { decls, min: minimize(decls, (p) => pcs.getPropertyValue(p), spanDef.plain) };
  }

  /* ------------------------------------------------------------------ */
  /* Minimal mode: only what changes the look, written as shorthands     */
  /* ------------------------------------------------------------------ */

  const zero = (v) => (v === '0px' ? '0' : v);

  function box4(t, r, b, l) {
    [t, r, b, l] = [t, r, b, l].map(zero);
    if (l !== r) return `${t} ${r} ${b} ${l}`;
    if (t !== b) return `${t} ${r} ${b}`;
    return t === r ? t : `${t} ${r}`;
  }

  function groupOf(p) {
    const box = p.match(/^(margin|padding)-(top|right|bottom|left)$/);
    if (box) return box[1];
    if (/^border-(top|right|bottom|left)-(width|style|color)$/.test(p)) return 'border';
    if (/^border-(top|bottom)-(left|right)-radius$/.test(p)) return 'radius';
    if (INSETS.has(p)) return 'inset';
    if (p === 'row-gap' || p === 'column-gap') return 'gap';
    if (p === 'overflow-x' || p === 'overflow-y') return 'overflow';
    if (/^flex-(grow|shrink|basis)$/.test(p)) return 'flex';
    if (/^(text-decoration(-(line|style|color|thickness))?|-webkit-text-decorations-in-effect)$/.test(p)) {
      return 'decoration';
    }
    if (/^outline-(color|style|width|offset)$/.test(p)) return 'outline';
    return null;
  }

  // Fully rounded corners compute to values like 1e+07px.
  function clampRadius(v) {
    return v.replace(/[\d.]+(e\+?\d+)?px/g, (m) => (parseFloat(m) > 9999 ? '9999px' : m));
  }

  // A border with no width draws nothing whatever its style, e.g. Tailwind's `* { border: 0 solid }`.
  function borderSide(side, val) {
    const style = val(`border-${side}-style`);
    if (style === 'hidden') return 'hidden';
    const width = val(`border-${side}-width`);
    if (style === 'none' || !parseFloat(width)) return 'none';
    const color = val(`border-${side}-color`);
    return [width, style, color === 'currentcolor' ? '' : color].filter(Boolean).join(' ');
  }

  // Drops shadow layers that draw nothing, e.g. Tailwind's `0 0 0 0` ring placeholders.
  function trimShadow(value) {
    const layers = splitTopLevel(value, ',')
      .map((s) => s.trim())
      .filter((layer) => {
        const color = layer.match(/[a-z-]+\([^()]*\)|transparent/)?.[0];
        if (color && isTransparent(color)) return false;
        const lengths = layer.replace(color || '', '').replace(/\binset\b/, '').trim().split(/\s+/);
        return !lengths.every((t) => parseFloat(t) === 0);
      });
    return layers.join(', ') || 'none';
  }

  function repeatTracks(value) {
    const tracks = value.split(' ');
    const same = tracks.length > 1 && /^[\d.]+px$/.test(tracks[0]) && tracks.every((t) => t === tracks[0]);
    return same ? `repeat(${tracks.length}, ${tracks[0]})` : value;
  }

  function decoration(val) {
    const line = val('text-decoration-line');
    if (line === 'none') return 'none';
    const parts = [line];
    const style = val('text-decoration-style');
    const color = val('text-decoration-color');
    const thickness = val('text-decoration-thickness');
    if (style !== 'solid') parts.push(style);
    if (color !== 'currentcolor') parts.push(color);
    if (thickness !== 'auto') parts.push(thickness);
    return parts.join(' ');
  }

  /**
   * Shrinks `decls` (already diffed against the defaults) to the declarations that change how the
   * element looks, merging longhands into shorthands. `get` reads the element's computed values,
   * `plain` the tag's default ones.
   */
  function minimize(decls, get, plain) {
    const set = new Map(decls);
    const color = get('color');
    const val = (p) => {
      if (set.has(p)) return set.get(p);
      const v = get(p);
      return CURRENTCOLOR.has(p) && v === color ? 'currentcolor' : v;
    };
    const dflt = (p) => plain[p] ?? '';
    const present = (props) => props.filter((p) => set.has(p));
    const longhands = (props) => present(props).map((p) => [p, set.get(p)]);
    const four = (name, props) => (present(props).length < 2 ? longhands(props) : [[name, box4(...props.map(val))]]);
    const position = get('position');
    const flat =
      /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(get('transform')) &&
      ['rotate', 'scale', 'translate'].every((p) => get(p) === 'none');

    const groups = {
      margin: () => four('margin', SIDES.map((s) => `margin-${s}`)),
      padding: () => four('padding', SIDES.map((s) => `padding-${s}`)),
      border: () => {
        const mine = SIDES.map((s) => borderSide(s, val));
        const base = SIDES.map((s) => borderSide(s, dflt));
        if (mine.every((v, i) => v === base[i])) return [];
        if (mine.every((v) => v === mine[0])) return [['border', mine[0]]];
        return SIDES.flatMap((s, i) => (mine[i] === base[i] ? [] : [[`border-${s}`, mine[i]]]));
      },
      radius: () => {
        const props = CORNERS.map((c) => `border-${c}-radius`);
        const vals = props.map((p) => clampRadius(val(p)));
        if (vals.some((v) => v.includes(' '))) return longhands(props).map(([p, v]) => [p, clampRadius(v)]);
        return [['border-radius', box4(...vals)]];
      },
      inset: () => {
        // Relative offsets resolve to opposite pairs; top and the start side win.
        if (position === 'relative') {
          const start = get('direction') === 'rtl' ? 'right' : 'left';
          return ['top', start].flatMap((p) => (/^(0px|auto)$/.test(val(p)) ? [] : [[p, val(p)]]));
        }
        if (position === 'absolute' || position === 'fixed') return four('inset', SIDES);
        return longhands(SIDES);
      },
      gap: () => {
        const [row, col] = [val('row-gap'), val('column-gap')].map(zero);
        return [['gap', row === col ? row : `${row} ${col}`]];
      },
      overflow: () => {
        const [x, y] = [val('overflow-x'), val('overflow-y')];
        return [['overflow', x === y ? x : `${x} ${y}`]];
      },
      flex: () => {
        const props = ['flex-grow', 'flex-shrink', 'flex-basis'];
        if (present(props).length < 2) return longhands(props);
        return [['flex', props.map((p) => zero(val(p))).join(' ')]];
      },
      decoration: () => {
        const v = decoration(val);
        return v === decoration(dflt) ? [] : [['text-decoration', v]];
      },
      outline: () => {
        const style = val('outline-style');
        if (style === 'none') return dflt('outline-style') === 'none' ? [] : [['outline', 'none']];
        const c = val('outline-color');
        const out = [['outline', [val('outline-width'), style, c === 'currentcolor' ? '' : c].filter(Boolean).join(' ')]];
        if (set.has('outline-offset')) out.push(['outline-offset', set.get('outline-offset')]);
        return out;
      },
    };

    const out = [];
    const done = new Set();
    for (const [p, raw] of decls) {
      const g = groupOf(p);
      if (g) {
        if (!done.has(g)) {
          done.add(g);
          out.push(...groups[g]());
        }
        continue;
      }
      if (MIN_SKIP_RE.test(p)) continue;
      if ((p === 'min-width' || p === 'min-height') && raw === 'auto') continue;
      if ((p === 'transform' || p === 'transform-origin') && flat) continue;
      const rule = p.match(/^(column|row)-rule-(color|width)$/);
      if (rule && /^(none|hidden|)$/.test(val(`${rule[1]}-rule-style`))) continue;
      let v = raw;
      if (p === 'box-shadow') {
        v = trimShadow(v);
        if (v === dflt(p)) continue;
      } else if (p === 'grid-template-columns' || p === 'grid-template-rows') {
        v = repeatTracks(v);
      }
      out.push([p, v]);
    }
    return out.map(([p, v]) => [p, v.replace(/rgba\(0, 0, 0, 0\)/g, 'transparent')]);
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

  function walk(ctx, orig, cl, parentInh, isRoot, parentOneLine = false, parentDisplay = '') {
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
    const overrides = isRoot ? rootOverrides(cs) : null;
    const get = (p) => (overrides && p in overrides ? overrides[p] : cs.getPropertyValue(p));
    const { decls, inh } = computeDecls(cs, def, parentInh, overrides, isRoot);
    // On flex and grid items min-width / min-height default to auto, not the 0 a plain div has.
    if (!isRoot && FLEX_GRID_PARENT.test(parentDisplay)) {
      for (const p of ['min-width', 'min-height']) {
        if (get(p) === '0px' && !decls.some(([q]) => q === p)) decls.push([p, '0px']);
      }
    }
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
      // Minimal mode: { decls, before, after, loose }, where `loose` lists the width / height
      // declarations that may be dropped if the element sizes itself the same way without them.
      min: null,
      rect: null,
    };

    const keepData = new Set();
    const minPseudo = { before: null, after: null };
    if (!inSvg) {
      const spanDef = ctx.defaults.get('span');
      for (const which of ['::before', '::after']) {
        const pd = pseudoDecls(orig, which, inh, spanDef);
        if (!pd) continue;
        fixLocalUrls(ctx, pd.decls);
        fixLocalUrls(ctx, pd.min);
        for (const [p, v] of pd.decls) {
          if (p === 'content') for (const m of v.matchAll(/attr\(\s*([\w-]+)/g)) keepData.add(m[1].toLowerCase());
          if (p === 'font-family') for (const f of splitTopLevel(v, ',')) ctx.families.add(cleanFamily(f));
        }
        const key = which === '::before' ? 'before' : 'after';
        info[key] = pd.decls;
        minPseudo[key] = pd.min;
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

    const minDecls = minimize(decls, get, def.plain);
    // The root keeps its width: in the page it came from its container, in the file it has none.
    const loose =
      FIXED_SIZE_TAGS.has(tag) || info.inSvg
        ? []
        : minDecls.map(([p]) => p).filter((p) => p === 'height' || (p === 'width' && !isRoot));
    info.min = { decls: minDecls, ...minPseudo, loose };
    const rect = orig.getBoundingClientRect();
    info.rect = [rect.width, rect.height];

    cleanAttributes(ctx, cl, inSvg, keepData);
    applyLiveState(orig, cl, tag);

    const idx = ctx.infos.push(info) - 1;
    ctx.map.set(orig, idx);
    cl.setAttribute('data-ct', String(idx));

    if (!recurse) return;
    const origKids = Array.from(orig.children);
    const cloneKids = Array.from(cl.children);
    for (let i = 0; i < origKids.length; i++) {
      if (cloneKids[i]) walk(ctx, origKids[i], cloneKids[i], inh, false, oneLine, info.display);
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

  /**
   * Picks the declarations for one element. In minimal mode `pins` (a Map of index -> Set of
   * 'width' / 'height') says which loose sizes to keep; null keeps them all.
   */
  function partsOf(info, idx, opts, pins, measuring) {
    const src = opts.minimal ? info.min : info;
    let decls = !opts.svg && info.inSvg ? [] : src.decls;
    if (opts.minimal) {
      if (pins) {
        const keep = pins.get(idx);
        decls = decls.filter(([p]) => !info.min.loose.includes(p) || keep?.has(p));
      }
      // Sizes pinned while measuring are set inline later and still rely on box-sizing.
      if (!measuring && !decls.some(([p]) => SIZE_RE.test(p))) decls = decls.filter(([p]) => p !== 'box-sizing');
    }
    const parts = [];
    if (decls.length) parts.push(['', decls]);
    if (opts.pseudo && src.before) parts.push(['::before', src.before]);
    if (opts.pseudo && src.after) parts.push(['::after', src.after]);
    if (info.placeholder) parts.push(['::placeholder', info.placeholder]);
    return parts;
  }

  // Replaces the `data-ct` markers in `holder` with generated classes and returns their CSS blocks.
  function applyStyles(snap, holder, opts, pins, measuring) {
    const classByKey = new Map();
    const blocks = [];
    const infoByNode = new Map();
    for (const node of holder.querySelectorAll('[data-ct]')) {
      const idx = +node.getAttribute('data-ct');
      const info = snap.infos[idx];
      if (!measuring) node.removeAttribute('data-ct');
      infoByNode.set(node, info);
      const parts = partsOf(info, idx, opts, pins, measuring);

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
    return { blocks, infoByNode, classCount: classByKey.size };
  }

  /* ------------------------------------------------------------------ */
  /* Minimal mode: keep a width / height only where the layout needs it  */
  /* ------------------------------------------------------------------ */

  function sizePins(snap, opts, fonts) {
    const cache = (snap.cache.pins = snap.cache.pins || new Map());
    const key = `${opts.pseudo}|${opts.svg}|${opts.fonts}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        measurePins(snap, opts, fonts).catch((err) => {
          console.warn('[Copy Thing] size check failed, keeping all sizes', err);
          return null;
        })
      );
    }
    return cache.get(key);
  }

  function ancestorsOf(el) {
    const out = [];
    for (let n = el.parentElement; n && n.localName !== 'body'; n = n.parentElement) out.push(n);
    return out;
  }

  const grows = (info) => parseFloat(info.decls.find(([p]) => p === 'flex-grow')?.[1]) > 0;

  /**
   * Chooses which wrong sizes to pin this round, most likely causes first:
   * 1. empty elements, which have no content to size themselves from;
   * 2. otherwise the outermost wrong widths (widths come from parents) and the innermost wrong
   *    heights (heights come from children), skipping flex items that grow when a sibling that
   *    doesn't is also wrong, since the growing one is usually just filling the space left over.
   * On the last round everything still wrong is pinned.
   */
  function pickPins(wrong, byEl, last) {
    const all = [...[...wrong.width].map((it) => [it, 'width']), ...[...wrong.height].map((it) => [it, 'height'])];
    if (last) return all;
    const empty = all.filter(([it]) => !it.el.firstElementChild && !it.el.textContent.trim());
    if (empty.length) return empty;

    const fix = [];
    for (const it of wrong.width) {
      if (!ancestorsOf(it.el).some((a) => wrong.width.has(byEl.get(a)))) fix.push([it, 'width']);
    }
    const aboveWrongHeight = new Set();
    for (const it of wrong.height) for (const a of ancestorsOf(it.el)) aboveWrongHeight.add(a);
    for (const it of wrong.height) if (!aboveWrongHeight.has(it.el)) fix.push([it, 'height']);

    const rigidParents = new Set(fix.filter(([it]) => !grows(it.info)).map(([it]) => it.el.parentElement));
    return fix.filter(([it]) => !grows(it.info) || !rigidParents.has(it.el.parentElement));
  }

  /**
   * Renders the output in a hidden frame with every loose width / height left out, compares each
   * element with its size on the page, and pins sizes back where they differ, repeating until the
   * layout matches. Returns the pins, or null when the output can't be measured (then every size
   * is kept).
   */
  async function measurePins(snap, opts, fonts) {
    const pins = new Map();
    if (!snap.infos.some((info) => info.min.loose.length)) return pins;

    const holder = document.createElement('div');
    holder.appendChild(snap.root.cloneNode(true));
    const { blocks } = applyStyles(snap, holder, opts, pins, true);
    let root = holder.firstElementChild;
    if (snap.meta.tableWrap) root = wrapTable(root, snap.meta.tableWrap);

    const { frame, doc, win } = hiddenFrame('measure', Math.max(innerWidth, snap.meta.width + 32), innerHeight);
    try {
      if (doc.compatMode !== 'CSS1Compat') return null;
      // A constructed sheet isn't subject to the page's style-src CSP, unlike a <style> element.
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync([...fonts, 'html, body { margin: 0; }', 'body { padding: 16px; }', ...blocks].join('\n'));
      doc.adoptedStyleSheets = [sheet];
      doc.body.appendChild(doc.importNode(root, true));
      void doc.body.offsetHeight;
      await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

      const items = Array.from(doc.querySelectorAll('[data-ct]'), (el) => {
        const idx = +el.getAttribute('data-ct');
        return { el, idx, info: snap.infos[idx] };
      });
      const byEl = new Map(items.map((it) => [it.el, it]));
      const canPin = (it, p) => it.info.min.loose.includes(p) && !pins.get(it.idx)?.has(p);

      for (let round = 0; round < PIN_ROUNDS; round++) {
        const wrong = { width: new Set(), height: new Set() };
        for (const it of items) {
          const r = it.el.getBoundingClientRect();
          if (Math.abs(r.width - it.info.rect[0]) > SIZE_TOLERANCE && canPin(it, 'width')) wrong.width.add(it);
          if (Math.abs(r.height - it.info.rect[1]) > SIZE_TOLERANCE && canPin(it, 'height')) wrong.height.add(it);
        }

        const fix = pickPins(wrong, byEl, round === PIN_ROUNDS - 1);
        if (!fix.length) break;

        for (const [it, p] of fix) {
          if (!pins.has(it.idx)) pins.set(it.idx, new Set());
          pins.get(it.idx).add(p);
          it.el.style.setProperty(p, it.info.min.decls.find(([q]) => q === p)[1]);
        }
      }
      return pins;
    } finally {
      frame.remove();
    }
  }

  async function build(snap, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const fetchFn = CT.fetchResource || defaultFetch;
    const fonts = opts.fonts ? await getFontFaces(snap, fetchFn) : [];
    const pins = opts.minimal ? await sizePins(snap, opts, fonts) : null;
    const stateBlocks = opts.states ? await getStateRules(snap, fetchFn) : [];

    const holder = document.createElement('div');
    holder.appendChild(snap.root.cloneNode(true));
    const { blocks, infoByNode, classCount } = applyStyles(snap, holder, opts, pins, false);

    const bodyRule = ['  padding: 16px;'];
    if (opts.pageBg && snap.meta.pageBg) bodyRule.push(`  background: ${snap.meta.pageBg};`);
    const sections = [...fonts];
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
    return { html, bytes: new Blob([html]).size, classCount };
  }

  CT.describe = describe;
  CT.serializer = { capture, build, DEFAULT_OPTIONS };
})();
