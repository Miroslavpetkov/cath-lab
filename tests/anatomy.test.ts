import { describe, expect, it } from 'vitest';
import { getAnatomy } from '../src/anatomy/vessels';
import { qca, stenosisFraction, treatedDiameter } from '../src/anatomy/lumen';
import { LESION } from '../src/config/anatomy';

describe('stenosis profile', () => {
  it('peaks at 90% on the plateau and is zero outside the lesion', () => {
    expect(stenosisFraction(LESION.centerS)).toBeCloseTo(0.9);
    expect(stenosisFraction(LESION.centerS + LESION.plateau / 2 - 0.01)).toBeCloseTo(0.9);
    expect(stenosisFraction(LESION.centerS + LESION.length / 2)).toBe(0);
    expect(stenosisFraction(LESION.centerS - 20)).toBe(0);
  });
  it('tapers monotonically from the plateau to the edge', () => {
    let prev = 1;
    for (let d = LESION.plateau / 2; d <= LESION.length / 2; d += 0.5) {
      const v = stenosisFraction(LESION.centerS + d);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
  it('the LAD reference diameter at the lesion is about 2.9–3.0 mm', () => {
    const ref = getAnatomy().vessels.get('LAD')!.ref(LESION.centerS);
    expect(ref).toBeGreaterThanOrEqual(2.9);
    expect(ref).toBeLessThanOrEqual(3.0);
  });
  it('the lesion sits between D1 and D2', () => {
    const a = getAnatomy();
    expect(a.vessels.get('D1')!.parentS).toBeLessThan(a.lesion.s0);
    expect(a.vessels.get('D2')!.parentS).toBeGreaterThan(a.lesion.s1);
  });
});

describe('lumen treatment', () => {
  it('plain balloon leaves the lumen open minus ~30% recoil; stent minus ~3%', () => {
    const base = 0.3;
    const b = treatedDiameter(base, 5, [{ vessel: 'LAD', s0: 0, s1: 10, diameter: 2.6, kind: 'balloon' }]);
    expect(b).toBeCloseTo(base + 0.7 * (2.6 - base));
    const s = treatedDiameter(base, 5, [{ vessel: 'LAD', s0: 0, s1: 10, diameter: 3.0, kind: 'stent' }]);
    expect(s).toBeCloseTo(3.0 * 0.97);
  });
  it('tapers smoothly beyond the treated segment and never narrows the lumen', () => {
    const t = [{ vessel: 'LAD', s0: 0, s1: 10, diameter: 3, kind: 'stent' as const }];
    const inside = treatedDiameter(1, 10, t);
    const edge = treatedDiameter(1, 10.7, t);
    const out = treatedDiameter(1, 13, t);
    expect(inside).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(out);
    expect(out).toBe(1);
    expect(treatedDiameter(3.2, 5, t)).toBe(3.2);
  });
  it('post-dilation via the stent list enlarges the stent', () => {
    const t = [{ vessel: 'LAD', s0: 0, s1: 10, diameter: 3, kind: 'stent' as const, stentIndex: 0 }];
    expect(treatedDiameter(1, 5, t, [3.3])).toBeCloseTo(3.3 * 0.97);
  });
});

describe('QCA', () => {
  it('measures reference, MLD, %DS and lesion length of the native lesion', () => {
    const lad = getAnatomy().vessels.get('LAD')!;
    const samples = [];
    for (let s = LESION.centerS - 16; s <= LESION.centerS + 16; s += 0.25) samples.push({ s, d: lad.native(s), ref: lad.ref(s) });
    const q = qca(samples);
    expect(q.percentDS).toBeCloseTo(90, 0);
    expect(q.mld).toBeLessThan(0.35);
    expect(q.lesionLength).toBeGreaterThan(10);
    expect(q.lesionLength).toBeLessThanOrEqual(14);
  });
});
