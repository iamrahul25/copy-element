# UI Picker – Chrome Extension Plan

Minimal Chrome extension (Manifest V3, vanilla JS, no build step) that lets you pick any element on a page, copies its HTML structure plus all the CSS needed to render it, and outputs a **standalone HTML page** that shows the component exactly as it looked — no external CSS, no extra wrappers.

---

## 1. Goals

- Pick an element on any page by hovering + clicking.
- Generate a self-contained `.html` document (HTML + `<style>`) that renders the element identically when opened directly.
- Show a **live preview** of the output in a sandboxed iframe before copying.
- Optional extras toggled with **checkboxes**; the preview updates live when a box is ticked/unticked.
- **Save** components to a local library to view, search, copy and download later.

## Non-goals (v1)

- JavaScript behaviour of the component (only markup + styles).
- Responsive/media-query reconstruction (we capture the element at its current size).
- Cloud sync, accounts.

---

## 2. Decisions

| Topic | Choice |
|---|---|
| Stack | Vanilla JS, Manifest V3, no bundler |
| CSS strategy | Computed styles, deduplicated into generated classes |
| Preview UI | Floating panel injected on the page, preview inside sandboxed `<iframe srcdoc>` |
| Extras | Checkboxes in the panel, live-updating preview |
| Library | List with previews, copy HTML / download `.html`, search |
| Storage | `chrome.storage.local` with `unlimitedStorage` permission |

---

## 3. File Structure

```
ui-picker/
├── manifest.json
├── background.js          # service worker: toolbar click, shortcut, message routing
├── content/
│   ├── picker.js          # hover highlight + click-to-select
│   ├── serializer.js      # element -> standalone HTML (core logic)
│   ├── panel.js           # floating panel: preview, checkboxes, Copy / Save
│   └── panel.css          # panel styles (scoped inside Shadow DOM)
├── preview/
│   ├── preview.html       # sandboxed renderer used by the panel and library (extension page,
│   └── preview.js         #   so the host page's CSP can't block the preview's styles/images)
├── library/
│   ├── library.html       # full-page library view (opened in a new tab)
│   ├── library.js
│   └── library.css
├── shared/
│   ├── util.js            # DOM builder, clipboard, download, formatting helpers
│   ├── storage.js         # save / list / delete / options helpers
│   └── highlight.js       # HTML / CSS / JS syntax highlighting for the code views
├── icons/                 # 16, 48, 128 px
└── plan.md
```

---

## 4. Manifest (MV3)

- `permissions`: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `clipboardWrite`, `contextMenus`
- `host_permissions`: `<all_urls>` (needed to fetch images/fonts for base64 embedding)
- `action`: toolbar button → starts picker on the current tab
- `commands`: `Alt+Shift+C` → start picker
- Context menu entry: "Open component library"
- Content scripts injected on demand via `chrome.scripting.executeScript` (not on every page).

---

## 5. User Flow

1. Click the toolbar icon (or press `Alt+Shift+C`).
2. **Picker mode**: hovered element gets an outline + small label (`tag.class  W×H`).
   - `↑` / `↓` arrow keys move selection to parent / first child.
   - `Click` selects, `Esc` cancels.
3. **Panel opens** (bottom-right, draggable, inside Shadow DOM so page CSS can't break it):
   - Live preview iframe showing exactly what the output HTML renders.
   - Checkbox row for extras (see §7). Toggling re-serializes and refreshes preview.
   - Size info + output size in KB.
   - Buttons: **Copy HTML**, **Download .html**, **Save to Library**, **Re-pick**, **Close**.
4. **Save** asks for a name (pre-filled from tag/heading text), stores the component.
5. **Library page** lists saved components with live mini previews, search, copy, download, delete.

---

## 6. Serializer – Core Algorithm (`serializer.js`)

Input: selected element + options object. Output: full HTML string.

1. **Clone the tree** (`cloneNode(true)`), walking original and clone in parallel so computed styles are read from the live original.
2. **Strip noise** from the clone: `<script>`, inline event handlers (`on*`), `id`/`class` attributes (replaced by generated classes), `data-*` (optional keep), hidden elements (`display:none`) are kept but styled hidden.
3. **Read computed styles** for each original node via `getComputedStyle`.
4. **Diff against defaults**: for each tag, create a reference element of the same tag in a clean hidden iframe and read its default computed style. Only keep properties whose values differ → small CSS.
5. **Inherited properties**: on the root element, always emit inheritable properties (`font-*`, `color`, `line-height`, `letter-spacing`, `text-*`, `white-space`, `direction`, `visibility`, `cursor`) because the page's ancestors provide them. On descendants, drop inheritable properties equal to the parent's value.
6. **Deduplicate**: hash each element's style declaration string → map to a class name (`uip-1`, `uip-2`, …). Identical styles share a class.
7. **Root fixes**: on the root element, reset `margin` to `0` and keep its exact `width`/`height` (from `getBoundingClientRect`) so layout depending on parent width still matches; remove `position: absolute/fixed` offsets (convert to `relative`, keep size).
8. **Form state**: copy live `value`, `checked`, `selected` into attributes.
9. **URLs**: rewrite relative `src`, `href`, `srcset`, `url(...)` in CSS to absolute URLs.
10. **Assemble document**:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Component</title>
<style>
  html,body{margin:0}
  body{padding:16px;background:<page color>}   /* background only when "Page background" is on */
  .uip-1{...}
  .uip-2{...}
</style>
</head>
<body>
  <!-- cloned element only -->
</body>
</html>
```

Body contains only the component — no wrapper divs, no extra styling.

---

## 7. Optional Extras (checkboxes in panel, live preview)

Each checkbox maps to an option flag; changing one re-runs the serializer (debounced ~150 ms) and refreshes the iframe `srcdoc`.

| Checkbox | Default | What it does |
|---|---|---|
| Minimal CSS (v2) | On | Keeps only declarations that affect the look, merged into shorthands (`margin`, `padding`, `border`, `border-radius`, `inset`, `gap`, `overflow`, `flex`, `text-decoration`, `outline`); drops transitions, no-op shadows, identity transforms, `min-*: auto`. Widths/heights are removed, the output is rendered in a hidden frame, and sizes are pinned back only on elements that come out a different size than on the page |
| Pseudo-elements (`::before` / `::after`) | On | Reads `getComputedStyle(el, '::before')`; if `content` ≠ `none`, emits `.uip-N::before{...}` |
| Embed images (base64) | Off | Converts `<img>`, `srcset` and CSS `background-image` URLs to data URIs (fetched via background worker to bypass CORS) |
| Web fonts | On | Collects `@font-face` rules for font families actually used; optionally base64 the font files when "Embed images" is on |
| Hover / focus states | Off | Scans stylesheets (including nested CSS) for `:hover`/`:focus`/`:active` rules whose base selector matches captured elements; re-emits them targeting generated classes. Cross-origin sheets are re-fetched through the background worker |
| SVG internals | On | Styles shapes inside inline SVGs with computed `fill`/`stroke`; `<use href>` sprites are always inlined |
| Keep classes | Off | Adds original classes next to generated ones (useful for reuse) |
| Page background | On | Sets the nearest ancestor background color on `<body>` so light-on-dark components stay readable |
| Tailwind CDN | Off | Only enabled when the page uses Tailwind. Diffs styles against Tailwind's preflight instead of browser defaults, keeps each Tailwind class whose rule (resolved in a hidden frame) matches the element's computed value, drops the declarations those classes cover, and adds the `@tailwindcss/browser@4` script plus an `@theme` block for the theme variables they use. The preview inlines the preflight and keeps the covered declarations, since it can't run scripts |
| Preview background (select) | Checker | Preview-only: checker / white / dark (not added to output) |

---

## 8. Live Preview

- The panel embeds `preview/preview.html` (an extension page) and sends it the HTML via `postMessage`; it renders into an inner `<iframe sandbox="allow-same-origin" srcdoc="...">` — scripts disabled, page styles and page CSP fully isolated, so what you see is exactly what the exported file renders.
- Iframe auto-sizes to the component's captured width/height, scaled down with `transform: scale()` if larger than the panel.
- Tab switcher: **Preview** | **HTML code** (read-only `<pre>` with the generated source).

---

## 9. Library

### Storage model (`chrome.storage.local`)

```js
{
  components: {
    "<id>": {
      id, name, html,          // full standalone HTML
      sourceUrl, sourceTitle,
      sourceScroll: { x, y }, // page scroll when the element was picked; "Open page" restores it
      width, height,
      sizeBytes,
      createdAt
    }
  }
}
```

### Library page (`library.html`)

- Opened from toolbar context menu or a "Library" button in the panel.
- Grid of cards; each card has a scaled-down live `<iframe srcdoc>` preview (lazy-loaded with `IntersectionObserver`).
- Card info: name, source domain, date, size.
- Actions per card: **Copy HTML**, **Download .html**, **Open full preview** (modal), **Delete**.
- **Search** box filters by name, source URL and HTML text content.
- Empty state with a short "how to pick" hint.

---

## 10. Edge Cases & Limits

- **Shadow DOM components**: v1 serializes light DOM only; open shadow roots flattened if simple (stretch goal).
- **Canvas / video**: canvas → `<img>` from `toDataURL()` when not tainted; video → poster image.
- **iframes inside the element**: replaced with an empty box of the same size.
- **CSS variables**: computed values are already resolved, so no variable dependencies remain.
- **Huge elements**: warn if > 2 000 nodes or output > 5 MB.
- **Restricted pages** (`chrome://`, Web Store): show a notice that picking isn't allowed.

---

## 11. Implementation Steps

1. **Scaffold**: `manifest.json`, icons, background worker, toolbar click → inject scripts.
2. **Picker**: hover overlay, label, arrow-key parent/child navigation, click/Esc.
3. **Serializer v1**: clone + computed styles + default diff + dedupe classes + document assembly.
4. **Panel**: Shadow DOM panel, preview iframe, Copy / Download buttons.
5. **Extras**: checkboxes wired to options with live re-render; implement pseudo-elements, SVG, fonts, then images (via background fetch), then hover states.
6. **Storage + Save**: `shared/storage.js`, Save button with name prompt.
7. **Library page**: grid, lazy previews, search, copy, download, delete.
8. **Polish**: draggable panel, keyboard shortcut, size warnings, restricted-page notice.
9. **Testing** (manual): capture components from a few real sites (buttons, cards, navbars, forms) and compare the exported file side-by-side with the original in the browser.

---

## 12. Acceptance Criteria

- Opening a downloaded `.html` file in Chrome shows the component visually identical to the original (same size, fonts, colors, spacing).
- Output contains only `<!DOCTYPE>`, `<head>` with one `<style>`, and the component in `<body>`.
- Toggling any checkbox updates the preview within ~300 ms.
- Saved components persist across browser restarts and can be searched, copied and downloaded from the library page.
