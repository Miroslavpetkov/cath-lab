/** Device controller: moves guide, wire and balloon/stent catheters along their 1D rails. */
import { DEVICES } from '../config/anatomy';
import {
  getAnatomy,
  lesionPathRange,
  pathLength,
  pathSegments,
  pathToVessel,
  splitInterval,
} from '../anatomy/vessels';
import { angleDiff, wrapDeg } from '../math/vec';
import { inflatedDiameter, rupturePressure, deviceSpec } from '../physics/devices';
import { SimState, pushMessage } from '../state/store';

export interface SimInput {
  advance: number; // -1..1
  fine: boolean;
  rotate: number; // -1..1
  inflate: boolean;
  deflate: boolean;
  fluoro: boolean;
}

export const NO_INPUT: SimInput = { advance: 0, fine: false, rotate: 0, inflate: false, deflate: false, fluoro: false };

export const cathOut = (st: SimState) => st.cath.kind !== null && st.cath.s > 0;

export function stepGuide(st: SimState, inp: SimInput, dt: number): void {
  const G = DEVICES.guide;
  const a = getAnatomy();
  const g = st.guide;
  g.speed = 0;
  if (inp.advance === 0 && inp.rotate === 0) return;
  if (st.wire.s > 0) {
    pushMessage(st, 'Pull the wire back into the guide before moving the guide.', 'warn');
    return;
  }
  if (inp.rotate !== 0) {
    g.rot = wrapDeg(g.rot + inp.rotate * (inp.fine ? G.fineRotSpeed : G.rotSpeed) * dt);
    if (g.engaged && Math.abs(angleDiff(g.rot, G.leftCusp)) > G.popOutDeg) {
      g.engaged = false;
      pushMessage(st, 'Too much torque: the guide popped out of the left main. Rotate back toward the left cusp and re-seat.', 'warn');
    }
  }
  if (inp.advance === 0) return;
  const speed = inp.fine ? G.fineSpeed : G.speed;
  const ds = inp.advance * speed * dt;
  g.speed = Math.abs(ds) / dt;
  const rootS = a.route.length;
  if (g.engaged) {
    if (ds < 0) {
      g.engaged = false;
      pushMessage(st, 'Guide disengaged from the left main.', 'info');
    }
    return;
  }
  const prev = g.s;
  g.s = Math.max(0, Math.min(rootS, g.s + ds));
  if (prev < a.routeElbowS && g.s >= a.routeElbowS) pushMessage(st, 'Past the elbow. Keep advancing up the arm.', 'info');
  if (prev < a.routeAortaS && g.s >= a.routeAortaS) pushMessage(st, 'Into the aorta. Tap fluoro (Space) to see where you are.', 'info');
  if (prev < rootS - 0.5 && g.s >= rootS - 0.5) pushMessage(st, 'At the aortic root. Rotate the tip (A/D) to face the left coronary cusp.', 'ok');
  if (g.s >= rootS - 0.5 && ds > 0) {
    const dl = Math.abs(angleDiff(g.rot, G.leftCusp));
    const dr = Math.abs(angleDiff(g.rot, G.rightCusp));
    if (dl <= G.engageTolerance) {
      if (g.speed <= G.gentleSpeed) {
        g.engaged = true;
        pushMessage(st, 'Guide seated in the left main ostium. Take a diagnostic angiogram (C).', 'ok');
      } else pushMessage(st, 'Facing the left cusp. Advance gently (hold Shift) to seat the guide.', 'info');
    } else if (dr <= G.engageTolerance * 1.6) {
      pushMessage(st, 'The tip is in the RIGHT cusp, the RCA ostium. This case is in the left system: rotate toward the left cusp.', 'warn');
    } else {
      pushMessage(st, 'The tip is not facing the left coronary cusp. Rotate (A/D) until the dial reads LEFT.', 'info');
    }
  }
}

export function stepWire(st: SimState, inp: SimInput, dt: number): void {
  const W = DEVICES.wire;
  const a = getAnatomy();
  const w = st.wire;
  w.speed = 0;
  w.rotating = inp.rotate !== 0;
  if (inp.rotate !== 0) w.rot = wrapDeg(w.rot + inp.rotate * (inp.fine ? W.fineRotSpeed : W.rotSpeed) * dt);
  w.resistance = Math.max(0, w.resistance - dt * 1.5);
  if (inp.advance === 0) {
    w.buckling = false;
    return;
  }
  if (!st.guide.engaged) {
    pushMessage(st, 'The guide must be engaged before the wire can come out.', 'warn');
    return;
  }
  if (inp.advance < 0 && cathOut(st)) {
    pushMessage(st, 'The wire cannot be retracted while a balloon is on it. Withdraw the balloon first.', 'warn');
    return;
  }
  let ds = inp.advance * (inp.fine ? W.fineSpeed : W.speed) * dt;
  const speed = Math.abs(ds) / dt;
  const lesion = lesionPathRange();
  const onLAD = w.branches[1] === 'LAD';
  const inLesion = onLAD && w.s >= lesion.s0 - 0.5 && w.s < lesion.s1 && !w.crossed;
  if (inLesion && ds > 0) {
    const safe = W.safeSpeed * (w.rotating ? W.torqueSafeBonus : 1);
    if (speed > safe) {
      if (!w.buckling) w.forcing += 1;
      w.buckling = true;
      w.resistance = Math.min(1, w.resistance + dt * 4);
      w.risk = Math.min(0.95, w.risk + W.buckleRiskPerMm * (speed - safe) * dt * 4);
      ds *= 0.12;
      pushMessage(st, 'Resistance! The wire is buckling. Slow down (Shift) or add gentle torque. Forcing it can dissect the vessel.', 'danger');
    } else {
      w.buckling = false;
      w.resistance = Math.max(w.resistance, Math.min(0.6, speed / safe * 0.6));
    }
  } else w.buckling = false;

  const prev = w.s;
  let next = Math.max(0, w.s + ds);
  // Branch decisions on the way forward.
  if (ds > 0) {
    const segs = pathSegments(w.branches);
    const last = segs[segs.length - 1];
    const v = a.vessels.get(last.vessel)!;
    const options = v.children.map((c) => a.vessels.get(c)!);
    const atEnd = options.filter((c) => Math.abs(c.parentS - v.path.length) < 0.01);
    const side = options.filter((c) => Math.abs(c.parentS - v.path.length) >= 0.01);
    for (const c of side) {
      const bp = last.offset + c.parentS;
      if (prev < bp && next >= bp && Math.abs(angleDiff(w.rot, c.wireAngle)) <= c.wireCapture) {
        w.branches.push(c.id);
        pushMessage(st, `The wire tip went into ${c.name}. Pull back and rotate the tip away to stay in the main vessel.`, 'warn');
        break;
      }
    }
    if (w.branches.length === segs.length && atEnd.length) {
      const endS = last.offset + v.path.length;
      if (prev < endS && next >= endS) {
        let pick = atEnd[0];
        for (const c of atEnd) if (Math.abs(angleDiff(w.rot, c.wireAngle)) <= c.wireCapture) pick = c;
        w.branches.push(pick.id);
        if (pick.id === 'LCx') pushMessage(st, 'The wire went into the LCx. Pull back into the left main and rotate the tip toward the LAD.', 'warn');
        else pushMessage(st, `Wire in the ${pick.name}.`, 'ok');
      }
    }
  }
  // Pulling back past a branch point drops that branch.
  let segs = pathSegments(w.branches);
  while (w.branches.length > 1 && next < segs[segs.length - 1].offset) {
    w.branches.pop();
    segs = pathSegments(w.branches);
  }
  const max = pathLength(w.branches) - 2;
  const lastSeg = segs[segs.length - 1];
  const lastV = a.vessels.get(lastSeg.vessel)!;
  const terminal = lastV.children.filter((c) => Math.abs(a.vessels.get(c)!.parentS - lastV.path.length) < 0.01).length === 0;
  if (terminal && next > max - W.endWarnMm) {
    pushMessage(st, 'Wire tip near the end of the vessel: risk of perforation. Do not push further.', 'danger');
    next = Math.min(next, max);
  }
  w.speed = Math.abs(next - prev) / dt;
  w.s = next;
  if (onLAD && w.branches[1] === 'LAD' && !w.crossed && prev < lesion.s1 && next >= lesion.s1) {
    w.crossed = true;
    if (st.rng() < w.risk) {
      st.dissections.push({ vessel: 'LAD', s: a.lesion.center, sealed: false, cause: 'wire', time: st.time });
      pushMessage(st, 'Dissection! Forcing the wire tore the vessel wall. Contrast staining beside the lumen; flow is reduced until a stent covers it.', 'danger');
    } else pushMessage(st, 'Lesion crossed. Park the wire tip well beyond it in the distal LAD.', 'ok');
    w.risk = 0;
  }
  if (w.s <= 0) w.branches = ['LM'];
}

/** Interval [s0, s1] of the balloon working length in wire-path space. */
export function cathInterval(st: SimState): { s0: number; s1: number } {
  return { s0: st.cath.s - st.cath.length, s1: st.cath.s };
}

export function currentCathDiameter(st: SimState): number {
  const c = st.cath;
  if (!c.kind) return 0;
  return inflatedDiameter(c.kind, c.diameter, c.pressure);
}

export function refAtPath(st: SimState, s: number): number {
  const a = getAnatomy();
  const { vessel, s: ls } = pathToVessel(st.wire.branches, s);
  return a.vessels.get(vessel)!.ref(ls);
}

export function stepCatheter(st: SimState, inp: SimInput, dt: number): void {
  const C = DEVICES.catheter;
  const c = st.cath;
  if (!c.kind) return;
  // Movement
  if (inp.advance !== 0) {
    if (c.pressure > 0.3) pushMessage(st, 'Deflate (Q) before moving the catheter.', 'warn');
    else {
      const ds = inp.advance * (inp.fine ? C.fineSpeed : C.speed) * dt;
      const max = st.wire.s - C.behindWireTip;
      const prev = c.s;
      let next = Math.max(C.minS, c.s + ds);
      if (next > max && ds > 0) {
        next = Math.max(prev, max);
        pushMessage(st, 'The catheter must stay behind the wire tip. Advance the wire first if you need to go further.', 'warn');
      }
      c.s = next;
      if (prev > 0 && c.s <= 0) {
        if (c.kind === 'stent' && !c.stentOnBoard) {
          c.stentOnBoard = true;
          c.ruptured = false;
          pushMessage(st, 'Stent delivery balloon withdrawn into the guide. A fresh stent is loaded if you need another (bailout).', 'info');
        } else if (c.ruptured) {
          c.ruptured = false;
          pushMessage(st, 'Ruptured balloon withdrawn. A fresh one is loaded.', 'info');
        } else pushMessage(st, `${c.kind === 'balloon' ? 'Balloon' : 'Stent'} back in the guide.`, 'info');
      }
    }
  }
  // Inflation
  const spec = deviceSpec(c.kind);
  if (inp.inflate && !inp.deflate) {
    if (c.s <= 0) pushMessage(st, 'Advance the catheter out of the guide before inflating.', 'warn');
    else if (c.ruptured) pushMessage(st, 'This balloon has ruptured. Withdraw it into the guide.', 'warn');
    else c.pressure += (inp.fine ? C.fineInflateRate : C.inflateRate) * dt;
  }
  if (inp.deflate) c.pressure = Math.max(0, c.pressure - C.deflateRate * dt);

  if (c.pressure > 0.3 && c.inflStart === null) {
    c.inflStart = st.time;
    c.maxP = 0;
    c.maxD = 0;
    c.dissectedThisInflation = false;
  }
  if (c.inflStart !== null) {
    c.maxP = Math.max(c.maxP, c.pressure);
    const d = currentCathDiameter(st);
    c.maxD = Math.max(c.maxD, d);
    const iv = cathInterval(st);
    if (c.pressure > spec.rbp && c.pressure <= rupturePressure(c.kind)) {
      pushMessage(st, `Above rated burst pressure (${spec.rbp} atm). Rupture risk!`, 'warn');
    }
    if (c.pressure > rupturePressure(c.kind)) {
      c.ruptured = true;
      st.ruptures += 1;
      pushMessage(st, 'BALLOON RUPTURE! Pressure lost. Withdraw it.', 'danger');
      if (st.rng() < 0.5) addDissection(st, (iv.s0 + iv.s1) / 2, 'rupture');
      c.pressure = 0;
    }
    // Stent deployment at ≥ deployAt.
    if (c.kind === 'stent' && c.stentOnBoard && c.pressure >= DEVICES.stent.deployAt) {
      c.stentOnBoard = false;
      const intervals = splitInterval(st.wire.branches, iv.s0, iv.s1);
      st.stents.push({
        intervals,
        pathS0: iv.s0,
        pathS1: iv.s1,
        nominal: c.diameter,
        length: c.length,
        diameter: d,
        maxPressure: c.pressure,
        time: st.time,
      });
      const idx = st.stents.length - 1;
      c.deployedIndex = idx;
      for (const it of intervals) st.treatments.push({ ...it, diameter: d, kind: 'stent', stentIndex: idx });
      pushMessage(st, 'Stent deployed. Keep the pressure for a few seconds, then deflate.', 'ok');
    }
    // Post-dilation of any stent the inflated balloon sits inside.
    if (c.pressure >= DEVICES.unfoldBelow) {
      st.stents.forEach((s) => {
        const overlap = Math.min(s.pathS1, iv.s1) - Math.max(s.pathS0, iv.s0);
        if (overlap > 0.5 * Math.min(s.length, c.length) && d > s.diameter) {
          s.diameter = d;
          s.maxPressure = Math.max(s.maxPressure, c.pressure);
        }
      });
      sealDissections(st);
    }
    // Oversizing → dissection (once per inflation).
    if (!c.dissectedThisInflation && c.pressure >= DEVICES.unfoldBelow) {
      const mid = (iv.s0 + iv.s1) / 2;
      const ref = refAtPath(st, mid);
      if (d > DEVICES.dissectionOversize * ref) {
        c.dissectedThisInflation = true;
        if (c.kind === 'stent') {
          addDissection(st, iv.s1 + DEVICES.edgeDissectionOffset, 'stent-edge');
          pushMessage(st, `Edge dissection: the stent (${d.toFixed(2)} mm) is far larger than the vessel (${ref.toFixed(2)} mm).`, 'danger');
        } else {
          addDissection(st, mid, 'balloon');
          pushMessage(st, `Dissection: the balloon (${d.toFixed(2)} mm) is oversized for a ${ref.toFixed(2)} mm vessel.`, 'danger');
        }
      }
    }
    // Deflated → record inflation and commit plain-balloon effect.
    if (c.pressure <= 0.05) {
      const lesion = lesionPathRange();
      const rec = {
        kind: c.kind,
        start: c.inflStart,
        duration: st.time - c.inflStart,
        maxPressure: c.maxP,
        maxDiameter: c.maxD,
        pathS0: iv.s0,
        pathS1: iv.s1,
        overLesion: st.wire.branches[1] === 'LAD' && iv.s0 <= lesion.center && iv.s1 >= lesion.center,
      };
      st.inflations.push(rec);
      if (c.kind === 'balloon' && c.maxP >= DEVICES.unfoldBelow && !c.ruptured) {
        for (const it of splitInterval(st.wire.branches, iv.s0, iv.s1)) st.treatments.push({ ...it, diameter: c.maxD, kind: 'balloon' });
      }
      c.inflStart = null;
      c.pressure = 0;
      if (rec.overLesion && rec.maxPressure >= 6 && c.kind === 'balloon') pushMessage(st, 'Pre-dilated. Withdraw the balloon into the guide.', 'ok');
    }
  }
}

function addDissection(st: SimState, pathS: number, cause: 'balloon' | 'stent-edge' | 'rupture'): void {
  const { vessel, s } = pathToVessel(st.wire.branches, pathS);
  st.dissections.push({ vessel, s, sealed: false, cause, time: st.time });
}

/** A dissection is sealed once a deployed stent covers it. */
export function sealDissections(st: SimState): void {
  for (const d of st.dissections) {
    if (d.sealed) continue;
    for (const s of st.stents)
      for (const it of s.intervals)
        if (it.vessel === d.vessel && d.s >= it.s0 - 1 && d.s <= it.s1 + 1) {
          d.sealed = true;
          pushMessage(st, 'Dissection sealed by the stent.', 'ok');
        }
  }
}
