/**
 * Voice Test Interactive Module
 * Школа классического вокала Екатерины Заремба
 */
(function () {
  'use strict';

  var root = document.getElementById('voiceTest');
  if (!root) return;

  var $ = function (id) { return document.getElementById(id); };

  /* ═════════════ МЕЛОДИЯ ═════════════ */
  var MELODY = [
    { midi: 60, syl: 'Слы-',  note: 'до',   dur: 1.2 },
    { midi: 62, syl: 'шишь',  note: 'ре',   dur: 1.2 },
    { midi: 64, syl: 'му-',   note: 'ми',   dur: 1.2 },
    { midi: 65, syl: 'зы-',   note: 'фа',   dur: 1.2 },
    { midi: 67, syl: 'ка',    note: 'соль', dur: 1.6 },
    { midi: 65, syl: 'ти-',   note: 'фа',   dur: 0.8 },
    { midi: 64, syl: 'хо',    note: 'ми',   dur: 1.2 },
    { midi: 62, syl: 'зву-',  note: 'ре',   dur: 1.2 },
    { midi: 60, syl: 'чит…',  note: 'до',   dur: 2.0 }
  ];
  var LEAD = 1.0;      // тишина перед первой нотой
  var GAP = 0.15;      // пауза между нотами
  var ONSET = 0.35;    // первые доли секунды ноты не оцениваем: голосу нужно время, чтобы найти высоту
  var BEAT = 0.9;      // длина одного счёта «3-2-1»

  var WINDOWS = (function () {
    var t = LEAD;
    return MELODY.map(function (n) {
      var w = { start: t, end: t + n.dur, midi: n.midi, syl: n.syl, note: n.note };
      t += n.dur + GAP;
      return w;
    });
  })();
  var TOTAL = WINDOWS[WINDOWS.length - 1].end + 0.6;

  function winAt(t, pad) {
    pad = pad || 0;
    for (var i = 0; i < WINDOWS.length; i++) {
      if (t >= WINDOWS[i].start - pad && t < WINDOWS[i].end + pad) return i;
    }
    return -1;
  }

  /* ═════════════ DOM ═════════════ */
  var canvas = $('vtCanvas'), ctx = canvas.getContext('2d');
  var stage = $('vtStage'), fxLayer = $('vtFx');
  var lyr = $('vtLyr'), statusEl = $('vtStatus');
  var btnListen = $('vtListen'), btnStart = $('vtStart'), btnStop = $('vtStop'), btnReset = $('vtReset'), btnEnroll = $('vtEnroll');
  var guideChk = $('vtGuide');
  var tune = $('vtTune'), tNote = $('vtNote'), tNeedle = $('vtNeedle'), tCents = $('vtCents');
  var countEl = $('vtCount'), digitEl = $('vtDigit');
  var resEl = $('vtRes');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ═════════════ СОСТОЯНИЕ ═════════════ */
  var state = 'idle';           // idle | listen | count | rec | done
  var listened = false;
  var samples = [];             // { t, m } — m: сглаженная высота (MIDI) или null
  var octCounts = [0, 0, 0, 0, 0, 0, 0]; // на сколько октав голос отличается от мелодии (-3…+3)
  var shift = 0;                // текущая октавная поправка
  var raf = 0, ac = null, outBus = null, session = null;
  var mic = null, micSrc = null, analyser = null, tbuf = null;
  var lastVoice = { t: -9, m: null };
  var lastResult = null;
  var burstDone = [], streak = [];

  /* ═════════════ ЗВУК ═════════════ */
  function impulse(c, sec, decay) {
    var rate = c.sampleRate, len = Math.floor(rate * sec), b = c.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function ensureAudio() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      var comp = ac.createDynamicsCompressor();
      comp.connect(ac.destination);
      outBus = ac.createGain(); outBus.gain.value = 0.9; outBus.connect(comp);
      var conv = ac.createConvolver(); conv.buffer = impulse(ac, 2.2, 2.6);
      var wet = ac.createGain(); wet.gain.value = 0.32;
      outBus.connect(conv); conv.connect(wet); wet.connect(comp);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function newSession() {
    killSession();
    session = ac.createGain();
    session.gain.value = 1;
    session.connect(outBus);
  }
  function killSession() {
    if (!session) return;
    var s = session; session = null;
    try { s.gain.cancelScheduledValues(ac.currentTime); s.gain.setTargetAtTime(0, ac.currentTime, 0.03); } catch (e) {}
    setTimeout(function () { try { s.disconnect(); } catch (e) {} }, 400);
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* ── РОЯЛЬ ──────────────────────────────────────────────
     Основной звук: записи рояля Salamander Grand Piano (автор Alexander Holm, CC BY 3.0).
     Берём пять файлов вокруг нужного диапазона и подстраиваем высоту до нужной ноты.
     Если файлы не загрузились (нет сети), играет запасной синтез ниже. */
  var SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
  var SAMPLE_LIST = [['A3', 57], ['C4', 60], ['Ds4', 63], ['Fs4', 66], ['A4', 69]];
  var samples_ = [], samplesState = 'idle', samplesPromise = null;

  function decode(buf) {
    return new Promise(function (ok, no) {
      var p = ac.decodeAudioData(buf, ok, no);
      if (p && p.then) p.then(ok, no);
    });
  }
  function loadSamples() {
    if (samplesPromise) return samplesPromise;
    if (!ensureAudio()) { samplesState = 'failed'; return Promise.resolve(false); }
    samplesState = 'loading';
    samplesPromise = Promise.all(SAMPLE_LIST.map(function (s) {
      return fetch(SAMPLE_BASE + s[0] + '.mp3')
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(decode)
        .then(function (b) { return { midi: s[1], buf: b }; });
    })).then(function (list) {
      samples_ = list; samplesState = 'ready'; return true;
    }).catch(function () {
      samplesState = 'failed'; return false;
    });
    return samplesPromise;
  }

  function sampleTone(midi, when, dur, vel) {
    var best = samples_[0], bd = 99;
    samples_.forEach(function (s) { var d = Math.abs(s.midi - midi); if (d < bd) { bd = d; best = s; } });
    var src = ac.createBufferSource();
    src.buffer = best.buf;
    src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12);
    var g = ac.createGain(), v = vel * 0.85, end = when + dur;
    g.gain.setValueAtTime(v, when);
    g.gain.setValueAtTime(v, end);
    g.gain.setTargetAtTime(0, end, 0.14);       // клавишу отпустили: нота мягко гаснет
    src.connect(g); g.connect(session);
    src.start(when); src.stop(end + 1.4);
  }

  /* запасной синтез: две чуть расстроенные струны, неточные обертоны, удар молоточка, фильтр темнеет по мере затухания */
  function synthTone(midi, when, dur, vel) {
    var f = mtof(midi), end = when + dur, i, n;
    var out = ac.createGain(); out.connect(session);
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(Math.min(9000, f * 7 + 1200), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(900, f * 2.2), when + 1.4);
    lp.connect(out);
    var env = ac.createGain(), pk = vel * 0.3;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(pk, when + 0.006);
    env.gain.setTargetAtTime(pk * 0.4, when + 0.006, 0.9);
    env.gain.setTargetAtTime(0, end, 0.11);
    env.connect(lp);
    for (n = 1; n <= 9; n++) {
      var fn = f * n * Math.sqrt(1 + 0.0004 * n * n);        // у настоящей струны обертоны слегка «растянуты»
      if (fn > 12000) break;
      var amp = (1 / Math.pow(n, 1.15)) * (n === 1 ? 1 : 0.85);
      var dec = Math.max(0.35, 2.6 / Math.pow(n, 0.7));
      [-1.3, 1.3].forEach(function (det) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = fn; o.detune.value = det * (n > 1 ? 1.5 : 1);
        g.gain.setValueAtTime(amp * 0.5, when);
        g.gain.setTargetAtTime(amp * 0.5 * 0.15, when, dec / 2.2);
        o.connect(g); g.connect(env);
        o.start(when); o.stop(end + 1);
      });
    }
    var len = Math.floor(ac.sampleRate * 0.04), nb = ac.createBuffer(1, len, ac.sampleRate), d = nb.getChannelData(0);
    for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var ns = ac.createBufferSource(); ns.buffer = nb;
    var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(4000, f * 4); bp.Q.value = 0.8;
    var ng = ac.createGain(); ng.gain.value = vel * 0.12;
    ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(when);
  }

  function tone(midi, when, dur, vel) {
    if (samplesState === 'ready') sampleTone(midi, when, dur, vel);
    else synthTone(midi, when, dur, vel);
  }
  /* перед первым прослушиванием даём роялю до 4 секунд на загрузку */
  function whenSoundReady() {
    var p = loadSamples();
    if (samplesState !== 'loading') return Promise.resolve();
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 4000); })]);
  }

  function scheduleMelody(t0, vel) {
    WINDOWS.forEach(function (w) { tone(w.midi, t0 + w.start, w.end - w.start, vel); });
  }

  /* ═════════════ ОПРЕДЕЛЕНИЕ ВЫСОТЫ (YIN) ═════════════
     Старая автокорреляция часто «перепрыгивала» на октаву и тянула время O(n·lag).
     YIN устойчивее к обертонам и даёт уверенность (clarity). */
  function yin(buf, sr) {
    var n = buf.length;
    var maxTau = Math.min(Math.floor(sr / 70), (n >> 1) - 1);
    var minTau = Math.floor(sr / 1000);
    var W = n - maxTau;
    var d = new Float32Array(maxTau + 1), c = new Float32Array(maxTau + 1);
    var tau, j, x, s;
    for (tau = 1; tau <= maxTau; tau++) {
      s = 0;
      for (j = 0; j < W; j++) { x = buf[j] - buf[j + tau]; s += x * x; }
      d[tau] = s;
    }
    var run = 0; c[0] = 1;
    for (tau = 1; tau <= maxTau; tau++) { run += d[tau]; c[tau] = run > 0 ? d[tau] * tau / run : 1; }
    var best = -1;
    for (tau = minTau; tau < maxTau; tau++) {
      if (c[tau] < 0.15) {
        while (tau + 1 < maxTau && c[tau + 1] < c[tau]) tau++;
        best = tau; break;
      }
    }
    if (best < 0) return -1;
    var t = best;
    if (best > 1 && best < maxTau) {
      var a = c[best - 1], b = c[best], g = c[best + 1], den = a + g - 2 * b;
      if (den !== 0) t = best + (a - g) / (2 * den);
    }
    return sr / t;
  }
  function rmsOf(buf) {
    var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /* сглаживание: медиана последних пяти значений */
  var hist = [], nulls = 0;
  function smooth(m) {
    if (m == null) { if (++nulls > 3) hist = []; return null; }
    nulls = 0; hist.push(m); if (hist.length > 5) hist.shift();
    var s = hist.slice().sort(function (a, b) { return a - b; });
    return s[s.length >> 1];
  }

  /* ═════════════ НАЗВАНИЯ НОТ ═════════════ */
  var SOL = ['до', 'до♯', 'ре', 'ре♯', 'ми', 'фа', 'фа♯', 'соль', 'соль♯', 'ля', 'ля♯', 'си'];
  function noteName(m, withOct) {
    var r = Math.round(m), n = SOL[((r % 12) + 12) % 12];
    return withOct ? n + (Math.floor(r / 12) - 1) : n;
  }

  /* ═════════════ СЛОГИ ═════════════ */
  var sylEls = [];
  (function () {
    MELODY.forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'vt-syl';
      el.innerHTML = '<b></b><small></small>';
      el.firstChild.textContent = n.syl;
      el.lastChild.textContent = n.note;
      lyr.appendChild(el); sylEls.push(el);
    });
  })();
  function lightSyl(idx) {
    sylEls.forEach(function (el, i) {
      el.classList.toggle('now', i === idx);
      el.classList.toggle('done', idx >= 0 && i < idx);
    });
  }
  function clearSyl() { sylEls.forEach(function (el) { el.className = 'vt-syl'; }); }

  /* ═════════════ ГРАФИК ═════════════ */
  var LO = 59, HI = 69, ROWS = HI - LO + 1;       // от си малой октавы до ля первой
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  function isBlack(m) { return !!BLACK[((m % 12) + 12) % 12]; }

  var W = 0, H = 340, kw = 66, padL = 80, padR = 16, padT = 40, padB = 32, rowH = 24, gw = 1;
  function layout() {
    var r = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kw = W < 560 ? 46 : 66;
    padL = kw + 14; padR = 16; padT = W < 860 ? 18 : 40; padB = 32;
    rowH = (H - padT - padB) / ROWS;
    gw = W - padL - padR;
  }
  function xOf(t) { return padL + (t / TOTAL) * gw; }
  function yTop(m) { return padT + (HI - m) * rowH; }
  function yC(m) { return yTop(m) + rowH / 2; }
  function clampM(m) { return Math.max(LO - 0.45, Math.min(HI + 0.45, m)); }

  function rr(x, y, w, h, r) {
    var a, b, c, d;
    if (Array.isArray(r)) { a = r[0]; b = r[1]; c = r[2]; d = r[3]; } else { a = b = c = d = r; }
    ctx.beginPath();
    ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
    ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
    ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
    ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
  }
  function disp(m) { return m - 12 * shift; }

  function winStats() {
    return WINDOWS.map(function (w) {
      var f = 0, sc = 0;
      for (var i = 0; i < samples.length; i++) {
        var s = samples[i];
        if (s.t < w.start + ONSET || s.t > w.end) continue;
        f++;
        if (s.m != null) sc += frameScore(Math.abs((disp(s.m) - w.midi) * 100));
      }
      return { f: f, ratio: f ? sc / f : 0 };
    });
  }
  function frameScore(a) { return a <= 25 ? 1 : a >= 100 ? 0 : 1 - (a - 25) / 75; }

  function drawKey(m, lit) {
    var white = !isBlack(m);
    var y = yTop(m), x = 0, w, y0, y1, grad;
    var ext = lit ? 7 : 0;
    if (white) {
      y0 = isBlack(m + 1) && m + 1 <= HI ? yTop(m + 1) + rowH / 2 : y;
      y1 = isBlack(m - 1) && m - 1 >= LO ? yTop(m - 1) + rowH / 2 : y + rowH;
      w = kw + ext;
      rr(x, y0 + 1, w, y1 - y0 - 2, [0, 8, 8, 0]);
      grad = ctx.createLinearGradient(0, 0, w, 0);
      if (lit === 'gold') { grad.addColorStop(0, 'rgba(255,248,226,.98)'); grad.addColorStop(1, 'rgba(236,208,140,.96)'); }
      else if (lit) { grad.addColorStop(0, 'rgba(250,240,255,.98)'); grad.addColorStop(1, 'rgba(224,196,255,.92)'); }
      else { grad.addColorStop(0, 'rgba(255,255,255,.96)'); grad.addColorStop(1, 'rgba(243,236,254,.88)'); }
      ctx.save();
      ctx.shadowColor = lit === 'gold' ? 'rgba(222,184,90,.85)' : lit ? 'rgba(195,150,255,.8)' : 'rgba(120,90,170,.2)';
      ctx.shadowBlur = lit ? 16 : 5; ctx.shadowOffsetY = lit ? 0 : 1;
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(169,139,207,.35)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      w = kw * 0.62 + ext;
      rr(x, y + rowH * 0.1, w, rowH * 0.8, [0, 5, 5, 0]);
      grad = ctx.createLinearGradient(0, y, 0, y + rowH);
      if (lit === 'gold') { grad.addColorStop(0, '#e6c97d'); grad.addColorStop(1, '#b8923d'); }
      else if (lit) { grad.addColorStop(0, 'rgba(195,162,235,.98)'); grad.addColorStop(1, 'rgba(130,90,185,.98)'); }
      else { grad.addColorStop(0, 'rgba(158,142,182,.92)'); grad.addColorStop(1, 'rgba(104,85,128,.95)'); }
      ctx.save();
      ctx.shadowColor = lit === 'gold' ? 'rgba(222,184,90,.9)' : lit ? 'rgba(195,145,255,.85)' : 'rgba(45,25,75,.4)';
      ctx.shadowBlur = lit ? 16 : 6; ctx.shadowOffsetY = lit ? 0 : 2;
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(1, y + rowH * 0.1 + 1.5); ctx.lineTo(w - 4, y + rowH * 0.1 + 1.5); ctx.stroke();
    }
  }

  function diamond(x, y, r, col) {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
  }

  function draw(ph) {
    ctx.clearRect(0, 0, W, H);
    var on = ph != null && ph >= 0;
    var curI = on ? winAt(ph) : -1;
    var m, i, k;

    /* строки пианоролла */
    for (m = LO; m <= HI; m++) {
      if (isBlack(m)) { ctx.fillStyle = 'rgba(169,139,207,.075)'; ctx.fillRect(padL, yTop(m), gw, rowH); }
    }
    ctx.lineWidth = 1;
    for (k = 0; k <= ROWS; k++) {
      var yy = Math.round(padT + k * rowH) + 0.5;
      var isC = (HI - k + 1) === 60;           // граница под «до» первой октавы
      ctx.strokeStyle = isC ? 'rgba(183,154,94,.5)' : 'rgba(169,139,207,.13)';
      ctx.setLineDash(isC ? [2, 5] : []);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    }
    ctx.setLineDash([]);
    /* вертикальные засечки в начале каждой ноты */
    ctx.strokeStyle = 'rgba(169,139,207,.1)'; ctx.setLineDash([2, 6]);
    WINDOWS.forEach(function (w) { var x = Math.round(xOf(w.start)) + 0.5; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke(); });
    ctx.setLineDash([]);

    /* ноты мелодии */
    var stats = samples.length ? winStats() : null;
    var bh = rowH * 0.62;
    WINDOWS.forEach(function (w, idx) {
      var x0 = xOf(w.start) + 2, x1 = xOf(w.end) - 2, y = yC(w.midi);
      var isNow = idx === curI;
      var finished = state === 'done' || (on && ph > w.end);
      var st = stats ? stats[idx] : null;
      var fill, stroke, glow = 0, glowCol = 'rgba(160,120,220,.7)';
      if (st && finished && st.f > 0) {
        if (st.ratio >= 0.65) { fill = ['rgba(246,226,170,.85)', 'rgba(224,190,110,.65)']; stroke = 'rgba(183,154,94,.95)'; glowCol = 'rgba(222,184,90,.6)'; glow = 10; }
        else if (st.ratio >= 0.3) { fill = ['rgba(210,186,242,.7)', 'rgba(176,146,220,.5)']; stroke = 'rgba(143,111,192,.7)'; }
        else { fill = ['rgba(248,214,226,.7)', 'rgba(238,176,200,.5)']; stroke = 'rgba(217,100,143,.7)'; }
      } else if (isNow) {
        fill = ['rgba(205,178,240,.85)', 'rgba(160,125,215,.7)']; stroke = 'rgba(125,94,180,.95)'; glow = 16;
      } else {
        fill = ['rgba(214,192,243,.55)', 'rgba(184,155,225,.38)']; stroke = 'rgba(160,125,210,.55)';
      }
      var g = ctx.createLinearGradient(0, y - bh / 2, 0, y + bh / 2);
      g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]);
      ctx.save();
      if (glow) { ctx.shadowColor = glowCol; ctx.shadowBlur = glow; }
      rr(x0, y - bh / 2, x1 - x0, bh, bh / 2); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.2; ctx.strokeStyle = stroke; rr(x0, y - bh / 2, x1 - x0, bh, bh / 2); ctx.stroke();
      /* блик и ажурные ромбики на концах */
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0 + bh / 2, y - bh / 2 + 2); ctx.lineTo(x1 - bh / 2, y - bh / 2 + 2); ctx.stroke();
      diamond(x0 + bh / 2, y, 2.3, 'rgba(183,154,94,.9)'); diamond(x1 - bh / 2, y, 2.3, 'rgba(183,154,94,.9)');
      /* слог внизу */
      if (W >= 640) {
        ctx.font = (isNow ? '600 ' : '500 ') + 'italic 16px "Cormorant Garamond",Georgia,serif';
        ctx.textAlign = 'center'; ctx.fillStyle = isNow ? '#2a1747' : 'rgba(95,76,130,.8)';
        ctx.fillText(w.syl, (x0 + x1) / 2, H - 10);
      }
    });

    /* голос */
    var headPt = null;
    if (samples.length > 1) {
      var grad = ctx.createLinearGradient(padL, 0, W - padR, 0);
      grad.addColorStop(0, '#8f6fc0'); grad.addColorStop(0.55, '#b394d6'); grad.addColorStop(1, '#d4b46c');
      var segs = [], cur = [], prevT = -1;
      samples.forEach(function (s) {
        if (s.m == null) { if (cur.length) { segs.push(cur); cur = []; } return; }
        if (prevT >= 0 && s.t - prevT > 0.25 && cur.length) { segs.push(cur); cur = []; }
        cur.push({ x: xOf(s.t), y: yC(clampM(disp(s.m))) });
        prevT = s.t;
      });
      if (cur.length) segs.push(cur);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = grad; ctx.lineWidth = 3.2;
      ctx.shadowColor = 'rgba(180,140,235,.75)'; ctx.shadowBlur = 11;
      segs.forEach(function (p) {
        ctx.beginPath();
        if (p.length === 1) { ctx.arc(p[0].x, p[0].y, 1.6, 0, 6.3); ctx.stroke(); return; }
        ctx.moveTo(p[0].x, p[0].y);
        for (var q = 1; q < p.length - 1; q++) {
          ctx.quadraticCurveTo(p[q].x, p[q].y, (p[q].x + p[q + 1].x) / 2, (p[q].y + p[q + 1].y) / 2);
        }
        ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
        ctx.stroke();
      });
      ctx.restore();
      var last = samples[samples.length - 1];
      if (state === 'rec' && last.m != null) headPt = { x: xOf(last.t), y: yC(clampM(disp(last.m))) };
    }
    if (headPt) {
      var rg = ctx.createRadialGradient(headPt.x, headPt.y, 0, headPt.x, headPt.y, 17);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(236,208,140,.9)'); rg.addColorStop(1, 'rgba(190,150,240,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(headPt.x, headPt.y, 17, 0, 6.3); ctx.fill();
    }

    /* курсор */
    if (on && ph <= TOTAL) {
      var px = xOf(ph);
      ctx.strokeStyle = 'rgba(143,111,192,.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(px, padT - 4); ctx.lineTo(px, H - padB); ctx.stroke(); ctx.setLineDash([]);
      diamond(px, padT - 6, 3.4, 'rgba(183,154,94,.95)');
    }

    /* клавиши слева — загораются от мелодии и от вашего голоса */
    var targetM = curI >= 0 ? WINDOWS[curI].midi : -1;
    var voiceM = -1;
    if (state === 'rec' && lastVoice.m != null && on && ph - lastVoice.t < 0.18) voiceM = Math.round(disp(lastVoice.m));
    for (m = LO; m <= HI; m++) { if (!isBlack(m)) drawKey(m, voiceM === m ? 'gold' : targetM === m ? 'lav' : false); }
    for (m = LO; m <= HI; m++) { if (isBlack(m)) drawKey(m, voiceM === m ? 'gold' : targetM === m ? 'lav' : false); }
    ctx.font = 'italic 600 13.5px "Cormorant Garamond",Georgia,serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(95,76,130,.9)';
    for (m = LO; m <= HI; m++) {
      if (!isBlack(m)) {
        var lbl = SOL[((m % 12) + 12) % 12] + (m % 12 === 0 ? String(Math.floor(m / 12) - 1) : '');
        ctx.fillText(lbl, kw - 8 + (targetM === m || voiceM === m ? 7 : 0), yC(m) + 4.5);
      }
    }
  }

  /* ═════════════ ЭФФЕКТЫ ═════════════ */
  function burst(t, midi) {
    if (reduceMotion) return;
    var gl = ['♪', '♫', '✦', '✧', '·'], cnt = 3 + Math.floor(Math.random() * 3);
    var cx = xOf(t), cy = yC(midi);
    for (var i = 0; i < cnt; i++) {
      var e = document.createElement('i');
      e.textContent = gl[Math.floor(Math.random() * gl.length)];
      e.style.left = (cx + Math.random() * 30 - 10) + 'px';
      e.style.top = (cy + Math.random() * 14 - 8) + 'px';
      e.style.fontSize = (13 + Math.random() * 12) + 'px';
      e.style.setProperty('--dx', (Math.random() * 60 - 10) + 'px');
      e.style.setProperty('--dy', -(40 + Math.random() * 60) + 'px');
      e.style.setProperty('--r', (Math.random() * 50 - 25) + 'deg');
      fxLayer.appendChild(e);
      setTimeout((function (el) { return function () { el.remove(); }; })(e), 1800);
    }
  }
  (function sparks() {
    for (var i = 0; i < 26; i++) {
      var d = document.createElement('div'); d.className = 'vt-spark';
      d.style.setProperty('--s', (2 + Math.random() * 4.5) + 'px');
      d.style.left = (3 + Math.random() * 94) + '%'; d.style.top = (4 + Math.random() * 92) + '%';
      d.style.setProperty('--d', (3.5 + Math.random() * 5) + 's');
      d.style.setProperty('--dl', (-Math.random() * 8) + 's');
      d.style.setProperty('--dx', (Math.random() * 50 - 25) + 'px');
      d.style.setProperty('--dy', (-20 - Math.random() * 50) + 'px');
      root.appendChild(d);
    }
  })();

  /* ═════════════ ИНТЕРФЕЙС ═════════════ */
  function say(txt, rec) { statusEl.textContent = txt; statusEl.classList.toggle('rec', !!rec); }
  function setStep(n) {
    root.querySelectorAll('.vt-step').forEach(function (el) {
      var s = +el.getAttribute('data-s');
      el.classList.toggle('on', s === n);
      el.classList.toggle('ok', s < n);
      el.firstChild.textContent = s < n ? '✓' : String(s);
    });
  }
  function setButtons() {
    var busy = state === 'listen' || state === 'count' || state === 'rec';
    btnListen.disabled = busy;
    btnStart.disabled = busy || !listened;
    btnStop.hidden = !busy;
    btnReset.hidden = state !== 'done';
    btnListen.hidden = false;
  }
  function tuneOff() {
    tune.classList.remove('live'); tNote.textContent = '—'; tCents.textContent = '';
    tNeedle.style.left = '50%'; tNeedle.classList.remove('ok');
  }
  function stopAll() {
    cancelAnimationFrame(raf);
    killSession();
    if (micSrc) { try { micSrc.disconnect(); } catch (e) {} micSrc = null; }
    if (mic) { mic.getTracks().forEach(function (t) { t.stop(); }); mic = null; }
    analyser = null;
    countEl.hidden = true;
  }

  /* ═════════════ 1. ПРОСЛУШИВАНИЕ ═════════════ */
  btnListen.addEventListener('click', async function () {
    if (!ensureAudio()) { say('Этот браузер не умеет воспроизводить звук. Попробуйте Chrome, Safari или Firefox.'); return; }
    if (samplesState === 'idle' || samplesState === 'loading') {
      btnListen.disabled = true; say('Настраиваем рояль…');
      await whenSoundReady();
      btnListen.disabled = false;
    }
    stopAll(); newSession();
    state = 'listen'; samples = []; shift = 0; resEl.classList.remove('show'); tuneOff();
    setStep(1); clearSyl(); setButtons();
    say('Слушайте мелодию и запоминайте…');
    var t0 = ac.currentTime + 0.25;
    scheduleMelody(t0, 0.9);
    (function loop() {
      var now = ac.currentTime - t0;
      lightSyl(winAt(now));
      draw(now);
      if (now < TOTAL) { raf = requestAnimationFrame(loop); return; }
      clearSyl(); state = 'idle'; listened = true; setStep(0); setButtons(); draw(null);
      say('Теперь нажмите «Начать тест» и спойте мелодию');
    })();
  });

  /* ═════════════ 2. ЗАПИСЬ ═════════════ */
  btnStart.addEventListener('click', async function () {
    if (state !== 'idle' && state !== 'done') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('Для микрофона нужна защищённая страница (https). Откройте сайт по https-адресу.'); return;
    }
    if (!ensureAudio()) { say('Этот браузер не умеет работать со звуком.'); return; }
    say('Просим доступ к микрофону…');
    btnStart.disabled = true; btnListen.disabled = true;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      var none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      say(denied ? 'Доступ к микрофону закрыт. Разрешите его в настройках браузера и попробуйте снова.'
        : none ? 'Микрофон не найден. Подключите его и попробуйте снова.'
        : 'Не удалось включить микрофон. Проверьте, что его не занимает другая программа.');
      state = 'idle'; setButtons(); return;
    }
    beginCountdown();
  });

  function beginCountdown() {
    killSession(); newSession();
    micSrc = ac.createMediaStreamSource(mic);
    analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
    micSrc.connect(analyser);
    tbuf = new Float32Array(analyser.fftSize);

    state = 'count'; samples = []; shift = 0; octCounts = [0, 0, 0, 0, 0, 0, 0];
    hist = []; nulls = 0; lastVoice = { t: -9, m: null };
    burstDone = WINDOWS.map(function () { return false; }); streak = WINDOWS.map(function () { return 0; });
    resEl.classList.remove('show'); clearSyl(); setStep(2); setButtons(); tuneOff();
    say('Тишина — мы настраиваемся на шум вокруг');

    var c0 = ac.currentTime + 0.2;
    var recStart = c0 + 3 * BEAT;
    // подсказка: первая нота заканчивается ДО старта записи, чтобы микрофон её не «услышал»
    tone(WINDOWS[0].midi, c0 + 2 * BEAT, BEAT - 0.08, 0.8);
    var noise = [], lastDigit = 0;
    countEl.hidden = false;

    (function loop() {
      var now = ac.currentTime - c0;
      var dig = 3 - Math.floor(now / BEAT);
      if (dig >= 1 && dig !== lastDigit) {
        lastDigit = dig; digitEl.textContent = String(dig);
        digitEl.style.animation = 'none'; void digitEl.offsetWidth; digitEl.style.animation = '';
        if (dig === 1) say('Возьмите ноту «до» и ждите: мелодия начнётся сразу после счёта');
      }
      if (now > 0.2 && now < 1.6) { analyser.getFloatTimeDomainData(tbuf); noise.push(rmsOf(tbuf)); }
      draw(null);
      if (ac.currentTime < recStart) { raf = requestAnimationFrame(loop); return; }
      countEl.hidden = true;
      // порог тишины
      noise.sort(function (a, b) { return a - b; });
      var floor = noise.length ? noise[Math.floor(noise.length * 0.25)] : 0;
      beginRecord(recStart, Math.min(0.035, Math.max(0.012, floor * 2.5 + 0.004)));
    })();
  }

  function beginRecord(recStart, gate) {
    state = 'rec'; setButtons(); tune.classList.add('live');
    say('Пойте мелодию — график рисуется прямо сейчас', true);
    if (guideChk.checked) scheduleMelody(recStart, 0.35);
    var prev = 0;

    (function loop() {
      var now = ac.currentTime - recStart;
      if (now > TOTAL) { finish(); return; }
      analyser.getFloatTimeDomainData(tbuf);
      var voiced = null;
      if (rmsOf(tbuf) >= gate) {
        var f = yin(tbuf, ac.sampleRate);
        if (f > 0) voiced = 69 + 12 * Math.log2(f / 440);
      }
      var m = smooth(voiced), t = Math.max(0, now);
      samples.push({ t: t, m: m });
      var wi = winAt(t, 0.2), dt = t - prev; prev = t;

      if (m != null) {
        lastVoice = { t: t, m: m };
        if (wi >= 0) {                                   // учимся, на какой октаве вы поёте
          var o = Math.max(-3, Math.min(3, Math.round((m - WINDOWS[wi].midi) / 12)));
          octCounts[o + 3]++;
          var bi = 3; for (var q = 0; q < 7; q++) if (octCounts[q] > octCounts[bi]) bi = q;
          shift = bi - 3;
        }
        var dm = disp(m), ref = wi >= 0 ? WINDOWS[wi].midi : Math.round(dm);
        var cents = (dm - ref) * 100;
        tNote.textContent = noteName(dm);
        tNeedle.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
        var okc = Math.abs(cents) <= 25;
        tNeedle.classList.toggle('ok', okc);
        tCents.textContent = okc ? 'точно в ноту' : (cents > 0 ? 'выше на ' : 'ниже на ') + Math.round(Math.abs(cents)) + ' цент';
        var wj = winAt(t);
        if (wj >= 0 && t > WINDOWS[wj].start + ONSET) {
          if (Math.abs((dm - WINDOWS[wj].midi) * 100) <= 50) {
            streak[wj] += dt;
            if (streak[wj] >= 0.4 && !burstDone[wj]) { burstDone[wj] = true; burst(t, WINDOWS[wj].midi); }
          }
        }
      } else if (t - lastVoice.t > 0.3) {
        tNote.textContent = '—'; tCents.textContent = 'не слышим голос'; tNeedle.classList.remove('ok'); tNeedle.style.left = '50%';
      }
      lightSyl(winAt(t));
      draw(now);
      raf = requestAnimationFrame(loop);
    })();
  }

  /* ═════════════ 3. РЕЗУЛЬТАТ ═════════════ */
  function finish() {
    stopAll();
    state = 'done';
    clearSyl(); setStep(3); tuneOff(); setButtons();
    say('Анализ завершён');

    var per = WINDOWS.map(function () { return { f: 0, v: 0, hit: 0, sc: 0, errs: [] }; });
    var raw = [];
    samples.forEach(function (s) {
      var i = winAt(s.t);
      if (i < 0 || s.t < WINDOWS[i].start + ONSET) return;
      var p = per[i]; p.f++;
      if (s.m == null) return;
      p.v++; raw.push(s.m);
      var err = (s.m - 12 * shift - WINDOWS[i].midi) * 100, a = Math.abs(err);
      p.errs.push(err); if (a <= 50) p.hit++; p.sc += frameScore(a);
    });
    var F = 0, V = 0, HIT = 0, SC = 0, stabNum = 0, errSum = 0;
    per.forEach(function (p) {
      F += p.f; V += p.v; HIT += p.hit; SC += p.sc;
      if (p.v > 2) {
        var mean = p.errs.reduce(function (a, b) { return a + b; }, 0) / p.v;
        var sd = Math.sqrt(p.errs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / p.v);
        stabNum += Math.max(0, 1 - sd / 60) * p.v;
      }
      errSum += p.errs.reduce(function (a, b) { return a + b; }, 0);
    });
    var coverage = F ? V / F : 0;
    var accAll = F ? SC / F : 0;
    var hitRate = V ? HIT / V : 0;
    var stab = V ? stabNum / V : 0;
    var overall = Math.round(100 * (0.7 * accAll + 0.3 * stab * coverage));
    var bias = V ? errSum / V : 0;

    var rangeTxt = '—';
    if (raw.length > 4) {
      raw.sort(function (a, b) { return a - b; });
      rangeTxt = noteName(raw[Math.floor(raw.length * 0.05)], true) + '–' + noteName(raw[Math.floor(raw.length * 0.95)], true);
    }

    var level, desc, quiet = coverage < 0.2;
    if (quiet) {
      level = 'Мы вас почти не услышали';
      desc = 'Звук был слишком тихим. Подойдите ближе к микрофону, закройте окно и спойте чуть смелее.';
    } else if (overall >= 85) { level = 'Виртуоз'; desc = 'Чистая интонация и тонкий слух. Ваш аппарат работает блестяще, вы готовы к сложному репертуару.'; }
    else if (overall >= 70) { level = 'Уверенный голос'; desc = 'Слух и связки работают согласованно. Детальная постановка дыхания выведет вас на профессиональный уровень.'; }
    else if (overall >= 50) { level = 'Растущий голос'; desc = 'Голос откликается, но интонации пока не хватает опоры. Это легко корректируется правильными распевками.'; }
    else if (overall >= 30) { level = 'Первые ростки'; desc = 'Голос уже ищет верные позиции. Несколько месяцев технической работы с дыханием дадут заметный скачок.'; }
    else { level = 'Начало пути'; desc = 'Чистая интонация — это навык, а не талант. На первом уроке мы аккуратно найдем вашу точку старта.'; }

    var fine = [];
    if (shift !== 0) fine.push('Вы пели на ' + (Math.abs(shift) > 1 ? Math.abs(shift) + ' октавы' : 'октаву') + (shift < 0 ? ' ниже' : ' выше') + ': у голосов разный регистр, мы это учли.');
    if (!quiet && Math.abs(bias) > 15) fine.push('В среднем вы звучали чуть ' + (bias > 0 ? 'выше' : 'ниже') + ' ноты: это поправляется опорой дыхания.');
    var fineEl = $('vtFine');
    fineEl.textContent = fine.join(' '); fineEl.hidden = !fine.length;

    /* клавиши-итог по каждой ноте */
    var chips = $('vtChips'); chips.innerHTML = '';
    per.forEach(function (p, i) {
      var r = p.f ? p.sc / p.f : 0, cls = r >= 0.65 ? 'hit' : r >= 0.3 ? 'near' : 'miss';
      var c = document.createElement('div'); c.className = 'vt-chip ' + cls;
      c.innerHTML = '<b></b><small></small>';
      c.firstChild.textContent = WINDOWS[i].syl; c.lastChild.textContent = WINDOWS[i].note;
      c.style.animation = 'vtReveal .6s ' + (0.25 + i * 0.07) + 's both var(--ease)';
      chips.appendChild(c);
      sylEls[i].classList.add(cls === 'hit' ? 'hit' : cls === 'miss' ? 'miss' : 'done');
    });

    $('vtLevel').textContent = level; $('vtDesc').textContent = desc;
    $('vtMHit').textContent = Math.round(hitRate * 100) + '%';
    $('vtMStab').textContent = Math.round(stab * 100) + '%';
    $('vtMRange').textContent = rangeTxt;
    btnEnroll.hidden = quiet; $('vtThanks').hidden = true;
    btnEnroll.disabled = false; btnEnroll.textContent = 'Записаться с результатом';

    lastResult = { score: overall, level: level, hit: Math.round(hitRate * 100), stability: Math.round(stab * 100), range: rangeTxt, octaveShift: shift };
    resEl.classList.add('show');
    draw(null);
    var tgt = resEl.getBoundingClientRect();
    if (tgt.top > window.innerHeight * 0.55) resEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

    var ring = $('vtRing'), C = 2 * Math.PI * 72, sv = $('vtScore');
    ring.style.transition = 'none'; ring.style.strokeDashoffset = C; void ring.getBoundingClientRect(); ring.style.transition = '';
    setTimeout(function () { ring.style.strokeDashoffset = C * (1 - overall / 100); }, 150);
    var t0 = performance.now();
    (function count(now) {
      var k = Math.min(1, (now - t0) / 1300), e = 1 - Math.pow(1 - k, 3);
      sv.textContent = String(Math.round(overall * e));
      if (k < 1) requestAnimationFrame(count);
    })(t0);
  }

  /* ═════════════ ОСТАНОВКА / СБРОС ═════════════ */
  function abort(msg) {
    stopAll();
    state = 'idle'; samples = []; shift = 0; clearSyl(); setStep(0); tuneOff(); setButtons(); draw(null);
    say(msg || 'Остановлено. Можно начать заново');
  }
  btnStop.addEventListener('click', function () { abort(); });
  btnReset.addEventListener('click', function () {
    stopAll();
    state = 'idle'; samples = []; shift = 0; clearSyl(); setStep(0);
    resEl.classList.remove('show'); setButtons(); draw(null);
    say(listened ? 'Нажмите «Начать тест», когда будете готовы' : 'Нажмите «Прослушать», чтобы познакомиться с мелодией');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (state === 'listen' || state === 'count' || state === 'rec')) abort('Тест остановлен: вы переключили вкладку. Начните заново');
  });

  /* ═════════════ ЗАПИСЬ НА УРОК ═════════════ */
  btnEnroll.addEventListener('click', function () {
    if (!lastResult) return;
    try { sessionStorage.setItem('voiceTestResult', JSON.stringify(lastResult)); } catch (e) {}
    var ev = new CustomEvent('voicetest:enroll', { detail: lastResult, cancelable: true, bubbles: true });
    var handled = !root.dispatchEvent(ev);
    if (!handled) {
      var th = $('vtThanks');
      th.textContent = 'Результат сохранён — Екатерина увидит его при записи ✦';
      th.hidden = false; btnEnroll.disabled = true;
    }
  });

  /* ═════════════ СТАРТ ═════════════ */
  function relayout() { layout(); draw(state === 'done' ? null : null); }
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);
  else window.addEventListener('resize', relayout);
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(relayout);
  setButtons(); relayout();
  // рояль грузим заранее, пока человек читает
  setTimeout(function () { try { loadSamples(); } catch (e) {} }, 700);
})();
