#!/usr/bin/env bash
# Measure an extension build in a HEADLESS gnome-shell on its own session bus, with throwaway
# XDG_CONFIG_HOME / XDG_DATA_HOME, so the live session (its dconf, extensions, windows) is never
# touched and nothing appears on screen.
#
#   [AUTOHIDE=false] tools/nested-test.sh <extension-dir> <uuid> <label> [rgb]
#
# Prints: idle CPU of the nested gnome-shell over 10 s (ticks = % of one core), and the count of
# "already disposed" errors after a window is opened and closed while the magnifier is forced on.
# A baseline with no extension: tools/nested-test.sh none none baseline
set -u
EXT=$1 UUID=$2 LABEL=$3 RGB=${4:-}
T=$(mktemp -d /var/tmp/hati-nested.XXXXXX)
trap 'rm -rf "$T"' EXIT
export XDG_CONFIG_HOME=$T/config XDG_DATA_HOME=$T/data XDG_CACHE_HOME=$T/cache XDG_STATE_HOME=$T/state
mkdir -p $XDG_CONFIG_HOME $XDG_CACHE_HOME $XDG_STATE_HOME $XDG_DATA_HOME/gnome-shell/extensions
EXTS="'unsafe@hati-test'"
# helper: turns on unsafe mode so org.gnome.Shell.Eval works on the nested bus (test only)
H=$XDG_DATA_HOME/gnome-shell/extensions/unsafe@hati-test; mkdir -p $H
cat > $H/metadata.json <<J
{"uuid":"unsafe@hati-test","name":"unsafe (test)","description":"test","shell-version":["50"]}
J
cat > $H/extension.js <<J
export default class { enable() { global.context.unsafe_mode = true; } disable() {} }
J
if [ "$EXT" != none ]; then
  cp -r "$EXT" $XDG_DATA_HOME/gnome-shell/extensions/$UUID
  glib-compile-schemas $XDG_DATA_HOME/gnome-shell/extensions/$UUID/schemas/
  EXTS="$EXTS, '$UUID'"
fi
LOG=$T/shell.log
dbus-run-session -- bash -c "
  dconf write /org/gnome/shell/disable-user-extensions false
  dconf write /org/gnome/shell/enabled-extensions \"[$EXTS]\"
  dconf write /org/gnome/shell/extensions/hati/enabled true
  [ -n '$RGB' ] && dconf write /org/gnome/shell/extensions/hati/rgb-enabled true
  [ -n '${AUTOHIDE:-}' ] && dconf write /org/gnome/shell/extensions/hati/auto-hide ${AUTOHIDE:-true}
  gnome-shell --headless --virtual-monitor 1280x800 --wayland --no-x11 --wayland-display=wl-hati-test >$LOG 2>&1 &
  SP=\$!; echo \$SP > $T/pid
  sleep 12
  ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \"\$1\" 2>&1; }
  echo \"loaded: \$(ev \"Main.extensionManager.lookup('$UUID')?.state ?? 'none'\")\"
  ev \"global._hatiFrames=0; global.stage.connect('after-paint',()=>global._hatiFrames++); 'counting'\" >/dev/null
  t1=\$(awk '{print \$14+\$15}' /proc/\$SP/stat); sleep 10; t2=\$(awk '{print \$14+\$15}' /proc/\$SP/stat)
  echo \"$LABEL idle ticks/10s: \$((t2-t1))\"
  echo \"$LABEL idle frames/10s: \$(ev 'global._hatiFrames' | tail -1)\"
  # disposed-actor check: force the magnifier on, open a window, close it
  ev \"let e=Main.extensionManager.lookup('$UUID')?.stateObj; if(e&&e._magnifier){e._magnifier.pollActivation=()=>{}; e._magnifier.activate(); if(e._wake) e._wake(); 'mag on'} else 'no magnifier'\" | tail -1
  WAYLAND_DISPLAY=wl-hati-test GDK_BACKEND=wayland zenity --info --text=hati-test >/dev/null 2>&1 & Z=\$!
  sleep 3; echo \"windows while open: \$(ev 'global.display.list_all_windows().length' | tail -1)\"; kill \$Z; sleep 2
  WAYLAND_DISPLAY=wl-hati-test GDK_BACKEND=wayland zenity --info --text=hati-test2 >/dev/null 2>&1 & Z=\$!
  sleep 3; kill \$Z; sleep 2
  echo \"windows seen: \$(ev 'global.display.list_all_windows().length' | tail -1)\"
  echo \"$LABEL disposed errors: \$(grep -c 'already disposed' $LOG)\"
  kill \$SP; wait \$SP 2>/dev/null
"
grep -iE "hati.*(error|exception)|JS ERROR" $LOG | head -5
