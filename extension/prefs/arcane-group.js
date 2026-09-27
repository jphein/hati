// SPDX-License-Identifier: GPL-3.0-or-later
// Arcane Cursor (realm.watch) preferences: one switch per effect.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

const ROWS = [
  ["arcane-trail", "Spell-mote trail", "Short-lived glowing motes behind a moving cursor. Nothing while it is still."],
  ["arcane-runes", "Rune ring on click", "A gold sigil circle per click: triangle (left), pentagram (middle), diamond (right)."],
  ["arcane-pulse", "Arcane pulse", "Shake the cursor to find it: three collapsing rings."],
  ["recording-subtle", "Subtle mode", "Fewer, fainter effects, for screen recording. Toggle: Super+Alt+C."],
  ["recording-auto-subtle", "Subtle while recording", "Automatically subtle while the screen is being cast or recorded (OBS, portals)."],
  ["realm-pulse", "Realm pulse", "Tint the aura from realm health (mysticlight / realmwatch). Off unless enabled; silent when unreachable."],
];

export function buildArcaneGroup(settings) {
  const group = new Adw.PreferencesGroup({
    title: "Arcane (realm.watch)",
    description: "Old gold, deep violet, ember and moonlight silver; follows the system light/dark style.",
  });
  for (const [key, title, subtitle] of ROWS) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
  }
  const url = new Adw.EntryRow({ title: "Realm status URL (polled at most every 30 s)" });
  settings.bind("realm-status-url", url, "text", Gio.SettingsBindFlags.DEFAULT);
  group.add(url);
  return group;
}

// The realm.watch header: the sigil in old gold, the name, and an About row linking realm.watch.
export function buildRealmHeader(metadata) {
  const group = new Adw.PreferencesGroup();
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 6, margin_bottom: 12 });
  const sigil = new Gtk.Label({ use_markup: true, label: '<span size="xx-large" foreground="#c5a55a">✦ ◬ ✦</span>' });
  const title = new Gtk.Label({ use_markup: true, label: '<span size="x-large" weight="bold" foreground="#c5a55a">Arcane Cursor</span>' });
  const sub = new Gtk.Label({ label: "a realm.watch cursor · spell-motes, runes and the arcane pulse", css_classes: ["dim-label"] });
  box.append(sigil);
  box.append(title);
  box.append(sub);
  group.add(box);
  const about = new Adw.ActionRow({
    title: "About",
    subtitle: `realm.watch · version ${metadata?.version ?? "?"} · fork of Hati by szymonwilczek (GPL-3.0)`,
    activatable: true,
  });
  about.add_suffix(new Gtk.Image({ icon_name: "adw-external-link-symbolic" }));
  about.connect("activated", () => new Gtk.UriLauncher({ uri: "https://realm.watch" }).launch(null, null, null));
  group.add(about);
  return group;
}
