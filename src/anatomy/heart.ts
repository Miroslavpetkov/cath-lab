import { HEART } from '../config/anatomy';
import { V3, add, cross, dot, norm, scale, sub, v3 } from '../math/vec';

/** Heart-local orthonormal frame: long axis toward the base, anterior, and patient-left. */
export interface HeartFrame {
  center: V3;
  long: V3; // toward base
  ant: V3;
  left: V3;
}

export function heartFrame(): HeartFrame {
  const long = norm(scale(HEART.apexDir, -1));
  const z = v3(0, 0, 1);
  const ant = norm(sub(z, scale(long, dot(z, long))));
  let left = norm(cross(long, ant));
  if (left.x < 0) left = scale(left, -1);
  return { center: HEART.center, long, ant, left };
}

/** Unit radial direction at heart-local angle (0 = anterior, +90 = patient-left). */
export function radialDir(f: HeartFrame, angleDeg: number): V3 {
  const a = (angleDeg * Math.PI) / 180;
  return add(scale(f.ant, Math.cos(a)), scale(f.left, Math.sin(a)));
}

/** Surface radius at angle/h: tapered apex, flattened base, RV bulge. h ∈ [-1 apex, 1 base]. */
export function surfaceRadius(angleDeg: number, h: number): number {
  const hh = Math.max(-1, Math.min(1, h));
  const base = Math.sqrt(Math.max(0, 1 - hh * hh));
  const flat = hh > 0 ? Math.pow(base, 0.7) : base; // fuller, flatter base
  const taper = 1 - HEART.apexTaper * Math.max(0, -hh);
  let r = HEART.radius * flat * taper;
  const d = (((angleDeg - HEART.rvBulgeAngle) % 360) + 540) % 360 - 180;
  const bulge = Math.max(0, Math.cos((d * Math.PI) / 180 / 1.2));
  r += HEART.rvBulge * bulge * bulge * base;
  return r;
}

export function axialOffset(h: number): number {
  return h >= 0 ? h * HEART.baseHalfLength : h * HEART.apexHalfLength;
}

/** Point on (or `lift` mm above) the epicardial surface. */
export function surfacePoint(f: HeartFrame, angleDeg: number, h: number, lift = 0): V3 {
  const r = surfaceRadius(angleDeg, h) + lift;
  return add(add(f.center, scale(f.long, axialOffset(h))), scale(radialDir(f, angleDeg), r));
}

/** Contraction of a heart-relative point at a given beat phase (0..1). Shared by mesh & devices. */
export function beatScale(phase: number): number {
  const sys = HEART.systoleFraction;
  const p = phase % 1;
  const k = p < sys ? Math.sin((Math.PI * p) / sys) : 0;
  return 1 - HEART.beatAmplitude * k;
}

export function beatPoint(p: V3, phase: number): V3 {
  const c = HEART.center;
  return add(c, scale(sub(p, c), beatScale(phase)));
}
