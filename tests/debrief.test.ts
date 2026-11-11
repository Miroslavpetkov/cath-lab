import { describe, expect, it } from 'vitest';
import { CaseSummary, buildDebrief, debriefFor, buildSummary } from '../src/procedure/debrief';
import { createState } from '../src/state/store';
import { DemoController } from '../src/procedure/demo';
import { inject, setCathSize, stepSim } from '../src/procedure/sim';
import { NO_INPUT } from '../src/tools/controller';
import { lesionPathRange } from '../src/anatomy/vessels';

const good: CaseSummary = {
  stagesCompleted: 6,
  residualStenosis: 4,
  finalTIMI: 3,
  stentCount: 1,
  stentToReference: 1.02,
  coverageMargin: 2,
  heparinBeforeWire: true,
  predilated: true,
  qcaUsed: true,
  dissection: 'none',
  wireForcing: 0,
  ruptures: 0,
  longestInflation: 12,
  contrastMl: 30,
  fluoroMinutes: 2,
  finalViews: 2,
};

describe('buildDebrief', () => {
  it('scores a clean case Excellent with every item ok', () => {
    const d = buildDebrief(good);
    expect(d.score).toBe(100);
    expect(d.grade).toBe('Excellent');
    expect(d.items.every((i) => i.status === 'ok')).toBe(true);
    expect(d.items.every((i) => i.teaching.length > 20)).toBe(true);
  });
  it('a few slips give Good', () => {
    const d = buildDebrief({ ...good, qcaUsed: false, wireForcing: 1, contrastMl: 150, longestInflation: 40 });
    expect(d.grade).toBe('Good');
  });
  it('oversized short stent with dissection and miss → Needs work', () => {
    const d = buildDebrief({ ...good, stentToReference: 1.45, coverageMargin: -1, dissection: 'unsealed', finalTIMI: 2 });
    expect(d.grade).toBe('Needs work');
    expect(d.items.find((i) => i.label === 'Lesion coverage')!.status).toBe('bad');
  });
  it('no stent → Incomplete', () => {
    expect(buildDebrief({ ...good, stentCount: 0, stentToReference: null, coverageMargin: null, stagesCompleted: 4 }).grade).toBe('Incomplete');
  });
});

describe('deliberately bad case (end to end)', () => {
  it('oversized short stent at high pressure → dissection, reduced flow, Needs work', () => {
    const st = createState(11);
    const demo = new DemoController();
    const dt = 1 / 30;
    // Let the autopilot do everything up to loading the stent, then take over badly.
    for (let i = 0; i < 30 * 400 && !(st.cath.kind === 'stent' && demo.narration.startsWith('Loading a 3.0')); i++) stepSim(st, demo.update(st, dt), dt);
    demo.active = false;
    setCathSize(st, 4.0, 12);
    const lesion = lesionPathRange();
    for (let t = 0; t < 60 && st.cath.s < lesion.center + 6; t += dt) stepSim(st, { ...NO_INPUT, advance: 1 }, dt);
    for (let t = 0; t < 30 && st.cath.pressure < 18; t += dt) stepSim(st, { ...NO_INPUT, inflate: true }, dt);
    for (let t = 0; t < 10 && st.cath.pressure > 0; t += dt) stepSim(st, { ...NO_INPUT, deflate: true }, dt);
    for (let t = 0; t < 20 && st.cath.s > 0; t += dt) stepSim(st, { ...NO_INPUT, advance: -1 }, dt);
    inject(st);
    for (let t = 0; t < 12; t += dt) stepSim(st, NO_INPUT, dt);
    const sum = buildSummary(st);
    expect(st.dissections.length).toBeGreaterThan(0);
    expect(sum.dissection).toBe('unsealed');
    expect(sum.finalTIMI).toBeLessThan(3);
    expect(st.ladFlow).toBeLessThan(0.8);
    expect(debriefFor(st).grade).toBe('Needs work');
  });
});
