"""Launcher for the UI Picker Chrome extension."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROFILE_DIR = ROOT / ".chrome-profile"
START_URL = "https://example.com"

BROWSER_CANDIDATES = [
    Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
    Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
]
BROWSER_COMMANDS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"]


def find_browser():
    for path in BROWSER_CANDIDATES:
        if path.is_file():
            return str(path)
    for name in BROWSER_COMMANDS:
        found = shutil.which(name)
        if found:
            return found
    return None


def extension_installed():
    """True if this folder is registered as an unpacked extension in the launcher profile."""
    target = os.path.normcase(str(ROOT))
    for name in ("Secure Preferences", "Preferences"):
        prefs_file = PROFILE_DIR / "Default" / name
        try:
            prefs = json.loads(prefs_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        settings = prefs.get("extensions", {}).get("settings", {})
        for ext in settings.values():
            path = ext.get("path") if isinstance(ext, dict) else None
            if path and os.path.normcase(os.path.normpath(path)) == target:
                return True
    return False


def copy_to_clipboard(text):
    try:
        if sys.platform == "win32":
            subprocess.run("clip", input=text.encode("utf-16-le"), check=True)
        elif sys.platform == "darwin":
            subprocess.run("pbcopy", input=text.encode(), check=True)
        else:
            return False
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def run_project():
    if not (ROOT / "manifest.json").is_file():
        print(f"manifest.json not found in {ROOT}")
        return

    browser = find_browser()
    if not browser:
        print("Chrome (or Edge) was not found. Install it, or load the extension manually:")
        print(f"  chrome://extensions > Developer mode > Load unpacked > {ROOT}")
        return

    # Chrome refuses to load an extension folder containing names that start with "_".
    shutil.rmtree(ROOT / "__pycache__", ignore_errors=True)
    PROFILE_DIR.mkdir(exist_ok=True)
    installed = extension_installed()
    args = [
        browser,
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        START_URL if installed else "chrome://extensions/",
    ]
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if installed:
        print(f"Launched {Path(browser).name} with UI Picker (profile: {PROFILE_DIR.name}).")
        print("Click the UI Picker icon (puzzle-piece menu) or press Alt+Shift+C, then pick an element.")
        print("Code changes: click the reload arrow on the UI Picker card in chrome://extensions.")
        return

    copied = copy_to_clipboard(str(ROOT))
    print(f"Launched {Path(browser).name} on chrome://extensions (profile: {PROFILE_DIR.name}).")
    print("Chrome only allows unpacked extensions to be added by hand. One-time setup:")
    print("  1. Turn on 'Developer mode' (top-right of the Extensions page).")
    print("  2. Click 'Load unpacked' and select this folder:")
    print(f"       {ROOT}" + ("   (path copied to clipboard - paste it in the folder dialog)" if copied else ""))
    print("  3. Click the puzzle-piece icon in the toolbar and pin UI Picker.")
    print("Chrome remembers it for this profile, so next time option 1 opens straight to the browser.")


def main():
    actions = {"1": run_project}
    while True:
        print("\n=== UI Picker ===")
        print("1. Run the project")
        print("2. Exit")
        try:
            choice = input("Choose an option: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if choice == "2":
            print("Bye!")
            break
        action = actions.get(choice)
        if action:
            action()
        else:
            print("Invalid option, enter 1 or 2.")


if __name__ == "__main__":
    sys.exit(main())
