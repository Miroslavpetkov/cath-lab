import { DEVICES, LESION } from '../config/anatomy';
import { smoothstep } from '../math/vec';

/** Reference (healthy) diameter along a vessel with a power-law taper. */
export function referenceDiameter(prox: number, dist: number, exp: number, s: number, length: number): number {
  const t = Math.max(0, Math.min(1, s / length));
  return prox - (prox - dist) * Math.pow(t, exp);
}

/**
 * Fractional diameter stenosis of the lesion at arc length s on its vessel:
 * cosine-tapered with a short plateau at the peak value.
 */
export function stenosisFraction(
  s: number,
  center: number = LESION.centerS,
  length: number = LESION.length,
  plateau: number = LESION.plateau,
  peak: number = LESION.stenosis,
): number {
  const d = Math.abs(s - center);
  const half = length / 2;
  const p = plateau / 2;
  if (d >= half) return 0;
  if (d <= p) return peak;
  const x = (d - p) / (half - p);
  return peak * 0.5 * (1 + Math.cos(Math.PI * x));
}

export type TreatmentKind = 'balloon' | 'stent' | 'live';

/** A lumen-changing intervention on one vessel interval. Applied in order. */
export interface Treatment {
  vessel: string;
  s0: number;
  s1: number;
  diameter: number;
  kind: TreatmentKind;
  /** For stents: index into the stent list, whose diameter can grow on post-dilation. */
  stentIndex?: number;
}

/** 0..1 weight of a treatment interval at s, with smooth tapers past the ends. */
export function treatmentWeight(t: { s0: number; s1: number }, s: number, taper: number = DEVICES.taperMm): number {
  if (s >= t.s0 && s <= t.s1) return 1;
  if (s < t.s0) return 1 - smoothstep(0, taper, t.s0 - s);
  return 1 - smoothstep(0, taper, s - t.s1);
}

/** Lumen diameter after the lesion and all treatments (balloon recoil, stent recoil). */
export function treatedDiameter(
  baseDiameter: number,
  s: number,
  treatments: readonly Treatment[],
  stentDiameters: readonly number[] = [],
): number {
  let d = baseDiameter;
  for (const t of treatments) {
    const w = treatmentWeight(t, s);
    if (w <= 0) continue;
    let target: number;
    if (t.kind === 'balloon') target = d + (1 - DEVICES.balloon.elasticRecoil) * (t.diameter - d);
    else if (t.kind === 'stent') {
      const sd = t.stentIndex !== undefined && stentDiameters[t.stentIndex] !== undefined ? stentDiameters[t.stentIndex] : t.diameter;
      target = sd * (1 - DEVICES.stent.recoil);
    } else target = t.diameter;
    if (target > d) d = d + w * (target - d);
  }
  return d;
}

export interface QCAResult {
  referenceDiameter: number;
  mld: number;
  percentDS: number;
  lesionLength: number;
  mldS: number;
}

/**
 * Quantitative coronary angiography on a sampled segment: reference = mean of healthy
 * diameters at both shoulders; MLD = minimum lumen; length = span where DS > 5%.
 */
export function qca(samples: { s: number; d: number; ref: number }[]): QCAResult {
  let mldIdx = 0;
  samples.forEach((p, i) => {
    if (p.d < samples[mldIdx].d) mldIdx = i;
  });
  const m = samples[mldIdx];
  const ref = m.ref;
  const ds = 1 - m.d / ref;
  let a = mldIdx;
  let b = mldIdx;
  while (a > 0 && 1 - samples[a - 1].d / samples[a - 1].ref > 0.05) a--;
  while (b < samples.length - 1 && 1 - samples[b + 1].d / samples[b + 1].ref > 0.05) b++;
  const length = ds > 0.05 ? samples[b].s - samples[a].s : 0;
  return { referenceDiameter: ref, mld: m.d, percentDS: Math.max(0, ds * 100), lesionLength: length, mldS: m.s };
}
