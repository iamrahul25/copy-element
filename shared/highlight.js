(() => {
  const CT = (globalThis.CopyThing = globalThis.CopyThing || {});
  if (CT.highlight) return;

  // Each token becomes a DOM node; past these sizes plain text is faster and just as readable.
  const MAX_LENGTH = 8 * 1024 * 1024;
  const MAX_TOKENS = 80000;

  const TAG_OPEN = /<(\/?)([A-Za-z][^\s/>]*)/y;
  const ATTR = /(\s+)|(\/?>)|([^\s"'>/=]+)|(=)(\s*)("[^"]*"|'[^']*'|[^\s"'>]+)?|(\/)/y;
  const ENTITY = /&(?:#\d+|#x[\da-f]+|\w+);/gi;
  const CSS_VALUE =
    /"(?:[^"\\]|\\[\s\S])*"?|'(?:[^'\\]|\\[\s\S])*'?|\burl\((?:"[^"]*"|'[^']*'|[^)]*)\)?|!important\b|#[\da-f]{3,8}\b|--[\w-]+|-?[a-z_][\w-]*(?=\()|(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?/gi;
  const JS_TOKEN =
    /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?|`(?:[^`\\]|\\[\s\S])*`?|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*/g;
  const JS_KEYWORDS = new Set(
    (
      'async await break case catch class const continue default delete do else export extends false finally ' +
      'for function if import in instanceof let new null of return static super switch this throw true try ' +
      'typeof undefined var void while yield'
    ).split(' ')
  );

  function push(out, type, text) {
    if (text) out.push([type, text]);
  }

  // Tokens matched by `re` get the type `classify` returns; the text between them gets `gapType`.
  function scan(src, re, classify, out, gapType = '') {
    let last = 0;
    for (const m of src.matchAll(re)) {
      push(out, gapType, src.slice(last, m.index));
      push(out, classify(m[0]), m[0]);
      last = m.index + m[0].length;
    }
    push(out, gapType, src.slice(last));
  }

  function html(src, out) {
    let lower = null;
    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      const text = src.slice(i, lt < 0 ? src.length : lt);
      scan(text, ENTITY, () => 'entity', out);
      if (lt < 0) break;
      i = lt;

      if (src.startsWith('<!--', i) || src[i + 1] === '!') {
        const comment = src.startsWith('<!--', i);
        const end = src.indexOf(comment ? '-->' : '>', i);
        const stop = end < 0 ? src.length : end + (comment ? 3 : 1);
        push(out, comment ? 'comment' : 'keyword', src.slice(i, stop));
        i = stop;
        continue;
      }

      TAG_OPEN.lastIndex = i;
      const tag = TAG_OPEN.exec(src);
      if (!tag) {
        push(out, '', '<');
        i++;
        continue;
      }
      push(out, 'punct', `<${tag[1]}`);
      push(out, 'tag', tag[2]);
      i = TAG_OPEN.lastIndex;

      let closed = false;
      while (!closed) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(src);
        if (!a) break;
        i = ATTR.lastIndex;
        if (a[1]) push(out, '', a[1]);
        else if (a[2]) {
          push(out, 'punct', a[2]);
          closed = true;
        } else if (a[3]) push(out, 'attr', a[3]);
        else if (a[4]) {
          push(out, 'punct', a[4]);
          push(out, '', a[5]);
          push(out, 'string', a[6]);
        } else push(out, 'punct', a[7]);
      }

      const name = tag[2].toLowerCase();
      if (closed && !tag[1] && (name === 'style' || name === 'script')) {
        lower = lower || src.toLowerCase();
        const end = lower.indexOf(`</${name}`, i);
        const stop = end < 0 ? src.length : end;
        (name === 'style' ? css : js)(src.slice(i, stop), out);
        i = stop;
      }
    }
  }

  function quoteEnd(src, i) {
    const q = src[i];
    for (i++; i < src.length; i++) {
      if (src[i] === '\\') i++;
      else if (src[i] === q) return i;
    }
    return src.length;
  }

  // Index of the `{`, `}` or `;` that ends the statement at `i`, skipping strings and parentheses
  // (data URIs inside url() contain semicolons).
  function statementEnd(src, i) {
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'") i = quoteEnd(src, i);
      else if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) return src.length;
        i = end + 1;
      } else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (c === '{' || c === '}' || c === ';')) return i;
    }
    return src.length;
  }

  function cssValueType(token) {
    const c = token[0];
    if (c === '"' || c === "'" || /^url\(/i.test(token)) return 'string';
    if (c === '!') return 'keyword';
    if (c === '#') return 'number';
    if (token.startsWith('--')) return 'prop';
    if (/^-?[\d.]/.test(token)) return 'number';
    return 'fn';
  }

  function cssValue(src, out) {
    scan(src, CSS_VALUE, cssValueType, out);
  }

  function css(src, out) {
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) {
        const m = /\s+/y;
        m.lastIndex = i;
        m.exec(src);
        push(out, '', src.slice(i, m.lastIndex));
        i = m.lastIndex;
      } else if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? src.length : end + 2;
        push(out, 'comment', src.slice(i, stop));
        i = stop;
      } else if (c === '{' || c === '}' || c === ';') {
        push(out, 'punct', c);
        i++;
      } else {
        const end = statementEnd(src, i);
        const stmt = src.slice(i, end);
        const at = /^@[\w-]+/.exec(stmt);
        const colon = stmt.indexOf(':');
        if (at) {
          push(out, 'keyword', at[0]);
          cssValue(stmt.slice(at[0].length), out);
        } else if (src[end] === '{') {
          push(out, 'selector', stmt);
        } else if (colon > 0) {
          push(out, 'prop', stmt.slice(0, colon));
          push(out, 'punct', ':');
          cssValue(stmt.slice(colon + 1), out);
        } else {
          push(out, '', stmt);
        }
        i = end;
      }
    }
  }

  function jsType(token) {
    const c = token[0];
    if (c === '/') return 'comment';
    if (c === '"' || c === "'" || c === '`') return 'string';
    if (/\d/.test(c)) return 'number';
    return JS_KEYWORDS.has(token) ? 'keyword' : '';
  }

  function js(src, out) {
    scan(src, JS_TOKEN, jsType, out);
  }

  const LANGS = { html, css, js };

  /** Returns [type, text] pairs; type '' is plain text. */
  function tokenize(src, lang = 'html') {
    const out = [];
    LANGS[lang](src, out);
    return out;
  }

  /** Fills `target` with `src` as `tok-<type>` spans. Copying the text still gives the plain source. */
  function render(target, src, lang = 'html') {
    const tokens = src.length <= MAX_LENGTH ? tokenize(src, lang) : null;
    if (!tokens || tokens.length > MAX_TOKENS) {
      target.textContent = src;
      return;
    }
    const doc = target.ownerDocument;
    const frag = doc.createDocumentFragment();
    let type = '';
    let text = '';
    const flush = () => {
      if (!text) return;
      if (!type) frag.append(text);
      else {
        const span = doc.createElement('span');
        span.className = `tok-${type}`;
        span.textContent = text;
        frag.append(span);
      }
    };
    for (const [t, s] of tokens) {
      if (t === type) text += s;
      else {
        flush();
        type = t;
        text = s;
      }
    }
    flush();
    target.replaceChildren(frag);
  }

  CT.highlight = { tokenize, render };
})();
