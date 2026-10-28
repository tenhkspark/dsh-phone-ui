[English](README.md) | [한국어](README-ko.md) | [简体中文](README-zh.md) | [日本語](README-ja.md)

# DSH on a phone — a phone-only layer for the DSH web UI

DSH (DeepSeek Harness) ships a web UI built for a desktop window. On a phone-width
screen it is usable but cramped, and nothing in the frontend reacts to the screen
width. This repository adds a phone entry point **next to** the desktop one: a small
reverse proxy that injects a narrow-screen stylesheet and script into the page it
serves. The desktop entry, the DSH install and its data are left untouched.

Nothing here is a fork. It is one Node script (no dependencies), one stylesheet and
one script, plus how to keep it running and expose it privately.

```
phone ──HTTPS──▶ private-network proxy (tailscale serve, :8450)
                        │
                        ▼
                 dsh-phone gateway  (this repo, 127.0.0.1:8450)
                   ├── /m              → 302 to /?token=<current DSH token>
                   ├── /__dshm/*.css   → the phone stylesheet
                   ├── /__dshm/*.js    → the phone script
                   ├── /__dshm/status  → health JSON
                   └── everything else → 127.0.0.1:3080 (DSH web)
desktop ──HTTPS──▶ the original DSH entry (:8446) — unchanged
```

## Why a second entry instead of a patch

Measured on the shipped frontend (`@deepseek-ai/dsh` 0.2.1-rc.2,
`dist/assets/index-*.css`):

- width-based media queries: **0** (the only `@media` rules are `prefers-reduced-motion`),
  and the bundle contains no `matchMedia` call — the layout never changes with width
- at a 440px viewport the left rail keeps **56px** permanently; opening the sidebar
  changes the grid to `280px | 160px`, leaving **160px** for the conversation
- composer chips are **28px** tall and the editable is **14px**, which makes iOS zoom
  the page on focus (it zooms anything under 16px)
- there is no presentation of the notch/home-indicator safe area (`viewport-fit=cover`)

Patching the bundled assets would work until the next `npm update`. Injecting at request
time keeps the DSH install untouched and can be removed in one step. It is not
future-proof in the same way though: the stylesheet hangs off DSH's `data-slot` names, so
a rename in a later DSH build can still break the skin (see the limits below).

## What you get

- The left rail becomes a slide-over panel with one floating menu button
- Tap targets of 36–40px for the composer, the header and the per-message actions
- 16px editable, so iOS stops zooming on focus
- The app is sized to the *visible* box, so the composer stays above the on-screen
  keyboard (`visualViewport`)
- Safe-area padding for fullscreen/PWA mode, plus home-screen icon/manifest routes
- A fixed entry URL (`/m`) that resolves to the current token — a home-screen shortcut
  keeps working after DSH restarts and rotates its token
- Long code blocks and tables scroll sideways instead of overflowing the page

## Requirements

- DSH web running and reachable at an HTTP origin (default `http://127.0.0.1:3080`)
- Node.js 20 or newer on the same host (no npm packages are needed)
- Any recent phone browser; you choose the breakpoint yourself. The layer has been checked
  on one device class only — see the limits below
- Optional: a private-network tunnel (the examples use Tailscale) so the phone reaches
  the host without opening a port to the internet

## Install

1. Copy `scripts/` to the host that runs DSH, for example `~/dsh-phone`.

2. Run it (replace the token-log path with the file DSH prints its URL to):

   ```sh
   PORT=8450 \
   UPSTREAM=http://127.0.0.1:3080 \
   TOKEN_LOG="$HOME/.dsh/dsh-launchd.log" \
   node ~/dsh-phone/server.mjs
   ```

   `TRUSTED_HOST` is opt-in and usually unnecessary. Set it only if you start DSH with
   `--trusted-host <host:port>` — pass the same value (for example
   `TRUSTED_HOST=myhost.example.ts.net:8446`), and the gateway will present that
   `Host`/`Origin` upstream so requests arriving through the second port pass DSH's
   origin check. Without it, headers are forwarded unchanged.

3. Check it locally:

   ```sh
   curl -s http://127.0.0.1:8450/__dshm/status
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8450/m   # expect 302
   ```

4. Keep it running. `deploy/com.example.dsh-phone.plist` (macOS launchd) and
   `deploy/dsh-phone.service` (Linux systemd) are templates — fill in the paths and the
   port, then load them as described in the comments.

5. Expose it to your phone, privately. With Tailscale:

   ```sh
   tailscale serve --bg --https=8450 http://127.0.0.1:8450
   ```

   **If your tailnet ACL lists allowed ports explicitly, add the new port there too.**
   Ports that are not listed are dropped silently — the phone shows "cannot connect"
   while everything works locally. This is the single most common reason the setup
   appears broken.

6. On the phone, open `https://<your-host>:8450/m`, then use the browser's
   "Add to Home Screen". The `/m` entry survives token rotation; a URL with a hard-coded
   token does not.

   Optional: drop your own `apple-touch-icon-180.png`, `icon-192.png` and `icon-512.png`
   into `scripts/icons/` — the icon and manifest links are injected only when those files
   exist. Do not ship the DSH logo as your own app icon — it belongs to
   DeepSeek; use your own image or none.

## Tune it to your phone

The breakpoint is a single value that appears twice — `MAX_W` in `mobile.js` and the
`@media (max-width: 520px)` block in `mobile.css` — so change both together. 520px was
chosen to sit above a Pro Max-class viewport of 440px, so the layer switches on for that
device. The test is width only: a desktop window narrowed below the breakpoint will match
it as well.

To measure your own device: open the page on the phone, save the line below as a bookmark
and run it from the bookmarks list, or run it in the browser's remote inspector —

```js
javascript:prompt('', innerWidth + 'x' + innerHeight)
```

Set `MAX_W` a little above your width (so orientation/landscape still matches whatever
you intend), and keep both files in sync. Things worth checking on a new device:

- does the composer stay visible when the keyboard opens (needs `visualViewport`)
- are the sidebar and the scrim the right size (`min(320px, 86vw)`)
- does the safe-area padding look right in fullscreen mode, in both orientations
- are the tap targets comfortable for your thumb, or should the 40px floor be larger

## What this does not do

- It adds no authentication. It relies on DSH's own token/cookie; keep the port on a
  private network / behind your tunnel. Do not expose it to the internet.
- It does not change the layout of a wide window: every rule is inside a width query gated
  by `html.dshm`, which the script only adds below the breakpoint.
- It is not a DSH fork. Selectors use DSH's `data-slot` attribute names on purpose (the
  CSS-module class names are hashed per build), but a DSH update can still rename slots
  and break the skin. When that happens,
  `document.querySelectorAll('[data-slot]')` on the live page is the fastest way to
  rebuild the selector list.
- It was written and checked on one host and one phone class. The keyboard handling in
  particular is device-dependent — verify it on your own phone.

## Troubleshooting

- **Phone cannot connect, host works locally.** Port not allowed by your ACL/firewall,
  or the phone is not on the private network. Check the gateway log for a `hit` line
  with a phone user-agent.
- **`/m` answers 503.** The gateway could not find a token in `TOKEN_LOG`. Point it at
  the file DSH writes its start URL to.
- **Page loads but the skin does nothing.** `html.dshm` was not added: the viewport is
  wider than `MAX_W`, or the script is blocked. Check `innerWidth` and the console.
- **Right-hand header icon looks cut off.** Something is clipping that row. In the
  stock layout the left padding that makes room for the menu button pushes the icon
  outside the row — do not add `overflow: hidden` to it.
- **Sidebar opens but the page behind is not dimmed.** The scrim is inserted into
  `document.body`; a strict CSP that blocks inline styles will drop it.

## Uninstall

```sh
launchctl bootout gui/$(id -u)/com.example.dsh-phone   # or: systemctl --user disable --now dsh-phone
tailscale serve --https=8450 off
rm -rf ~/dsh-phone
```

Nothing was written into DSH, so there is nothing to revert there.

## Credits

- DSH (DeepSeek Harness) by DeepSeek — used as-is, not modified, no model weights
  involved. `data-slot` names and the token/URL behavior are what this layer builds on.
- Contributors: **tenhkspark** (design, implementation) and **DeepSeek V4.1 Flash 1017**
  (review passes and translation checks, run locally).

MIT licensed — see [LICENSE](LICENSE).
