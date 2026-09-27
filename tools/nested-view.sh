#!/usr/bin/env bash
# Open a VISIBLE nested gnome-shell (mutter devkit window) with one extension enabled, on its own
# session bus and throwaway XDG dirs — the live session's dconf/extensions are never touched.
#   tools/nested-view.sh [uuid=arcane-cursor@jphein.github.io] [dark|light]
# Close the devkit window (or Ctrl+C in the tmux pane) to end it.
set -u
UUID=${1:-arcane-cursor@jphein.github.io}; SCHEME=${2:-dark}
SRC=$HOME/.local/share/gnome-shell/extensions/$UUID
[ -d "$SRC" ] || { echo "not installed: $SRC" >&2; exit 1; }
T=$(mktemp -d /var/tmp/hati-view.XXXXXX); trap 'rm -rf "$T"' EXIT
# Own XDG_RUNTIME_DIR: a shared one lets the nested session's xdg-document-portal mount over and then
# auto-unmount the LIVE /run/user/$UID/doc (breaks every `flatpak run`), and touch the live
# gnome-shell-disable-extensions crash-guard marker (lucid, 2026-09-26 23:11). WAYLAND_DISPLAY of the
# parent is kept so the devkit window still opens on the live desktop.
LIVE_RUNTIME=$XDG_RUNTIME_DIR
export XDG_CONFIG_HOME=$T/config XDG_DATA_HOME=$T/data XDG_CACHE_HOME=$T/cache XDG_STATE_HOME=$T/state XDG_RUNTIME_DIR=$T/run
mkdir -p "$T/run" && chmod 700 "$T/run" && ln -s "$LIVE_RUNTIME/${WAYLAND_DISPLAY:-wayland-0}" "$T/run/${WAYLAND_DISPLAY:-wayland-0}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME/gnome-shell/extensions"
cp -r "$SRC" "$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
[ -d "$XDG_DATA_HOME/gnome-shell/extensions/$UUID/schemas" ] && glib-compile-schemas "$XDG_DATA_HOME/gnome-shell/extensions/$UUID/schemas/"
# copy JP's live Hati look (size/glow/rgb) so the test matches his desktop, read-only. Arcane Cursor
# has its own schema path and migrates /hati/ once on first enable, so seeding /hati/ exercises that.
LIVE=$(dconf dump /org/gnome/shell/extensions/hati/ 2>/dev/null)
exec dbus-run-session -- bash -c "
  printf '%s\n' \"\$1\" | dconf load /org/gnome/shell/extensions/hati/ 2>/dev/null
  dconf write /org/gnome/shell/disable-user-extensions false
  dconf write /org/gnome/shell/enabled-extensions \"['$UUID']\"
  [ '$SCHEME' = light ] && dconf write /org/gnome/desktop/interface/color-scheme \"'prefer-light'\" || dconf write /org/gnome/desktop/interface/color-scheme \"'prefer-dark'\"
  exec gnome-shell --devkit --wayland --no-x11 --wayland-display=wl-arcane-view
" _ "$LIVE"
