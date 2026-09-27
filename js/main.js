import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

/* =====================================================================
   Theodore Roosevelt Island · Washington, DC — stylized low-poly model
   World axes: +x = east (DC / Georgetown), -x = west (Virginia / Rosslyn),
   +z = south (downstream). 1 unit ≈ 10 m; landmarks are exaggerated.
   ===================================================================== */

// ---------- seeded random so the scene looks the same on every visit
let seed = 19671027;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer, scene, camera
const hero = document.getElementById('hero');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xffffff, 190, 580);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 1500);
const HOME = { pos: new THREE.Vector3(-88, 74, 112), target: new THREE.Vector3(4, 1, -12) };
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 18;
controls.maxDistance = 250;
controls.minPolarAngle = 0.3;
controls.maxPolarAngle = 1.3;
controls.screenSpacePanning = false;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.35;

// ---------- post-processing: tilt-shift like Infinitown
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType })
);
composer.addPass(new RenderPass(scene, camera));
const hblur = new ShaderPass(HorizontalTiltShiftShader);
const vblur = new ShaderPass(VerticalTiltShiftShader);
hblur.uniforms.r.value = vblur.uniforms.r.value = 0.52;
composer.addPass(hblur);
composer.addPass(vblur);
composer.addPass(new OutputPass());

// ---------- shared shader uniforms
const U = { uNight: { value: 0 }, uTime: { value: 0 } };

// Adds world-space position/normal varyings to a built-in material.
function withWorldPos(shader) {
  shader.uniforms.uNight = U.uNight;
  shader.uniforms.uTime = U.uTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      vec3 wn = objectNormal;
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
        wn = mat3(instanceMatrix) * wn;
      #endif
      vWPos = (modelMatrix * wp4).xyz;
      vWNrm = normalize(mat3(modelMatrix) * wn);`
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
    varying vec3 vWPos;
    varying vec3 vWNrm;
    uniform float uNight;
    uniform float uTime;
    float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
  );
}

// Building material: procedural windows in world space, lit at night.
const bldgMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
bldgMat.onBeforeCompile = (shader) => {
  withWorldPos(shader);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float side = 1.0 - step(0.5, abs(vWNrm.y));
      bool facesX = abs(vWNrm.x) > abs(vWNrm.z);
      float along = facesX ? vWPos.z : vWPos.x;
      float across = facesX ? vWPos.x : vWPos.z;
      vec2 cell = vec2(along / 0.8, (vWPos.y - 1.0) / 0.7);
      vec2 f = fract(cell);
      float win = step(0.2, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.8);
      win *= side * step(1.6, vWPos.y);
      float rnd = hh(floor(cell) + vec2(floor(across * 0.5) * 17.0, 3.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.58, 0.68), win * 0.8);
      diffuseColor.rgb *= mix(0.9, 1.0, side);`
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float lit = step(0.5, rnd);
      vec3 warm = mix(vec3(1.0, 0.76, 0.42), vec3(0.72, 0.84, 1.0), step(0.86, rnd));
      totalEmissiveRadiance += warm * win * lit * uNight * 1.35;`
    );
};

// Water: flat colour with drifting glints.
const waterMat = new THREE.MeshStandardMaterial({ color: '#5b9fb5', roughness: 0.45, metalness: 0.05 });
waterMat.onBeforeCompile = (shader) => {
  withWorldPos(shader);
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
    float band = sin(vWPos.x * 1.7 + sin(vWPos.z * 0.12 + uTime * 0.4) * 2.5);
    float flow = sin(vWPos.z * 0.55 - uTime * 1.1 + vWPos.x * 0.3);
    float crest = smoothstep(0.86, 1.0, band * flow);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.96, 1.0), crest * 0.16 * (1.0 - uNight * 0.6));`
  );
};

// ---------- helpers
const matCache = new Map();
function M(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts }));
  return matCache.get(key);
}
function box(w, h, d, mat, x, y, z, { ry = 0, rz = 0, parent = scene, cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.rotation.set(0, ry, rz);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}
// Extrude a polygon given as [x, z] points; top face at topY.
function slab(pts, depth, topY, mats, { cast = false, receive = true } = {}) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mats);
  m.position.y = topY;
  m.castShadow = cast;
  m.receiveShadow = receive;
  scene.add(m);
  return m;
}
function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const ellipse = (cx, cz, rx, rz, n = 32, jitter = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, j = 1 + (rand() - 0.5) * jitter;
    return [cx + Math.cos(a) * rx * j, cz + Math.sin(a) * rz * j];
  });
const inEll = (x, z, cx, cz, rx, rz) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1;

const UNIT = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // bottom-anchored
const UNIT_C = new THREE.BoxGeometry(1, 1, 1); // centered
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function instances(geo, mat, items, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(items.length, 1));
  items.forEach((it, i) => {
    _p.set(it.x, it.y, it.z);
    if (it.q) _q.copy(it.q);
    else _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (it.c !== undefined) im.setColorAt(i, _c.set(it.c));
  });
  im.count = items.length;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  scene.add(im);
  return im;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- palette
const COL = {
  grass: '#9cc16f', bank: '#7d6a52', forestFloor: '#7fa35a', marsh: '#9aa85f',
  asphalt: '#6a6f74', sidewalk: '#cbc5b8', trail: '#d2bf93', concrete: '#d9d1c1', trunk: '#6b4b37',
  greens: ['#5f9a45', '#6aa84c', '#4e8a3e', '#7cb85a', '#588f3f', '#8bbd5e', '#679f48'],
};

// ---------- lights
const hemi = new THREE.HemisphereLight(0xe6f4ff, 0x8b8f6b, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.target.position.set(0, 0, -10);
sun.position.copy(sun.target.position).add(V(-70, 120, 80));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 500 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/* =====================================================================
   RIVER & SHORES — the Potomac, with the narrow "Little River" to the west
   ===================================================================== */
const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), waterMat);
water.receiveShadow = true;
scene.add(water);

const LAND = 1.0;
const vaX = (z) => -30 - 3 * Math.sin(z * 0.018 + 1); // Virginia shoreline
const dcX = (z) => 58 + 4 * Math.sin(z * 0.015); // DC shoreline
const roadVA = (z) => vaX(z) - 10; // George Washington Memorial Parkway
const trailVA = (z) => vaX(z) - 2.2; // Mount Vernon Trail
const roadDC = (z) => dcX(z) + 7; // Rock Creek & Potomac Parkway
const EXT = 520;
const zSteps = [];
for (let z = -EXT; z <= EXT; z += 8) zSteps.push(z);
slab([...zSteps.map((z) => [vaX(z), z]), [-EXT, EXT], [-EXT, -EXT]], 4, LAND, [M(COL.grass), M(COL.bank)]);
slab([...zSteps.map((z) => [dcX(z), z]), [EXT, EXT], [EXT, -EXT]], 4, LAND, [M(COL.grass), M(COL.bank)]);

// ribbons that follow the curving shore (roads, trail)
const ribbons = [];
function ribbon(fx, width, y, c, thick = 0.05) {
  for (let z = -EXT; z < EXT; z += 4) {
    const x0 = fx(z), x1 = fx(z + 4);
    ribbons.push({ x: (x0 + x1) / 2, y, z: z + 2, sx: width, sy: thick, sz: Math.hypot(x1 - x0, 4) + 0.1, ry: Math.atan2(x1 - x0, 4), c });
  }
}
ribbon(roadVA, 3.4, LAND, COL.asphalt);
ribbon(trailVA, 1.2, LAND, '#c9c1ae');
ribbon(roadDC, 3.4, LAND, COL.asphalt);
ribbon((z) => dcX(z) + 2.2, 1.2, LAND, '#c9c1ae');
instances(UNIT, M('#ffffff', { flatShading: false }), ribbons, { cast: false });

/* =====================================================================
   THEODORE ROOSEVELT ISLAND
   ===================================================================== */
const ISL = 1.6;
const islandPts = [
  [0, -62], [9, -58], [17, -48], [22, -34], [24, -18], [19, -7], [13, 5], [11, 18], [11.5, 30], [12, 42],
  [6, 54], [1, 62], [-4, 58], [-9, 46], [-14, 32], [-18, 16], [-21, 0], [-22, -16], [-21, -32], [-17, -46], [-9, -57],
];
const marshPts = [[24, -18], [26.5, -5], [24.5, 10], [21, 24], [17, 35], [12, 42], [11.5, 30], [11, 18], [13, 5], [19, -7]];
const hill1 = ellipse(-5, 10, 11, 19, 30, 0.12);
const hill2 = ellipse(-5, 8, 6, 10, 24, 0.1);
slab(islandPts, 4, ISL, [M(COL.forestFloor), M(COL.bank)]);
slab(marshPts, 3, 0.45, [M(COL.marsh), M('#6f6a4c')]);
slab(hill1, 1, 2.4, [M('#86a95f'), M('#8a7a5c')]);
slab(hill2, 1, 3.2, [M('#8cae63'), M('#8a7a5c')]);
for (const [cx, cz, r] of [[19, -2, 2.2], [17, 16, 1.6], [15, 28, 1.8]]) {
  const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2), waterMat);
  pool.position.set(cx, 0.47, cz);
  pool.scale.z = 1.6;
  scene.add(pool);
}

function groundY(x, z) {
  if (inPoly(x, z, hill2)) return 3.2;
  if (inPoly(x, z, hill1)) return 2.4;
  if (inPoly(x, z, marshPts)) return 0.45;
  if (inPoly(x, z, islandPts)) return ISL;
  return null;
}

/* ----- Memorial plaza (Eric Gugler, dedicated 1967) ----- */
const PZ = -30; // plaza centre z
const TER = 1.95; // terrace top
slab(ellipse(0, PZ, 12.5, 10, 40), 0.3, ISL + 0.05, [M('#d9cfb6'), M('#c4b99e')]);
slab(ellipse(0, PZ, 9.4, 7.4, 40), 0.3, ISL + 0.1, [M('#9a958b'), M('#9a958b')]);
const moat = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), waterMat);
moat.scale.set(8.8, 1, 6.8);
moat.position.set(0, ISL + 0.14, PZ);
scene.add(moat);
slab(ellipse(0, PZ, 7.5, 5.5, 40), 0.5, TER, [M('#e2dccf'), M('#b9b2a4')]);
for (const s of [-1, 1]) { // footbridges over the moat
  box(2.2, 0.18, 1.8, M('#cfc8ba'), s * 8.4, TER - 0.18, PZ);
  for (const dz of [-0.85, 0.85]) box(2.2, 0.4, 0.1, M('#8d8c86'), s * 8.4, TER, PZ + dz);
}
// granite shaft and the 17-foot bronze of Roosevelt by Paul Manship (exaggerated here)
const granite = M('#c2bbad');
const bronze = M('#6f5334', { roughness: 0.45, metalness: 0.6 });
box(2, 4.6, 0.8, granite, 0, TER, PZ - 4.6);
box(1.3, 0.6, 1.0, granite, 0, TER, PZ - 3.7);
const tr = new THREE.Group();
box(0.46, 0.8, 0.28, bronze, 0, 0, 0, { parent: tr }); // legs
box(0.62, 0.72, 0.34, bronze, 0, 0.8, 0, { parent: tr }); // torso
box(0.14, 0.62, 0.14, bronze, -0.36, 1.35, 0.05, { rz: -0.35, parent: tr }); // raised arm
box(0.14, 0.55, 0.14, bronze, 0.36, 0.95, 0, { parent: tr });
const trHead = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), bronze);
trHead.position.set(0, 1.72, 0);
tr.add(trHead);
tr.position.set(0, TER + 0.6, PZ - 3.7);
tr.traverse((o) => (o.castShadow = true));
scene.add(tr);

// four 21-foot granite tablets: Nature, Manhood, Youth, The State
function tabletTexture(word) {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#cbc4b6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#6d675d';
    g.font = '600 34px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(word, w / 2, 64);
    for (let y = 110; y < h - 40; y += 22) g.fillRect(34, y, w - 68 - (y % 3) * 14, 5);
  });
}
[['NATURE', -1, PZ - 1.4], ['MANHOOD', 1, PZ - 1.4], ['YOUTH', -1, PZ + 1.7], ['THE STATE', 1, PZ + 1.7]].forEach(([word, s, z]) => {
  const x = s * (z < PZ ? 5.4 : 5.0);
  box(0.4, 2.8, 1.5, granite, x, TER, z);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.7), new THREE.MeshStandardMaterial({ map: tabletTexture(word), roughness: 0.9 }));
  face.position.set(x - s * 0.205, TER + 1.4, z);
  face.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
  scene.add(face);
});
// fountain basins
const jets = [];
for (const s of [-1, 1]) {
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.3, 16), granite);
  basin.position.set(s * 2.6, TER + 0.15, PZ + 3.1);
  basin.castShadow = true;
  scene.add(basin);
  const bowl = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16).rotateX(-Math.PI / 2), waterMat);
  bowl.position.set(s * 2.6, TER + 0.31, PZ + 3.1);
  scene.add(bowl);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.7 }));
  jet.position.set(s * 2.6, TER + 0.31, PZ + 3.1);
  scene.add(jet);
  jets.push(jet);
}

/* ----- trails: Swamp Trail loop (with boardwalk), Upland Trail, Woods Trail ----- */
const SWAMP = [[12, -30], [17, -24], [20, -16], [18, -8], [15, 0], [13, 10], [13, 20], [13.5, 30], [12.5, 40], [8, 48], [3, 55], [-2, 55], [-7, 47], [-11, 36], [-15, 24], [-18, 10], [-19, -4], [-19.5, -18], [-19, -28], [-17, -40], [-12, -50], [-4, -55], [5, -53], [12, -45], [15, -37], [12, -30]];
const UPLAND = [[-12, -30], [-15, -18], [-14, -4], [-11, 10], [-9, 24], [-3, 34], [3, 28], [4, 14], [2, 0], [5, -12], [9, -22], [12, -30]];
const WOODS = [[-12, -30], [-9, -40], [0, -44], [9, -40], [12, -30]];
const ENTRY = [[-19.8, -30], [-12, -30]];
const trailItems = [], plankItems = [], trailPts = [];
function trail(pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.1));
    for (let k = 0; k < n; k++) {
      const xa = x0 + ((x1 - x0) * k) / n, za = z0 + ((z1 - z0) * k) / n;
      const xb = x0 + ((x1 - x0) * (k + 1)) / n, zb = z0 + ((z1 - z0) * (k + 1)) / n;
      const mx = (xa + xb) / 2, mz = (za + zb) / 2, g = groundY(mx, mz);
      trailPts.push([mx, mz]);
      if (g === null) continue;
      const ry = Math.atan2(xb - xa, zb - za), len = Math.hypot(xb - xa, zb - za) + 0.1;
      if (g < 1) {
        plankItems.push({ x: mx, y: 0.85, z: mz, sx: 1.2, sy: 0.1, sz: len, ry, c: '#8a6a48' });
        if (k % 2 === 0) for (const o of [-0.5, 0.5]) plankItems.push({ x: mx + Math.cos(ry) * o, y: 0, z: mz - Math.sin(ry) * o, sx: 0.1, sy: 0.85, sz: 0.1, c: '#5d4632' });
      } else {
        trailItems.push({ x: mx, y: g, z: mz, sx: 0.95, sy: 0.05, sz: len, ry, c: COL.trail });
      }
    }
  }
}
[SWAMP, UPLAND, WOODS, ENTRY].forEach(trail);
instances(UNIT, M('#ffffff'), trailItems, { cast: false });
instances(UNIT, M('#ffffff'), plankItems);
const nearTrail = (x, z, r) => trailPts.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);

// Mason family house foundations on the upland (c. 1790s)
const masonWalls = [];
for (const [x, z, w, d] of [[-5, 6.5, 4, 0.3], [-5, 9.5, 4, 0.3], [-7, 8, 0.3, 3], [-3, 8, 0.3, 3], [-5, 8, 0.25, 3]]) {
  masonWalls.push({ x, y: 3.2, z, sx: w, sy: rr(0.25, 0.5), sz: d, c: pick(['#a59c8e', '#968c7e', '#b1a898']) });
}
instances(UNIT, M('#ffffff'), masonWalls);

/* ----- trees (shared instancing for every tree in the scene) ----- */
const trees = [], pines = [];
function tree(x, base, z, s = 1, c = pick(COL.greens)) {
  trees.push({ x, base, z, s, c });
}
// the island is a forest: oaks, maples, tulip poplars … and a few conifers
for (let k = 0; k < 5200; k++) {
  const x = rr(-23, 26), z = rr(-62, 62);
  const g = groundY(x, z);
  if (g === null) continue;
  if (inEll(x, z, 0, PZ, 13.5, 11)) continue; // plaza clearing
  if (inEll(x, z, -5, 8, 3.4, 3)) continue; // Mason house site
  if (nearTrail(x, z, 1.1)) continue;
  if (g < 1) {
    if (rand() < 0.05) tree(x, g, z, rr(0.6, 0.9), pick(['#7d9a4a', '#8aa653']));
    continue;
  }
  if (rand() < 0.14) pines.push({ x, base: g, z, s: rr(0.9, 1.4) });
  else tree(x, g, z, rr(0.85, 1.5));
}
// reeds and cattails in the marsh
const reeds = [];
for (let k = 0; k < 900; k++) {
  const x = rr(10, 27), z = rr(-20, 44);
  if (!inPoly(x, z, marshPts) || nearTrail(x, z, 0.8)) continue;
  reeds.push({ x, y: 0.45, z, sx: rr(0.7, 1.2), sy: rr(0.6, 1.2), sz: rr(0.7, 1.2), ry: rand() * 3, c: pick(['#9aa35a', '#b5a862', '#8a9a4c', '#a8b068']) });
}
instances(new THREE.ConeGeometry(0.12, 0.7, 4).translate(0, 0.35, 0), M('#ffffff'), reeds, { cast: false });

/* =====================================================================
   FOOTBRIDGE & PARKING (Virginia side)
   ===================================================================== */
const FBZ = -30, FB0 = trailVA(FBZ) + 0.3, FB1 = -19.6;
const fbY = (x) => {
  const u = THREE.MathUtils.clamp((x - FB0) / (FB1 - FB0), 0, 1);
  return THREE.MathUtils.lerp(LAND, ISL, u) + 0.2 + 1.3 * Math.sin(Math.PI * u);
};
const fb = [];
for (let k = 0; k < 10; k++) {
  const xa = FB0 + ((FB1 - FB0) * k) / 10, xb = FB0 + ((FB1 - FB0) * (k + 1)) / 10;
  const ya = fbY(xa), yb = fbY(xb), len = Math.hypot(xb - xa, yb - ya) + 0.05, rz = Math.atan2(yb - ya, xb - xa);
  fb.push({ x: (xa + xb) / 2, y: (ya + yb) / 2 - 0.1, z: FBZ, sx: len, sy: 0.18, sz: 2, rz, c: '#8b7d6b' });
  for (const dz of [-0.95, 0.95]) fb.push({ x: (xa + xb) / 2, y: (ya + yb) / 2 + 0.45, z: FBZ + dz, sx: len, sy: 0.06, sz: 0.06, rz, c: '#3e4a4f' });
  for (const dz of [-0.95, 0.95]) fb.push({ x: xa, y: ya + 0.2, z: FBZ + dz, sx: 0.06, sy: 0.5, sz: 0.06, c: '#3e4a4f' });
}
instances(UNIT_C, M('#ffffff'), fb);
for (const x of [FB0 + (FB1 - FB0) * 0.33, FB0 + (FB1 - FB0) * 0.66]) box(0.6, fbY(x) - 0.3, 1.6, M('#8f877a'), x, 0, FBZ);

box(4.8, 0.06, 26, M('#74797d'), -36.8, LAND, -32, { cast: false }); // parking lot
const parked = [];
for (let z = -44; z < -20; z += 1.1) {
  for (const x of [-38.2, -35.4]) if (rand() < 0.75) parked.push({ x, y: LAND + 0.27, z, sx: 1.0, sy: 0.32, sz: 0.48, c: pick(['#ece9e2', '#2d3238', '#b33a32', '#3f6fa6', '#8c969c', '#556b4f']) });
}
instances(UNIT_C, M('#ffffff'), parked);

/* =====================================================================
   CITIES — DC (low, by the 1910 Height Act) and Virginia (Rosslyn towers)
   ===================================================================== */
const ZONES = [
  { x0: -80, x1: 125, z0: 44, z1: 60 }, // Theodore Roosevelt Bridge approaches
  { x0: -80, x1: 125, z0: -113, z1: -97 }, // Key Bridge approaches
  { x0: 64, x1: 104, z0: 22, z1: 96 }, // Watergate & Kennedy Center
  { x0: 64, x1: EXT, z0: 132, z1: 188 }, // National Mall & West Potomac Park
  { x0: 84, x1: 122, z0: -186, z1: -150 }, // Georgetown University
  { x0: 64, x1: 92, z0: -92, z1: -62 }, // Georgetown Waterfront Park
];
const hitsZone = (xa, xb, za, zb) => ZONES.some((z) => xa < z.x1 && xb > z.x0 && za < z.z1 && zb > z.z0);

const STYLE = {
  rosslyn: { lots: [1, 1, 2], rows: 0.2, park: 0.05, cols: ['#8fb3c4', '#a9c1cc', '#6f8fa3', '#c9d4d8', '#b9c6c9', '#d9d4c8'], h: () => rr(7, 18) + (rand() < 0.4 ? rr(6, 18) : 0) },
  arlington: { lots: [2, 3, 3, 4], rows: 0.5, park: 0.22, cols: ['#c98f73', '#d8b49a', '#e4d6c3', '#b77b63', '#cfc6b8', '#e0c9a6'], h: () => 1.2 + Math.pow(rand(), 2) * 5 },
  georgetown: { lots: [4, 5, 5, 6], rows: 0.85, park: 0.04, cols: ['#b5523b', '#c96f4a', '#e3c77a', '#9fb7c9', '#d99a8c', '#efe3cf', '#7f9a78', '#a44a3f'], h: () => rr(1.1, 2.5) },
  dc: { lots: [1, 2, 2, 3], rows: 0.4, park: 0.06, cols: ['#e8e0cf', '#d9cfbb', '#cfc6b4', '#e2d8c6', '#bfb6a4', '#d4c3a8', '#c9ccce'], h: () => 2.4 + Math.pow(rand(), 0.8) * 3.2 },
};
function styleAt(side, x, z) {
  if (side < 0) {
    if (x > -175 && z < -12 && z > -200) return 'rosslyn';
    if (z > 60 && x > -330) return 'forest'; // Arlington's wooded hills
    return 'arlington';
  }
  return z < -40 && x < 260 ? 'georgetown' : 'dc';
}

const cityBldg = [], sidewalks = [];
const CITY = { cellX: 14, blockX: 11, cellZ: 12, blockZ: 9 };
for (const side of [-1, 1]) {
  const x0 = side < 0 ? 46 : 73;
  box(EXT - x0 + 2, 0.04, EXT * 2, M(COL.asphalt), side * (x0 - 1 + (EXT - x0 + 2) / 2), LAND, 0, { cast: false });
  for (let d0 = x0; d0 + CITY.blockX < EXT; d0 += CITY.cellX) {
    const xa = side < 0 ? -(d0 + CITY.blockX) : d0, xb = side < 0 ? -d0 : d0 + CITY.blockX;
    for (let za = -EXT; za + CITY.blockZ < EXT; za += CITY.cellZ) {
      const zb = za + CITY.blockZ;
      if (hitsZone(xa, xb, za, zb)) continue;
      const cx = (xa + xb) / 2, cz = (za + zb) / 2;
      const style = styleAt(side, cx, cz);
      if (style === 'forest') {
        sidewalks.push({ x: cx, y: LAND, z: cz, sx: xb - xa + 3, sy: 0.1, sz: zb - za + 3, c: '#8fb866' });
        for (let k = 0; k < 5; k++) tree(rr(xa, xb), LAND + 0.1, rr(za, zb), rr(1.3, 1.9));
        continue;
      }
      const S = STYLE[style];
      if (rand() < S.park) {
        sidewalks.push({ x: cx, y: LAND, z: cz, sx: xb - xa, sy: 0.14, sz: zb - za, c: COL.grass });
        for (let k = 0; k < 6; k++) tree(rr(xa + 1, xb - 1), LAND + 0.14, rr(za + 1, zb - 1), rr(0.9, 1.4));
        continue;
      }
      sidewalks.push({ x: cx, y: LAND, z: cz, sx: xb - xa, sy: 0.12, sz: zb - za, c: COL.sidewalk });
      const n = pick(S.lots), rows = rand() < S.rows ? 2 : 1;
      const lw = (xb - xa) / n, ld = (zb - za) / rows;
      for (let k = 0; k < n; k++) {
        for (let r = 0; r < rows; r++) {
          const bx = xa + lw * (k + 0.5), bz = za + ld * (r + 0.5);
          const w = (lw - 0.3) * rr(0.85, 1), d = (ld - 0.3) * rr(0.8, 1);
          const h = S.h(), c = pick(S.cols);
          cityBldg.push({ x: bx, y: LAND + 0.12, z: bz, sx: w, sy: h, sz: d, c });
          if (style === 'rosslyn' && h > 16 && rand() < 0.5) cityBldg.push({ x: bx, y: LAND + 0.12 + h, z: bz, sx: w * 0.6, sy: rr(2, 5), sz: d * 0.6, c });
        }
      }
      if (style === 'georgetown' && rand() < 0.5) tree(cx + rr(-4, 4), LAND + 0.12, zb + 1.4, 0.8);
    }
  }
}
// riverbank woods along the George Washington Memorial Parkway, and trees on the DC bank
const nearBridge = (z) => (z > 44 && z < 60) || (z > -113 && z < -97);
for (let z = -EXT; z < EXT; z += 1.8) {
  if (!(z > -48 && z < -16) && !nearBridge(z)) {
    tree(rr(roadVA(z) + 2.2, trailVA(z) - 0.9), LAND, z + rr(-0.6, 0.6), rr(1, 1.6));
    if (rand() < 0.6) tree(rr(vaX(z) - 1.2, vaX(z) - 0.3), LAND, z, rr(0.9, 1.4));
    if (rand() < 0.7) tree(rr(roadVA(z) - 4.5, roadVA(z) - 2.2), LAND, z, rr(1, 1.5));
  }
  if (rand() < 0.45 && !nearBridge(z)) tree(dcX(z) + rr(0.6, 1.4), LAND, z, rr(0.9, 1.3));
}

/* ----- Kennedy Center (1971) and the Watergate ----- */
const kcMat = M('#f1eee6', { emissive: '#ffe2b0', emissiveIntensity: 0 });
box(12, 3.6, 22, kcMat, 82, LAND, 72);
box(13.2, 0.3, 23.2, M('#e6e2d8'), 82, LAND + 3.6, 72);
const kcCols = [];
for (let z = 61; z <= 83; z += 0.9) for (const x of [75.6, 88.4]) kcCols.push({ x, y: LAND, z, sx: 0.14, sy: 3.6, sz: 0.14, c: '#b8a06a' });
for (let x = 76.5; x <= 87.5; x += 0.9) for (const z of [60.4, 83.6]) kcCols.push({ x, y: LAND, z, sx: 0.14, sy: 3.6, sz: 0.14, c: '#b8a06a' });
instances(UNIT, M('#ffffff'), kcCols);
box(18, 0.06, 32, M(COL.grass), 84, LAND, 72, { cast: false });

function arcBuilding(cx, cz, r0, r1, a0, a1, h) {
  const pts = [];
  for (let k = 0; k <= 14; k++) { const a = a0 + ((a1 - a0) * k) / 14; pts.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); }
  for (let k = 14; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / 14; pts.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]); }
  return slab(pts, h, LAND + h, bldgMat, { cast: true });
}
box(28, 0.06, 26, M(COL.grass), 84, LAND, 38, { cast: false });
arcBuilding(84, 36, 5, 7.5, 2.0, 4.4, 4.2);
arcBuilding(92, 30, 4, 6.2, -0.4, 1.9, 3.8);
arcBuilding(93, 45, 4, 6.2, 3.8, 6.0, 3.6);

/* ----- Georgetown waterfront & university ----- */
box(26, 0.08, 30, M(COL.grass), 78, LAND, -77, { cast: false });
const healyMat = M('#76706a');
box(40, 0.07, 36, M(COL.grass), 103, LAND, -168, { cast: false });
box(12, 3.4, 4, healyMat, 103, LAND, -168);
box(2, 9, 2, healyMat, 103, LAND, -168);
const spire = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.4, 4), M('#58705f'));
spire.position.set(103, LAND + 10.7, -168);
spire.rotation.y = Math.PI / 4;
spire.castShadow = true;
scene.add(spire);
box(8, 2.8, 5, healyMat, 97, LAND, -176);
box(8, 2.8, 5, healyMat, 110, LAND, -176);
for (let k = 0; k < 30; k++) {
  const x = rr(84, 122), z = rr(-186, -150);
  if (!(x > 90 && x < 116 && z > -180 && z < -164)) tree(x, LAND + 0.07, z, rr(1, 1.4));
}

/* ----- National Mall: Lincoln Memorial, Reflecting Pool, Washington Monument ----- */
box(EXT - 64, 0.08, 56, M('#a7c97c'), (EXT + 64) / 2, LAND, 160, { cast: false });
const marble = M('#efeae0', { emissive: '#fff4dd', emissiveIntensity: 0 });
box(8, 2.6, 5.4, marble, 150, LAND, 160);
box(8.6, 0.8, 6, marble, 150, LAND + 2.6, 160);
const reflecting = new THREE.Mesh(new THREE.PlaneGeometry(76, 3.6).rotateX(-Math.PI / 2), waterMat);
reflecting.position.set(198, LAND + 0.14, 160);
scene.add(reflecting);
box(78, 0.12, 4.6, M('#d8d2c4'), 198, LAND, 160, { cast: false });
const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, 17, 4, 1), marble);
obelisk.rotation.y = Math.PI / 4;
obelisk.position.set(250, LAND + 8.5, 160);
obelisk.castShadow = true;
scene.add(obelisk);
const pyramidion = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), marble);
pyramidion.rotation.y = Math.PI / 4;
pyramidion.position.set(250, LAND + 17.8, 160);
scene.add(pyramidion);
for (let x = 162; x < 238; x += 4) for (const z of [154, 166]) tree(x, LAND + 0.08, z, 1.2);
for (let x = 268; x < EXT; x += 5) for (const z of [146, 152, 168, 174]) tree(x, LAND + 0.08, z, 1.3);

/* =====================================================================
   BRIDGES — Theodore Roosevelt Bridge (1964) & Key Bridge (1923)
   ===================================================================== */
const bridges = [];
function archBridge({ z, piers, top, width, spring, color, rampA, rampB }) {
  const mat = M(color);
  for (let i = 0; i < piers.length - 1; i++) {
    const x0 = piers[i] + 0.8, x1 = piers[i + 1] - 0.8;
    const rise = Math.min((x1 - x0) / 2, top - spring - 0.9);
    const shape = new THREE.Shape();
    shape.moveTo(x0, top);
    shape.lineTo(x1, top);
    shape.lineTo(x1, spring);
    for (let k = 1; k <= 18; k++) {
      const u = 1 - k / 18;
      shape.lineTo(x0 + (x1 - x0) * u, spring + rise * Math.sin(Math.PI * u));
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.z = z;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  for (const px of piers) box(1.6, top + 1, width + 0.8, mat, px, -1, z);
  const xa = piers[0], xb = piers[piers.length - 1];
  box(xb - xa, 0.06, width - 0.8, M(COL.asphalt), (xa + xb) / 2, top, z, { cast: false });
  for (const dz of [-1, 1]) box(xb - xa, 0.4, 0.3, mat, (xa + xb) / 2, top, z + dz * (width / 2 - 0.15));
  // sloped approaches down to street level
  for (const [a, b] of [[xa, rampA], [xb, rampB]]) {
    const L = Math.abs(b - a), H = top - LAND;
    const r = box(Math.hypot(L, H), 0.7, width, mat, (a + b) / 2, 0, z, { rz: Math.sign(a - b) * Math.atan2(H, L) });
    r.position.y = (top + LAND) / 2 - 0.35;
  }
  const B = { z, xa, xb, top, rampA, rampB, width };
  B.y = (x) => (x >= xa && x <= xb ? top : x < xa ? THREE.MathUtils.mapLinear(x, rampA, xa, LAND, top) : THREE.MathUtils.mapLinear(x, xb, rampB, top, LAND));
  bridges.push(B);
  return B;
}
archBridge({ z: 52, piers: [-46, -32, -18, -4, 10, 24, 38, 52, 66], top: 6.5, width: 6, spring: 1.2, color: COL.concrete, rampA: -78, rampB: 104 });
archBridge({ z: -105, piers: [-38, -20, -2, 16, 34, 52, 66], top: 7.5, width: 5, spring: 1, color: '#cfc6b3', rampA: -64, rampB: 96 });

/* =====================================================================
   INSTANCED STATIC STUFF
   ===================================================================== */
instances(UNIT, M('#ffffff', { flatShading: false }), sidewalks, { cast: false });
instances(UNIT, bldgMat, cityBldg);

const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 5).translate(0, 0.5, 0);
const crownGeo = new THREE.IcosahedronGeometry(1, 0);
instances(trunkGeo, M(COL.trunk), [...trees, ...pines].map((t) => ({ x: t.x, y: t.base, z: t.z, sx: t.s, sy: 0.6 * t.s, sz: t.s })));
instances(crownGeo, M('#ffffff'), trees.map((t) => ({ x: t.x, y: t.base + 1.02 * t.s, z: t.z, sx: 0.55 * t.s, sy: 0.66 * t.s, sz: 0.55 * t.s, ry: rand() * 3, c: t.c })));
instances(new THREE.ConeGeometry(0.5, 1.5, 6).translate(0, 0.75, 0), M('#ffffff'), pines.map((t) => ({ x: t.x, y: t.base + 0.4 * t.s, z: t.z, sx: t.s, sy: t.s, sz: t.s, c: pick(['#3f6e45', '#4a7a4c', '#36603f']) })));

/* =====================================================================
   MOVING THINGS: cars, boats, birds, people
   ===================================================================== */
const cars = [];
const carColor = () => pick(['#ece9e2', '#2d3238', '#b33a32', '#3f6fa6', '#8c969c', '#e9e6df', '#556b4f', '#c9c3b5']);
// parkways that follow the curving shore
for (const [fx, n] of [[roadVA, 70], [roadDC, 60]]) {
  for (let k = 0; k < n; k++) {
    const dir = k % 2 ? 1 : -1;
    cars.push({ kind: 'curve', fx, off: dir * 0.8, pos: rr(-EXT, EXT), speed: dir * rr(9, 14), min: -EXT, max: EXT, c: carColor() });
  }
}
// city grid
for (const side of [-1, 1]) {
  const x0 = side < 0 ? 46 : 73;
  for (let d = x0 + CITY.cellX; d < EXT - 20; d += CITY.cellX) {
    if (rand() < 0.4) continue;
    const cx = side * (d - 1.5);
    for (let k = 0; k < 3; k++) {
      const dir = rand() < 0.5 ? 1 : -1;
      cars.push({ kind: 'z', lane: cx + dir * 0.7, pos: rr(-EXT, EXT), speed: dir * rr(5, 9), min: -EXT, max: EXT, c: carColor() });
    }
  }
  for (let k = 0; k < 40; ) {
    const z = -EXT + Math.floor(rand() * 86) * CITY.cellZ - 1.5;
    if ((z > 40 && z < 64) || (z > -117 && z < -93) || (z > 128 && z < 192)) continue;
    const dir = rand() < 0.5 ? 1 : -1;
    cars.push({ kind: 'x', lane: z + dir * 0.7, pos: side * rr(x0 + 4, 400), speed: dir * rr(4, 8), min: side < 0 ? -EXT : x0, max: side < 0 ? -x0 : EXT, c: carColor() });
    k++;
  }
}
// bridges
for (const B of bridges) {
  for (let k = 0; k < 26; k++) {
    const lane = [-1.8, -0.6, 0.6, 1.8][k % 4] * (B.width / 6);
    cars.push({ kind: 'bridge', B, lane: B.z + lane, pos: rr(B.rampA, B.rampB), speed: (lane > 0 ? 1 : -1) * rr(7, 11), min: B.rampA, max: B.rampB, c: carColor() });
  }
}
const carBodies = new THREE.InstancedMesh(UNIT_C, M('#ffffff'), cars.length);
const carCabinMat = M('#dfe8ee', { emissive: '#ffd58a', emissiveIntensity: 0 });
const carCabins = new THREE.InstancedMesh(UNIT_C, carCabinMat, cars.length);
cars.forEach((c, i) => carBodies.setColorAt(i, _c.set(c.c)));
carBodies.castShadow = true;
carBodies.frustumCulled = carCabins.frustumCulled = false;
scene.add(carBodies, carCabins);

function updateCars(dt) {
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    c.pos += c.speed * dt;
    if (c.pos > c.max) c.pos = c.min + (c.pos - c.max);
    else if (c.pos < c.min) c.pos = c.max - (c.min - c.pos);
    let x, z, y = LAND, ry = 0;
    if (c.kind === 'curve') {
      z = c.pos;
      x = c.fx(z) + c.off;
      ry = Math.atan2(c.fx(z + 1) - c.fx(z - 1), 2);
    } else if (c.kind === 'z') {
      x = c.lane; z = c.pos;
    } else {
      x = c.pos; z = c.lane; ry = Math.PI / 2;
      if (c.kind === 'bridge') y = c.B.y(x) + 0.05;
    }
    _q.setFromEuler(_e.set(0, ry, 0));
    carBodies.setMatrixAt(i, _m.compose(_p.set(x, y + 0.27, z), _q, _s.set(0.48, 0.32, 1.0)));
    carCabins.setMatrixAt(i, _m.compose(_p.set(x, y + 0.52, z), _q, _s.set(0.42, 0.2, 0.52)));
  }
  carBodies.instanceMatrix.needsUpdate = true;
  carCabins.instanceMatrix.needsUpdate = true;
}

// boats: rowing shells from the Georgetown boathouses, kayaks, a tour boat
const wakeTex = canvasTexture(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(w * 0.3, 0);
  g.lineTo(w * 0.7, 0);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
});
const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false });
const boats = [];
function addBoat(kind, x, z, speed) {
  const g = new THREE.Group();
  let wakeW, wakeL, oars = null;
  if (kind === 'shell') {
    box(0.34, 0.14, 5.4, M(pick(['#f4f1e8', '#e8c547', '#c8372d'])), 0, 0, 0, { parent: g });
    oars = new THREE.Group();
    for (let r = 0; r < 8; r++) {
      const zz = -2 + r * 0.55;
      box(0.13, 0.26, 0.13, M(pick(['#2b5fa8', '#ffffff', '#1e2a2f'])), 0, 0.14, zz, { parent: g });
      box(2.4, 0.03, 0.06, M('#e9e4d8'), (r % 2 ? 1 : -1) * 0.9, 0.2, zz, { parent: oars });
    }
    g.add(oars);
    wakeW = 0.8; wakeL = 7;
  } else if (kind === 'kayak') {
    box(0.28, 0.14, 1.3, M(pick(['#f28c28', '#e8c547', '#c8372d', '#2f8f4e'])), 0, 0, 0, { parent: g });
    box(0.14, 0.24, 0.14, M('#2b5fa8'), 0, 0.14, 0, { parent: g });
    wakeW = 0.5; wakeL = 2.5;
  } else {
    box(1.3, 0.55, 3.6, M('#f3f3ef'), 0, -0.1, 0, { parent: g });
    box(1.32, 0.12, 3.62, M('#1f3b5a'), 0, 0.3, 0, { parent: g });
    box(1.0, 0.55, 1.6, M('#e7eef2'), 0, 0.45, 0.2, { parent: g });
    wakeW = 1.8; wakeL = 8;
  }
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(wakeW, wakeL).rotateX(-Math.PI / 2), wakeMat);
  wake.position.set(0, 0.03, -wakeL / 2 - 1);
  g.add(wake);
  g.position.set(x, 0, z);
  g.rotation.y = speed > 0 ? 0 : Math.PI;
  scene.add(g);
  boats.push({ g, speed, oars });
}
addBoat('shell', 30, -60, 5.5);
addBoat('shell', 44, 40, -4.8);
addBoat('shell', 20, -200, 5);
addBoat('tour', 45, -150, 3.4);
addBoat('kayak', -26, -10, 1.3);
addBoat('kayak', -25.4, 20, -1.1);
addBoat('kayak', 31, 90, -1.5);

// great blue herons in the marsh and a flock of birds overhead
function heron(x, z, ry) {
  const g = new THREE.Group();
  const grey = M('#9aa3a8');
  box(0.26, 0.26, 0.55, grey, 0, 0.5, 0, { parent: g });
  box(0.07, 0.42, 0.07, grey, 0, 0.72, 0.24, { parent: g });
  box(0.09, 0.08, 0.28, M('#c9a13a'), 0, 1.12, 0.34, { parent: g });
  for (const dx of [-0.06, 0.06]) box(0.03, 0.5, 0.03, M('#5b5448'), dx, 0, 0, { parent: g });
  g.position.set(x, 0.45, z);
  g.rotation.y = ry;
  scene.add(g);
}
heron(21, -4, 0.6);
heron(16.5, 20, 2.2);
heron(19.5, 12, -1.1);
heron(-24.5, -8, 1.4);

const birds = [];
const wingGeoL = new THREE.BoxGeometry(0.7, 0.04, 0.26).translate(-0.35, 0, 0);
const wingGeoR = new THREE.BoxGeometry(0.7, 0.04, 0.26).translate(0.35, 0, 0);
for (let k = 0; k < 14; k++) {
  const g = new THREE.Group();
  const l = new THREE.Mesh(wingGeoL, M('#3a3f44'));
  const r = new THREE.Mesh(wingGeoR, M('#3a3f44'));
  g.add(l, r);
  scene.add(g);
  birds.push({ g, l, r, a: (k / 14) * Math.PI * 2 + rr(-0.2, 0.2), rad: rr(22, 34), h: rr(16, 24), ph: rand() * 6 });
}

// people
const people = [];
const routes = [SWAMP, UPLAND, WOODS].map((pts) => {
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    seg.push({ a: pts[i], b: pts[i + 1], L, s0: total });
    total += L;
  }
  return { seg, total };
});
function routeAt(route, s) {
  for (const sg of route.seg) {
    if (s <= sg.s0 + sg.L) {
      const u = (s - sg.s0) / sg.L;
      return [sg.a[0] + (sg.b[0] - sg.a[0]) * u, sg.a[1] + (sg.b[1] - sg.a[1]) * u];
    }
  }
  const last = route.seg[route.seg.length - 1].b;
  return [last[0], last[1]];
}
for (let k = 0; k < 44; k++) {
  const route = routes[k % 3 === 0 ? 1 : k % 5 === 0 ? 2 : 0];
  people.push({ kind: 'trail', route, s: rand() * route.total, v: (rand() < 0.5 ? 1 : -1) * rr(0.35, 0.6), off: rr(-0.25, 0.25) });
}
for (let k = 0; k < 14; k++) people.push({ kind: 'plaza', x: rr(-5, 5), z: PZ + rr(-3, 4), a: rand() * 6.28 });
for (let k = 0; k < 6; k++) people.push({ kind: 'fb', x: rr(FB0, FB1), v: (rand() < 0.5 ? 1 : -1) * rr(0.4, 0.6), off: rr(-0.5, 0.5) });
for (let k = 0; k < 50; k++) people.push({ kind: 'mvt', z: rr(-EXT, EXT), v: (rand() < 0.5 ? 1 : -1) * (rand() < 0.5 ? rr(2.5, 4) : rr(0.6, 1)), off: rr(-0.4, 0.4) });
const personGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.3, 6).translate(0, 0.15, 0);
const headGeo = new THREE.IcosahedronGeometry(0.065, 0).translate(0, 0.37, 0);
const bodies = new THREE.InstancedMesh(personGeo, M('#ffffff'), people.length);
const heads = new THREE.InstancedMesh(headGeo, M('#d9ab85'), people.length);
people.forEach((p, i) => bodies.setColorAt(i, _c.set(pick(['#c8372d', '#2b5fa8', '#f2c230', '#2f2f2f', '#e9e6df', '#4c7a3a', '#8a5a9e']))));
bodies.castShadow = true;
bodies.frustumCulled = heads.frustumCulled = false;
scene.add(bodies, heads);

function updatePeople(dt) {
  _q.identity();
  _s.set(1, 1, 1);
  people.forEach((p, i) => {
    let x, y, z;
    if (p.kind === 'trail') {
      p.s += p.v * dt;
      if (p.s > p.route.total || p.s < 0) { p.v *= -1; p.s = THREE.MathUtils.clamp(p.s, 0, p.route.total); }
      [x, z] = routeAt(p.route, p.s);
      x += p.off;
      const g = groundY(x, z) ?? ISL;
      y = g < 1 ? 0.95 : g + 0.05;
    } else if (p.kind === 'plaza') {
      p.a += (rand() - 0.5) * dt * 2;
      const nx = p.x + Math.cos(p.a) * 0.3 * dt, nz = p.z + Math.sin(p.a) * 0.3 * dt;
      if (inEll(nx, nz, 0, PZ, 6.6, 4.6)) { p.x = nx; p.z = nz; } else p.a += Math.PI;
      x = p.x; z = p.z; y = TER;
    } else if (p.kind === 'fb') {
      p.x += p.v * dt;
      if (p.x > FB1 || p.x < FB0) { p.v *= -1; p.x = THREE.MathUtils.clamp(p.x, FB0, FB1); }
      x = p.x; z = FBZ + p.off; y = fbY(x) + 0.05;
    } else {
      p.z += p.v * dt;
      if (p.z > EXT) p.z = -EXT;
      if (p.z < -EXT) p.z = EXT;
      z = p.z; x = trailVA(z) + p.off; y = LAND + 0.05;
    }
    _m.compose(_p.set(x, y, z), _q, _s);
    bodies.setMatrixAt(i, _m);
    heads.setMatrixAt(i, _m);
  });
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
}

/* =====================================================================
   NIGHT LIGHTS (glowing sprites). The island closes at night, so it
   stays dark while the city glows around it.
   ===================================================================== */
const glowTex = canvasTexture(64, 64, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, w);
});
const lampPts = [];
for (let z = -EXT; z < EXT; z += 6) {
  lampPts.push(roadVA(z) + 2, 2, z);
  lampPts.push(roadDC(z) - 2, 2, z);
}
for (const B of bridges) {
  for (let x = B.xa; x <= B.xb; x += 3) for (const dz of [-1, 1]) lampPts.push(x, B.top + 0.9, B.z + dz * (B.width / 2 - 0.15));
}
for (let z = -44; z <= -20; z += 6) lampPts.push(-36.8, 2.2, z);
for (const [x, z] of [[247, 157], [253, 163], [247, 163], [253, 157], [150, 157], [150, 163]]) lampPts.push(x, LAND + 0.8, z);
const lampGeo = new THREE.BufferGeometry();
lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPts, 3));
const lampMat = new THREE.PointsMaterial({ map: glowTex, size: 2.4, color: 0xffd49a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const lamps = new THREE.Points(lampGeo, lampMat);
lamps.visible = false;
scene.add(lamps);

/* =====================================================================
   DAY / NIGHT
   ===================================================================== */
const DAY = { bg: new THREE.Color('#cfe5e6'), sky: new THREE.Color('#e6f4ff'), ground: new THREE.Color('#8b8f6b'), sun: new THREE.Color('#fff1dc'), water: new THREE.Color('#5b9fb5'), hemiI: 1.15, sunI: 2.6 };
const NIGHT = { bg: new THREE.Color('#0f1a33'), sky: new THREE.Color('#4a5f9a'), ground: new THREE.Color('#1b2030'), sun: new THREE.Color('#9fb6ff'), water: new THREE.Color('#17324a'), hemiI: 0.45, sunI: 0.45 };
let night = 0, nightGoal = 0;
function applyNight() {
  const k = night;
  scene.background.lerpColors(DAY.bg, NIGHT.bg, k);
  scene.fog.color.copy(scene.background);
  hero.style.background = '#' + scene.background.getHexString();
  hemi.color.lerpColors(DAY.sky, NIGHT.sky, k);
  hemi.groundColor.lerpColors(DAY.ground, NIGHT.ground, k);
  hemi.intensity = THREE.MathUtils.lerp(DAY.hemiI, NIGHT.hemiI, k);
  sun.color.lerpColors(DAY.sun, NIGHT.sun, k);
  sun.intensity = THREE.MathUtils.lerp(DAY.sunI, NIGHT.sunI, k);
  waterMat.color.lerpColors(DAY.water, NIGHT.water, k);
  U.uNight.value = k;
  lampMat.opacity = k;
  lamps.visible = k > 0.01;
  carCabinMat.emissiveIntensity = k * 0.9;
  kcMat.emissiveIntensity = k * 0.35;
  marble.emissiveIntensity = k * 0.55;
}
applyNight();

/* =====================================================================
   LANDMARKS, LABELS & CAMERA FLIGHTS
   ===================================================================== */
const LANDMARKS = [
  { id: 'memorial', name: 'Roosevelt Memorial', kicker: 'Memorial plaza · 1967', pos: V(0, 8.5, PZ - 4), cam: [20, 17, -6], target: [0, 2.5, PZ],
    text: 'In a clearing in the woods, a 17-foot bronze statue of Theodore Roosevelt by Paul Manship stands in front of a granite shaft. Four 21-foot granite tablets carry his words on Nature, Manhood, Youth and The State. A water moat with footbridges surrounds the oval terrace.' },
  { id: 'footbridge', name: 'Footbridge', kicker: 'The only way in', pos: V(-26, 5.5, FBZ), cam: [-4, 16, -4], target: [-27, 2, FBZ],
    text: 'Cars can’t go onto the island. Visitors walk across a footbridge from the Virginia shore, next to a parking lot on the George Washington Memorial Parkway and the Mount Vernon Trail.' },
  { id: 'swamp', name: 'Swamp Trail', kicker: 'Boardwalk loop', pos: V(18, 4, 12), cam: [52, 20, 32], target: [15, 1, 10],
    text: 'A loop of about a mile and a half circles the island, with boardwalks over tidal marsh and swamp on the east side. Look for herons, turtles and kingfishers.' },
  { id: 'upland', name: 'Upland forest', kicker: 'Upland Trail', pos: V(-5, 9, 8), cam: [-44, 30, 40], target: [-5, 3, 8],
    text: 'Most of the 88.5-acre island is forest, replanted from the 1930s under a plan by the Olmsted Brothers. The foundations of the Mason family house survive on the high ground.' },
  { id: 'trbridge', name: 'Roosevelt Bridge', kicker: 'Opened 1964', pos: V(20, 11, 52), cam: [40, 22, 96], target: [10, 5, 52],
    text: 'The Theodore Roosevelt Bridge carries I-66 and US-50 between Virginia and DC, crossing over the southern tip of the island.' },
  { id: 'key', name: 'Key Bridge', kicker: 'Opened 1923', pos: V(12, 13, -105), cam: [34, 25, -58], target: [12, 5, -105],
    text: 'The Francis Scott Key Bridge links Rosslyn to Georgetown on a row of concrete arches, just upstream of the island.' },
  { id: 'georgetown', name: 'Georgetown', kicker: 'Washington, DC', pos: V(100, 10, -80), cam: [44, 34, -24], target: [95, 3, -85],
    text: 'Rowhouses, the waterfront park, and the spire of Georgetown University’s Healy Hall. Crew teams row past the island from the boathouses upriver.' },
  { id: 'kennedy', name: 'Kennedy Center', kicker: 'Opened 1971', pos: V(82, 9, 72), cam: [40, 22, 112], target: [82, 3, 70],
    text: 'The national performing arts center sits on the DC shore just downstream, next to the curving Watergate complex.' },
  { id: 'rosslyn', name: 'Rosslyn', kicker: 'Arlington, Virginia', pos: V(-80, 36, -90), cam: [-16, 40, -18], target: [-85, 14, -90],
    text: 'Rosslyn’s towers rise just across the Little River. DC’s 1910 Height Act keeps the capital low, so Virginia has the skyline.' },
  { id: 'monument', name: 'Washington Monument', kicker: 'On the horizon', pos: V(250, 24, 160), cam: [178, 40, 236], target: [240, 10, 160],
    text: 'Past the Lincoln Memorial and the Reflecting Pool, the 555-foot obelisk rises over the National Mall, a couple of miles from the island.' },
];

const labelsEl = document.getElementById('labels');
const info = document.getElementById('info');
for (const L of LANDMARKS) {
  const b = document.createElement('button');
  b.className = 'label';
  b.type = 'button';
  b.setAttribute('aria-label', `Fly to ${L.name}`);
  b.innerHTML = `<span class="label-inner">${L.name}</span>`;
  b.addEventListener('click', () => focusLandmark(L.id));
  labelsEl.appendChild(b);
  L.el = b;
}

// "Places" cards in the page body
const grid = document.getElementById('place-grid');
for (const L of LANDMARKS) {
  const card = document.createElement('button');
  card.className = 'place';
  card.dataset.id = L.id;
  card.type = 'button';
  card.innerHTML = `<span class="kicker">${L.kicker}</span><h3>${L.name}</h3><p>${L.text}</p><span class="go">View on the model →</span>`;
  card.addEventListener('click', () => {
    hero.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => focusLandmark(L.id), reduceMotion ? 0 : 450);
  });
  grid.appendChild(card);
}

const fly = { active: false, pos: new THREE.Vector3(), target: new THREE.Vector3() };
function flyTo(pos, target) {
  fly.pos.copy(pos);
  fly.target.copy(target);
  fly.active = true;
  setAutoRotate(false);
}
function focusLandmark(id) {
  const L = LANDMARKS.find((l) => l.id === id);
  if (!L) return;
  LANDMARKS.forEach((l) => l.el.classList.toggle('active', l.id === id));
  flyTo(V(...L.cam), V(...L.target));
  document.getElementById('info-kicker').textContent = L.kicker;
  document.getElementById('info-title').textContent = L.name;
  document.getElementById('info-text').textContent = L.text;
  info.hidden = false;
  window.dispatchEvent(new CustomEvent('landmark:focus', { detail: { id } }));
}
function closeInfo() {
  info.hidden = true;
  LANDMARKS.forEach((l) => l.el.classList.remove('active'));
}
// user-initiated closes also stop any narration (see tour.js)
const userClose = () => {
  closeInfo();
  window.dispatchEvent(new CustomEvent('landmark:close'));
};
info.querySelector('.info-close').addEventListener('click', userClose);

function updateFly(dt) {
  if (!fly.active) return;
  const k = 1 - Math.exp(-dt * 2.6);
  camera.position.lerp(fly.pos, k);
  controls.target.lerp(fly.target, k);
  if (camera.position.distanceTo(fly.pos) < 0.05 && controls.target.distanceTo(fly.target) < 0.05) fly.active = false;
}
controls.addEventListener('start', () => {
  fly.active = false;
  hint.classList.add('fade');
});

const _v = new THREE.Vector3();
function updateLabels() {
  const w = hero.clientWidth, h = hero.clientHeight;
  for (const L of LANDMARKS) {
    _v.copy(L.pos).project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
    L.el.classList.toggle('hidden', !vis);
    if (vis) L.el.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px)`;
  }
}

/* =====================================================================
   UI
   ===================================================================== */
const btnTime = document.getElementById('btn-time');
const btnRotate = document.getElementById('btn-rotate');
const btnTilt = document.getElementById('btn-tilt');
const hint = document.getElementById('hint');

function setAutoRotate(on) {
  controls.autoRotate = on;
  btnRotate.setAttribute('aria-pressed', String(on));
}
setAutoRotate(controls.autoRotate);
btnTime.addEventListener('click', () => {
  nightGoal = nightGoal ? 0 : 1;
  btnTime.setAttribute('aria-pressed', String(!!nightGoal));
  btnTime.textContent = nightGoal ? '☀ Day' : '☾ Night';
});
btnRotate.addEventListener('click', () => setAutoRotate(!controls.autoRotate));
btnTilt.addEventListener('click', () => {
  const on = !hblur.enabled;
  hblur.enabled = vblur.enabled = on;
  btnTilt.setAttribute('aria-pressed', String(on));
});
function goHome() {
  closeInfo();
  flyTo(HOME.pos, HOME.target);
}
document.getElementById('btn-reset').addEventListener('click', () => {
  userClose();
  goHome();
});
// small API for the narrated tour
window.tri = { focusLandmark, goHome, landmarks: LANDMARKS.map((l) => ({ id: l.id, name: l.name })) };
function zoomBy(f) {
  const off = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(off.length() * f, controls.minDistance, controls.maxDistance);
  flyTo(controls.target.clone().add(off.setLength(len)), controls.target.clone());
}
document.getElementById('btn-zoom-in').addEventListener('click', () => zoomBy(0.7));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(1.4));

// Let the page scroll normally over the model; zoom needs Ctrl/⌘ (or a trackpad pinch).
hero.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
  },
  { capture: true }
);

/* =====================================================================
   RESIZE & LOOP
   ===================================================================== */
function resize() {
  const w = hero.clientWidth, h = hero.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hblur.uniforms.h.value = 1.8 / w;
  vblur.uniforms.v.value = 1.8 / h;
}
new ResizeObserver(resize).observe(hero);
resize();

let heroVisible = true;
new IntersectionObserver(([entry]) => (heroVisible = entry.isIntersecting)).observe(hero);

// Shareable URLs: ?time=night and/or ?view=memorial (any landmark id)
const params = new URLSearchParams(location.search);
if (params.get('time') === 'night') {
  btnTime.click();
  night = 1;
  applyNight();
}
if (params.get('view')) {
  const L = LANDMARKS.find((l) => l.id === params.get('view'));
  if (L) {
    focusLandmark(L.id);
    camera.position.set(...L.cam);
    controls.target.set(...L.target);
  }
}

const TARGET_BOUNDS = new THREE.Box3(V(-200, 0, -260), V(300, 40, 260));
const clock = new THREE.Clock();
let firstFrame = true;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!heroVisible && !firstFrame) return;
  const t = clock.elapsedTime;
  U.uTime.value = t;

  if (Math.abs(night - nightGoal) > 0.001) {
    night += Math.sign(nightGoal - night) * Math.min(Math.abs(nightGoal - night), dt * 0.8);
    applyNight();
  }

  updateCars(dt);
  updatePeople(dt);

  for (const b of boats) {
    b.g.position.z += b.speed * dt;
    if (b.g.position.z > 260) b.g.position.z = -380;
    if (b.g.position.z < -380) b.g.position.z = 260;
    b.g.position.y = Math.sin(t * 1.6 + b.g.position.x) * 0.03;
    if (b.oars) b.oars.rotation.y = Math.sin(t * 3.2) * 0.35;
  }
  jets.forEach((j, i) => (j.scale.y = 0.8 + 0.35 * Math.sin(t * 2.4 + i * 1.7)));
  for (const b of birds) {
    b.a += dt * 0.12;
    b.g.position.set(Math.cos(b.a) * b.rad, b.h + Math.sin(t + b.ph) * 1.2, Math.sin(b.a) * b.rad * 1.6 - 5);
    b.g.rotation.y = -b.a;
    const flap = Math.sin(t * 8 + b.ph) * 0.5;
    b.l.rotation.z = flap;
    b.r.rotation.z = -flap;
  }

  updateFly(dt);
  controls.update();
  controls.target.clamp(TARGET_BOUNDS.min, TARGET_BOUNDS.max);

  composer.render();
  updateLabels();

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loader').classList.add('done');
    setTimeout(() => hint.classList.add('fade'), 6000);
  }
});
