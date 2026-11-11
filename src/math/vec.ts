/** Minimal 3D vector maths with no Three.js dependency, so simulation logic stays pure and testable. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return scale(a, 1 / l);
};
export const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
export const angleDiff = (a: number, b: number): number => {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
};

/** Wrap an angle to (-180, 180]. */
export const wrapDeg = (a: number): number => angleDiff(a, 0);

/** Any vector perpendicular to n (unit). */
export const anyPerp = (n: V3): V3 => {
  const t = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  return norm(cross(n, t));
};

/** Rotate v around unit axis k by angle (radians) – Rodrigues. */
export const rotateAxis = (v: V3, k: V3, ang: number): V3 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
};

/** Seeded PRNG (mulberry32) so random complications are reproducible in tests. */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
