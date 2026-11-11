import { DEVICES } from '../config/anatomy';

export type CathKind = 'balloon' | 'stent';

export function deviceSpec(kind: CathKind) {
  return kind === 'balloon' ? DEVICES.balloon : DEVICES.stent;
}

/**
 * Semi-compliant pressure–diameter curve:
 * d = nominal × (1 + compliance × (P − nominalP)); smaller while unfolding below 2 atm.
 */
export function inflatedDiameter(kind: CathKind, nominalDiameter: number, pressure: number): number {
  const spec = deviceSpec(kind);
  const p = Math.max(0, pressure);
  const compliant = (pp: number) => nominalDiameter * (1 + spec.compliance * (pp - spec.nominal));
  if (p < DEVICES.unfoldBelow) {
    const folded = DEVICES.catheter.foldedDiameter;
    return folded + (compliant(DEVICES.unfoldBelow) - folded) * (p / DEVICES.unfoldBelow);
  }
  return compliant(p);
}

export function rupturePressure(kind: CathKind): number {
  return deviceSpec(kind).rbp + DEVICES.ruptureAboveRbp;
}

export type PressureZone = 'deflated' | 'unfolding' | 'working' | 'aboveRBP' | 'rupture';

export function pressureZone(kind: CathKind, p: number): PressureZone {
  const spec = deviceSpec(kind);
  if (p <= 0.05) return 'deflated';
  if (p < DEVICES.unfoldBelow) return 'unfolding';
  if (p > rupturePressure(kind)) return 'rupture';
  if (p > spec.rbp) return 'aboveRBP';
  return 'working';
}

/** Margins (mm) by which a device interval overhangs the lesion; negative = geographic miss. */
export function coverageMargins(
  device: { s0: number; s1: number },
  lesion: { s0: number; s1: number },
): { proximal: number; distal: number; min: number; covers: boolean } {
  const proximal = lesion.s0 - device.s0;
  const distal = device.s1 - lesion.s1;
  return { proximal, distal, min: Math.min(proximal, distal), covers: proximal >= 0 && distal >= 0 };
}

/** Whether the balloon markers straddle the lesion (both markers outside or at the lesion core). */
export function markersAcrossLesion(device: { s0: number; s1: number }, lesion: { s0: number; s1: number; center: number }): boolean {
  return device.s0 <= lesion.center && device.s1 >= lesion.center;
}
