import { describe, expect, it } from 'vitest';
import { arrivalAt, computeFlow, distalFlow, flowFactor, timiGrade } from '../src/physics/flow';
import { getAnatomy } from '../src/anatomy/vessels';
import { treatedDiameter } from '../src/anatomy/lumen';

const a = getAnatomy();
const nativeInput = { diameter: (v: string, s: number) => a.vessels.get(v)!.native(s), occlusions: [], dissections: [] };

describe('flowFactor / TIMI', () => {
  it('flowFactor is 1 below 60%, 0 at ≥ 98% and monotonic', () => {
    expect(flowFactor(0.3)).toBe(1);
    expect(flowFactor(0.59)).toBe(1);
    expect(flowFactor(0.98)).toBe(0);
    expect(flowFactor(1)).toBe(0);
    let prev = 1;
    for (let ds = 0; ds <= 1; ds += 0.01) {
      const f = flowFactor(ds);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });
  it('TIMI grade is monotonic in flow and a 90% lesion gives TIMI 2', () => {
    expect(timiGrade(1)).toBe(3);
    expect(timiGrade(0.5)).toBe(2);
    expect(timiGrade(0.1)).toBe(1);
    expect(timiGrade(0)).toBe(0);
    expect(timiGrade(flowFactor(0.9))).toBe(2);
    const flow = computeFlow(nativeInput);
    expect(timiGrade(distalFlow(flow, 'LAD'))).toBe(2);
  });
});

describe('contrast transit', () => {
  it('slows beyond the lesion', () => {
    const flow = computeFlow(nativeInput);
    const healthy = computeFlow({ ...nativeInput, diameter: (v, s) => a.vessels.get(v)!.ref(s) });
    const beyond = a.lesion.s1 + 20;
    expect(arrivalAt(flow, 'LAD', beyond)).toBeGreaterThan(arrivalAt(healthy, 'LAD', beyond) * 1.3);
    // Proximal to the lesion nothing changes.
    expect(arrivalAt(flow, 'LAD', a.lesion.s0 - 5)).toBeCloseTo(arrivalAt(healthy, 'LAD', a.lesion.s0 - 5));
  });
  it('stops behind an inflated balloon (D2 too, D1 not)', () => {
    const occ = [{ vessel: 'LAD', s0: a.lesion.s0, s1: a.lesion.s1 }];
    const flow = computeFlow({ ...nativeInput, occlusions: occ });
    expect(arrivalAt(flow, 'LAD', a.lesion.s1 + 10)).toBe(Infinity);
    expect(arrivalAt(flow, 'D2', 10)).toBe(Infinity);
    expect(Number.isFinite(arrivalAt(flow, 'D1', 10))).toBe(true);
    expect(distalFlow(flow, 'LAD')).toBe(0);
  });
  it('recovers after stenting', () => {
    const t = [{ vessel: 'LAD', s0: a.lesion.s0 - 2, s1: a.lesion.s1 + 2, diameter: 3.07, kind: 'stent' as const }];
    const flow = computeFlow({ ...nativeInput, diameter: (v, s) => (v === 'LAD' ? treatedDiameter(a.vessels.get(v)!.native(s), s, t) : a.vessels.get(v)!.native(s)) });
    expect(timiGrade(distalFlow(flow, 'LAD'))).toBe(3);
  });
  it('an unsealed dissection reduces downstream flow; sealing restores it', () => {
    const healthy = { ...nativeInput, diameter: (v: string, s: number) => a.vessels.get(v)!.ref(s) };
    const d = computeFlow({ ...healthy, dissections: [{ vessel: 'LAD', s: 50, sealed: false }] });
    expect(distalFlow(d, 'LAD')).toBeCloseTo(0.45);
    expect(timiGrade(distalFlow(d, 'LAD'))).toBe(2);
    const sealed = computeFlow({ ...healthy, dissections: [{ vessel: 'LAD', s: 50, sealed: true }] });
    expect(distalFlow(sealed, 'LAD')).toBe(1);
  });
});
