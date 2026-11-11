import { describe, expect, it } from 'vitest';
import { coverageMargins, inflatedDiameter, pressureZone, rupturePressure } from '../src/physics/devices';

describe('balloon / stent pressure–diameter', () => {
  it('balloon is nominal at 8 atm and grows 1.5%/atm', () => {
    expect(inflatedDiameter('balloon', 2.5, 8)).toBeCloseTo(2.5);
    expect(inflatedDiameter('balloon', 2.5, 10)).toBeCloseTo(2.5 * 1.03);
    expect(inflatedDiameter('balloon', 2.5, 6)).toBeCloseTo(2.5 * 0.97);
  });
  it('stent is nominal at 10 atm and grows 1.2%/atm', () => {
    expect(inflatedDiameter('stent', 3, 10)).toBeCloseTo(3);
    expect(inflatedDiameter('stent', 3, 12)).toBeCloseTo(3 * 1.024);
  });
  it('is smaller while unfolding below 2 atm and continuous at 2 atm', () => {
    expect(inflatedDiameter('balloon', 3, 0)).toBeLessThan(1);
    expect(inflatedDiameter('balloon', 3, 1)).toBeLessThan(inflatedDiameter('balloon', 3, 2));
    expect(inflatedDiameter('balloon', 3, 1.9999)).toBeCloseTo(inflatedDiameter('balloon', 3, 2), 3);
  });
  it('rupture threshold is RBP + 4 and zones are reported', () => {
    expect(rupturePressure('balloon')).toBe(18);
    expect(rupturePressure('stent')).toBe(20);
    expect(pressureZone('balloon', 15)).toBe('aboveRBP');
    expect(pressureZone('balloon', 18.5)).toBe('rupture');
    expect(pressureZone('balloon', 1)).toBe('unfolding');
  });
});

describe('coverage margins', () => {
  it('reports margins and geographic miss', () => {
    const lesion = { s0: 38, s1: 52 };
    expect(coverageMargins({ s0: 36, s1: 54 }, lesion)).toMatchObject({ proximal: 2, distal: 2, min: 2, covers: true });
    const miss = coverageMargins({ s0: 39, s1: 51 }, lesion);
    expect(miss.covers).toBe(false);
    expect(miss.min).toBe(-1);
  });
});
