/**
 * Scripted autopilot. It drives the case through the SAME input path as the learner:
 * every frame it returns a SimInput (advance / rotate / fine / inflate / deflate / fluoro)
 * and it calls the same action functions the toolbar uses.
 */
import { DEVICES, FLUORO } from '../config/anatomy';
import { getAnatomy, lesionPathRange } from '../anatomy/vessels';
import { angleDiff } from '../math/vec';
import { SimState } from '../state/store';
import { NO_INPUT, SimInput } from '../tools/controller';
import { giveHeparin, inject, measureQCA, selectTool, setCathSize, setProjection } from './sim';

interface Ctx {
  t: number; // time spent in the current step
  mark: number;
}

interface Step {
  narrate: string;
  run: (st: SimState, c: Ctx) => SimInput | 'next';
}

const inp = (o: Partial<SimInput>): SimInput => ({ ...NO_INPUT, ...o });

/** Rotate toward a target angle, returns 0 when close enough. */
const steer = (cur: number, target: number, tol = 3): number => {
  const d = angleDiff(target, cur);
  return Math.abs(d) <= tol ? 0 : Math.sign(d);
};

function waitCine(st: SimState): boolean {
  return st.time >= st.fluoro.cineUntil;
}

export function demoSteps(): Step[] {
  const a = getAnatomy();
  const G = DEVICES.guide;
  const lesion = lesionPathRange();
  const parkAt = lesion.s1 + 32;
  const center = lesion.center;
  return [
    {
      narrate: 'Advancing the 6F guide from the right radial artery up the arm, with short fluoro taps to check position.',
      run: (st, c) => {
        if (c.t === 0) selectTool(st, 'guide');
        if (st.guide.s >= a.route.length - 0.5) return 'next';
        const tap = c.t % 3 < 0.4;
        return inp({ advance: 1, fluoro: tap });
      },
    },
    {
      narrate: 'At the aortic root. Rotating the pre-shaped tip to face the left coronary cusp.',
      run: (st) => {
        const r = steer(st.guide.rot, G.leftCusp, 4);
        if (r === 0) return 'next';
        return inp({ rotate: r, fine: Math.abs(angleDiff(G.leftCusp, st.guide.rot)) < 15, fluoro: true });
      },
    },
    {
      narrate: 'Advancing gently to seat the guide in the left main ostium.',
      run: (st) => (st.guide.engaged ? 'next' : inp({ advance: 1, fine: true, fluoro: true })),
    },
    {
      narrate: 'Diagnostic angiogram (RAO 30 / CRA 30): the 90% mid-LAD stenosis fills slowly beyond the lesion (TIMI 2).',
      run: (st, c) => {
        if (c.t === 0) {
          setProjection(st, FLUORO.presets[0].lao, FLUORO.presets[0].cran);
          inject(st);
        }
        return c.t > 0.1 && waitCine(st) ? 'next' : NO_INPUT;
      },
    },
    {
      narrate: 'Giving heparin before any wire enters the coronary artery.',
      run: (st, c) => {
        if (c.t === 0) giveHeparin(st);
        return c.t > 1 ? 'next' : NO_INPUT;
      },
    },
    {
      narrate: 'Wire out. Rotating the tip away from the LCx so it drops into the LAD.',
      run: (st, c) => {
        if (c.t === 0) selectTool(st, 'wire');
        const r = steer(st.wire.rot, -15, 4);
        if (r !== 0) return inp({ rotate: r });
        if (st.wire.branches[1] === 'LAD') return 'next';
        return inp({ advance: 1, fluoro: true });
      },
    },
    {
      narrate: 'Keeping the tip pointed away from the first diagonal and advancing to the lesion.',
      run: (st) => {
        if (st.wire.s >= lesion.s0 - 3) return 'next';
        return inp({ advance: 1, rotate: steer(st.wire.rot, -15, 4), fluoro: true });
      },
    },
    {
      narrate: 'Crossing the lesion slowly (fine control) so the wire does not buckle.',
      run: (st) => {
        if (st.wire.crossed) return 'next';
        return inp({ advance: 1, fine: true, fluoro: true });
      },
    },
    {
      narrate: 'Parking the wire tip in the distal LAD, away from the second diagonal.',
      run: (st) => {
        if (st.wire.s >= parkAt) return 'next';
        const fine = st.wire.s > parkAt - 6;
        return inp({ advance: 1, fine, rotate: steer(st.wire.rot, -15, 4), fluoro: true });
      },
    },
    {
      narrate: 'Loading a 2.5 × 15 mm balloon (undersized for pre-dilation) and advancing it over the wire.',
      run: (st, c) => {
        if (c.t === 0) {
          selectTool(st, 'balloon');
          setCathSize(st, 2.5, 15);
        }
        const target = center + 7.5;
        const d = target - st.cath.s;
        if (Math.abs(d) < 0.25) return 'next';
        return inp({ advance: Math.sign(d), fine: Math.abs(d) < 4, fluoro: true });
      },
    },
    {
      narrate: 'Markers straddle the lesion. Inflating to 10 atm and holding ~12 s while watching the ECG.',
      run: (st, c) => {
        if (st.cath.pressure < 10 && c.mark === 0) return inp({ inflate: true, fine: st.cath.pressure > 9.2 });
        if (c.mark === 0) c.mark = st.time;
        if (st.time - c.mark < 9) return NO_INPUT;
        return 'next';
      },
    },
    {
      narrate: 'Deflating and withdrawing the balloon into the guide.',
      run: (st) => {
        if (st.cath.pressure > 0) return inp({ deflate: true });
        if (st.cath.s > 0) return inp({ advance: -1 });
        return 'next';
      },
    },
    {
      narrate: 'Quantitative coronary angiography: measuring the reference diameter and lesion length.',
      run: (st, c) => {
        if (c.t === 0) {
          selectTool(st, 'measure');
          measureQCA(st);
        }
        return c.t > 1.5 ? 'next' : NO_INPUT;
      },
    },
    {
      narrate: 'Loading a 3.0 × 18 mm drug-eluting stent (≈1:1 to the 3.0 mm reference, ~2 mm margin each side).',
      run: (st, c) => {
        if (c.t === 0) {
          selectTool(st, 'stent');
          setCathSize(st, 3.0, 18);
        }
        const target = center + 9;
        const d = target - st.cath.s;
        if (Math.abs(d) < 0.25) return 'next';
        return inp({ advance: Math.sign(d), fine: Math.abs(d) < 4, fluoro: true });
      },
    },
    {
      narrate: 'Deploying the stent at 12 atm and holding for a few seconds.',
      run: (st, c) => {
        if (st.cath.pressure < 12 && c.mark === 0) return inp({ inflate: true, fine: st.cath.pressure > 11.2 });
        if (c.mark === 0) c.mark = st.time;
        if (st.time - c.mark < 5) return NO_INPUT;
        return 'next';
      },
    },
    {
      narrate: 'Deflating and withdrawing the delivery balloon.',
      run: (st) => {
        if (st.cath.pressure > 0) return inp({ deflate: true });
        if (st.cath.s > 0) return inp({ advance: -1 });
        return 'next';
      },
    },
    {
      narrate: 'Final angiogram in RAO 30 / CRA 30: no residual narrowing, brisk TIMI 3 flow.',
      run: (st, c) => {
        if (c.t === 0) {
          setProjection(st, FLUORO.presets[0].lao, FLUORO.presets[0].cran);
          inject(st);
        }
        return c.t > 0.1 && waitCine(st) ? 'next' : NO_INPUT;
      },
    },
    {
      narrate: 'Second projection (LAO 45 / CRA 30) to confirm the result from another angle.',
      run: (st, c) => {
        if (c.t === 0) {
          setProjection(st, FLUORO.presets[2].lao, FLUORO.presets[2].cran);
          inject(st);
        }
        return c.t > 0.1 && waitCine(st) ? 'next' : NO_INPUT;
      },
    },
    {
      narrate: 'Case complete. Opening the debrief.',
      run: () => NO_INPUT,
    },
  ];
}

export class DemoController {
  private steps = demoSteps();
  index = 0;
  private ctx: Ctx = { t: 0, mark: 0 };
  active = true;

  get narration(): string {
    return this.steps[Math.min(this.index, this.steps.length - 1)].narrate;
  }

  get progress(): number {
    return this.index / (this.steps.length - 1);
  }

  /** Produce the input for this frame (call before stepSim). */
  update(st: SimState, dt: number): SimInput {
    if (!this.active) return NO_INPUT;
    for (let guard = 0; guard < 4; guard++) {
      const step = this.steps[this.index];
      const r = step.run(st, this.ctx);
      if (r === 'next') {
        if (this.index < this.steps.length - 1) this.index++;
        this.ctx = { t: 0, mark: 0 };
        continue;
      }
      this.ctx.t += dt;
      return r;
    }
    return NO_INPUT;
  }
}
