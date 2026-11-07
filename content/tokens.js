(() => {
  'use strict';
  const UIP = (window.UiPicker = window.UiPicker || {});
  if (UIP.tokens) return;

  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'head', 'option', 'optgroup', 'defs']);
  const SVG_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'use']);
  const NO_TEXT_INPUTS = new Set(['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'image']);
  const GENERIC = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'emoji',
    'math',
    'fangsong',
  ]);
  const COLOR_RE = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
  const ROLE_ORDER = ['text', 'background', 'border', 'fill', 'stroke', 'shadow', 'outline'];

  let ctx2d = null;
  const canvas = () =>
    (ctx2d ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
      willReadFrequently: true,
    }));
  const colorCache = new Map();

  const RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]\s*([\d.]+)[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/;

  // Computed colors are usually rgb() / rgba() and are read exactly. Anything else (oklch(),
  // color(), …) is painted on a canvas, which rounds translucent channels slightly.
  function toRgba(value) {
    const m = value.match(RGB_RE);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] ? m[4] / 100 : +m[4]];
    if (!CSS.supports('color', value)) return null;
    canvas().clearRect(0, 0, 1, 1);
    ctx2d.fillStyle = value;
    ctx2d.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }

  /** Any CSS color -> { hex, alpha } in sRGB, or null for invalid or fully transparent colors. */
  function normalize(value) {
    if (colorCache.has(value)) return colorCache.get(value);
    const rgba = value ? toRgba(value.trim()) : null;
    let out = null;
    if (rgba && rgba[3] > 0) {
      const hex = `#${rgba
        .slice(0, 3)
        .map((n) => Math.round(Math.min(255, n)).toString(16).padStart(2, '0'))
        .join('')}`;
      out = { hex, alpha: Math.round(rgba[3] * 100) / 100 };
    }
    colorCache.set(value, out);
    return out;
  }

  const strip = (name) => name.trim().replace(/^['"]|['"]$/g, '');

  function splitFamilies(stack) {
    return (stack.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g) || []).map(strip).filter(Boolean);
  }

  function measure(font) {
    canvas().font = font;
    return ctx2d.measureText('mmmmmmmmmmlli1WQ@#').width;
  }

  // A family renders if a matching web font has loaded, or if it is installed locally (it then
  // measures differently from the generic fallback it is paired with).
  function isAvailable(family) {
    const lower = family.toLowerCase();
    for (const face of document.fonts || []) {
      if (face.status === 'loaded' && strip(face.family).toLowerCase() === lower) return true;
    }
    const quoted = `"${family.replace(/["\\]/g, '\\$&')}"`;
    return ['monospace', 'serif'].some((base) => measure(`72px ${quoted}, ${base}`) !== measure(`72px ${base}`));
  }

  const resolved = new Map();

  /** The family a font-family stack actually renders with: { name, declared, generic }. */
  function resolveStack(stack) {
    if (resolved.has(stack)) return resolved.get(stack);
    const families = splitFamilies(stack);
    let out = null;
    for (const family of families) {
      if (GENERIC.has(family.toLowerCase())) {
        out = { name: family.toLowerCase(), generic: true };
        break;
      }
      if (isAvailable(family)) {
        out = { name: family, generic: false };
        break;
      }
    }
    out ||= { name: families[families.length - 1] || 'serif', generic: true };
    out.declared = families[0] && families[0].toLowerCase() !== out.name.toLowerCase() ? families[0] : null;
    resolved.set(stack, out);
    return out;
  }

  // Characters of visible text the element draws itself (not through its children).
  function ownTextLength(el, tag) {
    if (tag === 'input') {
      if (NO_TEXT_INPUTS.has((el.type || '').toLowerCase())) return 0;
      return (el.value || el.placeholder || '').trim().length;
    }
    if (tag === 'textarea') return (el.value || el.placeholder || '').trim().length;
    if (tag === 'select') return (el.selectedOptions?.[0]?.textContent || '').trim().length;
    let n = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) n += node.data.replace(/\s+/g, ' ').trim().length;
    }
    return n;
  }

  function visible(el) {
    if (!el.checkVisibility) return true;
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }

  // Share of a glyph's advance box (about 0.5em wide by 1em tall) that its ink covers.
  const TEXT_INK = 0.5 * 0.3;

  // Computed shadows list the color first: "rgb(…) 0px 1px 2px 0px inset, rgb(…) …".
  function parseShadows(value) {
    const matches = [...String(value).matchAll(COLOR_RE)];
    return matches.map((m, i) => {
      const end = i + 1 < matches.length ? matches[i + 1].index : undefined;
      const rest = String(value).slice(m.index + m[0].length, end);
      const [x = 0, y = 0, blur = 0, spread = 0] = (rest.match(/-?[\d.]+(?=px)/g) || []).map(Number);
      return { color: m[0], x, y, blur, spread, inset: /\binset\b/.test(rest) };
    });
  }

  // Non-inset and inset shadows alike, roughly the band they paint around (or inside) the box.
  function shadowAreas(value, rect) {
    const perimeter = 2 * (rect.width + rect.height);
    return parseShadows(value).map(({ color, x, y, blur, spread }) => {
      const band = Math.max(0, spread + blur / 2) + (Math.abs(x) + Math.abs(y)) / 2;
      return [color, perimeter * band];
    });
  }

  function svgStrokeArea(el, cs, rect) {
    const width = parseFloat(cs.strokeWidth) || 0;
    try {
      const m = el.getScreenCTM();
      const scale = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
      if (el.getTotalLength) return el.getTotalLength() * width * scale * scale;
      return 2 * (rect.width + rect.height) * width * scale;
    } catch {
      return 2 * (rect.width + rect.height) * width;
    }
  }

  /**
   * Colors and fonts used inside `root`, each sorted by how much they are used.
   * colors: [{ hex, alpha, count, area, pct, roles }], weighted by the area each color paints (count is
   * uses, once per element and role). Backgrounds covered by an opaque child background don't count.
   * fonts: [{ name, declared, generic, stacks, chars, pct, weights, sizes }], weighted by characters of text.
   */
  function extract(root) {
    const colors = new Map();
    const fonts = new Map();
    const rootRect = root.getBoundingClientRect();
    const clip = rootRect.width * rootRect.height > 0;
    const areaOf = (r) => {
      if (!clip) return r.width * r.height;
      const w = Math.min(r.right, rootRect.right) - Math.max(r.left, rootRect.left);
      const h = Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top);
      return w > 0 && h > 0 ? w * h : 0;
    };
    // Each element -> the nearest element (itself or an ancestor) painting an opaque background.
    const bgOwner = new Map();
    const bgPaint = new Map();

    const addColor = (value, role, area, seen) => {
      const c = normalize(value);
      if (!c) return null;
      const key = `${c.hex}|${c.alpha}`;
      let entry = colors.get(key);
      if (!entry) colors.set(key, (entry = { ...c, count: 0, area: 0, roles: new Set() }));
      entry.area += area;
      entry.roles.add(role);
      if (!seen.has(`${key}|${role}`)) {
        seen.add(`${key}|${role}`);
        entry.count++;
      }
      return entry;
    };
    const addAll = (value, role, area, seen) => {
      const found = [...String(value).matchAll(COLOR_RE)];
      for (const m of found) addColor(m[0], role, area / found.length, seen);
    };

    for (const el of [root, ...root.querySelectorAll('*')]) {
      const tag = el.localName;
      if (SKIP_TAGS.has(tag) || el.closest('[data-ui-picker], defs, template')) continue;
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const seen = new Set();
      const isSvg = el instanceof SVGElement;
      const text = ownTextLength(el, tag);
      const rect = el.getBoundingClientRect();
      const area = areaOf(rect);
      const inherited = el === root ? null : bgOwner.get(el.parentElement) || null;
      bgOwner.set(el, inherited);

      if (text) {
        const textArea = text * parseFloat(cs.fontSize) ** 2 * TEXT_INK;
        addColor(cs.color, 'text', textArea, seen);
        if (cs.textShadow !== 'none') addAll(cs.textShadow, 'shadow', textArea, seen);
        const stack = cs.fontFamily;
        const font = resolveStack(stack);
        const key = font.name.toLowerCase();
        let entry = fonts.get(key);
        if (!entry) {
          fonts.set(key, (entry = { ...font, stacks: new Set(), chars: 0, weights: new Set(), sizes: new Set() }));
        }
        entry.stacks.add(stack);
        entry.chars += text;
        entry.weights.add(cs.fontWeight);
        entry.sizes.add(Math.round(parseFloat(cs.fontSize) * 2) / 2);
        if (font.declared && !entry.declared) entry.declared = font.declared;
      }

      if (isSvg) {
        if (SVG_SHAPES.has(tag)) {
          if (cs.fill !== 'none' && !cs.fill.startsWith('url(')) addColor(cs.fill, 'fill', area, seen);
          if (cs.stroke !== 'none' && !cs.stroke.startsWith('url(') && parseFloat(cs.strokeWidth) > 0) {
            addColor(cs.stroke, 'stroke', svgStrokeArea(el, cs, rect), seen);
          }
        }
        continue;
      }

      const bg = addColor(cs.backgroundColor, 'background', area, seen);
      if (bg && bg.alpha === 1 && area) {
        if (inherited) bgPaint.get(inherited).area -= area;
        bgOwner.set(el, el);
        bgPaint.set(el, bg);
      }
      if (cs.backgroundImage !== 'none') addAll(cs.backgroundImage, 'background', area, seen);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const style = cs.getPropertyValue(`border-${side}-style`);
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
        if (style === 'none' || style === 'hidden' || !width) continue;
        const length = side === 'top' || side === 'bottom' ? rect.width : rect.height;
        addColor(cs.getPropertyValue(`border-${side}-color`), 'border', width * length, seen);
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
        addColor(cs.outlineColor, 'outline', 2 * (rect.width + rect.height) * parseFloat(cs.outlineWidth), seen);
      }
      if (cs.boxShadow !== 'none') {
        for (const [color, shadowArea] of shadowAreas(cs.boxShadow, rect)) addColor(color, 'shadow', shadowArea, seen);
      }
    }

    for (const c of colors.values()) c.area = Math.max(0, c.area);
    const totalArea = [...colors.values()].reduce((n, c) => n + c.area, 0) || 1;
    const totalChars = [...fonts.values()].reduce((n, f) => n + f.chars, 0) || 1;
    return {
      colors: [...colors.values()]
        .map((c) => ({
          ...c,
          pct: (c.area / totalArea) * 100,
          roles: ROLE_ORDER.filter((r) => c.roles.has(r)),
        }))
        .sort((a, b) => b.area - a.area || b.count - a.count || a.hex.localeCompare(b.hex)),
      fonts: [...fonts.values()]
        .map((f) => ({
          ...f,
          stacks: [...f.stacks],
          pct: (f.chars / totalChars) * 100,
          weights: [...f.weights].sort((a, b) => a - b),
          sizes: [...f.sizes].sort((a, b) => a - b),
        }))
        .sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name)),
      source: 'area',
    };
  }

  /* ---------- where a color is painted ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const REPLACED = new Set(['img', 'video', 'canvas', 'iframe', 'embed', 'object']);
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const keyOf = (c) => (c ? `${c.hex}|${c.alpha}` : '');

  /** Boxes of the text `el` draws itself, one per line, in viewport coordinates. */
  function textRects(el) {
    const tag = el.localName;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return [el.getBoundingClientRect()];
    const rects = [];
    const range = el.ownerDocument.createRange();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width && r.height) rects.push(r);
    }
    return rects;
  }

  // Geometry of an SVG shape in its own user units, as [tag, attributes], or null to use its box.
  function shapeGeometry(el, tag, cs) {
    if (tag === 'path') {
      const d = el.getAttribute('d');
      return d ? ['path', { d }] : null;
    }
    if (tag === 'polygon' || tag === 'polyline') return [tag, { points: el.getAttribute('points') || '' }];
    if (tag === 'line') {
      const [x1, y1, x2, y2] = [el.x1, el.y1, el.x2, el.y2].map((l) => l.animVal.value);
      return ['line', { x1, y1, x2, y2 }];
    }
    if (tag !== 'rect' && tag !== 'circle' && tag !== 'ellipse') return null;
    const b = el.getBBox();
    if (tag !== 'rect') return ['ellipse', { cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 }];
    let rx = parseFloat(cs.rx);
    let ry = parseFloat(cs.ry);
    rx ||= ry || 0;
    ry ||= rx;
    return ['rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx, ry }];
  }

  /**
   * Where `color` ({ hex, alpha }) is painted in `root`'s document, as regions in document coordinates,
   * in paint order. A region with `show: false` is something opaque painted over what came before it.
   *   { show, box: [x, y, width, height, radius], hole?: box }   a box, or a ring when it has a hole
   *   { show, shape: { tag, attrs, matrix, fillRule, stroke?: { width, linecap, linejoin } } }   an SVG shape
   */
  function paintRegions(root, color) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const key = keyOf(color);
    const matches = (value) => keyOf(normalize(value)) === key;
    const page = [0, 0, doc.documentElement.scrollWidth, doc.documentElement.scrollHeight, 0];
    const boxOf = (r, radius = 0) => [
      r.left + win.scrollX,
      r.top + win.scrollY,
      r.width,
      r.height,
      Math.max(0, Math.min(radius, r.width / 2, r.height / 2)),
    ];
    const regions = [];
    // Text and outlines paint over the boxes that come after them in the document.
    const onTop = [];
    // A paint in another color covers what is below it only when it is opaque.
    const paint = (c, region) => {
      const show = keyOf(c) === key;
      if (show || c?.alpha === 1) regions.push({ ...region, show });
    };

    const shapeRegions = (el, tag, cs) => {
      const fill = cs.fill !== 'none' && !cs.fill.startsWith('url(') ? normalize(cs.fill) : null;
      const strokeWidth = parseFloat(cs.strokeWidth) || 0;
      const stroke = cs.stroke !== 'none' && !cs.stroke.startsWith('url(') && strokeWidth > 0 ? normalize(cs.stroke) : null;
      if (!fill && !stroke) return;
      let geometry = null;
      let matrix = null;
      try {
        geometry = shapeGeometry(el, tag, cs);
        const m = el.getScreenCTM();
        if (m) matrix = [m.a, m.b, m.c, m.d, m.e + win.scrollX, m.f + win.scrollY];
      } catch {}
      for (const [c, stroked] of [
        [fill, false],
        [stroke, true],
      ]) {
        if (!c) continue;
        if (!geometry || !matrix) {
          if (keyOf(c) === key) regions.push({ show: true, box: boxOf(el.getBoundingClientRect()) });
          continue;
        }
        paint(c, {
          shape: {
            tag: geometry[0],
            attrs: geometry[1],
            matrix,
            fillRule: cs.fillRule,
            stroke: stroked && { width: strokeWidth, linecap: cs.strokeLinecap, linejoin: cs.strokeLinejoin },
          },
        });
      }
    };

    for (const el of [root, ...root.querySelectorAll('*')]) {
      const tag = el.localName;
      if (SKIP_TAGS.has(tag) || el.closest('[data-ui-picker], defs, template')) continue;
      if (!visible(el)) continue;
      const cs = win.getComputedStyle(el);

      if (ownTextLength(el, tag)) {
        const shadow = cs.textShadow !== 'none' && parseShadows(cs.textShadow).some((s) => matches(s.color));
        if (shadow || matches(cs.color)) for (const r of textRects(el)) onTop.push({ show: true, box: boxOf(r) });
      }

      if (el.namespaceURI === SVG_NS) {
        if (SVG_SHAPES.has(tag)) shapeRegions(el, tag, cs);
        continue;
      }

      const rect = el.getBoundingClientRect();
      const box = tag === 'html' || tag === 'body' ? page : boxOf(rect, parseFloat(cs.borderTopLeftRadius) || 0);
      const [x, y, w, h, r] = box;

      if (cs.boxShadow !== 'none') {
        for (const s of parseShadows(cs.boxShadow)) {
          if (!matches(s.color)) continue;
          const d = s.spread + s.blur / 2;
          const moved = [x + s.x, y + s.y, w, h, r];
          if (s.inset) regions.push({ show: true, box, hole: inflate(moved, -d) });
          else regions.push({ show: true, box: inflate(moved, d), hole: box });
        }
      }

      paint(normalize(cs.backgroundColor), { box });
      if (cs.backgroundImage !== 'none' && [...cs.backgroundImage.matchAll(COLOR_RE)].some((m) => matches(m[0]))) {
        regions.push({ show: true, box });
      }
      if (REPLACED.has(tag)) regions.push({ show: false, box });

      const borders = SIDES.map((side) => {
        const style = cs.getPropertyValue(`border-${side}-style`);
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0;
        const none = style === 'none' || style === 'hidden' || !width;
        return none ? null : { width, color: normalize(cs.getPropertyValue(`border-${side}-color`)) };
      });
      if (borders.some(Boolean)) {
        const [bt, br, bb, bl] = borders.map((b) => b?.width || 0);
        const uniform = borders.every((b) => b && keyOf(b.color) === keyOf(borders[0].color));
        if (uniform) {
          const hole = [x + bl, y + bt, w - bl - br, h - bt - bb, Math.max(0, r - Math.max(bt, bl))];
          paint(borders[0].color, { box, hole });
        } else {
          const strips = [
            [x, y, w, bt, 0],
            [x + w - br, y, br, h, 0],
            [x, y + h - bb, w, bb, 0],
            [x, y, bl, h, 0],
          ];
          borders.forEach((b, i) => b && paint(b.color, { box: strips[i] }));
        }
      }

      const outline = parseFloat(cs.outlineWidth);
      if (cs.outlineStyle !== 'none' && outline > 0 && matches(cs.outlineColor)) {
        const offset = parseFloat(cs.outlineOffset) || 0;
        onTop.push({ show: true, box: inflate(box, offset + outline), hole: inflate(box, offset) });
      }
    }
    return [...regions, ...onTop];
  }

  function inflate([x, y, w, h, r], d) {
    const width = Math.max(0, w + 2 * d);
    const height = Math.max(0, h + 2 * d);
    return [x - d, y - d, width, height, Math.max(0, Math.min(r + d, width / 2, height / 2))];
  }

  /* ---------- pixel shares from a screenshot ---------- */

  // RGB distance within which a pixel is that color, or a blend (anti-aliasing, blur, gradient) of two.
  const SOLID = 24;
  const BLEND = 24;
  // Unmatched colors (images, canvas) covering at least this share get their own row.
  const OWN_SHARE = 0.01;
  const MAX_OWN = 8;
  // Blends are only looked for between this many of the largest colors.
  const BLEND_COLORS = 12;

  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
  const over = (rgb, alpha, base) => rgb.map((n, i) => n * alpha + base[i] * (1 - alpha));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Distance from p to the segment a–b, and where along it (0 at a, 1 at b) p is closest.
  function toSegment(p, a, b) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = len ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len)) : 0;
    return { d: dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]), t };
  }

  /**
   * Re-weights `colors` (from extract) by the share of `bins` ([r, g, b, count] screenshot pixels)
   * each one accounts for. Blended pixels are split between the two colors they sit between.
   * `pageBg` (the color behind the element) and large unmatched colors are added as rows.
   */
  function pixelShares(colors, bins, pageBg) {
    let dominant = bins[0];
    for (const bin of bins) if (bin[3] > dominant[3]) dominant = bin;
    const base = dominant.slice(0, 3);
    const entries = colors.map((c) => ({ ...c, roles: [...c.roles], pixels: 0, rgb: over(rgbOf(c.hex), c.alpha, base) }));

    const page = pageBg && normalize(pageBg);
    if (page) {
      const same = entries.find((e) => e.hex === page.hex && e.alpha === page.alpha);
      if (same) same.roles.push('page');
      else entries.push({ ...page, count: 0, area: 0, roles: ['page'], pixels: 0, rgb: over(rgbOf(page.hex), page.alpha, base) });
    }

    const blendable = [...entries].sort((a, b) => b.area - a.area).slice(0, BLEND_COLORS);
    const pairs = [];
    for (let i = 0; i < blendable.length; i++) {
      for (let j = i + 1; j < blendable.length; j++) pairs.push([blendable[i], blendable[j]]);
    }

    const nearest = (p, list) => {
      let best = null;
      let bestD = Infinity;
      for (const e of list) {
        const d = dist(p, e.rgb);
        if (d < bestD) [best, bestD] = [e, d];
      }
      return [best, bestD];
    };

    const unmatched = new Map();
    for (const [r, g, b, n] of bins) {
      const p = [r, g, b];
      const [best, bestD] = nearest(p, entries);
      if (best && bestD <= SOLID) {
        best.pixels += n;
        continue;
      }
      let blend = null;
      for (const [a, c] of pairs) {
        const seg = toSegment(p, a.rgb, c.rgb);
        if (seg.d <= BLEND && (!blend || seg.d < blend.d)) blend = { ...seg, a, c };
      }
      if (blend) {
        blend.a.pixels += n * (1 - blend.t);
        blend.c.pixels += n * blend.t;
        continue;
      }
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = unmatched.get(key) || unmatched.set(key, { n: 0, sum: [0, 0, 0] }).get(key);
      bucket.n += n;
      for (let i = 0; i < 3; i++) bucket.sum[i] += p[i] * n;
    }

    const total = bins.reduce((n, bin) => n + bin[3], 0);
    const buckets = [...unmatched.values()].sort((a, b) => b.n - a.n);
    const own = buckets.filter((k) => k.n / total >= OWN_SHARE).slice(0, MAX_OWN);
    for (const k of own) {
      const rgb = k.sum.map((s) => s / k.n);
      entries.push({ hex: toHex(rgb), alpha: 1, count: 0, area: 0, roles: ['image'], pixels: k.n, rgb });
    }
    for (const k of buckets) {
      if (own.includes(k)) continue;
      const [best] = nearest(k.sum.map((s) => s / k.n), entries);
      if (best) best.pixels += k.n;
    }

    const assigned = entries.reduce((n, e) => n + e.pixels, 0) || 1;
    return entries
      .filter((e) => e.count || e.pixels >= 0.5)
      .map(({ rgb, ...e }) => ({ ...e, pct: (e.pixels / assigned) * 100 }))
      .sort((a, b) => b.pixels - a.pixels || b.area - a.area || a.hex.localeCompare(b.hex));
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /**
   * Screenshots `el` as it is on screen and re-weights `tokens.colors` by pixels. Keeps the
   * area estimate when the element is off screen or the screenshot fails.
   */
  async function measurePixels(el, tokens, pageBg) {
    try {
      // Let the picker overlay disappear from the screen first.
      await nextFrame();
      await nextFrame();
      const r = el.getBoundingClientRect();
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      const width = Math.min(innerWidth, r.right) - left;
      const height = Math.min(innerHeight, r.bottom) - top;
      if (width < 1 || height < 1) return;
      const res = await chrome.runtime.sendMessage({
        type: 'uip-capture-pixels',
        rect: { left, top, width, height, viewportWidth: innerWidth },
      });
      if (!res?.ok || !res.bins.length) return;
      tokens.colors = pixelShares(tokens.colors, res.bins, pageBg);
      tokens.source = 'pixels';
    } catch (err) {
      console.warn('[UI Picker] could not measure colors by pixels', err);
    }
  }

  UIP.tokens = { extract, measurePixels, paintRegions, textRects };
})();
