import { DEVICES } from '../config/anatomy';
import { getAnatomy, lesionPathRange } from '../anatomy/vessels';
import { angleDiff } from '../math/vec';
import { coverageMargins } from '../physics/devices';
import { SimState } from '../state/store';
import { cathInterval, cathOut } from '../tools/controller';
import { currentStage } from './stages';

/** Calm, situation-specific next-step hint for the mentor panel. */
export function mentorHint(st: SimState): string {
  const a = getAnatomy();
  const G = DEVICES.guide;
  const stage = currentStage(st.stages.done);
  const lesion = lesionPathRange();
  if (st.phys.unstable) return 'The patient is unstable. Deflate the balloon now (hold Q) and let the heart recover.';
  if (st.cath.pressure > 0 && st.phys.occlusionTime > 25) return 'The LAD has been occluded for a while. Finish this inflation and deflate (Q).';
  switch (stage) {
    case 0:
      if (st.tool !== 'guide') return 'Press 1 to pick up the guide catheter.';
      if (st.guide.s < a.routeAortaS) return 'Hold W (or scroll) to advance the guide up the arm. Tap Space for a quick fluoro look.';
      if (!st.flags.fluoroInChest) return 'Tap Space (fluoro) to confirm the catheter is in the chest.';
      return 'Keep advancing down the ascending aorta to the root.';
    case 1: {
      if (!st.guide.engaged) {
        const d = angleDiff(G.leftCusp, st.guide.rot);
        if (Math.abs(d) > G.engageTolerance) return `Rotate the tip ${d > 0 ? 'with D' : 'with A'} until the dial points to LEFT (left coronary cusp).`;
        return 'Facing the left cusp. Hold Shift + W to advance gently and seat the guide.';
      }
      return 'Inject contrast (C) for a diagnostic angiogram. Switch to the X-ray view (Tab) to watch.';
    }
    case 2:
      if (!st.phys.heparin) return 'Give heparin (G) before the wire goes in.';
      if (st.tool !== 'wire') return 'Press 2 to take the guidewire.';
      if (st.wire.branches[1] === 'LCx') return 'You are in the LCx. Pull back (S) into the left main and rotate the tip toward the LAD (dial near 0°).';
      if (st.wire.branches.length > 2) return `The wire is in ${st.wire.branches[2]}. Pull back (S) and rotate the tip away from it.`;
      if (st.wire.branches.length === 1) return 'Rotate the tip toward the LAD (dial near 0°, away from the LCx at 180°), then advance with W.';
      if (st.wire.buckling) return 'The wire is buckling. Ease off: use Shift for fine advance or rotate gently while advancing.';
      if (!st.wire.crossed) return st.wire.s > lesion.s0 - 6 ? 'At the lesion: cross slowly with Shift + W (or add gentle torque).' : 'Advance down the LAD toward the lesion, keeping the tip away from the diagonals.';
      return 'Lesion crossed. Park the tip well beyond it in the distal LAD.';
    case 3: {
      if (st.tool !== 'balloon' || !st.cath.kind) return 'Press 3 for a pre-dilation balloon. An undersized balloon (≈ 0.8× reference, e.g. 2.5 mm) is safer.';
      if (!cathOut(st)) return 'Pick a size in the device panel, then advance (W) out of the guide over the wire.';
      const iv = cathInterval(st);
      const mid = (iv.s0 + iv.s1) / 2;
      if (st.cath.pressure <= 0 && !st.inflations.some((i) => i.overLesion && i.maxPressure >= 6)) {
        if (Math.abs(mid - lesion.center) > 2) return `Centre the markers on the lesion: ${mid < lesion.center ? 'advance' : 'pull back'} ${Math.abs(mid - lesion.center).toFixed(1)} mm.`;
        return 'Markers straddle the lesion. Hold E to inflate to ~8–10 atm.';
      }
      if (st.cath.pressure > 0) return 'Hold for a few seconds while watching the ECG, then deflate with Q.';
      return 'Deflated.';
    }
    case 4: {
      if (!st.qca) return 'Press 7 and measure the lesion (QCA) before choosing a stent.';
      if (st.cath.kind === 'balloon' && cathOut(st)) return 'Withdraw the balloon into the guide (hold S).';
      if (st.tool !== 'stent') return `Press 4 for a stent. Reference ${st.qca.referenceDiameter.toFixed(2)} mm, lesion ${st.qca.lesionLength.toFixed(1)} mm: pick ≈1:1 diameter and a length that covers it with margin.`;
      if (!cathOut(st)) return 'Choose the stent size while it is in the guide, then advance.';
      if (st.stents.length === 0) {
        const m = coverageMargins(cathInterval(st), lesion);
        if (!m.covers || m.min < 1) return `Position: proximal margin ${m.proximal.toFixed(1)} mm, distal ${m.distal.toFixed(1)} mm. Aim for ≥ 1.5 mm each side.`;
        return 'Good position. Hold E to deploy (≥ 6 atm deploys; ~10–12 atm expands fully).';
      }
      if (st.cath.pressure > 0) return 'Stent deployed. Hold a few seconds, then deflate (Q).';
      return 'Withdraw the delivery balloon (hold S).';
    }
    case 5:
      if (st.cath.kind && cathOut(st)) return 'Withdraw the delivery balloon into the guide (hold S).';
      if (!st.injections.some((i) => i.afterStent)) return 'Inject contrast (C) to see the result.';
      return 'Change projection (V or arrows) and inject again for a second view.';
    default:
      return 'All stages complete. Review the debrief.';
  }
}

export function guideLocation(st: SimState): string {
  const a = getAnatomy();
  const s = st.guide.s;
  if (st.guide.engaged) return 'Engaged in the left main';
  if (s >= a.route.length - 0.5) return 'Aortic root';
  if (s >= a.routeAortaS) return 'Ascending aorta';
  const t = s / a.routeAortaS;
  if (t < 0.32) return 'Forearm (radial)';
  if (t < 0.55) return 'Upper arm (brachial)';
  if (t < 0.8) return 'Axillary / subclavian';
  return 'Brachiocephalic trunk';
}

/** Upcoming branch hint for the wire. */
export function branchHint(st: SimState): string {
  const a = getAnatomy();
  const w = st.wire;
  if (w.s <= 0) return 'Wire inside the guide.';
  const last = w.branches[w.branches.length - 1];
  const v = a.vessels.get(last)!;
  const offset = w.branches.length > 1 ? pathOffset(w.branches) : 0;
  const local = w.s - offset;
  for (const cid of v.children) {
    const c = a.vessels.get(cid)!;
    const dist = c.parentS - local;
    if (dist > 0 && dist < DEVICES.wire.hintAheadMm) {
      if (last === 'LM') {
        const toLCx = Math.abs(angleDiff(w.rot, 180)) <= 90;
        return `Bifurcation in ${dist.toFixed(0)} mm: the tip will go to the ${toLCx ? 'LCx' : 'LAD'}.`;
      }
      const into = Math.abs(angleDiff(w.rot, c.wireAngle)) <= c.wireCapture;
      return `${c.name} in ${dist.toFixed(0)} mm: tip will ${into ? `enter ${c.name}` : `stay in ${v.name}`}.`;
    }
  }
  return `${v.name}, ${local.toFixed(0)} mm in.`;
}

function pathOffset(branches: string[]): number {
  const a = getAnatomy();
  let off = 0;
  for (let i = 1; i < branches.length; i++) off += a.vessels.get(branches[i])!.parentS;
  return off;
}
