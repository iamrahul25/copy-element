# UI Picker

Chrome extension that copies any element on a page as a standalone HTML file (HTML + CSS), with a live preview and a local component library.

## Run

```bash
python app.py
```

Choose **1. Run the project**. It opens Chrome with its own profile (`.chrome-profile/`), so your normal Chrome is untouched.

## Load the extension (one time)

Chrome doesn't allow scripts to install unpacked extensions, so add it by hand once. The first run of `app.py` opens `chrome://extensions` and copies the folder path to your clipboard.

1. Turn on **Developer mode** (top right).
2. Click **Load unpacked** and select `C:\all-projects\ui-picker`.
3. Click the puzzle-piece icon in the toolbar and pin **UI Picker**.

Chrome remembers it for this profile; later runs open straight to the browser.

## Use

- Click the UI Picker icon or press `Alt+Shift+C`, then click an element (`↑`/`↓` select parent/child, `Esc` cancels).
- In the panel: pick an output style, then **Copy HTML**, **Download**, or the bookmark button to name and save it to the library. More toggles are under **Advanced options**.
- **Output style: Clean** (the default) writes only the styles that change how the element looks, as shorthands (`padding: 8px 16px`, `border: 1px solid …`), and keeps a `width`/`height` only where the layout needs it. **Exact** gives the exhaustive v1 output.
- **Tailwind CDN** (only enabled when the page uses Tailwind) keeps the element's Tailwind classes, adds `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">` to the output, and leaves out the CSS those classes already write. A class is kept only if it gives the same value the element has on the page; anything else (classes overridden by the site's CSS, custom colors on Tailwind v3 sites) stays in the generated CSS. Custom v4 theme values are copied into an `@theme` block. The preview can't run the CDN script, so it shows the same markup with the equivalent CSS inlined.
- The stat pills show how many lines the output has; after toggling an option the lines pill also shows how many lines that added or removed, e.g. `212 lines −38`. The **HTML** tab shows the code with syntax highlighting.
- The sun/moon button in the panel and library header switches light and dark mode for the whole extension. The choice is saved; until you pick one it follows the system.
- All colors, radii and fonts live in `shared/theme.css`, each written as `light-dark(<light>, <dark>)`, shared by the panel, picker, preview and library.
- Open the library from the panel's **Library** button or by right-clicking the toolbar icon. Each saved component remembers the page it came from and how far that page was scrolled when you picked it: click the site name on a card, or **Open page** in the full preview, to reopen it at that spot.

After changing the code, click the reload arrow on the UI Picker card in `chrome://extensions`.

## Troubleshooting

**"Cannot load extension with file or directory name `__pycache__`"**: delete the `__pycache__` folder in the project root and click **Retry**. `app.py` removes it automatically each time you choose option 1.
