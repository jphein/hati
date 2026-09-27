// SPDX-License-Identifier: GPL-3.0-or-later
// Arcane Cursor (realm.watch): the fantasy layer on top of the aura (from Hati).
//   - spell-mote trail: short-lived motes behind a MOVING cursor (none while still), pooled, capped
//   - rune ring: a thin sigil circle per click; left, middle and right draw distinct glyphs
//   - arcane pulse: "find my cursor" rings on a shake
// Everything is event-driven: emission happens only inside the frame tick (which runs only
// while something moves), and each effect is a Clutter ease that ends and stops asking for frames.
// Nothing here polls or keeps a timer alive when the cursor is still.

import Clutter from "gi://Clutter";
import St from "gi://St";

// realm.watch palette. Dark: on dark panels and windows. Light: deeper tones that still read on white.
export const PALETTE = {
  dark: { gold: [197, 165, 90], violet: [124, 92, 196], ember: [232, 118, 58], silver: [206, 212, 222] },
  light: { gold: [150, 118, 40], violet: [84, 52, 150], ember: [196, 82, 28], silver: [104, 110, 122] },
};

const MOTE_CAP = 24; // pooled; never more than this on screen
const MOTE_LIFE = 380; // ms, fades within ~400 ms
const MOTE_STEP = 9; // px of travel between motes
const RUNE_LIFE = 520;
const PULSE_LIFE = 750;
const SHAKE_REVERSALS = 4; // x-direction reversals…
const SHAKE_WINDOW = 700; // …within this many ms…
const SHAKE_MIN_DX = 10; // …each at least this fast (px per frame)
const SHAKE_COOLDOWN = 1500;

const BTN = [
  [Clutter.ModifierType.BUTTON1_MASK, "left"],
  [Clutter.ModifierType.BUTTON2_MASK, "middle"],
  [Clutter.ModifierType.BUTTON3_MASK, "right"],
];

const css = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

export class Arcane {
  constructor(settings, interfaceSettings) {
    this._settings = settings;
    this._iface = interfaceSettings;
    this._layer = new Clutter.Actor({ reactive: false });
    global.stage.add_child(this._layer);
    this._pool = [];
    this._next = 0;
    this._lastEmit = null;
    this._prevMask = 0;
    this._lastX = null;
    this._dir = 0;
    this._reversals = [];
    this._lastShake = 0;
    this._tint = null; // realm pulse override colour, or null
    this._subtle = false; // recording mode: fewer, fainter effects
  }

  palette() {
    let dark = true;
    try {
      dark = this._iface.get_string("color-scheme") !== "prefer-light";
    } catch (e) {
      // older schema without color-scheme: dark
    }
    return dark ? PALETTE.dark : PALETTE.light;
  }

  setTint(rgb) {
    this._tint = rgb;
  }

  setSubtle(on) {
    this._subtle = !!on;
  }

  _on(key) {
    try {
      return this._settings.get_boolean(key);
    } catch (e) {
      return false;
    }
  }

  _raise() {
    global.stage.set_child_above_sibling(this._layer, null);
  }

  // Called from the frame tick only (so only while something moves).
  update(x, y, mask, nowMs) {
    // clicks: one rune per press edge, per button
    for (const [bit, name] of BTN) {
      if (mask & bit && !(this._prevMask & bit) && this._on("arcane-runes")) this._rune(x, y, name);
    }
    this._prevMask = mask;

    // trail: motes only for real travel
    if (this._on("arcane-trail")) {
      if (!this._lastEmit) this._lastEmit = [x, y];
      const dx = x - this._lastEmit[0];
      const dy = y - this._lastEmit[1];
      const step = this._subtle ? MOTE_STEP * 2 : MOTE_STEP;
      if (dx * dx + dy * dy >= step * step) {
        this._mote(x, y);
        this._lastEmit = [x, y];
      }
    }

    // shake: rapid x reversals → the arcane pulse
    if (this._lastX !== null && this._on("arcane-pulse")) {
      const dx = x - this._lastX;
      if (Math.abs(dx) >= SHAKE_MIN_DX) {
        const d = Math.sign(dx);
        if (this._dir && d !== this._dir) {
          this._reversals.push(nowMs);
          this._reversals = this._reversals.filter((t) => nowMs - t <= SHAKE_WINDOW);
          if (this._reversals.length >= SHAKE_REVERSALS && nowMs - this._lastShake > SHAKE_COOLDOWN) {
            this._lastShake = nowMs;
            this._reversals = [];
            this.pulse(x, y);
          }
        }
        this._dir = d;
      }
    }
    this._lastX = x;
  }

  _mote(x, y) {
    let m = this._pool[this._next];
    if (!m) {
      if (this._pool.length >= MOTE_CAP) return;
      m = new St.Widget({ reactive: false, can_focus: false });
      this._layer.add_child(m);
      this._pool.push(m);
    }
    this._next = (this._next + 1) % MOTE_CAP;
    const p = this.palette();
    const color = this._tint || (Math.random() < 0.3 ? p.violet : p.gold);
    const s = 6 + Math.round(Math.random() * 5);
    m.remove_all_transitions();
    m.set_style(`background-color: ${css(color, 0.9)}; border-radius: ${s}px; box-shadow: 0 0 ${2 * s}px ${css(color, 0.7)};`);
    m.set_size(s, s);
    m.set_pivot_point(0.5, 0.5);
    m.set_position(x - s / 2 + (Math.random() - 0.5) * 6, y - s / 2 + (Math.random() - 0.5) * 6);
    m.opacity = this._subtle ? 120 : 230;
    m.set_scale(1, 1);
    m.show();
    this._raise();
    m.ease({
      opacity: 0,
      scale_x: 0.3,
      scale_y: 0.3,
      translation_y: -6,
      duration: MOTE_LIFE,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        m.hide();
        m.translation_y = 0;
      },
    });
  }

  // A thin gold sigil circle with a glyph per button: left = triangle, middle = star, right = diamond.
  _rune(x, y, button) {
    const size = 130;
    const p = this.palette();
    const gold = this._tint || p.gold;
    const glyph = button === "right" ? p.ember : button === "middle" ? p.silver : p.violet;
    const area = new St.DrawingArea({ reactive: false, width: size, height: size });
    area.connect("repaint", (a) => {
      const cr = a.get_context();
      const c = size / 2;
      cr.setLineWidth(2.4);
      cr.setSourceRGBA(gold[0] / 255, gold[1] / 255, gold[2] / 255, 0.95);
      cr.arc(c, c, c - 3, 0, 2 * Math.PI);
      cr.stroke();
      cr.setLineWidth(1);
      cr.arc(c, c, c - 9, 0, 2 * Math.PI);
      cr.stroke();
      // tick marks: the sigil's runes
      for (let i = 0; i < 12; i++) {
        const t = (i / 12) * 2 * Math.PI;
        cr.moveTo(c + Math.cos(t) * (c - 9), c + Math.sin(t) * (c - 9));
        cr.lineTo(c + Math.cos(t) * (c - 4), c + Math.sin(t) * (c - 4));
      }
      cr.stroke();
      cr.setSourceRGBA(glyph[0] / 255, glyph[1] / 255, glyph[2] / 255, 0.95);
      cr.setLineWidth(2.6);
      const r = c * 0.42;
      const n = button === "right" ? 4 : button === "middle" ? 5 : 3;
      const skip = button === "middle" ? 2 : 1; // a pentagram for the middle button
      for (let i = 0; i <= n; i++) {
        const t = -Math.PI / 2 + ((i * skip) / n) * 2 * Math.PI;
        const px = c + Math.cos(t) * r;
        const py = c + Math.sin(t) * r;
        if (i === 0) cr.moveTo(px, py);
        else cr.lineTo(px, py);
      }
      cr.stroke();
      cr.$dispose();
    });
    this._layer.add_child(area);
    area.set_pivot_point(0.5, 0.5);
    area.set_position(x - size / 2, y - size / 2);
    area.set_scale(0.35, 0.35);
    area.opacity = this._subtle ? 140 : 255;
    this._raise();
    area.ease({
      scale_x: 1.25,
      scale_y: 1.25,
      opacity: 0,
      rotation_angle_z: 40,
      duration: RUNE_LIFE,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => area.destroy(),
    });
  }

  // "Find my cursor": three rings, violet and gold, collapsing onto the cursor.
  pulse(x, y) {
    const p = this.palette();
    const colors = [p.violet, this._tint || p.gold, p.silver];
    colors.forEach((col, i) => {
      const size = 260 - i * 60;
      const ring = new St.Widget({ reactive: false, width: size, height: size });
      ring.set_style(`border: 3px solid ${css(col, 0.9)}; border-radius: ${size / 2}px; box-shadow: 0 0 18px ${css(col, 0.6)};`);
      this._layer.add_child(ring);
      ring.set_pivot_point(0.5, 0.5);
      ring.set_position(x - size / 2, y - size / 2);
      ring.set_scale(1.4, 1.4);
      ring.opacity = 0;
      this._raise();
      ring.ease({
        scale_x: 0.25,
        scale_y: 0.25,
        opacity: 255,
        duration: PULSE_LIFE * 0.6,
        delay: i * 90,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () =>
          ring.ease({ opacity: 0, duration: PULSE_LIFE * 0.4, onComplete: () => ring.destroy() }),
      });
    });
  }

  destroy() {
    if (this._layer) {
      this._layer.destroy(); // children (pool, runes, rings) go with it
      this._layer = null;
    }
    this._pool = [];
  }
}
