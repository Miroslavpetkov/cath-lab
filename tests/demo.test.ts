import { describe, expect, it } from 'vitest';
import { createState } from '../src/state/store';
import { stepSim } from '../src/procedure/sim';
import { DemoController } from '../src/procedure/demo';
import { debriefFor, buildSummary } from '../src/procedure/debrief';
import { currentStage } from '../src/procedure/stages';

function runDemo(seed: number) {
  const st = createState(seed);
  const demo = new DemoController();
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 600 && !st.ended; i++) {
    const input = demo.update(st, dt);
    stepSim(st, input, dt);
  }
  return st;
}

describe('demo mode', () => {
  it('completes all six stages and ends with an Excellent debrief', () => {
    const st = runDemo(7);
    const sum = buildSummary(st);
    const d = debriefFor(st);
    if (d.grade !== 'Excellent') console.log(JSON.stringify(sum, null, 1), d.items.filter((i) => i.status !== 'ok'), st.messages.slice(-15).map((m) => m.text));
    expect(st.ended).toBe(true);
    expect(currentStage(st.stages.done)).toBe(6);
    expect(d.grade).toBe('Excellent');
    expect(sum.finalTIMI).toBe(3);
    expect(sum.dissection).toBe('none');
  });
});
