# Arcane Cursor — a realm.watch cursor

> Fork of [Hati](https://github.com/szymonwilczek/hati) by szymonwilczek, GPL-3.0 (LICENSE unchanged).

> What changed from upstream: an event-driven frame loop: no idle redraws, and the RGB cycle pauses while auto-hidden. It also stops accessing disposed window actors in the magnifier. UUID `arcane-cursor@jphein.github.io`, with its own settings (`org.gnome.shell.extensions.arcane-cursor`). On first enable it copies your Hati settings once, read-only. **Arcane** page in the preferences: spell-mote trail, rune ring on click (triangle/pentagram/diamond for left/middle/right), arcane pulse on a shake to find the cursor, subtle mode, and an opt-in realm-health tint. Every effect is event-driven, so a still cursor costs nothing.
>
> **Swap on a live session** (Wayland may need a logout/login before a newly installed UUID is loadable):
> ```sh
> make install                                            # copies to ~/.local/share/gnome-shell/extensions/arcane-cursor@jphein.github.io
> gnome-extensions disable hati@szymonwilczek.github.io
> gnome-extensions enable arcane-cursor@jphein.github.io     # if "does not exist": log out and in, then run it again
> ```
> **Back out:** `gnome-extensions disable arcane-cursor@jphein.github.io && gnome-extensions enable hati@szymonwilczek.github.io`

## Features
- **Aura**: Hati's cursor highlight (shapes, glow, RGB cycle, magnifier, spotlight, auto-hide), now on an event-driven frame loop, so a still cursor costs nothing.
- **Spell-mote trail**: gold and violet motes behind a moving cursor, fading within 400 ms.
- **Rune ring on click**: a gold sigil circle per click, with a triangle, pentagram or diamond for the left, middle or right button.
- **Arcane pulse**: shake the cursor to find it.
- **Realm pulse** (opt-in): the aura is tinted from realmwatch health, green → ember → red.
- **Subtle mode**: Super+Alt+C, and automatic while the screen is being cast or recorded.
- Palette: old gold, deep violet, ember, moonlight silver; follows the system light/dark style.

## Install
```sh
make install        # → ~/.local/share/gnome-shell/extensions/arcane-cursor@jphein.github.io (schemas compiled)
```
Log out and in on Wayland, then `gnome-extensions enable arcane-cursor@jphein.github.io`. Preferences: `gnome-extensions prefs arcane-cursor@jphein.github.io`.

## Test (never on a live session)
- `tools/nested-test.sh <ext-dir> <uuid> <label> [rgb]` runs a headless gnome-shell on its own bus, with its own runtime and XDG dirs. It measures idle ticks and frames, plus disposed errors.
- `DEMO=1` adds a virtual-pointer demo with screenshots; `FEATURES=1` adds the realm pulse and screencast checks; `MIGRATE=1` exercises the one-time settings copy.
- `tools/nested-view.sh` opens a visible nested window.

## Credit
Arcane Cursor is a fork of [Hati](https://github.com/szymonwilczek/hati) by Szymon Wilczek, licensed GPL-3.0-or-later; see LICENSE, unchanged. The aura, magnifier, spotlight and presets are his work.
