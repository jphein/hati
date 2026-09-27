// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from "gi://Clutter";
import Cogl from "gi://Cogl";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import Gio from "gi://Gio";
import Cairo from "gi://cairo";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { parseColor, hslToRgb } from "./utils.js";
import {
  buildDrawSettings,
  calculateCanvasSize,
} from "./modules/style-manager.js";
import { Physics } from "./modules/physics.js";
import { Glow } from "./modules/glow.js";
import { getAnimation } from "./animations/animations.js";
import { renderHighlight } from "./modules/highlight-renderer.js";
import { initShaders } from "./shaders/shaders.js";
import { Magnifier } from "./modules/magnifier.js";
import { AutoHide } from "./modules/auto-hide.js";
import Indicator from "./modules/indicator.js";
import { Spotlight } from "./modules/spotlight.js";

export default class HatiExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    this._containerActor = null;
    this._outerRing = null;
    this._innerRing = null;
    this._settings = null;
    this._settingsChangedId = null;
    this._indicator = null;
  }

  async enable() {
    console.log("[Hati] Enabling cursor highlighter...");

    await initShaders(this.path);

    this._settings = this.getSettings();
    this._interfaceSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });

    // watch for settings changes
    this._settingsChangedId = this._settings.connect(
      "changed",
      (settings, key) => {
        this._onSettingsChanged(key);
      },
    );

    // watch for system accent changes
    this._interfaceSettingsChangedId = this._interfaceSettings.connect(
      "changed::accent-color",
      () => {
        if (this._settings.get_boolean("use-system-accent")) {
          this._refreshStyle();
        }
      },
    );

    // indicator
    this._indicator = new Indicator(this.path, this._settings, () => {
      this.openPreferences();
    });
    Main.panel.addToStatusArea("hati", this._indicator);

    // only proceed if enabled
    if (!this._settings.get_boolean("enabled")) {
      return;
    }

    this._rgbEnabled = this._settings.get_boolean("rgb-enabled");
    this._rgbSpeed = this._settings.get_double("rgb-speed");

    this._createHighlightActor();

    console.log("[Hati] Enabled successfully");
  }

  disable() {
    console.log("[Hati] Disabling cursor highlighter...");

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._removeHighlightActor();

    // cleanup settings
    if (this._settings) {
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      this._settings = null;
    }

    if (this._interfaceSettings) {
      if (this._interfaceSettingsChangedId) {
        this._interfaceSettings.disconnect(this._interfaceSettingsChangedId);
        this._interfaceSettingsChangedId = null;
      }
      this._interfaceSettings = null;
    }

    console.log("[Hati] Disabled successfully");
  }

  _createHighlightActor() {
    if (this._outerRing) {
      return; // already created!
    }

    this._containerActor = new St.Widget({
      style_class: "hati-container",
      reactive: false,
      can_focus: false,
      layout_manager: new Clutter.BinLayout(),
    });

    this._canvas = new St.DrawingArea({
      style_class: "hati-canvas",
      reactive: false,
      can_focus: false,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._canvas.connect("repaint", (area) => {
      this._drawHighlight(area);
    });

    this._containerActor.add_child(this._canvas);

    this._highlightActor = this._canvas;
    this._outerRing = this._canvas;
    this._innerRing = null;

    this._physics = new Physics(this._settings);
    this._tickId = 0;
    this._timeline = null;
    this._watchId = 0;
    this._cursorTracker = null;
    this._cursorMovedId = 0;
    this._lastFrameUs = 0;

    this._glow = new Glow(this._settings);

    this._magnifier = new Magnifier(this._settings, this._physics);
    this._magnifier.init();

    // magnifier activation
    this._stageEventId = global.stage.connect(
      "captured-event",
      (actor, event) => {
        return this._onStageEvent(event);
      },
    );

    this._autoHide = new AutoHide(
      this._settings,
      this._highlightActor,
      this._containerActor,
    );

    this._spotlight = new Spotlight(this._settings);

    this._refreshStyle();

    global.stage.add_child(this._containerActor);

    this._startFrameLoop();
  }

  // hati-realm: event-driven updates instead of a perpetual 16 ms GLib tick.
  // The physics/animation step runs on the stage frame clock (a Clutter.Timeline bound to our
  // actor) only while something is moving, and stops as soon as the state settles. Upstream's
  // unconditional timeout moved the actor 60 times a second forever, so the compositor redrew the
  // stage even with the cursor still (katana, 2026-09-26: gnome-shell ~55% of a core at idle).
  // Wake sources: the cursor tracker's position-invalidated signal (pointer motion), plus a cheap
  // 100 ms low-priority watch of the pointer mask (buttons and the magnifier/spotlight modifier
  // keys, which are not delivered to the stage while a client window has focus). The watch only
  // reads state; it never draws.
  _startFrameLoop() {
    this._timeline = new Clutter.Timeline({
      actor: this._containerActor,
      duration: 1000,
      repeat_count: -1,
    });
    this._timeline.connect("new-frame", () => {
      if (!this._tick()) this._timeline.stop();
    });

    try {
      this._cursorTracker = global.backend.get_cursor_tracker();
      this._cursorMovedId = this._cursorTracker.connect(
        "position-invalidated",
        () => this._wake(),
      );
    } catch (e) {
      this._cursorTracker = null; // the watch below still wakes us
    }

    let [lx, ly, lm] = global.get_pointer();
    this._watchId = GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
      const [x, y, m] = global.get_pointer();
      if (x !== lx || y !== ly || m !== lm) {
        lx = x;
        ly = y;
        lm = m;
        this._wake();
      }
      return GLib.SOURCE_CONTINUE;
    });
    this._wake();
  }

  _wake() {
    if (this._timeline && !this._timeline.is_playing()) {
      this._lastFrameUs = GLib.get_monotonic_time();
      this._timeline.start();
    }
  }

  _stopFrameLoop() {
    if (this._timeline) {
      this._timeline.stop();
      this._timeline = null;
    }
    if (this._watchId) {
      GLib.source_remove(this._watchId);
      this._watchId = 0;
    }
    if (this._cursorTracker && this._cursorMovedId) {
      this._cursorTracker.disconnect(this._cursorMovedId);
    }
    this._cursorTracker = null;
    this._cursorMovedId = 0;
  }

  _updatePhysicsConstants() {
    if (this._physics) {
      this._physics.updateConstants();
    }
  }

  _removeHighlightActor() {
    if (this._containerActor) {
      if (this._tickId) {
        GLib.source_remove(this._tickId);
        this._tickId = 0;
      }
      this._stopFrameLoop();

      // disconnect stage event handler
      if (this._stageEventId) {
        global.stage.disconnect(this._stageEventId);
        this._stageEventId = null;
      }

      global.stage.remove_child(this._containerActor);
      this._containerActor.destroy();
      this._containerActor = null;

      if (this._magnifier) {
        this._magnifier.destroy();
        this._magnifier = null;
      }

      if (this._spotlight) {
        this._spotlight.destroy();
        this._spotlight = null;
      }

      if (this._autoHide) {
        this._autoHide = null;
      }

      if (this._glow) {
        this._glow = null;
      }

      if (this._physics) {
        this._physics = null;
      }

      this._canvas = null;
      this._highlightActor = null;
      this._outerRing = null;
      this._innerRing = null;
      this._clickState = null;
      this._drawSettings = null;
    }
  }

  // magnifier: key event handler
  _onStageEvent(event) {
    if (this._magnifier && this._magnifier.handleKeyEvent(event)) {
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  // One frame of physics and animation. Returns true while anything is still moving (the frame
  // loop keeps running), false once settled (the loop stops until the next wake).
  _tick() {
    if (!this._containerActor || !this._highlightActor) return false;

    const nowUs = GLib.get_monotonic_time();
    const deltaMs = Math.min(100, Math.max(1, (nowUs - this._lastFrameUs) / 1000));
    this._lastFrameUs = nowUs;

    const [pointerX, pointerY, mask] = global.get_pointer();
    const containerWidth = this._containerActor.get_width();
    const containerHeight = this._containerActor.get_height();

    if (this._magnifier) {
      this._magnifier.pollActivation(mask);
    }

    const [curX, curY] = this._physics.update(pointerX, pointerY);

    if (this._magnifier) {
      this._magnifier.update(curX, curY);
    }

    // detect button state from mask
    const leftPressed = (mask & Clutter.ModifierType.BUTTON1_MASK) !== 0;
    const rightPressed = (mask & Clutter.ModifierType.BUTTON3_MASK) !== 0;
    const anyPressed = leftPressed || rightPressed;

    if (this._autoHide) {
      this._autoHide.update(curX, curY, anyPressed, deltaMs);
    }

    if (this._spotlight) {
      this._spotlight.pollActivation(mask);
      this._spotlight.update(curX, curY);
    }

    if (!this._clickState) {
      this._clickState = {
        active: false,
        button: null, // 'left' / 'right'
        progress: 0.0, // 0.0 to 1.0
        closing: false, // true if releasing button
      };
    }

    // detect button state from mask
    const pressedButton = leftPressed ? "left" : rightPressed ? "right" : null;

    // react to state changes
    if (anyPressed && !this._clickState.active) {
      // START CLICK
      this._clickState.active = true;
      this._clickState.button = pressedButton;
      this._clickState.progress = 0.0;
      this._clickState.closing = false;
      this._canvas.queue_repaint();
    } else if (
      !anyPressed &&
      this._clickState.active &&
      !this._clickState.closing
    ) {
      // RELEASE CLICK
      this._clickState.closing = true;
    }

    // animate progress
    if (this._clickState.active) {
      const speed = 0.15;

      if (!this._clickState.closing) {
        if (this._clickState.progress < 1.0) {
          this._clickState.progress = Math.min(
            1.0,
            this._clickState.progress + speed,
          );
          this._canvas.queue_repaint();
        }
      } else {
        if (this._clickState.progress > 0.0) {
          this._clickState.progress = Math.max(
            0.0,
            this._clickState.progress - speed,
          );
          this._canvas.queue_repaint();
        } else {
          this._clickState.active = false;
          this._clickState.button = null;
        }
      }
    }

    const px = curX - containerWidth / 2;
    const py = curY - containerHeight / 2;
    if (px !== this._lastPx || py !== this._lastPy) {
      this._lastPx = px;
      this._lastPy = py;
      this._containerActor.set_position(px, py);
    }

    // hati-realm: an auto-hidden highlight is invisible (opacity 0), so cycling its hue is a
    // 60 Hz Cairo repaint nobody sees. On katana (rgb-enabled, size 200, glow 100) that was the
    // idle cost. Resume the cycle on the next wake, when auto-hide shows it again.
    const hidden = this._autoHide && this._autoHide.isHidden();
    const rgbLive =
      this._rgbEnabled && !hidden && this._drawSettings && this._drawSettings.color;
    if (rgbLive) {
      const now = GLib.get_monotonic_time() / 1000; // ms
      const speed = this._rgbSpeed || 2.0;
      const hue = (now * speed * 0.1) % 360;
      const rgb = hslToRgb(hue, 1.0, 0.5);

      this._drawSettings.color.red = rgb.red;
      this._drawSettings.color.green = rgb.green;
      this._drawSettings.color.blue = rgb.blue;
      this._drawSettings.color.alpha = 1.0;

      this._canvas.queue_repaint();
    }

    // settled: nothing left to animate until the next wake
    const moving =
      !this._physics.isSettled(pointerX, pointerY) ||
      this._clickState.active ||
      rgbLive ||
      (this._magnifier && this._magnifier.isActive()) ||
      (this._spotlight && this._spotlight.isActive()) ||
      (this._autoHide && this._autoHide.isPending());
    return !!moving;
  }

  _toggleHighlight() {
    if (this._settings.get_boolean("enabled")) {
      this._createHighlightActor();
    } else {
      this._removeHighlightActor();
    }
  }

  _onSettingsChanged(key) {
    if (key === "enabled") {
      this._toggleHighlight();
      return;
    }

    if (
      key === "inertia-stiffness" ||
      key === "inertia-smoothness" ||
      key === "inertia-enabled"
    ) {
      this._updatePhysicsConstants();
      return;
    }

    if (key === "glow" || key === "glow-radius" || key === "glow-spread") {
      if (this._glow) {
        this._glow.updateConstants();
      }
    }

    if (key === "rgb-enabled") {
      this._rgbEnabled = this._settings.get_boolean("rgb-enabled");
    }
    if (key === "rgb-speed") {
      this._rgbSpeed = this._settings.get_double("rgb-speed");
    }

    this._refreshStyle();
    this._wake();
  }

  _refreshStyle() {
    if (!this._highlightActor || !this._containerActor) return;

    this._drawSettings = buildDrawSettings({
      settings: this._settings,
      interfaceSettings: this._interfaceSettings,
      glow: this._glow,
    });

    const totalSize = calculateCanvasSize(this._drawSettings.size, this._glow);

    this._containerActor.set_size(totalSize, totalSize);
    this._canvas.set_size(totalSize, totalSize);
    this._canvas.queue_repaint();

    this._containerActor.set_opacity(255);
  }

  _drawHighlight(area) {
    renderHighlight(area, {
      drawSettings: this._drawSettings,
      clickState: this._clickState,
      glow: this._glow,
      settings: this._settings,
    });
  }
}
