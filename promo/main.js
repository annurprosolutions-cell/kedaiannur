// Adegan Three.js video promosi TikTok 1080 x 1920. Semua keadaan ialah fungsi bagi masa t, supaya render.mjs
// boleh merakam frame demi frame (window.renderFrame(t) pulang JPEG data URL).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import qrcode from '/vendor/qrcode-generator-2.0.4.js';
import { LW, LH, screenMerchant, screenCustomer, setMark, setPhotos, lerp, easeOut, easeInOut, easeBack } from './ui.js';

const W = 1080;
const H = 1920;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const rand = (seed) => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };

// ------------------------------------------------------------------ renderer, adegan, kamera
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 1.1;
const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 60);

// latar belakang: gradien gelap dengan cahaya teal dan amber
{
  const c = document.createElement('canvas');
  c.width = 540; c.height = 960;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 960);
  g.addColorStop(0, '#060a16'); g.addColorStop(0.55, '#0a1a2c'); g.addColorStop(1, '#05080f');
  x.fillStyle = g; x.fillRect(0, 0, 540, 960);
  const r1 = x.createRadialGradient(150, 620, 10, 150, 620, 420);
  r1.addColorStop(0, 'rgba(15,118,110,0.55)'); r1.addColorStop(1, 'rgba(15,118,110,0)');
  x.fillStyle = r1; x.fillRect(0, 0, 540, 960);
  const r2 = x.createRadialGradient(450, 300, 10, 450, 300, 330);
  r2.addColorStop(0, 'rgba(251,191,36,0.28)'); r2.addColorStop(1, 'rgba(251,191,36,0)');
  x.fillStyle = r2; x.fillRect(0, 0, 540, 960);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

scene.add(new THREE.HemisphereLight(0xbfe8ff, 0x0b1224, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-2.5, 3.5, 4);
scene.add(key);
const rimTeal = new THREE.PointLight(0x2dd4bf, 14, 12);
rimTeal.position.set(-2.8, 0.6, -2);
scene.add(rimTeal);
const rimAmber = new THREE.PointLight(0xfbbf24, 12, 12);
rimAmber.position.set(2.8, 1.8, -1.5);
scene.add(rimAmber);

// ------------------------------------------------------------------ tekstur pembantu
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();

function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2; const y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedPlane(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 10);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

// ------------------------------------------------------------------ model phone
const PW = 0.78; const PH = 1.62; const PD = 0.09;
const SW = 0.72; const SH = 1.54;
const SCALE = 1.6; // kanvas skrin 576 x 1232

function makePhone(bodyColor, rough = 0.3) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: bodyColor, metalness: 0.92, roughness: rough, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PD, 8, 0.115), bodyMat);
  g.add(body);
  const black = new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.35, metalness: 0.2 });
  const bezel = new THREE.Mesh(roundedPlane(PW - 0.03, PH - 0.03, 0.1), black);
  bezel.position.z = PD / 2 + 0.001;
  g.add(bezel);

  const canvas = document.createElement('canvas');
  canvas.width = LW * SCALE; canvas.height = LH * SCALE;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const screen = new THREE.Mesh(roundedPlane(SW, SH, 0.082), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = PD / 2 + 0.002;
  g.add(screen);

  // kilau kaca yang bergerak melintasi skrin
  const gc = document.createElement('canvas');
  gc.width = 128; gc.height = 256;
  const gx = gc.getContext('2d');
  const gg = gx.createLinearGradient(0, 0, 128, 0);
  gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.3, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, 'rgba(255,255,255,0.085)');
  gg.addColorStop(0.7, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = gg; gx.fillRect(0, 0, 128, 256);
  const gtex = new THREE.CanvasTexture(gc);
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
  gtex.center.set(0.5, 0.5);
  gtex.rotation = 0.5;
  gtex.repeat.set(1.4, 1.4);
  const glare = new THREE.Mesh(roundedPlane(SW, SH, 0.082), new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glare.position.z = PD / 2 + 0.003;
  g.add(glare);

  const island = new THREE.Mesh(roundedPlane(0.2, 0.055, 0.0275), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  island.position.set(0, PH / 2 - 0.085, PD / 2 + 0.0035);
  g.add(island);

  // belakang: modul kamera
  const cam = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.32, 0.03, 4, 0.07), new THREE.MeshPhysicalMaterial({ color: bodyColor, metalness: 0.7, roughness: 0.4 }));
  cam.position.set(-0.17, PH / 2 - 0.22, -PD / 2 - 0.012);
  g.add(cam);
  for (const [lx, ly] of [[-0.07, 0.06], [0.07, 0.06], [0, -0.07]]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 28), new THREE.MeshPhysicalMaterial({ color: 0x0a0d14, metalness: 0.9, roughness: 0.12, clearcoat: 1 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(-0.17 + lx, PH / 2 - 0.22 + ly, -PD / 2 - 0.03);
    g.add(lens);
  }
  // butang sisi
  for (const [sx, sy, sh] of [[-1, 0.3, 0.2], [-1, 0.05, 0.12], [1, 0.22, 0.3]]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.014, sh, 0.03, 2, 0.006), bodyMat);
    b.position.set(sx * (PW / 2 + 0.003), sy, 0);
    g.add(b);
  }
  // cahaya lembut di belakang phone
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x14b8a6, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(3.4, 4.4, 1);
  halo.position.z = -0.5;
  g.add(halo);
  g.userData = { ctx, tex, gtex, halo };
  scene.add(g);
  return g;
}
const phoneM = makePhone(0x3b4658, 0.26);
const phoneC = makePhone(0xd6dae2, 0.3);

// ------------------------------------------------------------------ gelembung chat (hook)
const MESSAGES = [
  ['Abang ada burger beef?', 0], ['Harga berapa ya?', 0], ['Boleh COD tak?', 1], ['Nak order 2 burger', 0],
  ['Stok ada lagi?', 0], ['Hantar gambar boleh?', 1], ['Tadi saya dah tanya...', 0], ['Bank mana nak transfer?', 1],
  ['Berapa semua?', 0], ['Ada burger ayam?', 0], ['Hello?', 1], ['Lambat balas...', 0],
];
function bubbleTexture(label, mine) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = mine ? '#d9fdd3' : '#ffffff';
  const r = 34;
  x.beginPath(); x.moveTo(r, 10); x.arcTo(502, 10, 502, 150, r); x.arcTo(502, 150, 10, 150, r); x.arcTo(10, 150, 10, 10, r); x.arcTo(10, 10, 502, 10, r); x.fill();
  x.fillStyle = '#0f172a';
  x.font = '600 44px Inter, system-ui, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(label, 38, 80);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const bubbles = MESSAGES.map(([label, mine], i) => {
  const rnd = rand(i + 3);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.3125), new THREE.MeshBasicMaterial({ map: bubbleTexture(label, mine), transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, t0: 0.15 + i * 0.36, x0: (rnd() - 0.5) * 2.0, y0: (rnd() - 0.82) * 2.3, tilt: (rnd() - 0.5) * 0.5, spin: (rnd() - 0.5) * 0.9, ph: rnd() * 6 };
});

// ------------------------------------------------------------------ zarah
const PCOUNT = 420;
const pgeo = new THREE.BufferGeometry();
{
  const rnd = rand(77);
  const pos = new Float32Array(PCOUNT * 3);
  const col = new Float32Array(PCOUNT * 3);
  for (let i = 0; i < PCOUNT; i++) {
    pos.set([(rnd() - 0.5) * 9, (rnd() - 0.5) * 12, -4 + rnd() * 7], i * 3);
    const c = new THREE.Color(rnd() > 0.55 ? 0x2dd4bf : 0xfbbf24);
    col.set([c.r, c.g, c.b], i * 3);
  }
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.07, map: GLOW, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(particles);

// letupan di titik tertentu (reveal dan ketibaan order)
const BURST_N = 60;
function makeBurst(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, map: GLOW, color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.frustumCulled = false;
  scene.add(p);
  const rnd = rand(5);
  const dirs = Array.from({ length: BURST_N }, () => { const a = rnd() * Math.PI * 2; const b = (rnd() - 0.5) * Math.PI; return [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b), 0.6 + rnd()]; });
  return { p, dirs };
}
const burstA = makeBurst(0xfbbf24);
const burstB = makeBurst(0x25d366);
function updateBurst(b, t, t0, origin, radius = 1.6) {
  const d = t - t0;
  b.p.visible = d > 0 && d < 1.4;
  if (!b.p.visible) return;
  const pos = b.p.geometry.attributes.position;
  const k = easeOut(d / 1.2);
  b.dirs.forEach(([x, y, z, s], i) => pos.setXYZ(i, origin.x + x * s * radius * k, origin.y + y * s * radius * k, origin.z + z * s * radius * k));
  pos.needsUpdate = true;
  b.p.material.opacity = 1 - seg(d, 0.2, 1.4);
}

// paket order (gelembung hijau) yang terbang dari telefon pelanggan ke telefon peniaga
const packetTex = (() => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#25d366';
  x.beginPath(); x.moveTo(40, 8); x.arcTo(312, 8, 312, 160, 40); x.arcTo(312, 160, 8, 160, 40); x.arcTo(8, 160, 8, 8, 40); x.arcTo(8, 8, 312, 8, 40); x.fill();
  x.beginPath(); x.moveTo(60, 150); x.lineTo(40, 195); x.lineTo(100, 156); x.fill();
  x.fillStyle = '#fff'; x.font = '800 62px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('Order!', 160, 70);
  x.font = '700 40px Inter, system-ui, sans-serif'; x.fillText('RM35.00', 160, 124);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const packetMat = new THREE.MeshBasicMaterial({ map: packetTex, transparent: true, toneMapped: false });
const packet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3125), packetMat);
const packetBack = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3125), packetMat);
packetBack.rotation.y = Math.PI;
packetBack.position.z = -0.002;
packet.add(packetBack);
packet.visible = false;
scene.add(packet);
const TRAIL = 22;
const trail = Array.from({ length: TRAIL }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x25d366, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.visible = false; scene.add(s); return s;
});
const FLY0 = 45.7;
const FLY1 = 47.45;
const P0 = new THREE.Vector3(0.62, 0.42, 0.25);
const P1 = new THREE.Vector3(0.0, 1.25, 1.1);
const P2 = new THREE.Vector3(-0.62, 0.3, 0.25);
function flightPos(k, out) {
  const e = easeInOut(k);
  out.set(0, 0, 0);
  out.addScaledVector(P0, (1 - e) * (1 - e)).addScaledVector(P1, 2 * (1 - e) * e).addScaledVector(P2, e * e);
  return out;
}

// ------------------------------------------------------------------ keadaan telefon
function mState(t) {
  let s = 1; let x = 0; let y = 0; let ry = 0; let rz = 0;
  if (t < 5) s = 0.0001;
  else if (t < 6.6) {
    const k = (t - 5) / 1.6;
    s = Math.max(0.0001, easeBack(Math.min(1, k * 1.5)));
    y = lerp(-1.8, 0, easeOut(k));
    ry = lerp(-Math.PI * 1.7, 0, easeOut(k));
  }
  const sl = easeInOut(seg(t, 33.1, 34.4));
  x = lerp(0, -0.62, sl);
  ry += lerp(0, 0.22, sl);
  const cta = easeInOut(seg(t, 56, 57.2));
  x = lerp(x, -0.5, cta);
  ry += lerp(0, 0.18, cta);
  y += Math.sin(t * 1.3) * 0.022;
  ry += Math.sin(t * 0.6) * 0.05;
  if (t >= 47.45 && t < 48.4) rz = Math.sin(t * 70) * 0.035 * (1 - seg(t, 47.45, 48.4));
  return { s, x, y, ry, rz, z: 0 };
}
function cState(t) {
  const k = seg(t, 33.4, 34.5);
  const s = t < 33.4 ? 0.0001 : Math.max(0.0001, easeBack(k));
  const cta = easeInOut(seg(t, 56, 57.2));
  return { s, x: lerp(0.62, 0.5, cta), y: Math.sin(t * 1.2 + 1) * 0.022 + lerp(-0.3, 0, easeOut(k)), ry: -0.22 - cta * 0.18 + Math.sin(t * 0.55 + 1) * 0.05, rz: 0, z: 0 };
}
function applyPhone(g, st) {
  g.visible = st.s > 0.001;
  g.scale.setScalar(st.s);
  g.position.set(st.x, st.y, st.z);
  g.rotation.set(0, st.ry, st.rz);
}

// ------------------------------------------------------------------ kamera
const CAM = [
  [0, 0.0, 0.05, 5.2, 0, 0.1], [4.6, -0.08, 0.08, 5.7, 0, 0.1], [5.0, 0.0, 0.05, 5.4, 0, 0.05],
  [7.5, 0.18, 0.1, 4.4, 0, 0.25], [10, 0.1, 0.06, 3.95, 0, 0.36], [15, -0.12, 0.05, 3.9, 0, 0.36], [20, 0.12, 0.05, 3.9, 0, 0.36],
  [28, -0.1, 0.06, 3.95, 0, 0.36], [33.2, 0.0, 0.05, 4.0, 0, 0.36],
  [34.9, -0.16, 0.05, 3.95, 0.62, 0.36], [44.8, 0.1, 0.05, 3.95, 0.62, 0.36],
  [46.1, 0.0, 0.1, 6.9, 0, 0.2], [47.6, 0.3, 0.06, 5.2, -0.2, 0.25],
  [49.3, 0.14, 0.05, 3.95, -0.62, 0.36], [55.4, -0.08, 0.05, 3.8, -0.62, 0.36],
  [56.6, 0.0, 0.08, 6.3, 0, 0.55], [60, 0.05, 0.06, 5.7, 0, 0.5],
];
function camAt(t) {
  let i = 0;
  while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
  const a = CAM[i]; const b = CAM[i + 1];
  const p0 = CAM[Math.max(0, i - 1)]; const p3 = CAM[Math.min(CAM.length - 1, i + 2)];
  const u = clamp((t - a[0]) / (b[0] - a[0]));
  const out = [];
  for (let k = 1; k < 6; k++) {
    // Catmull-Rom bukan seragam (tangen mengikut selang masa)
    const m1 = (b[k] - p0[k]) / (b[0] - p0[0]) * (b[0] - a[0]);
    const m2 = (p3[k] - a[k]) / (p3[0] - a[0]) * (b[0] - a[0]);
    const u2 = u * u; const u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * a[k] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * m2);
  }
  return out;
}

// ------------------------------------------------------------------ kapsyen (lapisan 2D)
const out = document.createElement('canvas');
out.width = W; out.height = H;
const octx = out.getContext('2d');
document.body.appendChild(out);
out.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:640px';
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const CAPTIONS = [
  [0.2, 2.6, { lines: ['Order masuk WhatsApp', 'berselerak?'] }],
  [2.7, 4.9, { lines: ['Tanya harga. Tanya stok.', 'Ulang benda sama.'] }],
  [5.6, 7.8, { lines: ['Kenalkan', 'Kedai AnnurPro'], big: true }],
  [7.9, 9.9, { lines: ['Satu link. Katalog siap.', 'Order terus ke WhatsApp.'] }],
  [10.1, 19.8, { step: 1, lines: ['Log masuk Google,', 'isi nama & nombor WhatsApp'] }],
  [20.1, 27.9, { step: 2, lines: ['Letak gambar, harga', '& kategori produk'] }],
  [28.1, 33.6, { step: 3, lines: ['Kongsi link atau kod QR', 'di mana-mana'] }],
  [34.4, 41.0, { lines: ['Pelanggan pilih sendiri', 'dan masuk troli'] }],
  [41.2, 45.5, { lines: ['Isi nama,', 'tekan Hantar ke WhatsApp'] }],
  [45.9, 47.3, { lines: ['Order dihantar...'] }],
  [47.7, 55.8, { lines: ['Order siap tersusun', 'masuk WhatsApp kau!'], accent: true }],
];

function roundRect(x, y, w, h, r) {
  octx.beginPath();
  octx.moveTo(x + r, y); octx.arcTo(x + w, y, x + w, y + h, r); octx.arcTo(x + w, y + h, x, y + h, r); octx.arcTo(x, y + h, x, y, r); octx.arcTo(x, y, x + w, y, r); octx.closePath();
}

function drawCaption(t0, t1, cap, t) {
  const inK = easeBack(seg(t, t0, t0 + 0.4));
  const outK = 1 - seg(t, t1 - 0.25, t1);
  if (inK <= 0 || outK <= 0) return;
  const size = cap.big ? 84 : 56;
  octx.save();
  octx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  const widths = cap.lines.map((l) => octx.measureText(l).width);
  const bw = Math.max(...widths) + 90 + (cap.step ? 110 : 0);
  const lh = size * 1.18;
  const bh = lh * cap.lines.length + 56;
  const cx = W / 2;
  const cy = 290 + bh / 2 - 60;
  octx.globalAlpha = clamp(outK);
  octx.translate(cx, cy); octx.scale(0.9 + 0.1 * clamp(inK, 0, 1.15), 0.9 + 0.1 * clamp(inK, 0, 1.15)); octx.translate(-cx, -cy);
  octx.shadowColor = 'rgba(0,0,0,0.45)'; octx.shadowBlur = 30; octx.shadowOffsetY = 10;
  roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 44);
  octx.fillStyle = cap.accent ? 'rgba(15,118,110,0.92)' : (t < 5 ? 'rgba(8,12,24,0.88)' : 'rgba(8,12,24,0.66)');
  octx.fill();
  octx.shadowColor = 'transparent';
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  const tx = cx + (cap.step ? 52 : 0);
  cap.lines.forEach((l, i) => {
    octx.fillStyle = '#fff';
    octx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    octx.fillText(l, tx, cy - bh / 2 + 28 + lh * (i + 0.5) + 2);
  });
  if (cap.step) {
    octx.fillStyle = '#fbbf24';
    octx.beginPath(); octx.arc(cx - bw / 2 + 80, cy, 46, 0, 7); octx.fill();
    octx.fillStyle = '#0f172a'; octx.font = '800 64px Inter, system-ui, sans-serif';
    octx.fillText(String(cap.step), cx - bw / 2 + 80, cy + 3);
  }
  octx.restore();
}

function drawHook(t) {
  if (t > 4.9) return;
  const n = Math.floor(lerp(1, 37, easeOut(seg(t, 0.3, 4.6)) ** 0.8));
  const pop = easeBack(seg(t, 0.25, 0.7));
  octx.save();
  octx.globalAlpha = 1 - seg(t, 4.6, 4.9);
  octx.translate(W / 2, 1480); octx.scale(pop, pop);
  octx.fillStyle = '#ef4444';
  roundRect(-250, -66, 500, 132, 66); octx.fill();
  octx.fillStyle = '#fff'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.font = '800 84px Inter, system-ui, sans-serif';
  octx.fillText(String(n), -122, 4);
  octx.font = '700 34px Inter, system-ui, sans-serif';
  octx.fillText('mesej', 70, -18);
  octx.fillText('belum dibalas', 70, 22);
  octx.restore();
}

function drawCTA(t) {
  const k = easeBack(seg(t, 56.3, 56.9));
  if (k <= 0) return;
  octx.save();
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.translate(W / 2, 400); octx.scale(k, k);
  octx.shadowColor = 'rgba(0,0,0,0.55)'; octx.shadowBlur = 36; octx.shadowOffsetY = 12;
  octx.fillStyle = '#fff'; octx.font = '800 118px Inter, system-ui, sans-serif';
  octx.fillText('Mula percuma', 0, -50);
  octx.shadowColor = 'transparent';
  octx.fillStyle = '#fbbf24';
  roundRect(-380, 20, 760, 112, 56); octx.fill();
  octx.fillStyle = '#0f172a'; octx.font = '800 58px Inter, system-ui, sans-serif';
  octx.fillText('kedai.annurpro.com', 0, 78);
  octx.restore();
  const k2 = easeOut(seg(t, 57.4, 58.0));
  octx.save();
  octx.globalAlpha = k2; octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.shadowColor = 'rgba(0,0,0,0.6)'; octx.shadowBlur = 20;
  octx.fillStyle = '#e2e8f0'; octx.font = '600 44px Inter, system-ui, sans-serif';
  octx.fillText('Cuba demo: kedai.annurpro.com/contoh', W / 2, 570 + (1 - k2) * 20);
  octx.restore();
}

function drawFlash(t) {
  const a = Math.max(0.9 * (1 - seg(t, 5.0, 5.4)) * (t >= 5.0 ? 1 : 0), 0.35 * (1 - seg(t, 56.0, 56.35)) * (t >= 56 ? 1 : 0), 0.5 * (1 - seg(t, 47.45, 47.8)) * (t >= 47.45 ? 1 : 0));
  if (a <= 0.01) return;
  octx.save(); octx.globalAlpha = a; octx.fillStyle = '#fff'; octx.fillRect(0, 0, W, H); octx.restore();
}

function drawVignette() {
  const g = octx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  octx.fillStyle = g; octx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ rangka demi rangka
let qr = null;
let WARP = [[0, 0], [60, 60]];
const warp = (to) => {
  for (let i = 0; i < WARP.length - 1; i++) {
    const [a0, b0] = WARP[i]; const [a1, b1] = WARP[i + 1];
    if (to <= a1 || i === WARP.length - 2) return b0 + (b1 - b0) * clamp((to - a0) / (a1 - a0), 0, 1);
  }
  return to;
};
const tmp = new THREE.Vector3();

function renderFrame(tOut) {
  const t = warp(tOut);
  // kamera
  const [az, el, d, tx, ty] = camAt(t);
  const shake = t < 4.8 ? 0.012 * seg(t, 0.5, 4.5) : 0;
  camera.position.set(tx + d * Math.sin(az) * Math.cos(el) + Math.sin(t * 53) * shake, ty + d * Math.sin(el) + Math.cos(t * 47) * shake, d * Math.cos(az) * Math.cos(el));
  camera.lookAt(tx, ty, 0);

  // telefon
  const ms = mState(t); const cs = cState(t);
  applyPhone(phoneM, ms); applyPhone(phoneC, cs);
  for (const [g, st] of [[phoneM, ms], [phoneC, cs]]) {
    g.userData.gtex.offset.set(((t * 0.08) % 1) - 0.3, 0);
    g.userData.halo.material.opacity = 0.35 * clamp(st.s);
  }
  if (phoneM.visible) {
    const { ctx, tex } = phoneM.userData;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, LW, LH);
    screenMerchant(ctx, t, qr);
    tex.needsUpdate = true;
  }
  if (phoneC.visible) {
    const { ctx, tex } = phoneC.userData;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, LW, LH);
    screenCustomer(ctx, t);
    tex.needsUpdate = true;
  }

  // gelembung hook
  for (const b of bubbles) {
    const s = (t - b.t0) / 2.2;
    const vis = t >= b.t0 && t < 5.4;
    b.mesh.visible = vis;
    if (!vis) continue;
    const k = clamp(s);
    const pull = easeInOut(seg(t, 4.4, 5.1));
    const z = lerp(-7, 0.5, easeOut(k)) + Math.sin(t * 1.3 + b.ph) * 0.1;
    const x = b.x0 + Math.sin(t * 0.9 + b.ph) * 0.18;
    const y = b.y0 + Math.cos(t * 0.7 + b.ph) * 0.14 + k * 0.4;
    b.mesh.position.set(lerp(x, 0, pull), lerp(y, 0, pull), lerp(z, 0, pull));
    b.mesh.rotation.set(0, Math.sin(t * 0.8 + b.ph) * 0.35 + b.spin * k, b.tilt * (1 - pull) + pull * t * 3);
    b.mesh.scale.setScalar(easeBack(seg(t - b.t0, 0, 0.45)) * (1 - pull));
  }

  // zarah
  particles.position.y = (t * 0.06) % 1.5;
  particles.rotation.y = Math.sin(t * 0.2) * 0.15;
  updateBurst(burstA, t, 5.0, tmp.set(0, 0, 0.3), 2.4);
  updateBurst(burstB, t, 47.45, tmp.set(-0.62, 0.3, 0.35), 1.7);

  // paket order
  const fl = seg(t, FLY0, FLY1);
  packet.visible = t >= FLY0 && t < FLY1 + 0.05;
  if (packet.visible) {
    flightPos(fl, packet.position);
    packet.rotation.y = fl * Math.PI * 6;
    packet.rotation.z = Math.sin(fl * 9) * 0.2;
    packet.scale.setScalar(easeBack(seg(t, FLY0, FLY0 + 0.25)) * (1 - seg(t, FLY1 - 0.12, FLY1)) * 1.3 + 0.0001);
  }
  trail.forEach((s, i) => {
    const kk = fl - (i + 1) * 0.022;
    s.visible = packet.visible && kk > 0;
    if (!s.visible) return;
    flightPos(kk, s.position);
    const f = 1 - i / TRAIL;
    s.scale.setScalar(0.28 * f + 0.02);
    s.material.opacity = 0.85 * f * (1 - seg(t, FLY1 - 0.1, FLY1));
  });

  renderer.render(scene, camera);

  octx.clearRect(0, 0, W, H);
  octx.drawImage(renderer.domElement, 0, 0);
  drawVignette();
  drawHook(t);
  for (const [a, b, cap] of CAPTIONS) if (t >= a && t < b) drawCaption(a, b, cap, t);
  drawCTA(t);
  drawFlash(t);
}

window.renderFrame = (t) => { renderFrame(t); return out.toDataURL('image/jpeg', 0.93); };

(async () => {
  await Promise.all([document.fonts.load('800 40px Inter'), document.fonts.load('600 40px Inter'), document.fonts.load('500 20px Inter'), document.fonts.load('700 20px Inter')]);
  const img = new Image();
  img.src = '/brand/annurpro-mark.png';
  await img.decode().catch(() => {});
  setMark(img);
  const tl = await (await fetch('/timeline.json')).json();
  if (tl.vo) WARP = tl.vo.anchors.map(([vo, ti]) => [vo / tl.vo.tempo, ti]);
  const photos = {};
  await Promise.all(['banner', 'logo', 'classic', 'crispy', 'bbq', 'spicy', 'sirap'].map(async (k) => {
    const im = new Image(); im.src = `/assets/burger/${k}.jpg`;
    try { await im.decode(); photos[k] = im; } catch { /* guna ilustrasi vektor */ }
  }));
  setPhotos(photos);
  const q = qrcode(0, 'M');
  q.addData('https://kedai.annurpro.com/contoh?src=qr');
  q.make();
  qr = { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
  window.ready = true;
})();
