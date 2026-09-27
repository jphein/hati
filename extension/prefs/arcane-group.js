// SPDX-License-Identifier: GPL-3.0-or-later
// Arcane Cursor (realm.watch) preferences: one switch per effect.
import Adw from "gi://Adw";
import Gio from "gi://Gio";

const ROWS = [
  ["arcane-trail", "Spell-mote trail", "Short-lived glowing motes behind a moving cursor. Nothing while it is still."],
  ["arcane-runes", "Rune ring on click", "A gold sigil circle per click: triangle (left), pentagram (middle), diamond (right)."],
  ["arcane-pulse", "Arcane pulse", "Shake the cursor to find it: three collapsing rings."],
  ["recording-subtle", "Subtle mode", "Fewer, fainter effects, for screen recording."],
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
