#!/usr/bin/env node
/**
 * Timing harness. 1 warmup + 7 measured repetitions of the same workload,
 * plus a separately recorded cold run (very first call on a fresh process).
 * Writes bench/result.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import * as core from "../src/core.mjs";
import * as naive from "../baseline/naive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, "..", "data", "cloud.json"), "utf8"));
const P = Float64Array.from(doc.points);
const { radius: R, minNeighbors: K, count, noiseStart } = doc.meta;

const QUERIES = 2000;
const REPS = 7;
const WARMUP = 1;

// Deterministic query set drawn from the surface points themselves.
const qIdx = new Int32Array(QUERIES);
for (let i = 0; i < QUERIES; i++) qIdx[i] = (i * 7919 + 31) % count;

const now = () => Number(process.hrtime.bigint()) / 1e6;

function runGrid() {
  const t0 = now();
  const g = core.buildGrid(P, R);
  let hits = 0;
  for (let i = 0; i < QUERIES; i++) {
    const o = qIdx[i] * 3;
    hits += core.radiusQuery(g, P, P[o], P[o + 1], P[o + 2], R).length;
  }
  return { ms: now() - t0, hits };
}

function runBaseline() {
  const t0 = now();
  let hits = 0;
  for (let i = 0; i < QUERIES; i++) {
    const o = qIdx[i] * 3;
    hits += naive.naiveRadiusQuery(P, P[o], P[o + 1], P[o + 2], R).length;
  }
  return { ms: now() - t0, hits };
}

function stats(runs) {
  const s = [...runs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return {
    samples: n,
    min: +s[0].toFixed(3),
    median: +median.toFixed(3),
    p95: +s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)].toFixed(3),
    max: +s[n - 1].toFixed(3),
    mean: +mean.toFixed(3),
    stddev: +Math.sqrt(variance).toFixed(3),
    relStddev: +(Math.sqrt(variance) / median).toFixed(4),
  };
}

// ---- cold: the very first grid build + first batch on a fresh process
const cold = runGrid();

// ---- warmup
for (let i = 0; i < WARMUP; i++) { runGrid(); runBaseline(); }

// ---- measured
const gridRuns = [], baseRuns = [];
let gridHits = 0, baseHits = 0;
for (let i = 0; i < REPS; i++) {
  const g = runGrid();
  gridRuns.push(g.ms); gridHits = g.hits;
  const b = runBaseline();
  baseRuns.push(b.ms); baseHits = b.hits;
}

if (gridHits !== baseHits) {
  console.error(`hit count mismatch: grid=${gridHits} baseline=${baseHits}`);
  process.exit(1);
}

// ---- full outlier pass (grid only; brute force would be 3.6e9 comparisons)
const passRuns = [];
let detected = 0;
for (let i = 0; i < 5; i++) {
  const t0 = now();
  const g = core.buildGrid(P, R);
  const res = core.detectOutliers(g, P, R, K);
  passRuns.push(now() - t0);
  detected = res.outliers.length;
}

const gs = stats(gridRuns), bs = stats(baseRuns);

const result = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
  },
  dataset: {
    file: "data/cloud.json",
    points: count,
    surfacePoints: noiseStart,
    injectedNoise: count - noiseStart,
    radius: R,
    minNeighbors: K,
  },
  workload: {
    description: `${QUERIES} radius queries (r=${R}) with a grid build, vs the same ${QUERIES} queries by linear scan`,
    queries: QUERIES,
    reps: REPS,
    warmup: WARMUP,
    baseline: "baseline/naive.mjs :: naiveRadiusQuery (full scan, no early exit)",
    neighbourPairsChecked: gridHits,
  },
  grid: { coldMs: +cold.ms.toFixed(3), ...gs },
  baseline: bs,
  speedupMedian: +(bs.median / gs.median).toFixed(1),
  speedupCold: +(bs.median / cold.ms).toFixed(1),
  outlierPass: {
    points: count,
    detected,
    medianMs: +stats(passRuns).median.toFixed(3),
    ...stats(passRuns),
  },
};

writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n");

console.log(`grid     : cold ${result.grid.coldMs} ms | median ${gs.median} ms | p95 ${gs.p95} ms | stddev ${gs.stddev} ms (${(gs.relStddev * 100).toFixed(1)}%)`);
console.log(`baseline : median ${bs.median} ms | p95 ${bs.p95} ms | stddev ${bs.stddev} ms (${(bs.relStddev * 100).toFixed(1)}%)`);
console.log(`speedup  : ${result.speedupMedian}x (median vs median), ${result.speedupCold}x vs cold`);
console.log(`outliers : ${detected} flagged in ${result.outlierPass.medianMs} ms over ${count} points`);
console.log(`wrote ${join(HERE, "result.json")}`);
