import { SCORING } from '../config/anatomy';
import { getAnatomy, lesionPathRange } from '../anatomy/vessels';
import { coverageMargins } from '../physics/devices';
import { computeFlow, distalFlow, timiGrade } from '../physics/flow';
import { SimState } from '../state/store';
import { flowInput, lumenFn } from './sim';
import { STAGES, currentStage } from './stages';

export interface CaseSummary {
  stagesCompleted: number;
  residualStenosis: number; // %
  finalTIMI: 0 | 1 | 2 | 3;
  stentCount: number;
  stentToReference: number | null;
  coverageMargin: number | null; // min margin mm, negative = geographic miss
  heparinBeforeWire: boolean;
  predilated: boolean;
  qcaUsed: boolean;
  dissection: 'none' | 'sealed' | 'unsealed';
  wireForcing: number;
  ruptures: number;
  longestInflation: number; // s
  contrastMl: number;
  fluoroMinutes: number;
  finalViews: number;
}

export type Status = 'ok' | 'warn' | 'bad';
export interface DebriefItem {
  label: string;
  value: string;
  status: Status;
  teaching: string;
}
export type Grade = 'Excellent' | 'Good' | 'Acceptable' | 'Needs work' | 'Incomplete';
export interface Debrief {
  score: number;
  grade: Grade;
  headline: string;
  items: DebriefItem[];
}

/** Extract the scoring facts from a finished (or abandoned) case. */
export function buildSummary(st: SimState): CaseSummary {
  const a = getAnatomy();
  const lad = a.vessels.get('LAD')!;
  const lum = lumenFn(st, false);
  let worst = 0;
  for (let s = a.lesion.s0 - 2; s <= a.lesion.s1 + 2; s += 0.25) worst = Math.max(worst, 1 - lum('LAD', s) / lad.ref(s));
  const flow = computeFlow({ ...flowInput(st), diameter: lum, occlusions: [] }, ['LM']);
  const lesion = lesionPathRange();
  const ladStents = st.stents.filter((s) => s.intervals.some((i) => i.vessel === 'LAD'));
  let ratio: number | null = null;
  let margin: number | null = null;
  if (ladStents.length) {
    const s0 = Math.min(...ladStents.map((s) => s.pathS0));
    const s1 = Math.max(...ladStents.map((s) => s.pathS1));
    margin = coverageMargins({ s0, s1 }, lesion).min;
    // Worst-sized stent against the reference diameter at its middle.
    ratio = ladStents
      .map((s) => {
        const it = s.intervals.find((i) => i.vessel === 'LAD')!;
        return (s.diameter * 0.97) / lad.ref((it.s0 + it.s1) / 2);
      })
      .reduce((w, r) => (Math.abs(r - 1.05) > Math.abs(w - 1.05) ? r : w));
  }
  const diss = st.dissections.length === 0 ? 'none' : st.dissections.every((d) => d.sealed) ? 'sealed' : 'unsealed';
  const post = st.injections.filter((i) => i.afterStent);
  return {
    stagesCompleted: currentStage(st.stages.done.length ? st.stages.done : STAGES.map((x) => x.tasks.map(() => false))),
    residualStenosis: Math.max(0, worst * 100),
    finalTIMI: timiGrade(distalFlow(flow, 'LAD')),
    stentCount: st.stents.length,
    stentToReference: ratio,
    coverageMargin: margin,
    heparinBeforeWire: st.heparinTime !== null && (st.flags.wireOutBeforeHeparin !== true),
    predilated: st.inflations.some((i) => i.kind === 'balloon' && i.overLesion && i.maxPressure >= 6),
    qcaUsed: st.qca !== null,
    dissection: diss,
    wireForcing: st.wire.forcing,
    ruptures: st.ruptures,
    longestInflation: st.inflations.reduce((m, i) => Math.max(m, i.duration), 0),
    contrastMl: st.contrastMl,
    fluoroMinutes: st.fluoroTime / 60,
    finalViews: new Set(post.map((i) => i.projection)).size,
  };
}

const PENALTY: Record<string, { warn: number; bad: number }> = {
  residual: { warn: 8, bad: 20 },
  timi: { warn: 12, bad: 25 },
  size: { warn: 6, bad: 15 },
  coverage: { warn: 6, bad: 20 },
  stents: { warn: 4, bad: 10 },
  heparin: { warn: 5, bad: 15 },
  predil: { warn: 5, bad: 10 },
  qca: { warn: 4, bad: 8 },
  dissection: { warn: 6, bad: 20 },
  forcing: { warn: 5, bad: 10 },
  rupture: { warn: 8, bad: 15 },
  inflation: { warn: 5, bad: 12 },
  contrast: { warn: 4, bad: 10 },
  fluoro: { warn: 4, bad: 10 },
  views: { warn: 5, bad: 10 },
};

/** Pure scoring: summary → score (0–100), grade, headline and teaching items. */
export function buildDebrief(s: CaseSummary): Debrief {
  const items: (DebriefItem & { key: string })[] = [];
  const add = (key: string, label: string, value: string, status: Status, teaching: string) => items.push({ key, label, value, status, teaching });
  const S = SCORING;

  add('residual', 'Residual stenosis', `${s.residualStenosis.toFixed(0)}%`,
    s.residualStenosis <= S.residualOk ? 'ok' : s.residualStenosis <= S.residualWarn ? 'warn' : 'bad',
    'Aim for ≤ 10% residual narrowing after stenting. A larger residual predicts restenosis and stent thrombosis.');
  add('timi', 'Final TIMI flow', `TIMI ${s.finalTIMI}`, s.finalTIMI === 3 ? 'ok' : s.finalTIMI === 2 ? 'warn' : 'bad',
    'TIMI 3 means contrast fills the distal vessel as briskly as a normal artery. Slow flow after PCI is linked to worse outcomes.');
  if (s.stentToReference === null) add('size', 'Stent size vs reference', 'no stent', 'bad', 'No stent was deployed in the LAD.');
  else
    add('size', 'Stent size vs reference', `${s.stentToReference.toFixed(2)} : 1`,
      s.stentToReference >= S.sizeOk[0] && s.stentToReference <= S.sizeOk[1] ? 'ok'
        : s.stentToReference >= S.sizeWarn[0] && s.stentToReference <= S.sizeWarn[1] ? 'warn' : 'bad',
      'Size the stent about 1:1 (0.95–1.15) to the reference diameter. Undersizing leaves malapposed struts; oversizing tears the wall.');
  if (s.coverageMargin === null) add('coverage', 'Lesion coverage', 'no stent', 'bad', 'The lesion was not covered by a stent.');
  else
    add('coverage', 'Lesion coverage', s.coverageMargin < 0 ? `geographic miss (${s.coverageMargin.toFixed(1)} mm)` : `margins ≥ ${s.coverageMargin.toFixed(1)} mm`,
      s.coverageMargin >= S.marginOk ? 'ok' : s.coverageMargin >= 0 ? 'warn' : 'bad',
      'Land the stent from healthy shoulder to healthy shoulder, with at least ~1.5 mm beyond each end of the lesion.');
  add('stents', 'Stents used', `${s.stentCount}`, s.stentCount <= 1 ? (s.stentCount === 1 ? 'ok' : 'bad') : s.stentCount === 2 ? 'warn' : 'bad',
    'One well-sized stent is ideal. Extra (bailout) stents add metal, cost and risk.');
  add('heparin', 'Heparin before wiring', s.heparinBeforeWire ? 'yes' : 'no', s.heparinBeforeWire ? 'ok' : 'bad',
    'Anticoagulate before any wire enters a coronary artery, or clot can form on the hardware.');
  add('predil', 'Pre-dilation', s.predilated ? 'done' : 'not done', s.predilated ? 'ok' : 'warn',
    'Pre-dilating a tight lesion helps the stent cross and expand fully.');
  add('qca', 'QCA measured', s.qcaUsed ? 'yes' : 'no', s.qcaUsed ? 'ok' : 'warn',
    'Measuring the reference diameter and lesion length takes the guesswork out of stent sizing.');
  add('dissection', 'Dissection', s.dissection, s.dissection === 'none' ? 'ok' : s.dissection === 'sealed' ? 'warn' : 'bad',
    'A dissection is a tear in the vessel wall. Unsealed, it can close the artery; a stent covering it usually seals it.');
  add('forcing', 'Wire forcing', s.wireForcing === 0 ? 'none' : `${s.wireForcing}×`, s.wireForcing === 0 ? 'ok' : s.wireForcing <= 2 ? 'warn' : 'bad',
    'Cross tight lesions slowly with gentle torque. A buckling wire is a warning, not a challenge.');
  add('rupture', 'Balloon rupture', s.ruptures === 0 ? 'none' : `${s.ruptures}×`, s.ruptures === 0 ? 'ok' : 'bad',
    'Stay below the rated burst pressure (RBP). Rupture can dissect or perforate the vessel.');
  add('inflation', 'Longest inflation', `${s.longestInflation.toFixed(0)} s`,
    s.longestInflation <= S.inflationOk ? 'ok' : s.longestInflation <= S.inflationWarn ? 'warn' : 'bad',
    'Each inflation stops flow to the territory. Keep inflations short and watch the ECG and blood pressure.');
  add('contrast', 'Contrast', `${s.contrastMl.toFixed(0)} ml`, s.contrastMl <= S.contrastOk ? 'ok' : s.contrastMl <= S.contrastWarn ? 'warn' : 'bad',
    'Contrast can injure the kidneys. Use only the injections you need.');
  add('fluoro', 'Fluoro time', `${s.fluoroMinutes.toFixed(1)} min`,
    s.fluoroMinutes <= S.fluoroOkMin ? 'ok' : s.fluoroMinutes <= S.fluoroWarnMin ? 'warn' : 'bad',
    'Radiation adds up for the patient and the team. Use short fluoro taps and last-image hold.');
  add('views', 'Final views', `${s.finalViews}`, s.finalViews >= 2 ? 'ok' : s.finalViews === 1 ? 'warn' : 'bad',
    'Check the final result in at least two different projections so nothing is hidden by overlap.');

  let score = 100;
  for (const it of items) if (it.status !== 'ok') score -= PENALTY[it.key][it.status];
  score = Math.max(0, Math.min(100, Math.round(score)));
  let grade: Grade;
  if (s.stentCount === 0 || s.stagesCompleted < 5) grade = 'Incomplete';
  else if (score >= 85) grade = 'Excellent';
  else if (score >= 70) grade = 'Good';
  else if (score >= 55) grade = 'Acceptable';
  else grade = 'Needs work';
  const headline =
    grade === 'Excellent' ? 'Clean result: well-sized stent, full coverage, TIMI 3 flow.'
      : grade === 'Good' ? 'Good result with a few things to tighten up.'
        : grade === 'Acceptable' ? 'The artery is open, but several steps carried avoidable risk.'
          : grade === 'Needs work' ? 'The result has problems that would put this patient at risk. Review the red items.'
            : 'The case was not completed. Finish all stages to get a full score.';
  return { score, grade, headline, items: items.map(({ key: _k, ...rest }) => rest) };
}

export function debriefFor(st: SimState): Debrief {
  return buildDebrief(buildSummary(st));
}
