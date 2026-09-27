// SPDX-License-Identifier: GPL-3.0-or-later
// Realm pulse (opt-in, default off): tint the cursor from realm health.
// Polls realmwatch /status over HTTP, asynchronously (Soup), at most every 30 s, only while the
// `realm-pulse` setting is on. Any failure (unreachable, timeout, bad JSON) clears the tint and
// stays silent: the compositor is never blocked and nothing is logged per poll.
// mysticlightd's `mysticlight/health/state` topic was the other option; GJS has no async MQTT
// client, so HTTP is the source here.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";

const POLL_S = 30;
const GREEN = [96, 190, 118];
const EMBER = [232, 118, 58];
const RED = [214, 52, 52];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// pressure 0→1: green → ember → red
export function pressureColor(p) {
  const x = Math.max(0, Math.min(1, p));
  return x < 0.5 ? mix(GREEN, EMBER, x / 0.5) : mix(EMBER, RED, (x - 0.5) / 0.5);
}

// realmwatch /status → pressure 0..1: the worst of forge (CPU) and mana (memory) load, and the
// share of astral nodes that are down. Missing parts count as healthy.
export function pressureOf(status) {
  const parts = [];
  if (status?.forge?.usage != null) parts.push(status.forge.usage / 100);
  if (status?.mana?.usage != null) parts.push(status.mana.usage / 100);
  const nodes = status?.astral?.nodes;
  if (nodes && typeof nodes === "object") {
    const v = Object.values(nodes);
    if (v.length) parts.push(v.filter((up) => !up).length / v.length);
  }
  return parts.length ? Math.max(...parts) : null;
}

export class RealmPulse {
  constructor(settings, onTint) {
    this._settings = settings;
    this._onTint = onTint;
    this._session = null;
    this._cancel = null;
    this._timerId = 0;
    this._sigs = [
      settings.connect("changed::realm-pulse", () => this._sync()),
      settings.connect("changed::realm-status-url", () => this._sync()),
    ];
    this._sync();
  }

  _sync() {
    this._stop();
    if (!this._settings.get_boolean("realm-pulse")) {
      this._onTint(null);
      return;
    }
    this._session = new Soup.Session({ timeout: 20 }) // realmwatch /status can take ~10 s on a cache miss; async, so nothing waits;
    this._poll();
    this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, POLL_S, () => {
      this._poll();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _poll() {
    if (!this._session) return;
    let msg;
    try {
      msg = Soup.Message.new("GET", this._settings.get_string("realm-status-url"));
    } catch (e) {
      msg = null;
    }
    if (!msg) {
      this._onTint(null);
      return;
    }
    this._cancel?.cancel();
    this._cancel = new Gio.Cancellable();
    this._session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancel, (s, res) => {
      try {
        const bytes = s.send_and_read_finish(res);
        if (msg.get_status() !== 200) throw new Error("status");
        const text = new TextDecoder().decode(bytes.get_data());
        const p = pressureOf(JSON.parse(text));
        this._onTint(p == null ? null : pressureColor(p));
      } catch (e) {
        this.lastError = String(e); // for tests; never logged
        this._onTint(null); // silently off when the realm is unreachable
      }
    });
  }

  _stop() {
    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = 0;
    }
    this._cancel?.cancel();
    this._cancel = null;
    this._session?.abort();
    this._session = null;
  }

  destroy() {
    this._stop();
    for (const id of this._sigs) this._settings.disconnect(id);
    this._sigs = [];
  }
}
