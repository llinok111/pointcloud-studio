#!/usr/bin/env node
/**
 * Correctness gate. Every assertion prints the value it actually measured.
 * Exit 0 only if all checks pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/core.mjs";
import * as naive from "../baseline/naive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, "..", "data", "cloud.json"), "utf8"));
const P = Float64Array.from(doc.points);
const { radius: R, minNeighbors: K, noiseStart, count } = doc.meta;

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
  if (!ok) failures++;
}

console.log(`dataset: ${count} points (${noiseStart} surface + ${count - noiseStart} injected noise), r=${R}, k=${K}\n`);

// --- 1. structural facts about the generated data
check("point count", P.length / 3 === count, `${P.length / 3} === ${count}`);
check("flat buffer length", P.length === count * 3, `${P.length}`);

// --- 2. grid construction
const grid = core.buildGrid(P, R);
check("grid cell size >= r", grid.cellSize >= R - 1e-9, `cell=${grid.cellSize.toFixed(4)} r=${R}`);
check("grid covers every point", grid.items.length === count, `${grid.items.length} bucketed`);
check("grid cell count bounded", grid.nx * grid.ny * grid.nz < 8_000_000, `${grid.nx}x${grid.ny}x${grid.nz}`);

// --- 3. radius query vs brute force (exact set equality)
let qBad = 0, qCompared = 0, qHits = 0;
const Q = 150;
for (let i = 0; i < Q; i++) {
  const idx = (i * 397) % count, o = idx * 3;
  const a = Array.from(core.radiusQuery(grid, P, P[o], P[o + 1], P[o + 2], R)).sort((x, y) => x - y);
  const b = Array.from(naive.naiveRadiusQuery(P, P[o], P[o + 1], P[o + 2], R)).sort((x, y) => x - y);
  qCompared += b.length; qHits += a.length;
  if (a.length !== b.length || a.some((v, k) => v !== b[k])) qBad++;
}
check("radius query set equality", qBad === 0, `${Q} queries, ${qCompared} neighbour pairs, ${qBad} mismatches`);
check("radius query non-trivial", qCompared / Q > 5, `avg ${(qCompared / Q).toFixed(1)} neighbours/query`);

// --- 4. nearest neighbour vs brute force
let nBad = 0;
for (let i = 0; i < 200; i++) {
  const idx = (i * 977 + 13) % count, o = idx * 3;
  const a = core.nearest(grid, P, P[o], P[o + 1], P[o + 2]);
  const b = naive.naiveNearest(P, P[o], P[o + 1], P[o + 2]);
  if (a.index !== b.index) nBad++;
}
check("nearest neighbour index", nBad === 0, `200 queries, ${nBad} mismatches`);

// --- 5. per-point neighbour counts vs brute force
let cBad = 0;
const counts = core.neighborCounts(grid, P, R);
for (let i = 0; i < 250; i++) {
  const idx = (i * 733 + 7) % count;
  if (counts[idx] !== naive.naiveNeighborCount(P, idx, R)) cBad++;
}
check("neighbour counts", cBad === 0, `250 sampled points, ${cBad} mismatches`);

// --- 6. outlier detection quality against the known ground-truth mask
const det = core.detectOutliers(grid, P, R, K);
let tp = 0, fp = 0, fn = 0;
for (let i = 0; i < count; i++) {
  const isOut = counts[i] < K;
  const isNoise = i >= noiseStart;
  if (isOut && isNoise) tp++;
  else if (isOut && !isNoise) fp++;
  else if (!isOut && isNoise) fn++;
}
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn);
const f1 = (2 * precision * recall) / (precision + recall);
check("outlier precision >= 0.99", precision >= 0.99, `${precision.toFixed(4)} (${tp} tp / ${fp} fp)`);
check("outlier recall >= 0.85", recall >= 0.85, `${recall.toFixed(4)} (${tp} tp / ${fn} fn)`);
check("outlier F1 >= 0.90", f1 >= 0.90, `${f1.toFixed(4)}`);
check("detector is not trivially empty", det.outliers.length > 1000, `${det.outliers.length} flagged`);

// --- 7. edge cases
const empty = core.radiusQuery(grid, P, 9999, 9999, 9999, R);
check("query outside bounds is empty", empty.length === 0, `${empty.length} hits`);
const far = core.nearest(grid, P, 9999, 9999, 9999);
check("nearest from far away still resolves", far.index >= 0 && Number.isFinite(far.dist), `index=${far.index} dist=${far.dist.toFixed(2)}`);
const single = core.buildGrid(Float64Array.from([1, 2, 3]), 0.5);
check("single-point grid", single.n === 1 && single.items[0] === 0, `n=${single.n}`);
check("deterministic rebuild", core.buildGrid(P, R).items.every((v, i) => v === grid.items[i]), "identical bucket order");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
