/**
 * Render + interaction only. Every geometric decision comes from src/core.mjs;
 * this file never re-implements a query.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGrid, detectOutliers, nearest, radiusQuery, cloudStats } from "./src/core.mjs";

const $ = (id) => document.getElementById(id);
const app = $("app");
const loading = $("loading");

let P, meta, grid, counts, outliers, stats;
let scene, camera, renderer, controls, cloud, noise, highlight, ring;
let radius, minNeighbors, hideOutliers = false;

const COLOR_OUTLIER = new THREE.Color(0xff4d3d);
const STOPS = [
  new THREE.Color(0x1b3f8f),
  new THREE.Color(0x2f8fd6),
  new THREE.Color(0x46d6c4),
  new THREE.Color(0xe8d16a),
  new THREE.Color(0xfff3d6),
];

function ramp(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  return STOPS[i].clone().lerp(STOPS[i + 1], x - i);
}

function disposeObj(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.geometry.dispose();
  obj.material.dispose();
}

/** Split the cloud into inliers + outliers and hand both to the renderer. */
function buildLayers() {
  const n = P.length / 3;
  const inPos = new Float32Array((n - outliers.size) * 3);
  const inCol = new Float32Array((n - outliers.size) * 3);
  const outPos = new Float32Array(outliers.size * 3);
  const ref = Math.log1p(Math.max(1, stats.maxNeighbors));
  const c = new THREE.Color();
  let a = 0, b = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (outliers.has(i)) {
      outPos[b++] = P[o]; outPos[b++] = P[o + 1]; outPos[b++] = P[o + 2];
    } else {
      inPos[a] = P[o]; inPos[a + 1] = P[o + 1]; inPos[a + 2] = P[o + 2];
      c.copy(ramp(Math.log1p(counts[i]) / ref));
      inCol[a] = c.r; inCol[a + 1] = c.g; inCol[a + 2] = c.b;
      a += 3;
    }
  }

  disposeObj(cloud);
  disposeObj(noise);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(inPos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(inCol, 3));
  g.computeBoundingSphere();
  cloud = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.052, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.94,
  }));
  scene.add(cloud);

  const og = new THREE.BufferGeometry();
  og.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
  og.computeBoundingSphere();
  noise = new THREE.Points(og, new THREE.PointsMaterial({
    size: 0.075, color: COLOR_OUTLIER, sizeAttenuation: true,
    transparent: true, opacity: 0.9,
  }));
  noise.visible = !hideOutliers;
  scene.add(noise);
}

function refreshStats() {
  $("s-total").textContent = String(P.length / 3);
  $("s-out").textContent = `${outliers.size} (${((outliers.size / (P.length / 3)) * 100).toFixed(2)}%)`;
  $("s-mean").textContent = stats.meanNeighbors.toFixed(1);
}

function recompute() {
  grid = buildGrid(P, radius);
  const res = detectOutliers(grid, P, radius, minNeighbors);
  counts = res.counts;
  outliers = new Set(res.outliers);
  stats = cloudStats(P, counts);
  buildLayers();
  refreshStats();
  ring.visible = false;
  highlight.geometry.setDrawRange(0, 0);
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.012);

  camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(11, 8, 13);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  app.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.minDistance = 2;
  controls.maxDistance = 60;
  controls.target.set(0, 0, 0);

  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
  hg.setDrawRange(0, 0);
  highlight = new THREE.Points(hg, new THREE.PointsMaterial({
    size: 0.1, color: 0xffb454, sizeAttenuation: true, transparent: true, opacity: 0.95,
  }));
  highlight.frustumCulled = false;
  scene.add(highlight);

  ring = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb454, wireframe: true, transparent: true, opacity: 0.16 }),
  );
  ring.visible = false;
  scene.add(ring);
}

function pick(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.params.Points.threshold = 0.16;
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([cloud, noise], false)[0];
  if (!hit) { $("pick").textContent = "no point under cursor"; return; }

  const t0 = performance.now();
  const nn = nearest(grid, P, hit.point.x, hit.point.y, hit.point.z);
  if (nn.index < 0) return;
  const o = nn.index * 3;
  const cx = P[o], cy = P[o + 1], cz = P[o + 2];
  const neighbours = radiusQuery(grid, P, cx, cy, cz, radius);
  const dt = performance.now() - t0;

  const pos = highlight.geometry.getAttribute("position");
  const cap = Math.min(neighbours.length, pos.count);
  for (let i = 0; i < cap; i++) {
    const q = neighbours[i] * 3;
    pos.setXYZ(i, P[q], P[q + 1], P[q + 2]);
  }
  pos.needsUpdate = true;
  highlight.geometry.setDrawRange(0, cap);

  ring.position.set(cx, cy, cz);
  ring.scale.setScalar(radius);
  ring.visible = true;

  $("pick").textContent = `${neighbours.length} nbrs · ${dt.toFixed(2)} ms`;
  controls.autoRotate = false;
}

function wireUI() {
  const rEl = $("r"), kEl = $("k");
  rEl.value = String(radius);
  kEl.value = String(minNeighbors);
  $("r-val").textContent = radius.toFixed(2);
  $("k-val").textContent = String(minNeighbors);

  const apply = () => {
    radius = parseFloat(rEl.value);
    minNeighbors = parseInt(kEl.value, 10);
    $("r-val").textContent = radius.toFixed(2);
    $("k-val").textContent = String(minNeighbors);
    recompute();
  };
  rEl.addEventListener("change", apply);
  kEl.addEventListener("change", apply);

  $("toggle").addEventListener("click", (e) => {
    hideOutliers = !hideOutliers;
    e.currentTarget.setAttribute("aria-pressed", String(hideOutliers));
    e.currentTarget.textContent = hideOutliers ? "show outliers" : "hide outliers";
    noise.visible = !hideOutliers;
  });

  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 4) pick(e.clientX, e.clientY);
  });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function main() {
  const res = await fetch("./data/cloud.json");
  if (!res.ok) throw new Error(`data/cloud.json -> HTTP ${res.status}`);
  const doc = await res.json();
  meta = doc.meta;
  P = new Float32Array(doc.points);
  radius = meta.radius;
  minNeighbors = meta.minNeighbors;

  initScene();
  recompute();
  wireUI();
  animate();
  loading.classList.add("done");
}

main().catch((err) => {
  loading.innerHTML = `<div class="err"><b>failed to start</b><br>${String(err.message || err)}<br><br>serve this folder over http (see README) — file:// blocks ES modules and fetch.</div>`;
});
