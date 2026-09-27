# hati (realm fork)

JP's fork of [szymonwilczek/hati](https://github.com/szymonwilczek/hati), a GNOME Shell cursor highlighter (GPL-3.0-or-later; keep the licence and the SPDX headers, and credit upstream). Our UUID is `hati-realm@jphein.github.io`, so it installs beside the original. The settings schema is still `org.gnome.shell.extensions.hati`, so both builds share JP's settings. Enable only one at a time: both add a panel indicator named "hati".

## Why the fork exists (2026-09-26)
On katana, gnome-shell sat at about 55% of a core with the cursor still. JP's settings have `rgb-enabled=true`, size 200 and glow 100. Upstream runs a perpetual 16 ms `GLib.timeout_add` tick that repaints the Cairo canvas every frame in RGB mode, including while auto-hide has made it invisible. Separately, the magnifier's `SceneCloner` read `.x`/`.y` from window actors that Mutter had already disposed ("MetaWindowActorWayland … already disposed", scene-cloner.js:90).

## What changed
- `extension/extension.js`: the frame loop is a `Clutter.Timeline` on the stage frame clock. It runs only while something moves, and `_tick()` returns false once settled. Wake sources are the cursor tracker's `position-invalidated` and a 100 ms low-priority read of the pointer mask (buttons, magnifier/spotlight modifier keys); the read never draws. The RGB hue cycle pauses while auto-hidden. `set_position` is skipped when unchanged.
- `modules/scene-cloner.js`: each window clone watches its source actor's `destroy` and drops itself; the handler is disconnected while the source is alive, and every access is guarded.
- `modules/physics.js` `isSettled`, `auto-hide.js` `isPending`, `spotlight.js` `isActive`.

## Test: never on JP's live session
`tools/nested-test.sh <ext-dir> <uuid> <label> [rgb]` (`AUTOHIDE=false` optional) runs a headless gnome-shell on its own session bus, with throwaway XDG dirs. It reports idle ticks and frames painted over 10 s, and disposed errors after windows open and close with the magnifier forced on and the loop woken. Controls and perturbations are in `scratch/lucid.md` and PR #1. Note: the disposed check is only valid if the loop is awake. Without `_wake()` it saw 0 errors even with the fix removed.

## Rules
- Branch + PR; PRs for JP's live desktop are "[for JP]" and never self-merged.
- Never enable or swap extensions in JP's live session; he swaps (commands in README).
