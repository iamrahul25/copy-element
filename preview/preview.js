(() => {
  const frame = document.getElementById('frame');
  const stage = document.getElementById('stage');
  const params = new URLSearchParams(location.search);
  const PAD = 8;

  window.UiPicker.theme.apply(document.documentElement);

  let hint = { width: 0, height: 0 };
  // 0 scales the component to fit the frame.
  let zoom = 0;
  let scale = 1;
  // Interface size from settings. Zoom on the page holding this frame doesn't reach inside it,
  // so the component is scaled by it here, on top of `scale`.
  let uiZoom = 1;
  // What the panel asks to mark: text set in one font, { stacks: Set of font-family values },
  // or everywhere a color is painted, { color: { hex, alpha } }.
  let mark = null;
  const MARK_COLOR = '#f43f5e';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const { tokens } = window.UiPicker;

  function setBg(bg) {
    document.body.className = `bg-${bg || 'dots'}`;
  }

  function render(html, width, height) {
    hint = { width: width || 0, height: height || 0 };
    frame.style.width = `${Math.max(hint.width + 32, 50)}px`;
    frame.style.height = `${Math.max(hint.height + 32, 50)}px`;
    frame.srcdoc = html;
  }

  function drawFont(doc, layer, px) {
    const win = doc.defaultView;
    for (const el of doc.body.querySelectorAll('*')) {
      if (!mark.stacks.has(win.getComputedStyle(el).fontFamily)) continue;
      for (const r of tokens.textRects(el)) {
        const box = doc.createElement('div');
        box.style.cssText = `all: initial; position: absolute; box-sizing: border-box;
          left: ${r.left + win.scrollX}px; top: ${r.top + win.scrollY}px; width: ${r.width}px; height: ${r.height}px;
          outline: ${px(2)} solid ${MARK_COLOR}; outline-offset: ${px(1)}; border-radius: ${px(2)};
          background: color-mix(in srgb, ${MARK_COLOR} 14%, transparent);`;
        layer.append(box);
      }
    }
  }

  // Inline styles, so the component's own CSS (`rect { … }`, `svg { … }`) can't restyle the marks.
  function svgEl(doc, tag, attrs) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
  }

  function boxPath([x, y, w, h, r]) {
    if (w <= 0 || h <= 0) return '';
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    const [iw, ih] = [w - 2 * r, h - 2 * r];
    const arc = (dx, dy) => `a${r} ${r} 0 0 1 ${dx} ${dy}`;
    return `M${x + r} ${y}h${iw}${arc(r, r)}v${ih}${arc(-r, r)}h${-iw}${arc(-r, -r)}v${-ih}${arc(r, -r)}Z`;
  }

  // A ring is drawn even-odd, so its hole must lie inside it.
  function clip([x, y, w, h, r], [bx, by, bw, bh]) {
    const left = Math.max(x, bx);
    const top = Math.max(y, by);
    return [left, top, Math.min(x + w, bx + bw) - left, Math.min(y + h, by + bh) - top, r];
  }

  // In the mask, white shows the hatching and black hides it again.
  function regionEl(doc, region) {
    const color = region.show ? '#fff' : '#000';
    if (region.box) {
      const d = boxPath(region.box) + (region.hole ? boxPath(clip(region.hole, region.box)) : '');
      return svgEl(doc, 'path', { d, style: `fill: ${color}; fill-rule: evenodd; stroke: none;` });
    }
    const { tag, attrs, matrix, fillRule, stroke } = region.shape;
    const style = stroke
      ? `fill: none; stroke: ${color}; stroke-width: ${stroke.width}px; stroke-linecap: ${stroke.linecap}; stroke-linejoin: ${stroke.linejoin};`
      : `fill: ${color}; fill-rule: ${fillRule}; stroke: none;`;
    return svgEl(doc, tag, { ...attrs, transform: `matrix(${matrix.join(' ')})`, style });
  }

  // Diagonal stripes over every area painted in the color, minus what is painted over it.
  function drawColor(doc, layer, width, height) {
    const regions = tokens.paintRegions(doc.documentElement, mark.color);
    if (!regions.some((r) => r.show)) return;
    const gap = 7 / scale;
    const svg = svgEl(doc, 'svg', { width, height, style: 'all: initial; position: absolute; left: 0; top: 0; overflow: hidden;' });
    const pattern = svgEl(doc, 'pattern', {
      id: 'uip-marks-hatch',
      patternUnits: 'userSpaceOnUse',
      width: gap,
      height: gap,
      patternTransform: 'rotate(45)',
    });
    pattern.append(
      svgEl(doc, 'rect', { width: gap, height: gap, style: `fill: ${MARK_COLOR}; fill-opacity: 0.14;` }),
      svgEl(doc, 'rect', { width: gap * 0.3, height: gap, style: `fill: ${MARK_COLOR};` }),
      svgEl(doc, 'rect', { x: gap * 0.3, width: gap * 0.15, height: gap, style: 'fill: #fff; fill-opacity: 0.75;' })
    );
    const mask = svgEl(doc, 'mask', { id: 'uip-marks-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width, height });
    for (const region of regions) mask.append(regionEl(doc, region));
    const defs = svgEl(doc, 'defs', {});
    defs.append(pattern, mask);
    svg.append(defs, svgEl(doc, 'rect', { width, height, mask: 'url(#uip-marks-mask)', style: 'fill: url(#uip-marks-hatch);' }));
    layer.append(svg);
  }

  // The marks live in the component's document, so they scale with it; stroke and stripe sizes are
  // divided by the zoom to look the same at any zoom.
  function drawMarks(width, height) {
    const doc = frame.contentDocument;
    doc?.getElementById('uip-marks')?.remove();
    if (!mark || !doc?.body) return;
    const px = (n) => `${n / scale}px`;
    const layer = doc.createElement('div');
    layer.id = 'uip-marks';
    layer.dataset.uiPicker = 'marks';
    layer.style.cssText = `all: initial; position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; overflow: hidden; pointer-events: none; z-index: 2147483647;`;
    if (mark.color) drawColor(doc, layer, width, height);
    else drawFont(doc, layer, px);
    doc.documentElement.append(layer);
  }

  function fit() {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;
    doc.getElementById('uip-marks')?.remove();
    const width = Math.ceil(Math.max(hint.width + 32, doc.documentElement.scrollWidth, doc.body.scrollWidth));
    const height = Math.ceil(Math.max(doc.body.getBoundingClientRect().height, doc.body.scrollHeight));
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    const room = (size) => size / uiZoom - PAD * 2;
    scale = zoom || Math.min(1, room(innerWidth) / width, room(innerHeight) / height);
    const shown = scale * uiZoom;
    document.documentElement.classList.toggle('zoomed', !!zoom);
    frame.style.transform = `scale(${shown})`;
    stage.style.width = `${width * shown}px`;
    stage.style.height = `${height * shown}px`;
    drawMarks(width, height);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'uip-rendered', width, height, scale, fit: !zoom }, '*');
    }
  }

  frame.addEventListener('load', () => {
    fit();
    frame.contentDocument?.fonts?.ready.then(fit);
  });
  window.addEventListener('resize', fit);

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === 'uip-zoom') {
      zoom = Number(e.data.zoom) || 0;
      fit();
    } else if (e.data?.type === 'uip-bg') {
      setBg(e.data.bg);
    } else if (e.data?.type === 'uip-highlight') {
      const { stacks, color } = e.data;
      if (color?.hex) mark = { color: { hex: String(color.hex), alpha: Number(color.alpha) } };
      else if (Array.isArray(stacks) && stacks.length) mark = { stacks: new Set(stacks) };
      else mark = null;
      fit();
    } else if (e.data?.type === 'uip-render') {
      zoom = Number(e.data.zoom) || 0;
      setBg(e.data.bg);
      render(String(e.data.html || ''), e.data.width, e.data.height);
    }
  });

  function parentIsExtension() {
    try {
      return window.parent === window || window.parent.location.origin === location.origin;
    } catch {
      return false;
    }
  }

  window.UiPicker.settings.watch('zoom', (z) => {
    uiZoom = z;
    if (frame.srcdoc) fit();
  });

  setBg(params.get('bg'));
  const id = params.get('id');
  if (id && parentIsExtension()) {
    window.UiPicker.storage.get(id).then((comp) => {
      if (comp) render(comp.previewHtml || comp.html, comp.width, comp.height);
    });
  }
})();
