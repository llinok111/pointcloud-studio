/**
 * pointcloud-studio — pure point-cloud kernels.
 *
 * Runs unchanged in node and in the browser: no renderer, no DOM, no I/O,
 * no top-level side effects. Everything here is deterministic given its input.
 *
 * Coordinate layout: `points` is a flat array of x,y,z triples
 * (Float32Array, Float64Array or plain number[] all work).
 */

const EPS = 1e-9;
const MAX_CELLS = 8_000_000;

/** Axis-aligned bounds of a flat xyz buffer. */
export function bounds(points) {
  const n = (points.length / 3) | 0;
  if (n === 0) return { count: 0, min: [0, 0, 0], max: [0, 0, 0] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const x = points[j], y = points[j + 1], z = points[j + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { count: n, min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** Cell size that yields roughly `targetPerCell` points per occupied cell. */
export function suggestCellSize(points, targetPerCell = 24) {
  const b = bounds(points);
  if (b.count === 0) return 0.1;
  const vx = Math.max(b.max[0] - b.min[0], EPS);
  const vy = Math.max(b.max[1] - b.min[1], EPS);
  const vz = Math.max(b.max[2] - b.min[2], EPS);
  const s = Math.cbrt((vx * vy * vz * targetPerCell) / b.count);
  return Math.max(s, 1e-4);
}

/**
 * Uniform spatial hash built with a counting sort (no per-cell arrays).
 * Cells are stored in a flat CSR layout: cell c owns items[start[c] .. start[c+1]).
 */
export function buildGrid(points, cellSize) {
  const b = bounds(points);
  const n = b.count;
  let cs = Math.max(Number(cellSize) || 0, 1e-4);
  let nx = 1, ny = 1, nz = 1;

  for (let guard = 0; guard < 64; guard++) {
    nx = Math.max(1, Math.ceil((b.max[0] - b.min[0]) / cs) + 1);
    ny = Math.max(1, Math.ceil((b.max[1] - b.min[1]) / cs) + 1);
    nz = Math.max(1, Math.ceil((b.max[2] - b.min[2]) / cs) + 1);
    if (nx * ny * nz <= MAX_CELLS) break;
    cs *= 1.5;
  }

  const numCells = nx * ny * nz;
  const start = new Int32Array(numCells + 1);
  const items = new Int32Array(n);
  const inv = 1 / cs;
  const mx = b.min[0], my = b.min[1], mz = b.min[2];

  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const ix = ((points[j] - mx) * inv) | 0;
    const iy = ((points[j + 1] - my) * inv) | 0;
    const iz = ((points[j + 2] - mz) * inv) | 0;
    start[(ix * ny + iy) * nz + iz + 1]++;
  }
  for (let c = 0; c < numCells; c++) start[c + 1] += start[c];

  const cursor = start.slice(0, numCells);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const ix = ((points[j] - mx) * inv) | 0;
    const iy = ((points[j + 1] - my) * inv) | 0;
    const iz = ((points[j + 2] - mz) * inv) | 0;
    items[cursor[(ix * ny + iy) * nz + iz]++] = i;
  }

  return { n, cellSize: cs, inv, nx, ny, nz, min: [mx, my, mz], start, items, bounds: b };
}

/** All point indices within Euclidean distance r of (x,y,z). Exact. */
export function radiusQuery(grid, points, x, y, z, r) {
  const out = [];
  const r2 = r * r;
  const { cellSize: cs, inv, nx, ny, nz, min, start, items } = grid;
  const span = Math.max(0, Math.ceil(r / cs));

  const ix0 = Math.max(0, ((x - min[0]) * inv) | 0), ix1 = Math.min(nx - 1, ix0 + span);
  const iy0 = Math.max(0, ((y - min[1]) * inv) | 0), iy1 = Math.min(ny - 1, iy0 + span);
  const iz0 = Math.max(0, ((z - min[2]) * inv) | 0), iz1 = Math.min(nz - 1, iz0 + span);
  const lx = Math.max(0, ix0 - span), ly = Math.max(0, iy0 - span), lz = Math.max(0, iz0 - span);

  for (let ix = lx; ix <= ix1; ix++) {
    const bx = ix * ny;
    for (let iy = ly; iy <= iy1; iy++) {
      const by = (bx + iy) * nz;
      for (let iz = lz; iz <= iz1; iz++) {
        const c = by + iz;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const p = items[k] * 3;
          const dx = points[p] - x, dy = points[p + 1] - y, dz = points[p + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(items[k]);
        }
      }
    }
  }
  return Int32Array.from(out);
}

/** Neighbour count per point (self excluded). */
export function neighborCounts(grid, points, r) {
  const { n, cellSize: cs, inv, nx, ny, nz, min, start, items } = grid;
  const counts = new Int32Array(n);
  const r2 = r * r;
  const span = Math.max(0, Math.ceil(r / cs));

  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const x = points[j], y = points[j + 1], z = points[j + 2];
    const cx = ((x - min[0]) * inv) | 0;
    const cy = ((y - min[1]) * inv) | 0;
    const cz = ((z - min[2]) * inv) | 0;
    const ax = Math.max(0, cx - span), bx = Math.min(nx - 1, cx + span);
    const ay = Math.max(0, cy - span), by = Math.min(ny - 1, cy + span);
    const az = Math.max(0, cz - span), bz = Math.min(nz - 1, cz + span);
    let count = 0;
    for (let ix = ax; ix <= bx; ix++) {
      const o1 = ix * ny;
      for (let iy = ay; iy <= by; iy++) {
        const o2 = (o1 + iy) * nz;
        for (let iz = az; iz <= bz; iz++) {
          const c = o2 + iz;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const q = items[k];
            if (q === i) continue;
            const p = q * 3;
            const dx = points[p] - x, dy = points[p + 1] - y, dz = points[p + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= r2) count++;
          }
        }
      }
    }
    counts[i] = count;
  }
  return counts;
}

/** Indices of points whose neighbour count is below `minNeighbors`. */
export function detectOutliers(grid, points, r, minNeighbors) {
  const counts = neighborCounts(grid, points, r);
  const out = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] < minNeighbors) out.push(i);
  return { outliers: Int32Array.from(out), counts };
}

/** Exact nearest neighbour via expanding Chebyshev shells. */
export function nearest(grid, points, x, y, z) {
  const { n, cellSize: cs, inv, nx, ny, nz, min, start, items } = grid;
  if (n === 0) return { index: -1, dist: Infinity };

  // Clamp the seed cell into the grid so that queries from far outside the
  // bounds still expand over every cell instead of starting out of range.
  const cx = Math.min(nx - 1, Math.max(0, ((x - min[0]) * inv) | 0));
  const cy = Math.min(ny - 1, Math.max(0, ((y - min[1]) * inv) | 0));
  const cz = Math.min(nz - 1, Math.max(0, ((z - min[2]) * inv) | 0));
  let best = -1, bestD2 = Infinity;
  const maxRing = Math.max(nx, ny, nz) + 1;

  for (let R = 0; R <= maxRing; R++) {
    const ax = Math.max(0, cx - R), bx = Math.min(nx - 1, cx + R);
    const ay = Math.max(0, cy - R), by = Math.min(ny - 1, cy + R);
    const az = Math.max(0, cz - R), bz = Math.min(nz - 1, cz + R);
    for (let ix = ax; ix <= bx; ix++) {
      const dxc = ix < cx ? cx - ix : ix - cx;
      const o1 = ix * ny;
      for (let iy = ay; iy <= by; iy++) {
        const dyc = iy < cy ? cy - iy : iy - cy;
        const o2 = (o1 + iy) * nz;
        for (let iz = az; iz <= bz; iz++) {
          const dzc = iz < cz ? cz - iz : iz - cz;
          // shell only: interior cells were already scanned
          if (dxc !== R && dyc !== R && dzc !== R) continue;
          const c = o2 + iz;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const p = items[k] * 3;
            const dx = points[p] - x, dy = points[p + 1] - y, dz = points[p + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = items[k]; }
          }
        }
      }
    }
    if (best >= 0) {
      const reach = R * cs;
      if (bestD2 <= reach * reach) break;
    }
  }
  return { index: best, dist: Math.sqrt(bestD2) };
}

/** Simple descriptive statistics for a flat xyz buffer (used by the HUD). */
export function cloudStats(points, counts) {
  const n = (points.length / 3) | 0;
  let sum = 0, max = 0;
  for (let i = 0; i < n; i++) { sum += counts[i]; if (counts[i] > max) max = counts[i]; }
  return { count: n, meanNeighbors: n ? sum / n : 0, maxNeighbors: max };
}
