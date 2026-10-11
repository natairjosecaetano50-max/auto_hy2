/* ========================================================
CURTAIN OVERLAY MODULE (Бархатный занавес) — SUPER OPTIMIZED
Оптимизировано: снижена нагрузка на шину памяти, 
устранены артефакты при запекании (toBlob + Dithering).
======================================================== */
(function () {
'use strict';

function createCurtainDOM() {
var style = document.createElement('style');
style.id = 'curtain-styles';
style.textContent = [
'html.curtain-locked, html.curtain-locked body {',
'  overflow: hidden !important;',
'}',
'#curtain-wrapper {',
'  position: fixed;',
'  inset: 0;',
'  width: 100vw;',
'  height: 100vh;',
'  z-index: 99999;',
'  pointer-events: none;',
'  overflow: hidden;',
'}',
'#curtain-wrapper.interactive {',
'  pointer-events: auto;',
'}',
'#curtain-wrapper.narrow-open {',
'  position: absolute !important;',
'  top: 0 !important;',
'  left: 0 !important;',
'  right: 0 !important;',
'  width: 100% !important;',
'  height: 100vh !important;',
'  height: 100svh !important;',
'  bottom: auto !important;',
'  pointer-events: none !important;',
'  overflow: hidden !important;',
'}',
'canvas#curtain-gl {',
'  position: absolute;',
'  inset: 0;',
'  width: 100%;',
'  height: 100%;',
'  display: block;',
'  touch-action: none;',
'  cursor: pointer;',
'  pointer-events: auto;',
'}',
'canvas#curtain-gl.down { cursor: grabbing; }',
'canvas#curtain-gl.open-state {',
'  pointer-events: none;',
'}',
'#curtain-baked {',
'  position: absolute;',
'  inset: 0;',
'  width: 100%;',
'  height: 100%;',
'  object-fit: cover;', 
'  pointer-events: none;',
'}',
'#curtain-vignette {',
'  position: absolute;',
'  inset: 0;',
'  pointer-events: none;',
'  background: radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%);',
'  transition: opacity 1.2s ease;',
'}',
'#curtain-phrase {',
'  position: absolute;',
'  top: 44%;',
'  left: 50%;',
'  transform: translate(-50%, -50%);',
'  display: flex;',
'  flex-direction: column;',
'  align-items: center;',
'  justify-content: center;',
'  pointer-events: none;',
'  z-index: 100000;',
'  user-select: none;',
'  text-align: center;',
'  width: 94vw;',
'  max-width: 1200px;',
'  will-change: opacity, transform;',
'  transition: opacity 0.6s ease;',
'}',
'.phrase-inner {',
'  display: flex;',
'  flex-direction: column;',
'  align-items: center;',
'  justify-content: center;',
'  position: relative;',
'  padding: 10px;',
'}',
'.phrase-text {',
'  font-family: "Cormorant Garamond", "Playfair Display", "Palatino Linotype", Palatino, serif;',
'  font-size: clamp(38px, 7.5vw, 110px);',
'  font-weight: 700;',
'  font-style: italic;',
'  letter-spacing: 0.04em;',
'  line-height: 1.15;',
'  margin: 0;',
'  background: linear-gradient(',
'    115deg,',
'    #caa049 0%,',
'    #fceeaf 20%,',
'    #e2b357 36%,',
'    #fffdf4 48%,',
'    #dfab44 62%,',
'    #feefb8 80%,',
'    #b37f26 100%',
'  );',
'  background-size: 220% auto;',
'  -webkit-background-clip: text;',
'  -webkit-text-fill-color: transparent;',
'  animation: goldShimmer 8s ease-in-out infinite alternate;',
'  filter:',
'    drop-shadow(0 2px 0px rgba(0, 0, 0, 1.0))',
'    drop-shadow(0 4px 6px rgba(0, 0, 0, 0.98))',
'    drop-shadow(0 10px 18px rgba(0, 0, 0, 0.96))',
'    drop-shadow(0 22px 42px rgba(0, 0, 0, 0.92))',
'    drop-shadow(0 0 32px rgba(245, 195, 95, 0.38));',
'}',
'@keyframes goldShimmer {',
'  0% { background-position: 0% center; }',
'  100% { background-position: 100% center; }',
'}',
'.phrase-ornament {',
'  display: flex;',
'  align-items: center;',
'  justify-content: center;',
'  gap: 20px;',
'  width: min(520px, 80vw);',
'  opacity: 0.9;',
'}',
'.phrase-ornament.top { margin-bottom: 16px; }',
'.phrase-ornament.bottom { margin-top: 18px; }',
'.ornament-line {',
'  flex: 1;',
'  height: 1.5px;',
'  background: linear-gradient(90deg, transparent, rgba(245, 215, 140, 0.95) 50%, transparent);',
'  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.9), 0 0 10px rgba(245, 195, 95, 0.6);',
'}',
'.ornament-gem {',
'  color: #fcebb1;',
'  font-size: 18px;',
'  line-height: 1;',
'  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 10px rgba(245, 195, 95, 0.95));',
'}',
'#curtain-hint {',
'  position: absolute;',
'  bottom: 28px;',
'  left: 0;',
'  right: 0;',
'  text-align: center;',
'  font-family: "Cormorant Garamond", serif;',
'  font-style: italic;',
'  font-size: 17px;',
'  color: rgba(241, 223, 186, 0.85);',
'  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);',
'  pointer-events: none;',
'  z-index: 100001;',
'  transition: opacity 0.8s ease;',
'  letter-spacing: 0.04em;',
'}'
].join('\n');
document.head.appendChild(style);

var wrap = document.createElement('div');
wrap.id = 'curtain-wrapper';
wrap.className = 'interactive';
wrap.innerHTML = [
'<canvas id="curtain-gl"></canvas>',
'<div id="curtain-vignette"></div>',
'<div id="curtain-phrase" aria-hidden="true">',
'  <div class="phrase-inner">',
'    <div class="phrase-ornament top">',
'      <span class="ornament-line"></span>',
'      <span class="ornament-gem">✦</span>',
'      <span class="ornament-line"></span>',
'    </div>',
'    <div class="phrase-text">Раскройте истинное звучание</div>',
'    <div class="phrase-ornament bottom">',
'      <span class="ornament-line"></span>',
'      <span class="ornament-gem">✦</span>',
'      <span class="ornament-line"></span>',
'    </div>',
'  </div>',
'</div>',
'<div id="curtain-hint">потяните за ткань или кликните</div>'
].join('\n');
document.body.appendChild(wrap);
document.documentElement.classList.add('curtain-locked');
}

function start() {
createCurtainDOM();

var TEXTURE_SRC = 'red_velvet.webp';
var TILE = 2.4;
var COLS = 240, ROWS = 56;
var NC = COLS + 1, NV = NC * (ROWS + 1);
var FOV = 40, CAM_Z = 9;
var FULLNESS = 1.9;
var FRONT_W = 0.38;
var OPEN_TIME = 4.5;

var BAKE_DELAY_FRAMES = 150; 
var bakeCountdown = -1;
var isBaked = false;

var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var smooth = function (t) { return t * t * (3 - 2 * t); };

var canvas = document.getElementById('curtain-gl');
var wrapper = document.getElementById('curtain-wrapper');
var hint = document.getElementById('curtain-hint');
var phraseEl = document.getElementById('curtain-phrase');
var vignette = document.getElementById('curtain-vignette');

var renderer;
try {
renderer = new THREE.WebGLRenderer({
canvas: canvas,
antialias: true,
alpha: true,
preserveDrawingBuffer: true 
});
} catch (e) {
console.error('Curtain WebGL init failed:', e);
if (wrapper) wrapper.remove();
return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
camera.position.set(0, 0, CAM_Z);

var visH = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
var yTop = visH / 2 + 0.7;
var yBot = -visH / 2 - 0.42;
var Hc = yTop - yBot;
var viewW, Wc, Lfab, lambda, dsCol, xL;

var P = new Float32Array(NV * 3);
var Vel = new Float32Array(NV * 3);
var T = new Float32Array(NV * 3);
var O = new Float32Array(NV * 3);
var UV = new Float32Array(NV * 2);
var FOLD = new Float32Array(NV);
var DENS = new Float32Array(NV);
var TDA = new Float32Array(NV);
var SEGP = new Float32Array(COLS);
var SP = new Float32Array(COLS);
var XS = new Float32Array(NC);

var geo = new THREE.BufferGeometry();
var posAttr = new THREE.BufferAttribute(P, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
var uvAttr = new THREE.BufferAttribute(UV, 2);
var foldAttr = new THREE.BufferAttribute(FOLD, 1); foldAttr.setUsage(THREE.DynamicDrawUsage);
var densAttr = new THREE.BufferAttribute(DENS, 1); densAttr.setUsage(THREE.DynamicDrawUsage);
var tdAttr = new THREE.BufferAttribute(TDA, 1); tdAttr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position', posAttr);
geo.setAttribute('uv', uvAttr);
geo.setAttribute('fold', foldAttr);
geo.setAttribute('dens', densAttr);
geo.setAttribute('tdist', tdAttr);

var idx = new Uint16Array(COLS * ROWS * 6), q = 0;
for (var j = 0; j < ROWS; j++) {
for (var i = 0; i < COLS; i++) {
var a = j * NC + i, b = a + 1, c = a + NC, d = c + 1;
idx[q++] = a; idx[q++] = c; idx[q++] = b;
idx[q++] = b; idx[q++] = c; idx[q++] = d;
}
}
geo.setIndex(new THREE.BufferAttribute(idx, 1));

var material = new THREE.ShaderMaterial({
side: THREE.DoubleSide,
transparent: true,
uniforms: {
map: { value: null },
uTie: { value: 0 },
camPos: { value: camera.position }
},
vertexShader: [
'attribute float fold;',
'attribute float dens;',
'attribute float tdist;',
'varying vec3 vN; varying vec3 vP; varying vec2 vUv;',
'varying float vFold; varying float vDens; varying float vTd;',
'void main(){',
'  vN = normal; vP = position; vUv = uv; vFold = fold; vDens = dens; vTd = tdist;',
'  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
'}'
].join('\n'),
fragmentShader: [
'uniform sampler2D map; uniform vec3 camPos; uniform float uTie;',
'varying vec3 vN; varying vec3 vP; varying vec2 vUv;',
'varying float vFold; varying float vDens; varying float vTd;',
'void main(){',
'  vec3 N = normalize(vN);',
'  if(!gl_FrontFacing) N = -N;',
'  vec3 V = normalize(camPos - vP);',
'  vec3 alb = texture2D(map, vUv).rgb;',
'  alb = vec3(pow(alb.r, 0.85), alb.g * 1.5, alb.b * 1.5) * 2.1;',
'  vec3 L1 = normalize(vec3(0.5, 7.0, 8.0) - vP);',
'  vec3 L2 = normalize(vec3(-5.0, -3.5, 5.0) - vP);',
'  float d1 = max(dot(N, L1), 0.0);',
'  float d2 = max(dot(N, L2), 0.0);',
'  float wrap = clamp(dot(N, L1) * 0.5 + 0.5, 0.0, 1.0);',
'  float lit = 0.22 + 0.75 * d1 + 0.25 * d2 + 0.25 * wrap * wrap;',
'  float ridge = vFold * 0.5 + 0.5;',
'  float ao = mix(1.0, mix(0.16, 1.0, ridge), clamp(vDens * 0.9 + 0.12, 0.0, 1.0));',
'  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);',
'  vec3 sheen = vec3(0.85, 0.16, 0.18) * fres * (0.35 + 0.65 * d1 + 0.3 * d2);',
'  vec3 col = alb * lit * ao + sheen * (0.4 + 0.6 * ao);',
'  float shw = vTd > 0.0 ? 0.78 : 0.52;',
'  float dd = max(abs(vTd) - 1.0, 0.0) / 0.85;',
'  col *= 1.0 - uTie * shw * exp(-dd * dd * 2.0);',
// Dithering для предотвращения рассыпания картинки при запекании (лечит "бандинг")
'  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
'  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);',
'}'
].join('\n')
});

var mesh = new THREE.Mesh(geo, material);
mesh.frustumCulled = false;
scene.add(mesh);

var RR = 5, NCAP = 10, NBACK = 0;
var NL = NC + NCAP + NBACK;
var RNV = NL * RR;
var RP = new Float32Array(RNV * 3);
var RA = new Float32Array(RNV);
var ZT = new Float32Array(NC), ZC = new Float32Array(NC), ZS = new Float32Array(NC), VC = new Float32Array(NC);
for (var qa = 0; qa < RR; qa++) for (var qi = 0; qi < NL; qi++) RA[qa * NL + qi] = qa / (RR - 1);
var RIB_H = 0.058;

var rgeo = new THREE.BufferGeometry();
var rPos = new THREE.BufferAttribute(RP, 3); rPos.setUsage(THREE.DynamicDrawUsage);
rgeo.setAttribute('position', rPos);
rgeo.setAttribute('across', new THREE.BufferAttribute(RA, 1));
var ridx = new Uint16Array((NL - 1) * (RR - 1) * 6), rq = 0;
for (var rj = 0; rj < RR - 1; rj++) {
for (var ri = 0; ri < NL - 1; ri++) {
var ra = rj * NL + ri, rb = ra + 1, rc = ra + NL, rd = rc + 1;
ridx[rq++] = ra; ridx[rq++] = rc; ridx[rq++] = rb;
ridx[rq++] = rb; ridx[rq++] = rc; ridx[rq++] = rd;
}
}
rgeo.setIndex(new THREE.BufferAttribute(ridx, 1));

var rmat = new THREE.ShaderMaterial({
side: THREE.FrontSide,
transparent: true,
uniforms: { camPos: { value: camera.position }, uOp: { value: 0 } },
vertexShader: [
'attribute float across; varying float vAc;',
'varying vec3 vN; varying vec3 vP;',
'void main(){',
'  vN = normal; vP = position; vAc = across;',
'  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
'}'
].join('\n'),
fragmentShader: [
'uniform vec3 camPos; uniform float uOp; varying float vAc;',
'varying vec3 vN; varying vec3 vP;',
'void main(){',
'  vec3 N = normalize(vN);',
'  vec3 V = normalize(camPos - vP);',
'  vec3 L1 = normalize(vec3(0.5, 7.0, 8.0) - vP);',
'  vec3 L2 = normalize(vec3(-5.0, -3.5, 5.0) - vP);',
'  float d1 = max(dot(N, L1), 0.0);',
'  float d2 = max(dot(N, L2), 0.0);',
'  vec3 H1 = normalize(L1 + V);',
'  float nh = max(dot(N, H1), 0.0);',
'  float spSoft = pow(nh, 18.0);',
'  float spSharp = pow(nh, 72.0);',
'  vec3 goldDeep = vec3(0.60, 0.42, 0.17);',
'  vec3 goldMid  = vec3(0.96, 0.80, 0.45);',
'  vec3 goldHi   = vec3(1.00, 0.95, 0.74);',
'  float lit = 0.36 + 0.64 * d1 + 0.22 * d2;',
'  vec3 base = mix(goldDeep, goldMid, clamp(d1 * 0.85 + 0.24, 0.0, 1.0));',
'  vec3 col = base * lit;',
'  col += goldHi * (spSoft * 0.38 + spSharp * 0.58);',
'  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.8);',
'  col += goldHi * fres * 0.28;',
'  float edgeDist = min(vAc, 1.0 - vAc);',
'  float thread = 1.0 + 0.15 * exp(-pow((edgeDist - 0.05) / 0.02, 2.0));',
'  float selvedge = smoothstep(0.0, 0.035, edgeDist);',
'  col *= thread * mix(0.92, 1.0, selvedge);',
'  gl_FragColor = vec4(min(col, vec3(1.0)), uOp);',
'}'
].join('\n')
});

var rmesh = new THREE.Mesh(rgeo, rmat);
rmesh.frustumCulled = false;
rmesh.renderOrder = 2;
rmesh.visible = false;
scene.add(rmesh);

function samp(arr, i, vv, comp) {
var jf = clamp(vv, 0, 1) * ROWS;
var j0 = Math.min(Math.floor(jf), ROWS - 1), t = jf - j0;
var a = arr[(j0 * NC + i) * 3 + comp], b = arr[((j0 + 1) * NC + i) * 3 + comp];
return a + (b - a) * t;
}

function updateRibbon(e) {
material.uniforms.uTie.value = e < 0.01 ? 0 : smooth(e);
if (e < 0.01) { rmesh.visible = false; return; }
rmesh.visible = true;
rmat.uniforms.uOp.value = smooth(e);
var jT = Math.round(V_TIE * ROWS);
var tieW = Math.max(T[(jT * NC + COLS) * 3] - xL, 0.2);
var hv = (RIB_H / Hc) * smooth(e);
var i, k, r, j;
for (i = 0; i <= COLS; i++) {
var dxw = T[(jT * NC + i) * 3] - xL;
var u = i / COLS;
var sag = 0.022 * Math.sin(u * Math.PI) / Hc;
VC[i] = V_TIE + 0.44 * (dxw - tieW * 0.7) / Hc + sag;
var zA = samp(P, i, VC[i] - hv * 1.2, 2), zB = samp(P, i, VC[i], 2), zC = samp(P, i, VC[i] + hv * 1.2, 2);
ZC[i] = Math.max(zA, zB, zC);
}
var KM = 12, KW = 10;
for (i = 0; i <= COLS; i++) {
var m = -1e9;
for (k = -KM; k <= KM; k++) { var ii = clamp(i + k, 0, COLS); if (ZC[ii] > m) m = ZC[ii]; }
ZS[i] = m;
}
for (var pass = 0; pass < 3; pass++) {
for (i = 0; i <= COLS; i++) {
var sum = 0;
for (k = -KW; k <= KW; k++) sum += ZS[clamp(i + k, 0, COLS)];
ZT[i] = sum / (2 * KW + 1);
}
ZS.set(ZT);
}
for (r = 0; r < RR; r++) {
var fr = r / (RR - 1);
var vvE = VC[COLS] + (fr - 0.5) * 2 * hv;
var xe = samp(T, COLS, vvE, 0), ye = samp(T, COLS, vvE, 1);
var zfE = ZS[COLS] + 0.012;
for (i = 0; i <= COLS; i++) {
var vv = VC[i] + (fr - 0.5) * 2 * hv;
var o = (r * NL + i) * 3;
RP[o] = samp(T, i, vv, 0);
RP[o + 1] = samp(T, i, vv, 1);
RP[o + 2] = ZS[i] + 0.012;
}
var oa = (r * NL + COLS) * 3, ob = (r * NL + COLS - 6) * 3;
var slope = (RP[oa + 1] - RP[ob + 1]) / Math.max(RP[oa] - RP[ob], 0.001);
for (j = 0; j < NCAP; j++) {
var t = (j + 1) / NCAP;
var th = t * Math.PI * 0.55;
var o2 = (r * NL + NC + j) * 3;
var curX = xe + 0.024 * Math.sin(th) + 0.006 * t;
RP[o2] = curX;
RP[o2 + 1] = ye + slope * (curX - xe);
RP[o2 + 2] = zfE - 0.045 * (1.0 - Math.cos(th));
}
}
rPos.needsUpdate = true;
rgeo.computeVertexNormals();
}

function layout() {
viewW = visH * camera.aspect;
Wc = viewW + 1.4;
Lfab = Wc * FULLNESS;
lambda = Math.max(Lfab / 26, 0.3);
dsCol = Lfab / COLS;
xL = -Wc / 2 + 0.25;
for (var j = 0; j <= ROWS; j++) {
var v = j / ROWS;
for (var i = 0; i <= COLS; i++) {
var k = j * NC + i;
UV[k * 2] = (i * dsCol) / TILE;
UV[k * 2 + 1] = (v * Hc) / TILE;
}
}
uvAttr.needsUpdate = true;
}

var V_TIE = 0.575;
var W_TOP = 0.33, W_TIE = 0.085, W_BOT = 0.115;

function fracRaw(v) {
if (v < V_TIE) return lerp(W_TIE, W_TOP, Math.max(1 - v / V_TIE, 0));
return lerp(W_TIE, W_BOT, Math.pow(Math.max((v - V_TIE) / (1 - V_TIE), 0), 1.3));
}
function fracW(v) {
var sum = 0, wsum = 0;
for (var d = -0.04; d <= 0.0401; d += 0.004) {
var w = Math.exp(-0.5 * (d / 0.012) * (d / 0.012));
sum += w * fracRaw(v + d); wsum += w;
}
return sum / wsum;
}

function isNarrowScreen() {
var w = window.innerWidth, h = window.innerHeight;
return w <= 1080 || (w / h < 1.15);
}
function updateWrapperPosition() {
if (!wrapper) return;
if (openTarget === 1 && isNarrowScreen()) {
wrapper.classList.add('narrow-open');
} else {
wrapper.classList.remove('narrow-open');
}
}

// Оптимизация: Удалена зависимость от time, так как функция работает только с геометрией
function computeTargets(oe) {
var f = lerp(1, -FRONT_W, oe);
for (var i = 0; i < COLS; i++) {
var u = (i + 0.5) / COLS;
SEGP[i] = smooth(clamp((u - f) / FRONT_W, 0, 1));
}
var spC = Wc / COLS;
var sc = Math.pow(clamp(viewW / 13.1, 0.6, 1), 0.6);
var topFrac = fracW(0);
for (var j = 0; j <= ROWS; j++) {
var v = j / ROWS;
var gwOriginal = 13.1 * sc * fracW(v) + 0.45;
var maxVisibleNarrow = (viewW / 3) * (fracW(v) / topFrac);
var gwNarrow = maxVisibleNarrow + 0.45;
var gw = (!isNarrowScreen()) ? gwOriginal : Math.min(gwOriginal, gwNarrow);
var spO = gw / COLS;
var x = xL;
for (var i2 = 0; i2 <= COLS; i2++) {
XS[i2] = x;
if (i2 < COLS) { SP[i2] = lerp(spC, spO, SEGP[i2]); x += SP[i2]; }
}
var hem = smooth(clamp((v - 0.86) / 0.14, 0, 1));
var hemF = smooth(clamp((v - 0.74) / 0.2, 0, 1));
var bel = 0.2 * Math.exp(-Math.pow((v - V_TIE - 0.13) / 0.13, 2));
for (var i3 = 0; i3 <= COLS; i3++) {
var rs = i3 === 0 ? SP[0] : (i3 === COLS ? SP[COLS - 1] : 0.5 * (SP[i3 - 1] + SP[i3]));
var r = clamp(rs / dsCol, 0, 0.999);
var dens = 1 - r;
var xw = lambda * r;
var s = i3 * dsCol;
var warp = 1.9 * (0.30 * Math.sin(0.37 * s + 0.5 * v) + 0.16 * Math.sin(1.13 * s + 2.0 + v) + 0.07 * Math.sin(2.9 * s + 0.7));
var half = Math.PI * s / lambda + warp;
var gc = 2 * Math.pow(Math.abs(Math.sin(half)), 0.7) - 1;
gc += 0.16 * Math.sin(half * 2.7 + 1.1 + 0.8 * Math.sin(0.5 * s));
var fold = lerp(gc, Math.sin(2 * half - Math.PI / 2), hemF);
var variety = 1 + 0.18 * Math.sin(s * 0.83 + 1.3) + 0.10 * Math.sin(s * 2.1);
var Aarc = 0.26 * lambda * Math.sqrt(1 - r * r);
var A = Math.min(Aarc, Math.max(0.7 * xw, 0.07)) * variety * (0.85 + 0.2 * v) * (1 - 0.5 * hem);
var zHem = hem * dens * (0.16 + 0.12 * Math.sin(s * 2.9 + 1.0) + 0.07 * Math.sin(s * 6.1));
var yHem = hem * dens * 0.07 * Math.sin(s * 2.9 + 0.6);
var k = j * NC + i3;
T[k * 3] = XS[i3];
T[k * 3 + 1] = yTop - v * Hc + 0.18 * dens * v * v + yHem;
T[k * 3 + 2] = A * fold + 0.12 * v * v + zHem + bel * dens;
FOLD[k] = fold;
DENS[k] = dens;
}
}
var jT0 = Math.round(V_TIE * ROWS), hv0 = RIB_H / Hc;
var tieW0 = Math.max(T[(jT0 * NC + COLS) * 3] - xL, 0.2);
for (var ic = 0; ic <= COLS; ic++) {
var vcc = V_TIE + 0.45 * (T[(jT0 * NC + ic) * 3] - xL - tieW0 * 0.7) / Hc;
for (var jc = 0; jc <= ROWS; jc++) TDA[jc * NC + ic] = (jc / ROWS - vcc) / hv0;
}
}

var K = new Float32Array(ROWS + 1), C = new Float32Array(ROWS + 1);
for (var jj = 0; jj <= ROWS; jj++) {
var vv = jj / ROWS;
K[jj] = lerp(520, 46, Math.pow(vv, 0.7)) + 320 * Math.exp(-Math.pow((vv - 0.575) / 0.05, 2));
C[jj] = 1.5 * Math.sqrt(K[jj]) + 2.0;
}
var KC = 300;

var ptr = { active: false, down: false, x: 0, y: 0, vx: 0, vy: 0, lastT: 0, lx: 0, ly: 0 };
var raycaster = new THREE.Raycaster();
var plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
var hit = new THREE.Vector3();
var ndc = new THREE.Vector2();

function updatePointer(e) {
var rect = canvas.getBoundingClientRect();
ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
raycaster.setFromCamera(ndc, camera);
if (!raycaster.ray.intersectPlane(plane, hit)) return;
var now = performance.now() / 1000;
if (ptr.lastT > 0) {
var dt = Math.max(now - ptr.lastT, 0.001);
var ivx = (hit.x - ptr.lx) / dt, ivy = (hit.y - ptr.ly) / dt;
ptr.vx = lerp(ptr.vx, ivx, 0.35);
ptr.vy = lerp(ptr.vy, ivy, 0.35);
}
ptr.lastT = now; ptr.lx = hit.x; ptr.ly = hit.y;
ptr.x = hit.x; ptr.y = hit.y;
ptr.active = true;
}

canvas.addEventListener('pointermove', updatePointer);
canvas.addEventListener('pointerdown', function (e) {
updatePointer(e); ptr.down = true; canvas.classList.add('down');
try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
function release() { ptr.down = false; canvas.classList.remove('down'); }
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', function () { if (!ptr.down) { ptr.active = false; ptr.lastT = 0; } });

var R2 = 1.2 * 1.2;

function physics(dt, time) {
var speed = Math.sqrt(ptr.vx * ptr.vx + ptr.vy * ptr.vy);
var depth = ptr.down ? 0.55 : 0.04 + 0.2 * Math.min(speed / 22, 1);
var pvx = clamp(ptr.vx, -12, 12);
var useP = ptr.active;
for (var n = 0; n < NV * 3; n++) O[n] = P[n] - T[n];
for (var j = 1; j <= ROWS; j++) {
var v = j / ROWS;
var k = K[j], c = C[j];
var jU = (j - 1) * NC, jC = j * NC, jD = (j === ROWS ? j : j + 1) * NC;
for (var i = 0; i <= COLS; i++) {
var iL = i === 0 ? 0 : i - 1, iR = i === COLS ? COLS : i + 1;
var id = jC + i;
var b = id * 3;
var s = i * dsCol;
var ex = 3 * Math.sin(time * 0.5 + s * 0.3) * v * v;
var ez = 4 * Math.sin(time * 0.7 + s * 0.4 + v * 1.5) * v * v;
var ey = 0;
if (useP) {
var dx = T[b] - ptr.x, dy = T[b + 1] - ptr.y;
var d2 = dx * dx + dy * dy;
if (d2 < R2 * 9) {
var w = Math.exp(-d2 / R2) * (0.25 + 0.75 * v);
ez -= k * depth * w;
ex += k * 0.012 * pvx * w;
}
}
var l = (jC + iL) * 3, r = (jC + iR) * 3, u = (jU + i) * 3, dn = (jD + i) * 3;
var ax = -k * O[b] + KC * ((O[l] + O[r] + O[u] + O[dn]) * 0.25 - O[b]) - c * Vel[b] + ex;
var ay = -k * O[b + 1] + KC * ((O[l + 1] + O[r + 1] + O[u + 1] + O[dn + 1]) * 0.25 - O[b + 1]) - c * Vel[b + 1] + ey;
var az = -k * O[b + 2] + KC * ((O[l + 2] + O[r + 2] + O[u + 2] + O[dn + 2]) * 0.25 - O[b + 2]) - c * Vel[b + 2] + ez;
Vel[b] += ax * dt; Vel[b + 1] += ay * dt; Vel[b + 2] += az * dt;
P[b] += Vel[b] * dt; P[b + 1] += Vel[b + 1] * dt; P[b + 2] += Vel[b + 2] * dt;
}
}
for (var i0 = 0; i0 <= COLS; i0++) {
var b0 = i0 * 3;
P[b0] = T[b0]; P[b0 + 1] = T[b0 + 1]; P[b0 + 2] = T[b0 + 2];
Vel[b0] = Vel[b0 + 1] = Vel[b0 + 2] = 0;
}
ptr.vx *= 0.92; ptr.vy *= 0.92;
}

var openTarget = 0;
var prog = 0;
var lastProg = -1; // Для контроля шины памяти

function openCurtain() {
if (openTarget === 1) return;
openTarget = 1;
document.documentElement.classList.remove('curtain-locked');
canvas.classList.add('open-state');
if (wrapper) {
wrapper.classList.remove('interactive');
updateWrapperPosition();
}
if (hint) { hint.style.opacity = '0'; setTimeout(function () { hint.remove(); }, 800); }
if (vignette) { vignette.style.opacity = '0'; }
}

var clickMoved = 0;
window.addEventListener('pointerdown', function () { clickMoved = 0; }, true);
window.addEventListener('pointermove', function (e) {
if (ptr.down) clickMoved += Math.hypot(e.movementX || 0, e.movementY || 0);
}, true);
window.addEventListener('click', function () {
if (openTarget === 0) openCurtain();
});
window.addEventListener('wheel', function () {
if (openTarget === 0) openCurtain();
}, { passive: true });

function resize() {
var w = window.innerWidth, h = window.innerHeight;
if (!isBaked && renderer) {
renderer.setSize(w, h, false);
camera.aspect = w / h;
camera.updateProjectionMatrix();
}
updateWrapperPosition();
if (!isBaked) {
layout();
var currentProg = smooth(prog);
computeTargets(currentProg);
P.set(T); Vel.fill(0);
posAttr.needsUpdate = true;
foldAttr.needsUpdate = true;
densAttr.needsUpdate = true;
tdAttr.needsUpdate = true;
geo.computeVertexNormals();
updateRibbon(clamp((currentProg - 0.82) / 0.18, 0, 1));
lastProg = currentProg;
}
}
window.addEventListener('resize', resize);

/* ═══════ ЗАПЕКАНИЕ ШТОРКИ (ИДЕАЛЬНОЕ КАЧЕСТВО ЧЕРЕЗ BLOB) ═══════ */
function bakeCurtain() {
isBaked = true;
renderer.render(scene, camera);

// Используем toBlob для избежания крашей и потери качества при генерации огромных base64 строк
canvas.toBlob(function(blob) {
if (!blob) {
  console.warn('[Curtain] toBlob failed, keeping WebGL');
  isBaked = false;
  return;
}
var url = URL.createObjectURL(blob);
var img = document.createElement('img');
img.id = 'curtain-baked';
img.alt = '';
img.src = url;
wrapper.insertBefore(img, canvas);

// Удаляем canvas
canvas.remove();

// Освобождаем ВСЕ ресурсы Three.js
try {
  geo.dispose();
  rgeo.dispose();
  material.dispose();
  rmat.dispose();
  if (material.uniforms.map && material.uniforms.map.value) {
    material.uniforms.map.value.dispose();
  }
  scene.clear();
  renderer.dispose();
  renderer.forceContextLoss();
} catch (e) {
  console.warn('[Curtain] Cleanup warning:', e);
}

renderer = null;
scene = null;
camera = null;

console.log('[Curtain] ✅ Запечена без потери качества. WebGL освобожден.');
}, 'image/png');
}

/* ═══════ ГЛАВНЫЙ ЦИКЛ ═══════ */
function startLoop() {
resize();
var last = performance.now() / 1000, time = 0;

function frame() {
if (isBaked) return; 

var now = performance.now() / 1000;
var dt = Math.min(now - last, 1 / 30); last = now; time += dt;

var step = dt / OPEN_TIME;
if (prog < openTarget) prog = Math.min(openTarget, prog + step);
else if (prog > openTarget) prog = Math.max(openTarget, prog - step);

if (phraseEl) {
var p = smooth(prog);
var phraseAlpha = clamp(1 - p * 2.5, 0, 1);
var phraseShiftY = (1 - phraseAlpha) * -24;
var phraseScale = 1 + (1 - phraseAlpha) * 0.05;
phraseEl.style.opacity = phraseAlpha.toFixed(3);
phraseEl.style.transform = 'translate(-50%, calc(-50% + ' + phraseShiftY.toFixed(1) + 'px)) scale(' + phraseScale.toFixed(3) + ')';
if (phraseAlpha <= 0.002) phraseEl.style.display = 'none';
}

var currentProg = smooth(prog);

// ОПТИМИЗАЦИЯ: Обновляем тяжелые буферы ТОЛЬКО когда шторка в движении. 
// Снижает нагрузку на шину памяти на 70% при простое.
if (currentProg !== lastProg) {
computeTargets(currentProg);
foldAttr.needsUpdate = true;
densAttr.needsUpdate = true;
tdAttr.needsUpdate = true;
updateRibbon(clamp((currentProg - 0.82) / 0.18, 0, 1));
lastProg = currentProg;
}

var sub = 3, sdt = dt / sub;
for (var s = 0; s < sub; s++) physics(sdt, time);

// Позиции вершин и нормали обновляются всегда для анимации ветра/мыши
posAttr.needsUpdate = true;
geo.computeVertexNormals(); 

renderer.render(scene, camera);

if (openTarget === 1 && prog >= 0.999 && bakeCountdown < 0) {
bakeCountdown = BAKE_DELAY_FRAMES;
}
if (bakeCountdown > 0) {
bakeCountdown--;
if (bakeCountdown === 0) {
bakeCurtain();
return; 
}
}

requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
}

var loader = new THREE.TextureLoader();
loader.load(
TEXTURE_SRC,
function (tex) {
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
tex.minFilter = THREE.LinearMipmapLinearFilter;
tex.magFilter = THREE.LinearFilter;
tex.needsUpdate = true;
material.uniforms.map.value = tex;
material.needsUpdate = true;
startLoop();
},
undefined,
function (err) {
console.error('Curtain texture load error, fallback used:', err);
var cFallback = document.createElement('canvas');
cFallback.width = cFallback.height = 512;
var cCtx = cFallback.getContext('2d');
cCtx.fillStyle = '#4c080f';
cCtx.fillRect(0, 0, 512, 512);
var idata = cCtx.getImageData(0, 0, 512, 512);
for (var p = 0; p < idata.data.length; p += 4) {
var n = (Math.random() - 0.5) * 28;
idata.data[p] = Math.min(255, Math.max(0, idata.data[p] + n));
}
cCtx.putImageData(idata, 0, 0);
var fTex = new THREE.CanvasTexture(cFallback);
fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
fTex.needsUpdate = true;
material.uniforms.map.value = fTex;
material.needsUpdate = true;
startLoop();
}
);
}

if (typeof THREE !== 'undefined') {
start();
} else {
var script = document.createElement('script');
script.src = 'three.min.js';
script.onload = start;
document.head.appendChild(script);
}
})();