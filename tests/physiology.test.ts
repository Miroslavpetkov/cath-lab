import { describe, expect, it } from 'vitest';
import { giveHeparin, initialPhysiology, stepPhysiology } from '../src/physics/physiology';
import { ecgSample } from '../src/physics/ecg';

const run = (p: ReturnType<typeof initialPhysiology>, flow: number, secs: number) => {
  for (let t = 0; t < secs; t += 0.1) p = stepPhysiology(p, flow, 0.1);
  return p;
};

describe('physiology', () => {
  it('ST rises with occlusion and recovers after reperfusion', () => {
    let p = run(initialPhysiology(), 0, 20);
    expect(p.st).toBeGreaterThan(3.5);
    expect(p.hr).toBeGreaterThan(80);
    p = run(p, 1, 30);
    expect(p.st).toBeLessThan(0.2);
  });
  it('drops BP after 40 s and becomes unstable after 60 s of occlusion', () => {
    let p = run(initialPhysiology(), 0, 45);
    expect(p.sys).toBeLessThan(110);
    expect(p.pvcRate).toBeGreaterThan(0);
    expect(p.unstable).toBe(false);
    p = run(p, 0, 20);
    expect(p.unstable).toBe(true);
    expect(p.alarm).toBe(true);
  });
  it('ACT rises from 128 to ~285 s after heparin', () => {
    let p = initialPhysiology();
    expect(p.act).toBe(128);
    p = run(p, 1, 10);
    expect(p.act).toBe(128);
    p = run(giveHeparin(p), 1, 60);
    expect(p.act).toBeGreaterThan(280);
  });
});

describe('ECG', () => {
  it('shows ST elevation in the ST segment', () => {
    const t = 0.32;
    expect(ecgSample(t, 0.88, 3) - ecgSample(t, 0.88, 0)).toBeGreaterThan(0.25);
  });
  it('has a tall R wave and a wide PVC', () => {
    expect(ecgSample(0.22, 0.88, 0)).toBeGreaterThan(1);
    expect(ecgSample(0.08, 0.88, 0, true)).toBeGreaterThan(1);
  });
});
