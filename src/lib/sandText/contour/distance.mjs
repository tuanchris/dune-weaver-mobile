// Vendored from sand-weaver experiments/region-program/boundary-fill.js (the signed-distance
// sampler only: sampleDistance and its helpers), for contourFill.mjs. Edit there first.



const EPS = 1e-10;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
const area = points => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2;
const winding = points => Math.sign(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0));
const closed = points => [...points, points[0]];

function edgesFor(loops) {
  return loops.flatMap(loop => loop.points.map((a, edge) => {
    const b = loop.points[(edge + 1) % loop.points.length];
    return {a, b, loop, edge, minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1])};
  }));
}

// A segment BVH keeps exact distances affordable for traced masks with many
// vertices. The raster introduces sampling error, not a chamfer-distance bias.
function makeIndex(edges) {
  const node = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
  for (const edge of edges) for (const axis of ['X', 'Y']) {
    node['min' + axis] = Math.min(node['min' + axis], edge['min' + axis]);
    node['max' + axis] = Math.max(node['max' + axis], edge['max' + axis]);
  }
  if (edges.length <= 8) return {...node, edges};
  const axis = node.maxX - node.minX >= node.maxY - node.minY ? 'X' : 'Y';
  edges.sort((a, b) => a['min' + axis] + a['max' + axis] - b['min' + axis] - b['max' + axis]);
  const middle = edges.length >> 1;
  return {...node, left: makeIndex(edges.slice(0, middle)), right: makeIndex(edges.slice(middle))};
}

function nearest(index, p) {
  let best = {squared: Infinity};
  const bound = box => Math.max(box.minX - p[0], 0, p[0] - box.maxX) ** 2 + Math.max(box.minY - p[1], 0, p[1] - box.maxY) ** 2;
  const visit = node => {
    if (bound(node) > best.squared + 1e-18) return;
    if (node.edges) {
      for (const edge of node.edges) {
        const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], squared = dx * dx + dy * dy;
        const u = squared ? Math.max(0, Math.min(1, ((p[0] - edge.a[0]) * dx + (p[1] - edge.a[1]) * dy) / squared)) : 0;
        const point = lerp(edge.a, edge.b, u), d = (p[0] - point[0]) ** 2 + (p[1] - point[1]) ** 2;
        if (d < best.squared) best = {squared: d, point, u, ...edge};
      }
    } else if (bound(node.left) <= bound(node.right)) { visit(node.left); visit(node.right); }
    else { visit(node.right); visit(node.left); }
  };
  visit(index);
  return best;
}

export function sampleDistance(region, pitch, step) {
  const boundary = [region.polygon, ...(region.holes || [])].map(points => ({points}));
  const edges = edgesFor(boundary), index = makeIndex([...edges]);
  const span = Math.max(index.maxX - index.minX, index.maxY - index.minY);
  const requestedStep = Math.min(pitch / 3, step / 2);
  const n = Math.max(65, Math.min(513, Math.ceil(span / requestedStep) + 5));
  const gridStep = span / (n - 5), center = [(index.minX + index.maxX) / 2, (index.minY + index.maxY) / 2];
  const origin = center.map(v => v - (n - 1) / 2 * gridStep), field = new Float64Array(n * n);
  let maximum = 0;
  for (let y = 0; y < n; y++) {
    const yy = origin[1] + y * gridStep, crossings = [];
    for (const edge of edges) if ((edge.a[1] > yy) !== (edge.b[1] > yy)) crossings.push(edge.a[0] + (edge.b[0] - edge.a[0]) * (yy - edge.a[1]) / (edge.b[1] - edge.a[1]));
    crossings.sort((a, b) => a - b);
    let crossed = 0;
    for (let x = 0; x < n; x++) {
      const xx = origin[0] + x * gridStep;
      while (crossed < crossings.length && crossings[crossed] <= xx) crossed++;
      const value = Math.sqrt(nearest(index, [xx, yy]).squared) * (crossed % 2 ? 1 : -1);
      field[y * n + x] = value;
      maximum = Math.max(maximum, value);
    }
  }
  return {field, n, gridStep, center, maximum, capped: gridStep > requestedStep * 1.01};
}
