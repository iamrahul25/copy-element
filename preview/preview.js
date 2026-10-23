(() => {
  const frame = document.getElementById('frame');
  const stage = document.getElementById('stage');
  const params = new URLSearchParams(location.search);
  const PAD = 8;

  let hint = { width: 0, height: 0 };

  function setBg(bg) {
    document.body.className = `bg-${bg || 'checker'}`;
  }

  function render(html, width, height) {
    hint = { width: width || 0, height: height || 0 };
    frame.style.width = `${Math.max(hint.width + 32, 50)}px`;
    frame.style.height = `${Math.max(hint.height + 32, 50)}px`;
    frame.srcdoc = html;
  }

  function fit() {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;
    const width = Math.ceil(Math.max(hint.width + 32, doc.documentElement.scrollWidth, doc.body.scrollWidth));
    const height = Math.ceil(Math.max(doc.body.getBoundingClientRect().height, doc.body.scrollHeight));
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    const scale = Math.min(1, (innerWidth - PAD * 2) / width, (innerHeight - PAD * 2) / height);
    frame.style.transform = `scale(${scale})`;
    stage.style.width = `${width * scale}px`;
    stage.style.height = `${height * scale}px`;
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ct-rendered', width, height, scale }, '*');
    }
  }

  frame.addEventListener('load', () => {
    fit();
    frame.contentDocument?.fonts?.ready.then(fit);
  });
  window.addEventListener('resize', fit);

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'ct-render') return;
    setBg(e.data.bg);
    render(String(e.data.html || ''), e.data.width, e.data.height);
  });

  function parentIsExtension() {
    try {
      return window.parent === window || window.parent.location.origin === location.origin;
    } catch {
      return false;
    }
  }

  setBg(params.get('bg'));
  const id = params.get('id');
  if (id && parentIsExtension()) {
    window.CopyThing.storage.get(id).then((comp) => {
      if (comp) render(comp.html, comp.width, comp.height);
    });
  }
})();
