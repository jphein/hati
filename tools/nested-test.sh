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
# own runtime dir too: gnome-shell keeps its crash-guard marker (gnome-shell-disable-extensions)
# and the Wayland socket there, and the live session must never see either
export XDG_RUNTIME_DIR=$T/run; mkdir -p -m 700 $T/run
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
OUT=${OUT:-$PWD/scratch/shots}; mkdir -p $OUT
dbus-run-session -- bash -c "
  dconf write /org/gnome/shell/disable-user-extensions false
  dconf write /org/gnome/shell/enabled-extensions \"[$EXTS]\"
  dconf write /org/gnome/shell/extensions/hati/enabled true
  SCHEME=${SCHEME:-dark}; [ \"\$SCHEME\" = light ] && dconf write /org/gnome/desktop/interface/color-scheme \"'prefer-light'\" || dconf write /org/gnome/desktop/interface/color-scheme \"'prefer-dark'\"
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
  if [ -n '${DEMO:-}' ]; then
    # demo: a virtual pointer draws a path, shakes, clicks all three buttons; screenshots mid-effect
    ev \"global._hatiFrames=0; 'reset'\" >/dev/null
    ev \"const GLib=imports.gi.GLib, C=imports.gi.Clutter; const d=C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.POINTER_DEVICE); global._hatiVd=d; let i=0; const pts=[]; for(let k=0;k<40;k++) pts.push([300+k*14, 400+Math.round(80*Math.sin(k/5))]); for(let k=0;k<10;k++) pts.push([860+(k%2?-60:60), 400]); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, ()=>{ if(i<pts.length){ d.notify_absolute_motion(GLib.get_monotonic_time(), pts[i][0], pts[i][1]); i++; return true;} const t=GLib.get_monotonic_time(); for (const b of [1,2,3]) {} return false; }); 'moving'\" >/dev/null
    sleep 0.55
    gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.Screenshot true false $OUT/trail-\$SCHEME.png >/dev/null 2>&1
    sleep 0.5
    ev \"const d=global._hatiVd, GLib=imports.gi.GLib; let b=0; const tap=()=>{ const t=GLib.get_monotonic_time(); d.notify_absolute_motion(t, 420+b*260, 620); d.notify_button(t, [1,2,3][b], 1); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, ()=>{ d.notify_button(GLib.get_monotonic_time(), [1,2,3][b], 0); b++; if(b<3) GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, ()=>{tap(); return false;}); return false; }); }; tap(); 'clicks'\" >/dev/null
    sleep 0.75
    gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.Screenshot true false $OUT/runes-\$SCHEME.png >/dev/null 2>&1
    echo \"$LABEL frames during demo: \$(ev 'global._hatiFrames' | tail -1)\"
    sleep 4; ev \"global._hatiFrames=0; 'reset'\" >/dev/null; a1=\$(awk '{print \$14+\$15}' /proc/\$SP/stat); sleep 10; a2=\$(awk '{print \$14+\$15}' /proc/\$SP/stat)
    echo \"$LABEL ticks/10s after demo (settled): \$((a2-a1))\"
    echo \"$LABEL frames/10s after demo (settled): \$(ev 'global._hatiFrames' | tail -1)\"
  fi
  if [ -n '${FEATURES:-}' ]; then
    E=\"Main.extensionManager.lookup('$UUID')?.stateObj\"
    ev \"\$E.getSettings ? 1 : 0\" >/dev/null
    ev \"const s=\$E._settings; s.set_string('realm-status-url','${REALM_URL:-http://familiar.lan/status}'); s.set_boolean('realm-pulse', true); 'on'\" >/dev/null
    sleep 14
    echo \"$LABEL realm tint: \$(ev \"JSON.stringify(\$E._realmTint)\" | tail -1)  pulse=\$(ev \"String(!!\$E._realmPulse) + ' timer=' + \$E._realmPulse?._timerId + ' session=' + !!\$E._realmPulse?._session + ' err=' + \$E._realmPulse?.lastError\" | tail -1)\"
    r1=\$(awk '{print \$14+\$15}' /proc/\$SP/stat); sleep 10; r2=\$(awk '{print \$14+\$15}' /proc/\$SP/stat)
    echo \"$LABEL idle ticks/10s with realm pulse on: \$((r2-r1))\"
    ev \"\$E._settings.set_boolean('realm-pulse', false); 'off'\" >/dev/null
    gdbus call --session --dest org.gnome.Shell.Screencast --object-path /org/gnome/Shell/Screencast --method org.gnome.Shell.Screencast.Screencast $T/cast.webm {} 2>&1 | tail -1 | cut -c1-160
    sleep 3
    echo \"$LABEL casting=\$(ev \"\$E._casting\" | tail -1) subtle=\$(ev \"\$E._arcane._subtle\" | tail -1)\"
    gdbus call --session --dest org.gnome.Shell.Screencast --object-path /org/gnome/Shell/Screencast --method org.gnome.Shell.Screencast.StopScreencast >/dev/null 2>&1
    sleep 2
    echo \"$LABEL after stop: casting=\$(ev \"\$E._casting\" | tail -1) subtle=\$(ev \"\$E._arcane._subtle\" | tail -1)\"
  fi
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
