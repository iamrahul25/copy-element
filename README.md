# Copy Thing

Chrome extension that copies any element on a page as a standalone HTML file (HTML + CSS), with a live preview and a local component library.

## Run

```bash
python app.py
```

Choose **1. Run the project**. It opens Chrome with its own profile (`.chrome-profile/`), so your normal Chrome is untouched.

## Load the extension (one time)

Chrome doesn't allow scripts to install unpacked extensions, so add it by hand once. The first run of `app.py` opens `chrome://extensions` and copies the folder path to your clipboard.

1. Turn on **Developer mode** (top right).
2. Click **Load unpacked** and select `C:\all-projects\copy-thing`.
3. Click the puzzle-piece icon in the toolbar and pin **Copy Thing**.

Chrome remembers it for this profile; later runs open straight to the browser.

## Use

- Click the Copy Thing icon or press `Alt+Shift+C`, then click an element (`↑`/`↓` select parent/child, `Esc` cancels).
- In the panel: toggle options, then **Copy HTML**, **Download .html**, or **Save to library**.
- **Minimal CSS** (on by default) writes only the styles that change how the element looks, as shorthands (`padding: 8px 16px`, `border: 1px solid …`), and keeps a `width`/`height` only where the layout needs it. Turn it off for the exhaustive v1 output.
- Open the library from the panel's **Library** button or by right-clicking the toolbar icon.

After changing the code, click the reload arrow on the Copy Thing card in `chrome://extensions`.

## Troubleshooting

**"Cannot load extension with file or directory name `__pycache__`"**: delete the `__pycache__` folder in the project root and click **Retry**. `app.py` removes it automatically each time you choose option 1.
