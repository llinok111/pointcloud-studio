#!/usr/bin/env node
/**
 * Deterministic generator for the demo cloud: a (2,3) torus knot tube sampled as
 * a point cloud, with a known number of uniform outliers injected at the tail.
 *
 *   node tools/gen-sample.mjs
 *
 * Same seed -> byte-identical output. The noise block is placed last so that
 * bench/verify.mjs can compute precision/recall against a ground-truth mask.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "data");

const SEED = 20261031;
const SURFACE = 57000;
const NOISE = 3000;
const TUBE_R = 0.55;
const JITTER = 0.012;
const SCALE = 2.4;
const NOISE_SPHERE = 7.6;

const RADIUS = 0.28;
const MIN_NEIGHBORS = 4;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const gauss = () => {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// (2,3) torus knot centerline
function knot(t) {
  const c = 2 + Math.cos(3 * t);
  return [c * Math.cos(2 * t), c * Math.sin(2 * t), Math.sin(3 * t)];
}
function tangent(t) {
  const h = 1e-4;
  const a = knot(t - h), b = knot(t + h);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const pts = new Float64Array((SURFACE + NOISE) * 3);

for (let i = 0; i < SURFACE; i++) {
  const t = rand() * Math.PI * 2;
  const T = tangent(t);
  const up = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const N = norm(cross(T, up));
  const B = norm(cross(T, N));
  const phi = rand() * Math.PI * 2;
  const rr = TUBE_R + gauss() * JITTER;
  const c = knot(t);
  const cp = Math.cos(phi) * rr, sp = Math.sin(phi) * rr;
  const o = i * 3;
  pts[o] = (c[0] + N[0] * cp + B[0] * sp) * SCALE;
  pts[o + 1] = (c[1] + N[1] * cp + B[1] * sp) * SCALE;
  pts[o + 2] = (c[2] + N[2] * cp + B[2] * sp) * SCALE;
}

// uniform points inside a sphere — these are the injected outliers
for (let i = 0; i < NOISE; i++) {
  let x, y, z;
  do {
    x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1;
  } while (x * x + y * y + z * z > 1);
  const o = (SURFACE + i) * 3;
  pts[o] = x * NOISE_SPHERE;
  pts[o + 1] = y * NOISE_SPHERE;
  pts[o + 2] = z * NOISE_SPHERE;
}

const round4 = (v) => Math.round(v * 10000) / 10000;
const flat = new Array(pts.length);
for (let i = 0; i < pts.length; i++) flat[i] = round4(pts[i]);

const doc = {
  meta: {
    name: "torus-knot-cloud",
    seed: SEED,
    count: SURFACE + NOISE,
    surfaceCount: SURFACE,
    noiseStart: SURFACE,
    radius: RADIUS,
    minNeighbors: MIN_NEIGHBORS,
    generator: "tools/gen-sample.mjs",
  },
  points: flat,
};

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, "cloud.json");
writeFileSync(out, JSON.stringify(doc));
console.log(`wrote ${out}  points=${SURFACE + NOISE} (surface=${SURFACE}, noise=${NOISE})`);
