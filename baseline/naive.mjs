/**
 * Brute-force reference implementation. O(n) per query, O(n^2) for a full pass.
 * Used only by bench/ and bench/verify.mjs as the comparison baseline.
 */

export function naiveRadiusQuery(points, x, y, z, r) {
  const n = (points.length / 3) | 0;
  const r2 = r * r;
  const out = [];
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const dx = points[j] - x, dy = points[j + 1] - y, dz = points[j + 2] - z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  }
  return Int32Array.from(out);
}

export function naiveNearest(points, x, y, z) {
  const n = (points.length / 3) | 0;
  let best = -1, bestD2 = Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const dx = points[j] - x, dy = points[j + 1] - y, dz = points[j + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return { index: best, dist: Math.sqrt(bestD2) };
}

export function naiveNeighborCount(points, index, r) {
  const n = (points.length / 3) | 0;
  const o = index * 3;
  const x = points[o], y = points[o + 1], z = points[o + 2];
  const r2 = r * r;
  let count = 0;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    if (i === index) continue;
    const dx = points[j] - x, dy = points[j + 1] - y, dz = points[j + 2] - z;
    if (dx * dx + dy * dy + dz * dz <= r2) count++;
  }
  return count;
}

export function naiveOutliers(points, r, minNeighbors) {
  const n = (points.length / 3) | 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (naiveNeighborCount(points, i, r) < minNeighbors) out.push(i);
  }
  return Int32Array.from(out);
}
