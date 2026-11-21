"""One-time interactive login, persisted as Playwright storage state so
later captures run already signed in.

Logging in matters for two reasons: Suno interrupts anonymous playback
after a while with a "log in to keep listening" prompt, and it shows a
signup modal on share pages to logged-out visitors. Both go away once the
browser context carries a real, authenticated session -- *your* session,
established by *you*, in a real visible browser window. This tool never
sees, stores, or handles your password; it only persists the cookies and
local storage that your own login leaves behind, the same thing a normal
browser's cookies jar would carry across restarts.
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_AUTH_PATH = Path.home() / ".suno-tape" / "auth.json"


def login(auth_path: Path = DEFAULT_AUTH_PATH) -> Path:
    auth_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://suno.com/", timeout=30000)

        print(
            "A browser window just opened. Log in to your Suno account there\n"
            "(Google, Apple, phone, whatever you normally use), the same way\n"
            "you always do. Once you're logged in and see your own account,\n"
            "come back here and press Enter."
        )
        input()

        context.storage_state(path=str(auth_path))
        browser.close()

    print(f"Saved session to {auth_path}.")
    print("`suno-tape capture` will use it automatically from now on.")
    print("Re-run `suno-tape login` whenever the session expires or you log out.")
    return auth_path
