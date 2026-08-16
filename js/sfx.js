/* Tiny Web-Audio SFX helper — synthesized, no audio files needed.
   Usage: <script>window.SFX_CONFIG={hover:...,click:...}</script> then load sfx.js
   Sounds are gentle by design; the AudioContext only starts after a user gesture. */

(function () {
  var cfg = window.SFX_CONFIG || {};
  var HOVER = cfg.hover || { f: 1500, d: 0.02, t: "sine", v: 0.012 };
  var CLICK = cfg.click || { f: 640, d: 0.09, t: "triangle", v: 0.04 };
  var ctx = null;
  var lastHover = 0;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, when, slide) {
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function hover() {
    var now = Date.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    tone(HOVER.f, HOVER.d, HOVER.t, HOVER.v, 0);
  }

  function click() {
    tone(CLICK.f, CLICK.d, CLICK.t, CLICK.v, 0, CLICK.f * 1.35);
  }

  window.SFX = { hover: hover, click: click, tone: tone, resume: ensure };

  document.addEventListener("mouseover", function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.matches && t.matches("a, button, [data-sfx], .btn, .menubar a, .card")) { hover(); return; }
      t = t.parentNode;
    }
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.matches && t.matches("a, button, [data-sfx], .btn, .menubar a")) { click(); return; }
      t = t.parentNode;
    }
  });
})();
