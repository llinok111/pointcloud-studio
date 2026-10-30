# pointcloud-studio

**A 60 000-point cloud inspector whose neighbourhood queries are ~43× faster than a linear scan — 2000 radius queries drop from 281.6 ms to 6.5 ms median (43.4×), while returning byte-identical result sets and flagging 2 588 outliers at precision 0.998 / recall 0.861.**

The core is a uniform spatial hash with exact radius search, nearest-neighbour and density-based outlier detection. It is pure arithmetic on typed arrays: no renderer, no DOM, no I/O — so the same file runs in node and in the browser, and every claim below is checked by a node script.

Upstream: none

## Run it

```bash
node tools/gen-sample.mjs && node bench/verify.mjs && node bench/bench.mjs
```

That regenerates the data, runs 17 correctness assertions against a brute-force baseline, and writes `bench/result.json`.

To open the viewer:

```bash
python3 -m http.server 4173   # then open http://localhost:4173
```

Drag to orbit, scroll to zoom, **click the cloud** to query a neighbourhood. The `r` and `k` sliders re-run detection; the button hides the flagged points so you can see the clean surface underneath.

## Evidence

All numbers below come from `node bench/bench.mjs` on this machine (node v24.19.0, AMD EPYC 7K62, 4 cores). Nothing here is estimated.

| workload | baseline (`baseline/naive.mjs`) | spatial hash | ratio |
| --- | --- | --- | --- |
| 2000 radius queries, r=0.28, 60 000 points | **281.58 ms** median (p95 297.70) | **6.48 ms** median (p95 7.00) | **43.4×** |
| grid cold start (first call in a fresh process) | 281.58 ms *(warm median — the baseline is not re-timed cold)* | 16.33 ms | 17.2× vs warm baseline |
| full outlier pass over all 60 000 points | not run (3.6×10⁹ comparisons) | **71.56 ms** median | — |

Medians and p95 are stable; dispersion is not. Three independent re-runs gave speedup 42.2–43.0×, grid median 6.38–6.55 ms and cold start 16.9–18.4 ms. Per-run σ lives in `bench/result.json` and moves much more than the medians do, so it is not quoted here as a fixed property of the code.

Both paths return the same neighbour sets — the benchmark aborts if the total hit count differs (`48 029` neighbour pairs in both).

Correctness, from `node bench/verify.mjs` (exit 0, all 17 checks print their measured value):

| check | measured |
| --- | --- |
| radius query vs linear scan, 150 queries | 3 737 neighbour pairs, **0 mismatches** |
| nearest neighbour vs linear scan, 200 queries | **0 mismatches** |
| per-point neighbour counts, 250 sampled points | **0 mismatches** |
| outlier precision / recall / F1 | **0.9977 / 0.8607 / 0.9241** |
| flagged outliers | 2 588 of 60 000 (4.31 %) |

The dataset is generated, not scraped: a (2,3) torus-knot tube sampled at 57 000 surface points plus 3 000 uniform points injected inside a sphere. Because the injected block sits at the tail of the buffer, precision and recall are computed against a ground-truth mask rather than asserted by eye. `tools/gen-sample.mjs` uses a fixed seed — running it twice produces byte-identical `data/cloud.json` (1.3 MB, ~0.1 s).

## How it works

- `src/core.mjs` — `buildGrid` (counting sort into a CSR cell array), `radiusQuery`, `nearest` (expanding Chebyshev shells), `neighborCounts`, `detectOutliers`.
- `baseline/naive.mjs` — the linear-scan reference. Same semantics, no early exit, used by both bench scripts.
- `main.js` — three.js renderer and orbit/click interaction only. It calls the core for every query and never recomputes geometry itself.
- `index.html` — single entry point, pinned import map (`three@0.169.0` from unpkg).

## Known limitations

- **Recall is 0.861, not 1.0.** Density thresholding cannot separate a stray point that landed *on* the tube from a real surface point; those 418 misses are the honest cost of a radius/k heuristic. Precision is high (6 false positives) because surface density (~25 neighbours) sits far above the k=4 threshold.
- **The 43.4× figure is for 2 000 queries**, the interactive path (click-to-query, box selection). A full 60 000×60 000 pass is not benchmarked against the baseline because it would take minutes; the grid-only pass is reported separately at 71.6 ms.
- **Cold start is ~2.5–2.8× slower than steady state** (16.9–18.4 ms vs 6.4–6.5 ms across re-runs) due to JIT warm-up; the cold number is reported rather than hidden. The baseline is never timed cold, so the 17.2× cold figure is a warm-baseline comparison and is labelled as such.
- The grid allocates one cell array sized to the bounding box; cell count is capped at 8×10⁶ and the cell size is grown automatically past that.
- Browser-side timings shown in the HUD are indicative only. No browser automation is used anywhere in this repo, and no screenshot is evidence.
