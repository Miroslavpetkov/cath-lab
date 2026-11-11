import { PHYSIOLOGY } from '../config/anatomy';

export interface Physiology {
  ischaemia: number; // 0..1
  occlusionTime: number; // s of current continuous occlusion
  hr: number;
  sys: number;
  dia: number;
  spo2: number;
  st: number; // mm ST elevation in V2
  act: number;
  heparin: boolean;
  unstable: boolean;
  alarm: boolean;
  pvcRate: number; // probability that a beat is a PVC
  chestPain: boolean;
}

export function initialPhysiology(): Physiology {
  return {
    ischaemia: 0,
    occlusionTime: 0,
    hr: PHYSIOLOGY.baseHR,
    sys: PHYSIOLOGY.baseSys,
    dia: PHYSIOLOGY.baseDia,
    spo2: PHYSIOLOGY.spo2,
    st: 0,
    act: PHYSIOLOGY.actBase,
    heparin: false,
    unstable: false,
    alarm: false,
    pvcRate: 0,
    chestPain: false,
  };
}

/**
 * Advance the patient model. `ladFlow` is the relative flow reaching the distal LAD
 * (0 = occluded). Pure: returns a new object.
 */
export function stepPhysiology(p: Physiology, ladFlow: number, dt: number): Physiology {
  const P = PHYSIOLOGY;
  const n = { ...p };
  const occluded = ladFlow <= 0.02;
  if (occluded) {
    n.occlusionTime = p.occlusionTime + dt;
    n.ischaemia = Math.min(1, p.ischaemia + dt / P.ischaemiaRiseTime);
  } else {
    n.occlusionTime = 0;
    const target = ladFlow < P.poorFlowThreshold ? 0.6 * (1 - ladFlow / P.poorFlowThreshold) : 0;
    if (p.ischaemia < target) n.ischaemia = Math.min(target, p.ischaemia + dt / P.ischaemiaRiseTime);
    else n.ischaemia = target + (p.ischaemia - target) * Math.exp(-dt / P.recoveryTau);
  }
  n.st = P.maxST * n.ischaemia;
  n.chestPain = n.ischaemia > 0.35;
  const dropping = n.occlusionTime > P.dropAfter;
  n.unstable = n.occlusionTime > P.unstableAfter;
  n.hr = P.baseHR + P.maxHRRise * n.ischaemia + (n.unstable ? 14 : 0);
  n.sys = P.baseSys - (dropping ? 26 : 0) - (n.unstable ? 22 : 0) - 6 * n.ischaemia;
  n.dia = P.baseDia - (dropping ? 12 : 0) - (n.unstable ? 10 : 0);
  n.spo2 = n.unstable ? 94 : P.spo2;
  n.pvcRate = dropping ? P.pvcProbability : 0;
  n.alarm = n.unstable || n.sys < 90;
  if (p.heparin) n.act = P.actHeparin + (p.act - P.actHeparin) * Math.exp(-dt / P.actTau);
  return n;
}

export function giveHeparin(p: Physiology): Physiology {
  return { ...p, heparin: true };
}
