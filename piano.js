/**
 * Piano Interactive Module
 * Школа классического вокала Екатерины Заремба
 */
(function(){
  'use strict';

  function initPiano() {
    var section = document.getElementById('pianoSection');
    var wrap = document.getElementById('pianoWrap');
    var frame = document.getElementById('pianoFrame');
    var stage = document.getElementById('pianoStage');
    var piano = document.getElementById('piano');
    var fx = document.getElementById('pianoFx');
    var sp = document.getElementById('pianoSparks');
    var haze = document.getElementById('pianoHaze');
    var hintEl = document.getElementById('pianoHint');

    if (!section || !wrap || !frame || !stage || !piano) return;

    /* ---------- scale to fit container ---------- */
    var S = 1;
    function fit() {
      var H = wrap.clientHeight || 768;
      S = H / 768;
      var containerW = wrap.clientWidth || 1366;
      var fw = Math.min(containerW, 1080 * S);
      frame.style.width = fw + 'px';
      stage.style.left = (fw - 1080 * S) + 'px';
      stage.style.transform = 'scale(' + S + ')';
    }
    window.addEventListener('resize', fit);
    fit();

    /* ---------- Web Audio synthesis ---------- */
    var ctx = null, bus = null;

    function impulse(c, sec, decay) {
      var rate = c.sampleRate, len = rate * sec, b = c.createBuffer(2, len, rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = b.getChannelData(ch);
        for (var i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      return b;
    }

    function initAudio() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      var master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(ctx.destination);
      bus = ctx.createGain();
      bus.connect(master);

      // Reverb convolver
      var conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 3, 2.4);
      var wet = ctx.createGain();
      wet.gain.value = 0.55;
      bus.connect(conv);
      conv.connect(wet);
      wet.connect(master);

      // Soft echo delay
      var dl = ctx.createDelay(1);
      dl.delayTime.value = 0.33;
      var fb = ctx.createGain();
      fb.gain.value = 0.32;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      var eg = ctx.createGain();
      eg.gain.value = 0.28;
      bus.connect(dl);
      dl.connect(lp);
      lp.connect(fb);
      fb.connect(dl);
      lp.connect(eg);
      eg.connect(master);
      eg.connect(conv);

      ctx.onstatechange = function() {
        if (ctx.state === 'running' && hintEl) hintEl.classList.add('hide');
      };
    }

    function unlock() {
      initAudio();
      if (ctx && ctx.state !== 'running') {
        ctx.resume().then(function() {
          if (hintEl) hintEl.classList.add('hide');
        }).catch(function(){});
      } else if (ctx && hintEl) {
        hintEl.classList.add('hide');
      }
    }
    var unlocked = false;
    function unlockOnce() {
      if (unlocked) return;
      unlocked = true;
      unlock();
      ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function(ev) {
        window.removeEventListener(ev, unlockOnce);
      });
    }
    ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function(ev) {
      window.addEventListener(ev, unlockOnce, { passive: true });
    });

    function voice(freq, vel, pan) {
      var t = ctx.currentTime;
      var out = ctx.createGain();
      out.gain.value = 1;
      var pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pn) {
        pn.pan.value = pan;
        out.connect(pn);
        pn.connect(bus);
      } else {
        out.connect(bus);
      }
      function osc(type, mult, gain, dec, det) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq * mult;
        if (det) o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain * vel, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + dec + 0.1);
      }
      osc('sine', 1, 0.34, 2.6, 0);
      osc('triangle', 1, 0.16, 1.6, 4);
      osc('sine', 2, 0.14, 1.3, 0);
      osc('sine', 3, 0.05, 0.8, 0);
      osc('sine', 4, 0.035, 0.45, 0);
      osc('sine', 6, 0.012, 0.25, 0);
    }

    function play(freq, vel, pan) {
      if (!ctx || ctx.state !== 'running') return;
      voice(freq, vel, pan);
    }

    /* ---------- Piano keys generation ---------- */
    var keys = [];

    var WHITE_KEYS = [
      { top: 60,  left: 860, op: 0.16 },
      { top: 98,  left: 855, op: 0.42 },
      { top: 136, left: 850, op: 0.68 },
      { top: 174, left: 840, op: 0.86 },
      { top: 212, left: 825, op: 0.96 },
      { top: 250, left: 805, op: 1.00 },
      { top: 288, left: 785, op: 1.00 },
      { top: 326, left: 765, op: 1.00 },
      { top: 364, left: 745, op: 1.00 },
      { top: 402, left: 725, op: 1.00 },
      { top: 440, left: 710, op: 1.00 },
      { top: 478, left: 698, op: 1.00 },
      { top: 516, left: 692, op: 1.00 },
      { top: 554, left: 690, op: 1.00 },
      { top: 592, left: 695, op: 0.94 },
      { top: 630, left: 710, op: 0.78 },
      { top: 668, left: 735, op: 0.54 },
      { top: 706, left: 770, op: 0.30 },
      { top: 744, left: 815, op: 0.12 }
    ];

    var BLACK_KEYS = [
      { top: 125, left: 940, op: 0.45 },
      { top: 163, left: 938, op: 0.75 },
      { top: 239, left: 932, op: 0.96 },
      { top: 277, left: 926, op: 1.00 },
      { top: 315, left: 920, op: 1.00 },
      { top: 429, left: 916, op: 1.00 },
      { top: 467, left: 912, op: 1.00 },
      { top: 543, left: 910, op: 1.00 },
      { top: 581, left: 910, op: 0.96 },
      { top: 619, left: 914, op: 0.85 },
      { top: 695, left: 925, op: 0.45 },
      { top: 733, left: 940, op: 0.15 }
    ];

    WHITE_KEYS.forEach(function(item){
      var w = document.createElement('div');
      w.className = 'wk';
      w.style.top = item.top + 'px';
      w.style.left = item.left + 'px';
      w.style.width = (1100 - item.left) + 'px';
      if (item.op < 1) w.style.opacity = item.op;
      piano.appendChild(w);
      keys.push({ el: w, y: item.top + 17.5, type: 'white' });
    });

    BLACK_KEYS.forEach(function(item){
      var b = document.createElement('div');
      b.className = 'bk';
      b.style.top = item.top + 'px';
      b.style.left = item.left + 'px';
      b.style.width = (1100 - item.left) + 'px';
      if (item.op < 1) b.style.opacity = item.op;
      piano.appendChild(b);
      keys.push({ el: b, y: item.top + 11, type: 'black' });
    });

    var order = keys.slice().sort(function(a, b){ return b.y - a.y; });
    var SC = [0, 2, 4, 5, 7, 9, 11], START = 4;
    order.forEach(function(k, idx){
      var n = START + idx, midi = 36 + SC[n % 7] + 12 * Math.floor(n / 7);
      k.freq = 440 * Math.pow(2, (midi - 69) / 12);
      k.pan = Math.max(-0.5, Math.min(0.5, (k.y / 768 - 0.5) * 0.6));
    });

    function burst(cx, cy){
      if (!fx) return;
      var glyphs = ['♪', '♫', '✦', '✧', '·'];
      var cnt = 3 + Math.floor(Math.random() * 3);
      for (var i = 0; i < cnt; i++){
        var e = document.createElement('i');
        e.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
        e.style.left = (cx + (Math.random() * 30 - 10)) + 'px';
        e.style.top = (cy + (Math.random() * 16 - 8)) + 'px';
        e.style.fontSize = (12 + Math.random() * 12) + 'px';
        e.style.setProperty('--dx', (Math.random() * 60 - 10) + 'px');
        e.style.setProperty('--dy', -(40 + Math.random() * 60) + 'px');
        e.style.setProperty('--r', (Math.random() * 50 - 25) + 'deg');
        fx.appendChild(e);
        setTimeout(function(el){ return function(){ el.remove(); }; }(e), 1800);
      }
    }

    function trigger(k, ev){
      var now = performance.now();
      if (k.last && now - k.last < 90) return;
      k.last = now;
      if (ctx && ctx.state === 'suspended') ctx.resume();
      play(k.freq, k.el.classList.contains('bk') ? 0.8 : 1, k.pan);
      k.el.classList.add('on');
      clearTimeout(k.t);
      k.t = setTimeout(function(){ k.el.classList.remove('on'); }, 320);
      var sr = stage.getBoundingClientRect();
      burst((ev.clientX - sr.left) / S, (ev.clientY - sr.top) / S);
    }

    keys.forEach(function(k){
      k.el.addEventListener('pointerenter', function(e){ trigger(k, e); });
      k.el.addEventListener('pointerdown', function(e){ trigger(k, e); });
    });

    var lastEl = null;
    piano.addEventListener('touchmove', function(e){
      var t = e.touches[0];
      var el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el !== lastEl){
        lastEl = el;
        keys.forEach(function(k){ if (k.el === el) trigger(k, t); });
      }
      e.preventDefault();
    }, { passive: false });
    piano.addEventListener('touchend', function(){ lastEl = null; });

    /* ---------- Magic sparkles ---------- */
    if (sp) {
      for (var s = 0; s < 46; s++){
        var d = document.createElement('div');
        d.className = 'spark';
        var size = 2 + Math.random() * 4.5;
        d.style.setProperty('--s', size + 'px');
        d.style.left = (600 + Math.random() * 470) + 'px';
        d.style.top = (60 + Math.random() * 690) + 'px';
        d.style.setProperty('--d', (3.5 + Math.random() * 5) + 's');
        d.style.setProperty('--dl', (-Math.random() * 8) + 's');
        d.style.setProperty('--dx', (Math.random() * 50 - 25) + 'px');
        d.style.setProperty('--dy', (-20 - Math.random() * 50) + 'px');
        sp.appendChild(d);
      }
    }

    /* ---------- Gentle parallax on haze ---------- */
    if (haze) {
      stage.addEventListener('pointermove', function(e){
        var r = stage.getBoundingClientRect();
        var x = ((e.clientX - r.left) / r.width - 0.5);
        var y = ((e.clientY - r.top) / r.height - 0.5);
        haze.style.transform = 'translate(' + (-x * 18) + 'px,' + (-y * 14) + 'px)';
      });
      stage.addEventListener('pointerleave', function(){
        haze.style.transform = '';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPiano);
  } else {
    initPiano();
  }
})();
