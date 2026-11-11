import { describe, expect, it } from 'vitest';
import { SimState, createState } from '../src/state/store';
import { giveHeparin, inject, selectTool, setCathSize, stepSim } from '../src/procedure/sim';
import { NO_INPUT, SimInput } from '../src/tools/controller';
import { getAnatomy, lesionPathRange } from '../src/anatomy/vessels';
import { DEVICES } from '../src/config/anatomy';
import { currentStage, latch } from '../src/procedure/stages';
import { toolStatus } from '../src/tools/tools';

const dt = 1 / 30;
const run = (st: SimState, inp: Partial<SimInput>, until: (s: SimState) => boolean, max = 120) => {
  for (let t = 0; t < max && !until(st); t += dt) stepSim(st, { ...NO_INPUT, ...inp }, dt);
};
const a = getAnatomy();

function toRoot(st: SimState) {
  run(st, { advance: 1, fluoro: true }, (s) => s.guide.s >= a.route.length - 0.5);
}
function engage(st: SimState) {
  toRoot(st);
  run(st, { rotate: 1, fine: true }, (s) => Math.abs(s.guide.rot - DEVICES.guide.leftCusp) < 3);
  run(st, { advance: 1, fine: true }, (s) => s.guide.engaged);
}
function wireToLAD(st: SimState) {
  engage(st);
  inject(st);
  run(st, {}, (s) => s.time > s.fluoro.cineUntil);
  giveHeparin(st);
  selectTool(st, 'wire');
  run(st, { rotate: -1 }, (s) => Math.abs(s.wire.rot - -15) < 4);
}

describe('guide engagement', () => {
  it('engages only when facing the left cusp and advanced gently', () => {
    const st = createState(1);
    toRoot(st);
    run(st, { advance: 1, fine: true }, () => false, 1);
    expect(st.guide.engaged).toBe(false); // starts facing the wrong way
    run(st, { rotate: 1, fine: true }, (s) => Math.abs(s.guide.rot - DEVICES.guide.leftCusp) < 3);
    run(st, { advance: 1 }, () => false, 0.5);
    expect(st.guide.engaged).toBe(false); // too fast
    run(st, { advance: 1, fine: true }, (s) => s.guide.engaged);
    expect(st.guide.engaged).toBe(true);
  });
  it('gives a specific message when facing the right cusp', () => {
    const st = createState(1);
    toRoot(st);
    run(st, { rotate: -1 }, (s) => Math.abs(s.guide.rot - DEVICES.guide.rightCusp) < 3);
    run(st, { advance: 1, fine: true }, () => false, 0.3);
    expect(st.messages.some((m) => m.text.includes('RIGHT cusp'))).toBe(true);
  });
  it('pops out with too much torque', () => {
    const st = createState(1);
    engage(st);
    run(st, { rotate: 1 }, (s) => !s.guide.engaged, 2);
    expect(st.guide.engaged).toBe(false);
  });
});

describe('wire steering and forcing', () => {
  it('follows the tip rotation at the LM bifurcation', () => {
    const st = createState(1);
    engage(st);
    inject(st);
    run(st, {}, (s) => s.time > s.fluoro.cineUntil);
    giveHeparin(st);
    selectTool(st, 'wire');
    // Start rotation faces the LCx.
    run(st, { advance: 1 }, (s) => s.wire.branches.length > 1);
    expect(st.wire.branches[1]).toBe('LCx');
    run(st, { advance: -1 }, (s) => s.wire.branches.length === 1);
    run(st, { rotate: -1 }, (s) => Math.abs(s.wire.rot - -15) < 4);
    run(st, { advance: 1 }, (s) => s.wire.branches.length > 1);
    expect(st.wire.branches[1]).toBe('LAD');
  });
  it('captures a diagonal when the tip faces it', () => {
    const st = createState(1);
    wireToLAD(st);
    run(st, { advance: 1 }, (s) => s.wire.branches[1] === 'LAD');
    run(st, { rotate: 1 }, (s) => Math.abs(s.wire.rot - 90) < 4);
    run(st, { advance: 1 }, (s) => s.wire.branches.length > 2, 10);
    expect(st.wire.branches[2]).toBe('D1');
  });
  it('buckles and builds dissection risk when forced through the lesion', () => {
    const st = createState(1);
    wireToLAD(st);
    const lesion = lesionPathRange();
    run(st, { advance: 1 }, (s) => s.wire.s >= lesion.s0 + 1);
    run(st, { advance: 1 }, () => false, 1);
    expect(st.wire.buckling).toBe(true);
    expect(st.wire.forcing).toBeGreaterThan(0);
    expect(st.wire.risk).toBeGreaterThan(0);
  });
  it('crosses cleanly when advanced slowly', () => {
    const st = createState(1);
    wireToLAD(st);
    const lesion = lesionPathRange();
    run(st, { advance: 1 }, (s) => s.wire.s >= lesion.s0 - 2);
    run(st, { advance: 1, fine: true }, (s) => s.wire.crossed);
    expect(st.wire.crossed).toBe(true);
    expect(st.wire.forcing).toBe(0);
    expect(st.dissections.length).toBe(0);
  });
});

describe('balloon catheter rules', () => {
  function readyBalloon() {
    const st = createState(1);
    wireToLAD(st);
    const lesion = lesionPathRange();
    run(st, { advance: 1 }, (s) => s.wire.s >= lesion.s0 - 2);
    run(st, { advance: 1, fine: true }, (s) => s.wire.crossed);
    run(st, { advance: 1 }, (s) => s.wire.s >= lesion.s1 + 30);
    expect(selectTool(st, 'balloon')).toBe(true);
    return st;
  }
  it('size locks once out of the guide; cannot move while inflated', () => {
    const st = readyBalloon();
    expect(setCathSize(st, 2.5, 15)).toBe(true);
    run(st, { advance: 1 }, (s) => s.cath.s > 5);
    expect(setCathSize(st, 3.0, 15)).toBe(false);
    run(st, { inflate: true }, (s) => s.cath.pressure > 4);
    const pos = st.cath.s;
    run(st, { advance: 1 }, () => false, 0.5);
    expect(st.cath.s).toBe(pos);
  });
  it('stays behind the wire tip', () => {
    const st = readyBalloon();
    run(st, { advance: 1 }, () => false, 30);
    expect(st.cath.s).toBeLessThanOrEqual(st.wire.s - DEVICES.catheter.behindWireTip + 1e-6);
  });
  it('ruptures above RBP + 4 and records inflations', () => {
    const st = readyBalloon();
    setCathSize(st, 2.5, 15);
    const lesion = lesionPathRange();
    run(st, { advance: 1 }, (s) => s.cath.s >= lesion.center + 7.5);
    run(st, { inflate: true }, (s) => s.cath.pressure >= 10);
    run(st, { deflate: true }, (s) => s.cath.pressure === 0);
    expect(st.inflations.length).toBe(1);
    expect(st.inflations[0].overLesion).toBe(true);
    expect(st.inflations[0].maxPressure).toBeGreaterThanOrEqual(10);
    run(st, { inflate: true }, (s) => s.cath.ruptured, 20);
    expect(st.cath.ruptured).toBe(true);
    expect(st.ruptures).toBe(1);
  });
  it('the wire cannot be retracted while a balloon is on it', () => {
    const st = readyBalloon();
    run(st, { advance: 1 }, (s) => s.cath.s > 5);
    selectTool(st, 'wire');
    const w = st.wire.s;
    run(st, { advance: -1 }, () => false, 0.5);
    expect(st.wire.s).toBe(w);
  });
});

describe('stage progression and tool unlocking', () => {
  it('latches sub-tasks and finds the current stage', () => {
    const prev = [[true, false], [false]];
    const now = [[false, true], [false]];
    expect(latch(prev, now)).toEqual([[true, true], [false]]);
  });
  it('locks tools with a reason until prerequisites are met', () => {
    const base = { engaged: false, angiogramDone: false, heparin: false, wireDistal: false, predilated: false, cathKind: null, cathOut: false };
    expect(toolStatus('wire', base).enabled).toBe(false);
    expect(toolStatus('wire', { ...base, engaged: true, angiogramDone: true }).reason).toMatch(/heparin/i);
    expect(toolStatus('wire', { ...base, engaged: true, angiogramDone: true, heparin: true }).enabled).toBe(true);
    expect(toolStatus('balloon', base).enabled).toBe(false);
    expect(toolStatus('stent', { ...base, predilated: true }).enabled).toBe(true);
    expect(toolStatus('stent', { ...base, predilated: true, cathKind: 'balloon', cathOut: true }).enabled).toBe(false);
  });
  it('progresses through stages 1 and 2 as the guide is engaged and an angiogram taken', () => {
    const st = createState(1);
    expect(selectTool(st, 'wire')).toBe(false);
    engage(st);
    expect(currentStage(st.stages.done)).toBe(1);
    inject(st);
    stepSim(st, NO_INPUT, dt);
    expect(currentStage(st.stages.done)).toBe(2);
    expect(st.injections[0].kind).toBe('selective');
  });
});
