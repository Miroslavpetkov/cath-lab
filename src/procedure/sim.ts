/** Simulation step + learner actions. No Three.js/DOM: the demo and tests drive it headlessly. */
import { CONTRAST, DEVICES, FLUORO } from '../config/anatomy';
import { qca, treatedDiameter, Treatment } from '../anatomy/lumen';
import { getAnatomy, lesionPathRange, splitInterval } from '../anatomy/vessels';
import { angleDiff } from '../math/vec';
import { coverageMargins, markersAcrossLesion } from '../physics/devices';
import { computeFlow, distalFlow, timiGrade, cineLength, FlowInput } from '../physics/flow';
import { giveHeparin as heparinPhys, stepPhysiology } from '../physics/physiology';
import { SimState, ToolId, pushMessage } from '../state/store';
import { SimInput, cathInterval, cathOut, currentCathDiameter, stepCatheter, stepGuide, stepWire } from '../tools/controller';
import { toolStatus, ToolContext } from '../tools/tools';
import { STAGES, Snapshot, currentStage, emptyDone, evaluateTasks, latch } from './stages';

/** Live (inflated) balloon intervals per vessel. */
function liveTreatments(st: SimState): Treatment[] {
  if (!cathOut(st) || st.cath.pressure <= 0.05) return [];
  const iv = cathInterval(st);
  const d = currentCathDiameter(st);
  return splitInterval(st.wire.branches, iv.s0, iv.s1).map((it) => ({ ...it, diameter: d, kind: 'live' as const }));
}

/** Lumen function with treatments pre-grouped per vessel (fast enough to call per ring per frame). */
export function lumenFn(st: SimState, includeLive = true): (vessel: string, s: number) => number {
  const a = getAnatomy();
  const all = includeLive ? [...st.treatments, ...liveTreatments(st)] : st.treatments;
  const byVessel = new Map<string, Treatment[]>();
  for (const t of all) {
    if (!byVessel.has(t.vessel)) byVessel.set(t.vessel, []);
    byVessel.get(t.vessel)!.push(t);
  }
  const sd = st.stents.map((x) => x.diameter);
  return (vessel, s) => {
    const v = a.vessels.get(vessel)!;
    const ts = byVessel.get(vessel);
    return ts ? treatedDiameter(v.native(s), s, ts, sd) : v.native(s);
  };
}

/** Current lumen diameter at a vessel position (lesion + all treatments, optionally the live balloon). */
export function lumenDiameter(st: SimState, vessel: string, s: number, includeLive = true): number {
  return lumenFn(st, includeLive)(vessel, s);
}

export function flowInput(st: SimState): FlowInput {
  const occ =
    cathOut(st) && st.cath.pressure > DEVICES.catheter.blockFlowAbove
      ? splitInterval(st.wire.branches, cathInterval(st).s0, cathInterval(st).s1)
      : [];
  return {
    diameter: lumenFn(st),
    occlusions: occ,
    dissections: st.dissections,
  };
}

export function lumenKey(st: SimState): string {
  const live = liveTreatments(st)
    .map((t) => `${t.vessel}:${t.s0.toFixed(1)}-${t.s1.toFixed(1)}@${t.diameter.toFixed(2)}`)
    .join(',');
  return `${st.treatments.length}|${st.stents.map((s) => s.diameter.toFixed(2)).join(',')}|${live}`;
}

export function toolContext(st: SimState): ToolContext {
  const done = st.stages.done;
  return {
    engaged: st.guide.engaged,
    angiogramDone: st.injections.some((i) => i.kind === 'selective'),
    heparin: st.phys.heparin,
    wireDistal: !!done[2] && done[2].every(Boolean),
    predilated: !!done[3] && done[3].every(Boolean),
    cathKind: st.cath.kind,
    cathOut: cathOut(st),
  };
}

export function selectTool(st: SimState, tool: ToolId): boolean {
  if (tool === 'contrast') {
    inject(st);
    return true;
  }
  if (tool === 'fluoro') return true;
  const status = toolStatus(tool, toolContext(st));
  if (!status.enabled) {
    pushMessage(st, `${tool[0].toUpperCase() + tool.slice(1)} locked: ${status.reason}`, 'info');
    return false;
  }
  if ((tool === 'balloon' || tool === 'stent') && st.cath.kind !== tool) {
    st.cath.kind = tool;
    st.cath.s = DEVICES.catheter.minS;
    st.cath.pressure = 0;
    st.cath.ruptured = false;
    st.cath.inflStart = null;
    st.cath.stentOnBoard = tool === 'stent';
    st.cath.deployedIndex = null;
    if (tool === 'balloon') {
      st.cath.diameter = 2.0;
      st.cath.length = 12;
    } else {
      st.cath.diameter = 2.5;
      st.cath.length = 12;
    }
    pushMessage(st, tool === 'balloon' ? 'Balloon catheter loaded in the guide. Choose a size, then advance over the wire.' : 'Stent loaded in the guide. Measure, choose a size, then advance.', 'info');
  }
  st.tool = tool;
  return true;
}

export function setCathSize(st: SimState, diameter: number, length: number): boolean {
  if (!st.cath.kind) return false;
  if (st.cath.s > 0) {
    pushMessage(st, 'Sizes can only be changed while the catheter is inside the guide.', 'warn');
    return false;
  }
  st.cath.diameter = diameter;
  st.cath.length = length;
  return true;
}

export function giveHeparin(st: SimState): void {
  if (st.phys.heparin) {
    pushMessage(st, 'Heparin already given. ACT is rising.', 'info');
    return;
  }
  st.phys = heparinPhys(st.phys);
  st.heparinTime = st.time;
  pushMessage(st, 'Heparin 70 U/kg given. ACT will rise above 250 s.', 'ok');
}

export function projectionName(p: { lao: number; cran: number }): string {
  const lr = p.lao === 0 ? 'AP' : `${p.lao > 0 ? 'LAO' : 'RAO'}${Math.abs(Math.round(p.lao))}`;
  const cc = p.cran === 0 ? '' : ` ${p.cran > 0 ? 'CRA' : 'CAU'}${Math.abs(Math.round(p.cran))}`;
  return lr + cc;
}

export function setProjection(st: SimState, lao: number, cran: number): void {
  st.fluoro.projection = { lao: Math.max(-90, Math.min(90, lao)), cran: Math.max(-45, Math.min(45, cran)), name: '' };
  st.fluoro.projection.name = projectionName(st.fluoro.projection);
}

export function cyclePreset(st: SimState): void {
  const ps = FLUORO.presets;
  const i = ps.findIndex((p) => p.lao === st.fluoro.projection.lao && p.cran === st.fluoro.projection.cran);
  const n = ps[(i + 1) % ps.length];
  setProjection(st, n.lao, n.cran);
}

export function inject(st: SimState): boolean {
  const a = getAnatomy();
  if (st.guide.s < a.routeAortaS) {
    pushMessage(st, 'Get the guide into the aorta before injecting contrast.', 'warn');
    return false;
  }
  if (st.fluoro.cineUntil > st.time) {
    pushMessage(st, 'Cine run in progress.', 'info');
    return false;
  }
  const selective = st.guide.engaged;
  const kind = selective ? 'selective' : 'aortic';
  const ml = selective ? CONTRAST.selectiveMl : CONTRAST.aorticMl;
  const flow = computeFlow(flowInput(st), selective ? ['LM'] : ['LM', 'RCA']);
  const duration = cineLength(flow);
  const afterStent = st.stents.length > 0 && !(st.cath.kind === 'stent' && st.cath.pressure > 0);
  st.injections.push({ time: st.time, kind, projection: projectionName(st.fluoro.projection), afterStent, duration, flow, ml });
  st.contrastMl += ml;
  st.fluoro.cineUntil = st.time + duration;
  pushMessage(st, selective ? `Selective injection, ${ml} ml (${projectionName(st.fluoro.projection)}).` : `Aortic root flush, ${ml} ml. Engage the left main for a selective picture.`, 'info');
  return true;
}

export function measureQCA(st: SimState): void {
  const a = getAnatomy();
  const v = a.vessels.get('LAD')!;
  const samples: { s: number; d: number; ref: number }[] = [];
  const lum = lumenFn(st, false);
  for (let s = a.lesion.center - 16; s <= a.lesion.center + 16; s += 0.25) samples.push({ s, d: lum('LAD', s), ref: v.ref(s) });
  st.qca = qca(samples);
  st.qcaTime = st.time;
  const q = st.qca;
  pushMessage(
    st,
    `QCA mid-LAD: reference ${q.referenceDiameter.toFixed(2)} mm, MLD ${q.mld.toFixed(2)} mm, ${q.percentDS.toFixed(0)}% DS, lesion ${q.lesionLength.toFixed(1)} mm.`,
    'ok',
  );
}

export function imagingActive(st: SimState): boolean {
  return st.fluoro.pedal || st.time < st.fluoro.cineUntil;
}

export function imagingMode(st: SimState): 'CINE' | 'FLUORO' | 'LIH' | 'OFF' {
  if (st.time < st.fluoro.cineUntil) return 'CINE';
  if (st.fluoro.pedal) return 'FLUORO';
  return st.fluoro.everImaged ? 'LIH' : 'OFF';
}

export function buildSnapshot(st: SimState): Snapshot {
  const a = getAnatomy();
  const G = DEVICES.guide;
  const lesion = lesionPathRange();
  const onLAD = st.wire.branches[1] === 'LAD';
  const atRoot = st.guide.engaged || st.guide.s >= a.route.length - 0.5;
  const predilated = st.inflations.some((i) => i.kind === 'balloon' && i.overLesion && i.maxPressure >= 6);
  const iv = cathInterval(st);
  const postStent = st.injections.filter((i) => i.afterStent);
  return {
    pastElbow: st.guide.s >= a.routeElbowS,
    inAorta: st.guide.s >= a.routeAortaS,
    fluoroInChest: !!st.flags.fluoroInChest,
    atRoot,
    facingLeft: atRoot && Math.abs(angleDiff(st.guide.rot, G.leftCusp)) <= G.engageTolerance,
    engaged: st.guide.engaged,
    selectiveAngio: st.injections.some((i) => i.kind === 'selective'),
    heparin: st.phys.heparin,
    wireOut: st.wire.s > 2,
    wireInLAD: onLAD,
    wireCrossed: onLAD && st.wire.crossed,
    wireDistal: onLAD && st.wire.branches.length === 2 && st.wire.crossed && st.wire.s >= lesion.s1 + 25,
    balloonMarkersAcross: st.cath.kind === 'balloon' && cathOut(st) && onLAD && markersAcrossLesion(iv, lesion),
    predilated,
    predilDeflated: predilated && !(st.cath.kind === 'balloon' && st.cath.pressure > 0),
    qcaDone: st.qca !== null,
    stentLoaded: st.cath.kind === 'stent',
    stentCovers: st.cath.kind === 'stent' && st.cath.stentOnBoard && cathOut(st) && onLAD && coverageMargins(iv, lesion).covers,
    stentDeployed: st.stents.length > 0,
    stentDeflated: st.stents.length > 0 && !(st.cath.kind === 'stent' && st.cath.pressure > 0),
    postStentInjection: postStent.length > 0,
    postStentViews: new Set(postStent.map((i) => i.projection)).size,
  };
}

/** Advance the whole simulation by dt seconds with the given (learner or demo) input. */
export function stepSim(st: SimState, inp: SimInput, dt: number): void {
  if (st.ended) return;
  st.time += dt;
  if (!st.stages.done.length) {
    st.stages.done = emptyDone();
    st.stages.completedAt = STAGES.map(() => null);
  }
  // Devices: only the active tool responds to advance/rotate/inflate.
  if (st.tool === 'guide') stepGuide(st, inp, dt);
  else if (st.tool === 'wire') stepWire(st, inp, dt);
  else if (st.tool === 'balloon' || st.tool === 'stent') stepCatheter(st, inp, dt);
  else if (st.tool === 'measure' && inp.advance !== 0) pushMessage(st, 'Select a device (1–4) to move it.', 'info');
  if (st.tool !== 'wire') {
    st.wire.buckling = false;
    st.wire.resistance = Math.max(0, st.wire.resistance - dt * 1.5);
  }
  // A balloon left inflated keeps its pressure even if the learner switches tools.
  if (st.tool !== 'balloon' && st.tool !== 'stent' && st.cath.kind) stepCatheter(st, { ...inp, advance: 0, inflate: false, deflate: false }, dt);

  // Imaging.
  st.fluoro.pedal = inp.fluoro;
  if (imagingActive(st)) {
    st.fluoroTime += dt;
    st.fluoro.everImaged = true;
    st.fluoro.lastActive = st.time;
    if (st.guide.s >= getAnatomy().routeAortaS - 60) st.flags.fluoroInChest = true;
  }

  // Flow & patient.
  st.flow = computeFlow(flowInput(st), ['LM', 'RCA']);
  st.ladFlow = distalFlow(st.flow, 'LAD');
  st.timi = timiGrade(st.ladFlow);
  st.lumenKey = lumenKey(st);
  const prevPhys = st.phys;
  st.phys = stepPhysiology(st.phys, st.ladFlow, dt);
  if (st.phys.chestPain && !prevPhys.chestPain) pushMessage(st, 'Patient: "That chest tightness is back, doctor." Anterior ST elevation on V2.', 'warn');
  if (st.phys.occlusionTime > 40 && prevPhys.occlusionTime <= 40) pushMessage(st, 'BP falling and ectopic beats: the LAD has been occluded for 40 s.', 'warn');
  if (st.phys.unstable) pushMessage(st, 'Patient unstable! Deflate now!', 'danger');

  // ECG beat clock.
  st.ecg.t += dt;
  st.ecg.phase = st.ecg.t / st.ecg.rr;
  if (st.ecg.t >= st.ecg.rr) {
    st.ecg.t -= st.ecg.rr;
    st.ecg.rr = 60 / st.phys.hr;
    st.ecg.pvc = st.rng() < st.phys.pvcRate;
    st.ecg.beats += 1;
    st.ecg.phase = 0;
  }

  // Stage progression.
  const before = currentStage(st.stages.done);
  st.stages.done = latch(st.stages.done, evaluateTasks(buildSnapshot(st)));
  const after = currentStage(st.stages.done);
  for (let i = before; i < after; i++) {
    st.stages.completedAt[i] = st.time;
    pushMessage(st, `Stage ${i + 1} complete: ${STAGES[i].title}.`, 'ok');
  }
  if (after >= STAGES.length && !st.flags.allDone) st.flags.allDone = true;
  if (st.flags.allDone && st.time > st.fluoro.cineUntil + 1) st.ended = true;

  if (!st.log.length || st.time - st.log[st.log.length - 1].time >= 1) {
    st.log.push({ time: st.time, stage: after, ladFlow: st.ladFlow, hr: st.phys.hr, st: st.phys.st });
  }
}

export function endCase(st: SimState): void {
  st.ended = true;
}
