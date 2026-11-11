import { V3, add, dist, lerp, norm, scale, sub } from './vec';

/** A centreline parameterised by arc length (mm). Devices slide along these as 1D rails. */
export class Polyline {
  readonly pts: V3[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: V3[]) {
    if (pts.length < 2) throw new Error('Polyline needs at least 2 points');
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + dist(pts[i - 1], pts[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  private seg(s: number): { i: number; t: number } {
    const c = this.cum;
    if (s <= 0) return { i: 0, t: 0 };
    if (s >= this.length) return { i: c.length - 2, t: 1 };
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segLen = c[lo + 1] - c[lo] || 1;
    return { i: lo, t: (s - c[lo]) / segLen };
  }

  pointAt(s: number): V3 {
    const { i, t } = this.seg(s);
    const p = lerp(this.pts[i], this.pts[i + 1], t);
    if (s < 0) return add(this.pts[0], scale(this.tangentAt(0), s));
    if (s > this.length) return add(this.pts[this.pts.length - 1], scale(this.tangentAt(this.length), s - this.length));
    return p;
  }

  tangentAt(s: number): V3 {
    const { i } = this.seg(Math.min(Math.max(s, 0), this.length));
    return norm(sub(this.pts[i + 1], this.pts[i]));
  }

  /** Closest arc length to a point (brute force, fine for a few hundred points). */
  closestS(p: V3): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const ab = sub(b, a);
      const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1;
      const ap = sub(p, a);
      const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / l2));
      const q = add(a, scale(ab, t));
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
      }
    }
    return best;
  }

  /** Evenly resampled points, step mm apart (always includes both ends). */
  sample(step: number): { s: number; p: V3 }[] {
    const n = Math.max(1, Math.ceil(this.length / step));
    const out: { s: number; p: V3 }[] = [];
    for (let k = 0; k <= n; k++) {
      const s = (this.length * k) / n;
      out.push({ s, p: this.pointAt(s) });
    }
    return out;
  }
}

/** Centripetal-ish Catmull–Rom through control points, returned as a dense point list. */
export function catmullRom(ctrl: V3[], perSeg = 12): V3[] {
  if (ctrl.length < 2) return ctrl.slice();
  const out: V3[] = [];
  const P = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}
